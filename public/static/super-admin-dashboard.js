// ============================================================
// SUPER ADMIN COMMAND CENTER — Post-Login Dashboard
// Views: Active Users | Credit Pack Sales | Order History | Sign-ups | Sales & Marketing
// Only accessible by superadmin
// ============================================================

const SA = {
  view: 'users',
  loading: true,
  data: {},
  salesPeriod: 'monthly',
  signupsPeriod: 'monthly',
  ordersFilter: '',
  analyticsPeriod: '7d',
  ga4Period: '7d',
  ga4Tab: 'overview',
  secRevPeriod: 'monthly',
  secCallsCustomerId: '',
  lkTab: 'overview'
};

document.addEventListener('DOMContentLoaded', () => {
  loadView('users');

  // Auto-prompt for push notifications after dashboard loads
  setTimeout(() => {
    if (window.RoofPush && localStorage.getItem('rc_token')) {
      window.RoofPush.autoPrompt();
    }
  }, 3000);
});

window.saDashboardSetView = function(v) {
  SA.view = v;
  // Reset secretary manager sub-views when navigating from sidebar
  if (v === 'secretary-manager') { SA.smView = 'list'; SA.smDetail = null; SA.smCustomerId = null; }
  loadView(v);
};

// Admin auth headers — send Bearer token with every admin API call
function saHeaders() {
  const token = localStorage.getItem('rc_token');
  return token ? { 'Authorization': 'Bearer ' + token } : {};
}

async function saFetch(url, opts) {
  // CRITICAL: Merge headers properly — don't let opts.headers overwrite auth token
  var mergedOpts = Object.assign({}, opts || {});
  mergedOpts.headers = Object.assign({}, saHeaders(), mergedOpts.headers || {});
  const res = await fetch(url, mergedOpts);
  if (res.status === 401) {
    // Session expired or invalid — always redirect to login
    localStorage.removeItem('rc_user');
    localStorage.removeItem('rc_token');
    window.location.href = '/login';
    return null;
  }
  if (res.status === 403) {
    // Permission issue (e.g. not superadmin) — return error without logout
    return res;
  }
  return res;
}

async function loadView(view) {
  SA.loading = true;
  renderContent();
  try {
    switch (view) {
      case 'users':
        const usersRes = await saFetch('/api/admin/superadmin/users');
        if (usersRes && usersRes.ok) SA.data.users = await usersRes.json();
        else if (usersRes) console.error('Failed to load users:', usersRes.status);
        break;
      case 'sales':
        const salesRes = await saFetch(`/api/admin/superadmin/sales?period=${SA.salesPeriod}`);
        if (salesRes && salesRes.ok) SA.data.sales = await salesRes.json();
        else if (salesRes) console.error('Failed to load sales:', salesRes.status);
        break;
      case 'report-requests':
        const [reportReqRes, needsTraceRes2] = await Promise.all([
          saFetch(`/api/admin/superadmin/orders?limit=200&status=${SA.reportReqFilter || ''}`),
          saFetch('/api/admin/superadmin/orders/needs-trace')
        ]);
        if (reportReqRes && reportReqRes.ok) SA.data.reportRequests = await reportReqRes.json();
        if (needsTraceRes2 && needsTraceRes2.ok) {
          SA.data.needsTrace = await needsTraceRes2.json();
          var ntCount = (SA.data.needsTrace.orders || []).length;
          var badge = document.getElementById('sa-report-req-badge');
          if (badge) { badge.textContent = ntCount; badge.style.display = ntCount > 0 ? '' : 'none'; }
        }
        break;
      case 'orders':
        const [ordersRes, needsTraceRes] = await Promise.all([
          saFetch(`/api/admin/superadmin/orders?limit=100&status=${SA.ordersFilter}`),
          saFetch('/api/admin/superadmin/orders/needs-trace')
        ]);
        if (ordersRes && ordersRes.ok) SA.data.orders = await ordersRes.json();
        else if (ordersRes) console.error('Failed to load orders:', ordersRes.status);
        if (needsTraceRes && needsTraceRes.ok) SA.data.needsTrace = await needsTraceRes.json();
        break;
      case 'signups':
        const signupsRes = await saFetch(`/api/admin/superadmin/signups?period=${SA.signupsPeriod}`);
        if (signupsRes && signupsRes.ok) SA.data.signups = await signupsRes.json();
        else if (signupsRes) console.error('Failed to load signups:', signupsRes.status);
        break;
      case 'marketing':
        const mktRes = await saFetch('/api/admin/superadmin/marketing');
        if (mktRes && mktRes.ok) SA.data.marketing = await mktRes.json();
        else if (mktRes) console.error('Failed to load marketing:', mktRes.status);
        break;
      case 'email-outreach':
        // Handled by email-outreach.js module
        if (typeof window.loadEmailOutreach === 'function') {
          SA.loading = false;
          window.loadEmailOutreach();
          return;
        }
        break;
      case 'email-setup':
        const gmailStatusRes = await saFetch('/api/auth/gmail/status');
        if (gmailStatusRes) SA.data.emailSetup = await gmailStatusRes.json();
        break;
      case 'blog-manager':
        const [bmPostsRes, bmCatsRes] = await Promise.all([
          saFetch('/api/blog/admin/posts?limit=200'),
          saFetch('/api/blog/categories')
        ]);
        if (bmPostsRes && bmPostsRes.ok) SA.data.blog_posts = await bmPostsRes.json();
        if (bmCatsRes && bmCatsRes.ok) SA.data.blog_categories = await bmCatsRes.json();
        break;
      case 'analytics':
        const analyticsRes = await saFetch(`/api/analytics/dashboard?period=${SA.analyticsPeriod}`);
        if (analyticsRes) SA.data.analytics = await analyticsRes.json();
        break;
      case 'ga4':
        const [ga4StatusRes, ga4ReportRes, ga4RealtimeRes] = await Promise.all([
          saFetch('/api/analytics/ga4/status'),
          saFetch(`/api/analytics/ga4/report?period=${SA.ga4Period}`),
          saFetch('/api/analytics/ga4/realtime')
        ]);
        if (ga4StatusRes) SA.data.ga4_status = await ga4StatusRes.json();
        if (ga4ReportRes) { const r = await ga4ReportRes.json(); SA.data.ga4_report = r.success ? r : null; }
        if (ga4RealtimeRes) { const r = await ga4RealtimeRes.json(); SA.data.ga4_realtime = r.success ? r : null; }
        break;
      case 'pricing':
        const pricingRes = await saFetch('/api/settings/pricing/config');
        if (pricingRes) SA.data.pricing = await pricingRes.json();
        const squareRes = await saFetch('/api/settings/square/status');
        if (squareRes) SA.data.square = await squareRes.json();
        break;
      case 'api-users':
        var apiUsersRes = await saFetch('/api/admin/superadmin/api-accounts');
        if (apiUsersRes && apiUsersRes.ok) {
          SA.data.apiUsers = await apiUsersRes.json();
          var badge = document.getElementById('sa-api-badge');
          var activeJobs = (SA.data.apiUsers.accounts || []).reduce(function(s, a) { return s + (a.active_jobs || 0); }, 0);
          if (badge) { badge.textContent = activeJobs; badge.style.display = activeJobs > 0 ? '' : 'none'; }
        }
        break;
      case 'call-center':
        // Handled by call-center.js module
        if (typeof window.loadCallCenter === 'function') {
          SA.loading = false;
          window.loadCallCenter();
          return;
        }
        break;
      case 'meta-connect':
        // Handled by meta-connect.js module
        if (typeof window.loadMetaConnect === 'function') {
          SA.loading = false;
          window.loadMetaConnect();
          return;
        }
        break;
      case 'heygen':
        // Handled by heygen.js module
        if (typeof window.loadHeyGen === 'function') {
          SA.loading = false;
          window.loadHeyGen();
          return;
        }
        break;
      case 'secretary-admin':
        try {
          const [secOverviewRes, secSubsRes] = await Promise.all([
            saFetch('/api/admin/superadmin/secretary/overview'),
            saFetch('/api/admin/superadmin/secretary/subscribers'),
          ]);
          if (secOverviewRes) SA.data.secretary_overview = await secOverviewRes.json();
          if (secSubsRes) SA.data.secretary_subscribers = await secSubsRes.json();
        } catch(secErr) {
          console.warn('Secretary admin load error:', secErr);
        }
        break;
      case 'secretary-manager':
        // Reset sub-view to list when navigating from sidebar (not from internal navigation)
        if (!SA.smView || SA.smView === 'list') SA.smView = 'list';
        // Only load data for list view; detail view loads its own data
        if (SA.smView === 'list') {
          try {
            const [smConfigsRes, smPoolRes] = await Promise.all([
              saFetch('/api/admin/superadmin/livekit/secretary-configs'),
              saFetch('/api/admin/superadmin/livekit/phone-pool'),
            ]);
            if (smConfigsRes) SA.data.sm_configs = await smConfigsRes.json();
            if (smPoolRes) SA.data.sm_pool = await smPoolRes.json();
          } catch(smErr) { console.warn('Secretary Manager load error:', smErr); }
        }
        break;
      case 'secretary-revenue':
        try {
          const secRevRes = await saFetch(`/api/admin/superadmin/secretary/revenue?period=${SA.secRevPeriod || 'monthly'}`);
          if (secRevRes) SA.data.secretary_revenue = await secRevRes.json();
        } catch(e) {
          console.warn('Secretary revenue load error:', e);
        }
        break;
      case 'ai-chat':
        // Redirected to Gemini Command Center
        SA.currentView = 'gemini-command';
        break;
      case 'invoices':
        try {
          const [invListRes, invStatsRes, invCustRes] = await Promise.all([
            saFetch('/api/invoices'),
            saFetch('/api/invoices/stats/summary'),
            saFetch('/api/invoices/customers/list')
          ]);
          if (invListRes) SA.data.invoices = await invListRes.json();
          if (invStatsRes) SA.data.invoice_stats = await invStatsRes.json();
          if (invCustRes) SA.data.invoice_customers = await invCustRes.json();
        } catch(e) { console.warn('Invoice load error:', e); }
        break;
      case 'telephony':
        // Load telephony/LiveKit status
        try {
          const telRes = await saFetch('/api/admin/superadmin/telephony-status');
          if (telRes) SA.data.telephony = await telRes.json();
        } catch(e) { SA.data.telephony = {}; }
        break;
      case 'livekit-agents':
        try {
          const [lkRes, lkConfigsRes, lkPoolRes] = await Promise.all([
            saFetch('/api/admin/superadmin/livekit/overview'),
            saFetch('/api/admin/superadmin/livekit/secretary-configs'),
            saFetch('/api/admin/superadmin/livekit/phone-pool'),
          ]);
          if (lkRes) SA.data.livekit = await lkRes.json();
          if (lkConfigsRes) SA.data.livekitConfigs = await lkConfigsRes.json();
          if (lkPoolRes) SA.data.livekitPool = await lkPoolRes.json();
        } catch(e) { SA.data.livekit = { configured: false, error: e.message }; }
        break;
      case 'customer-onboarding':
        try {
          const obRes = await saFetch('/api/admin/superadmin/onboarding/list');
          if (obRes) SA.data.onboarding = await obRes.json();
        } catch(e) { SA.data.onboarding = { customers: [] }; }
        // Also pre-fetch deployment status and phone pool in background (non-blocking)
        saFetch('/api/admin/superadmin/secretary/deployment-status').then(function(r) { return r ? r.json() : null; }).then(function(d) { if (d) { SA.data.deployments = d; obRenderDeployments(); } }).catch(function(){});
        saFetch('/api/admin/superadmin/phone-numbers/owned').then(function(r) { return r ? r.json() : null; }).then(function(d) { if (d) { SA.data.phonePool = d; obRenderPhonePool(); } }).catch(function(){});
        break;
      case 'service-invoices':
        try {
          const siRes = await saFetch('/api/admin/superadmin/service-invoices');
          if (siRes) SA.data.service_invoices = await siRes.json();
        } catch(e) { SA.data.service_invoices = { invoices: [] }; }
        break;
      case 'call-center-manage':
        try {
          const [ccStatsRes, ccScriptsRes] = await Promise.all([
            saFetch('/api/admin/superadmin/call-center/stats'),
            saFetch('/api/admin/superadmin/sales-scripts')
          ]);
          if (ccStatsRes) SA.data.cc_stats = await ccStatsRes.json();
          if (ccScriptsRes) SA.data.cc_scripts = await ccScriptsRes.json();
        } catch(e) { SA.data.cc_stats = {}; SA.data.cc_scripts = { scripts: [] }; }
        break;
      case 'onboarding-config':
        try {
          const obcRes = await saFetch('/api/admin/superadmin/onboarding/config');
          if (obcRes) SA.data.onboarding_config = await obcRes.json();
        } catch(e) { SA.data.onboarding_config = { config: {} }; }
        break;
      case 'phone-marketplace':
        try {
          const pnRes = await saFetch('/api/admin/superadmin/phone-numbers/owned');
          if (pnRes) SA.data.phone_numbers = await pnRes.json();
        } catch(e) { SA.data.phone_numbers = { numbers: [] }; }
        break;
      case 'secretary-monitor':
        try {
          const smRes = await saFetch('/api/admin/superadmin/secretary/monitor');
          if (smRes) SA.data.secretary_monitor = await smRes.json();
        } catch(e) { SA.data.secretary_monitor = { agents: [], global: {}, recent_calls: [], summary: {} }; }
        break;
      case 'gemini-command':
        // Check Gemini API status on first load
        if (!SA.data.gemini_status) {
          try {
            const gRes = await saFetch('/api/gemini/status');
            if (gRes) SA.data.gemini_status = await gRes.json();
          } catch(e) { SA.data.gemini_status = { configured: false, error: e.message }; }
        }
        break;
      // Platform Admin views — handled by platform-admin.js
      case 'enhanced-onboarding':
      case 'service-panel':
      case 'membership-config':
      case 'agent-personas':
      case 'cold-call-centre':
      case 'live-dashboard':
      case 'transcript-flagging':
        break;
    }
  } catch (e) {
    console.error('Load error:', e);
  }
  SA.loading = false;
  renderContent();
}

// ============================================================
// HELPERS
// ============================================================
function samc(label, value, icon, color, sub) {
  return `<div class="metric-card bg-white rounded-2xl p-5">
    <div class="flex items-start justify-between">
      <div>
        <p class="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">${label}</p>
        <p class="text-[26px] font-extrabold text-slate-800 mt-1 leading-tight">${value}</p>
        ${sub ? `<p class="text-[11px] text-slate-400 mt-1.5">${sub}</p>` : ''}
      </div>
      <div class="w-11 h-11 bg-${color}-50 rounded-xl flex items-center justify-center"><i class="fas ${icon} text-${color}-500 text-sm"></i></div>
    </div>
  </div>`;
}

function $$(v) { return '$' + (v || 0).toFixed(2); }
function centsToD(c) { return '$' + ((c || 0) / 100).toFixed(2); }
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('en-CA') : '-'; }
function fmtDateTime(d) { return d ? new Date(d).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' }) : '-'; }
function fmtSeconds(s) {
  if (!s || s <= 0) return '-';
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.floor(s/60)}m ${Math.round(s%60)}s`;
  return `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m`;
}

function statusBadge(s) {
  const m = { pending:'bg-yellow-100 text-yellow-800', processing:'bg-indigo-100 text-indigo-800', completed:'bg-green-100 text-green-800', failed:'bg-red-100 text-red-800', cancelled:'bg-gray-100 text-gray-500' };
  return `<span class="px-2 py-0.5 ${m[s]||'bg-gray-100 text-gray-600'} rounded-full text-xs font-medium capitalize">${s}</span>`;
}

function payBadge(s) {
  const m = { unpaid:'bg-yellow-100 text-yellow-800', paid:'bg-green-100 text-green-800', refunded:'bg-purple-100 text-purple-800', trial:'bg-blue-100 text-blue-800' };
  return `<span class="px-2 py-0.5 ${m[s]||'bg-gray-100 text-gray-600'} rounded-full text-xs font-medium capitalize">${s === 'trial' ? 'Free Trial' : s}</span>`;
}

function saSection(title, icon, content, actions) {
  return `<div class="sa-section">
    <div class="sa-section-header">
      <h3><i class="fas ${icon}"></i>${title}</h3>
      ${actions || ''}
    </div>
    <div class="sa-section-body">${content}</div>
  </div>`;
}

function periodDropdown(current, onchangeFn) {
  return `<select onchange="${onchangeFn}(this.value)" class="text-xs border border-slate-200 rounded-lg px-3 py-2 bg-white focus:ring-2 focus:ring-teal-500 focus:border-teal-500 font-medium text-slate-600 appearance-none cursor-pointer">
    <option value="daily" ${current === 'daily' ? 'selected' : ''}>Daily (Last 30 Days)</option>
    <option value="weekly" ${current === 'weekly' ? 'selected' : ''}>Weekly (Last 12 Weeks)</option>
    <option value="monthly" ${current === 'monthly' ? 'selected' : ''}>Monthly (Last 12 Months)</option>
  </select>`;
}

// ============================================================
// MAIN RENDER
// ============================================================
function renderContent() {
  const root = document.getElementById('sa-root');
  if (!root) return;

  if (SA.loading) {
    root.innerHTML = `<div class="flex flex-col items-center justify-center py-24">
      <div class="w-10 h-10 border-[3px] border-teal-100 border-t-teal-500 rounded-full animate-spin"></div>
      <span class="mt-4 text-slate-400 text-sm font-medium">Loading dashboard...</span>
    </div>`;
    return;
  }

  switch (SA.view) {
    case 'users': root.innerHTML = renderUsersView(); break;
    case 'sales': root.innerHTML = renderSalesView(); break;
    case 'report-requests': root.innerHTML = renderReportRequestsView(); break;
    case 'orders': root.innerHTML = renderOrdersView(); break;
    case 'signups': root.innerHTML = renderSignupsView(); break;
    case 'marketing': root.innerHTML = renderMarketingView(); break;
    case 'email-outreach': break; // Handled by email-outreach.js
    case 'email-setup': root.innerHTML = renderEmailSetupView(); break;
    case 'analytics': root.innerHTML = renderAnalyticsView(); break;
    case 'blog-manager': root.innerHTML = renderBlogManagerView(); break;
    case 'ga4': root.innerHTML = renderGA4View(); break;
    case 'pricing': root.innerHTML = renderPricingView(); break;
    case 'api-users': root.innerHTML = renderApiUsersView(); break;
    case 'call-center': break; // Handled by call-center.js
    case 'meta-connect': break; // Handled by meta-connect.js
    case 'secretary-admin': root.innerHTML = renderSecretaryAdminView(); break;
    case 'secretary-manager': root.innerHTML = renderSecretaryManagerView(); break;
    case 'secretary-monitor': root.innerHTML = renderSecretaryMonitorView(); break;
    case 'secretary-revenue': root.innerHTML = renderSecretaryRevenueView(); break;
    case 'ai-chat': root.innerHTML = renderGeminiCommandView(); break; // Redirect to Gemini
    case 'contact-forms': root.innerHTML = renderContactFormsView(); loadContactForms(); break;
    case 'seo-manager': root.innerHTML = renderSEOManagerView(); break;
    case 'onboarding-config': root.innerHTML = renderOnboardingConfigView(); loadOnboardingConfig(); break;
    case 'phone-marketplace': root.innerHTML = renderPhoneMarketplaceView(); loadPhoneNumbers(); break;
    case 'pricing-engine': root.innerHTML = renderPricingEngineView(); loadPricingPresets(); break;
    case 'invoices': root.innerHTML = renderInvoicesView(); break;
    case 'telephony': root.innerHTML = renderTelephonyView(); break;
    case 'livekit-agents': root.innerHTML = renderLiveKitAgentsView(); break;
    case 'revenue-pipeline': root.innerHTML = renderRevenuePipelineView(); loadRevenuePipeline(); break;
    case 'notifications-admin': root.innerHTML = renderNotificationsAdminView(); loadNotifications(); break;
    case 'webhooks': root.innerHTML = renderWebhooksView(); loadWebhooks(); break;
    case 'paywall': root.innerHTML = renderPaywallView(); loadPaywallStatus(); break;
    case 'customer-onboarding': root.innerHTML = renderCustomerOnboardingView(); obLoadDeployments(); obLoadPhonePool(); break;
    case 'service-invoices': root.innerHTML = renderServiceInvoicesView(); break;
    case 'call-center-manage': root.innerHTML = renderCallCenterManageView(); break;
    case 'gemini-command': root.innerHTML = renderGeminiCommandView(); break;
    // Platform Admin modules
    case 'enhanced-onboarding': root.innerHTML = (typeof renderEnhancedOnboardingView === 'function') ? renderEnhancedOnboardingView() : '<div class="p-8 text-gray-500">Module loading...</div>'; paLoadTiers(); break;
    case 'service-panel': root.innerHTML = (typeof renderServicePanelView === 'function') ? renderServicePanelView() : '<div class="p-8 text-gray-500">Module loading...</div>'; paLoadServicePanel(); break;
    case 'membership-config': root.innerHTML = (typeof renderMembershipConfigView === 'function') ? renderMembershipConfigView() : '<div class="p-8 text-gray-500">Module loading...</div>'; paLoadMembershipConfig(); break;
    case 'agent-personas': root.innerHTML = (typeof renderAgentPersonasView === 'function') ? renderAgentPersonasView() : '<div class="p-8 text-gray-500">Module loading...</div>'; paLoadPersonas(); break;
    case 'cold-call-centre': root.innerHTML = (typeof renderColdCallCentreView === 'function') ? renderColdCallCentreView() : '<div class="p-8 text-gray-500">Module loading...</div>'; paShowCCTab('agents'); break;
    case 'live-dashboard': root.innerHTML = (typeof renderLiveDashboardView === 'function') ? renderLiveDashboardView() : '<div class="p-8 text-gray-500">Module loading...</div>'; paLoadLiveDashboard(); break;
    case 'transcript-flagging': root.innerHTML = (typeof renderTranscriptFlaggingView === 'function') ? renderTranscriptFlaggingView() : '<div class="p-8 text-gray-500">Module loading...</div>'; paLoadFlags(); break;
    default: root.innerHTML = renderUsersView();
  }
}

// ============================================================
// VIEW 1: ALL ACTIVE USERS
// ============================================================
function renderUsersView() {
  const d = SA.data.users || {};
  const users = d.users || [];
  const s = d.summary || {};

  return `
    <div class="mb-6">
      <h2 class="text-2xl font-black text-gray-900"><i class="fas fa-users mr-2 text-teal-500"></i>All Users</h2>
      <p class="text-sm text-gray-500 mt-1">Complete user registry with account details, credits, and order history</p>
    </div>

    <div class="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
      ${samc('Total Users', s.total_users || users.length, 'fa-users', 'blue')}
      ${samc('Active Users', s.active_users || 0, 'fa-user-check', 'green', (s.new_signups_7d || 0) + ' new (7d) · ' + (s.new_signups_30d || 0) + ' new (30d)')}
      ${samc('Google Sign-In', s.google_users || 0, 'fa-google', 'red')}
      ${samc('Paying Customers', s.paying_users || 0, 'fa-credit-card', 'amber')}
      ${samc('Credits Available', s.total_credits_available || 0, 'fa-coins', 'indigo', (s.total_credits_used || 0) + ' used')}
    </div>

    ${saSection('User Registry (' + users.length + ')', 'fa-table', `
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">User</th>
              <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Company</th>
              <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Contact</th>
              <th class="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Auth</th>
              <th class="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Free Trial</th>
              <th class="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Credits</th>
              <th class="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Orders</th>
              <th class="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Completed</th>
              <th class="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Revenue</th>
              <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Last Order</th>
              <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Joined</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-50">
            ${users.length === 0 ? '<tr><td colspan="11" class="px-4 py-8 text-center text-gray-400">No registered users yet</td></tr>' : ''}
            ${users.map(u => `
              <tr class="hover:bg-teal-50/30 transition-colors">
                <td class="px-4 py-3">
                  <div class="flex items-center gap-2">
                    ${u.google_avatar ? `<img src="${u.google_avatar}" class="w-8 h-8 rounded-full border-2 border-white shadow-sm">` : `<div class="w-8 h-8 bg-gradient-to-br from-teal-500 to-teal-600 rounded-full flex items-center justify-center text-white text-xs font-bold">${(u.name||'?')[0].toUpperCase()}</div>`}
                    <div>
                      <p class="font-semibold text-gray-800 text-sm">${u.name || '-'} ${new Date(u.created_at) > new Date(Date.now() - 7*86400000) ? '<span class="ml-1 px-1.5 py-0.5 bg-green-100 text-green-700 text-[9px] font-bold rounded-full uppercase">New</span>' : ''}</p>
                      <p class="text-[10px] text-gray-400">${u.email}</p>
                    </div>
                  </div>
                </td>
                <td class="px-4 py-3 text-sm text-gray-600">${u.company_name || '-'}</td>
                <td class="px-4 py-3 text-xs text-gray-500">${u.phone || '-'}</td>
                <td class="px-4 py-3 text-center">
                  ${u.google_id ? '<span class="text-xs text-red-500"><i class="fab fa-google"></i></span>' : '<span class="text-xs text-gray-400"><i class="fas fa-envelope"></i></span>'}
                </td>
                <td class="px-4 py-3 text-center">
                  <span class="text-xs ${(u.free_trial_used || 0) >= (u.free_trial_total || 3) ? 'text-red-500 font-bold' : 'text-gray-600'}">${u.free_trial_used || 0}/${u.free_trial_total || 3}</span>
                </td>
                <td class="px-4 py-3 text-center">
                  <span class="text-xs font-medium ${(u.report_credits || 0) > 0 ? 'text-green-600' : 'text-gray-400'}">${u.report_credits || 0}</span>
                  ${(u.credits_used || 0) > 0 ? `<span class="text-[10px] text-gray-400 block">${u.credits_used} used</span>` : ''}
                </td>
                <td class="px-4 py-3 text-center font-medium text-gray-700">${u.order_count || 0}</td>
                <td class="px-4 py-3 text-center font-medium text-green-600">${u.completed_reports || 0}</td>
                <td class="px-4 py-3 text-right font-bold text-gray-800">${$$(u.total_spent)}</td>
                <td class="px-4 py-3 text-xs text-gray-500">${fmtDate(u.last_order_date)}</td>
                <td class="px-4 py-3 text-xs text-gray-500">${fmtDate(u.created_at)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `)}
  `;
}

// ============================================================
// VIEW 2: INDIVIDUAL / CREDIT PACK SALES
// ============================================================
window.saChangeSalesPeriod = function(p) {
  SA.salesPeriod = p;
  loadView('sales');
};

function renderSalesView() {
  const d = SA.data.sales || {};
  const creditSales = d.credit_sales_by_period || [];
  const orderSales = d.order_sales_by_period || [];
  const packages = d.packages || [];
  const recent = d.recent_sales || [];
  const ct = d.credit_totals || {};
  const ot = d.order_totals || {};

  return `
    <div class="mb-6 flex items-center justify-between">
      <div>
        <h2 class="text-2xl font-black text-gray-900"><i class="fas fa-credit-card mr-2 text-teal-500"></i>Credit Pack & Report Sales</h2>
        <p class="text-sm text-gray-500 mt-1">Revenue tracking from individual reports and credit pack purchases</p>
      </div>
      ${periodDropdown(SA.salesPeriod, 'saChangeSalesPeriod')}
    </div>

    <div class="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
      ${samc('Total Orders', ot.total_orders || 0, 'fa-shopping-cart', 'blue', (ot.trial_orders || 0) + ' trial')}
      ${samc('Paid Revenue', $$(ot.paid_value), 'fa-dollar-sign', 'green')}
      ${samc('Credit Purchases', ct.total_transactions || 0, 'fa-credit-card', 'indigo')}
      ${samc('Credit Revenue', centsToD(ct.paid_cents), 'fa-coins', 'amber')}
      ${samc('Trial Orders', ot.trial_orders || 0, 'fa-gift', 'purple', '$0 revenue')}
    </div>

    <!-- Credit Packages -->
    ${saSection('Credit Packages Available', 'fa-box-open', `
      <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
        ${packages.map(p => `
          <div class="border border-gray-200 rounded-xl p-4 text-center hover:border-teal-300 hover:shadow-md transition-all">
            <p class="text-2xl font-black text-gray-900">${p.credits}</p>
            <p class="text-xs font-semibold text-gray-500 uppercase">${p.name}</p>
            <p class="text-lg font-bold text-red-600 mt-1">$${(p.price_cents / 100).toFixed(2)}</p>
            <p class="text-[10px] text-gray-400">${p.description}</p>
          </div>
        `).join('')}
      </div>
    `)}

    <!-- Sales by Period -->
    <div class="grid lg:grid-cols-2 gap-6">
      ${saSection('Report Sales by Period', 'fa-chart-bar', `
        ${orderSales.length === 0 ? '<p class="text-gray-400 text-sm">No sales data yet</p>' : `
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-4 py-2 text-left text-xs font-semibold text-gray-500">Period</th>
                <th class="px-4 py-2 text-center text-xs font-semibold text-gray-500">Orders</th>
                <th class="px-4 py-2 text-center text-xs font-semibold text-gray-500">Trial</th>
                <th class="px-4 py-2 text-right text-xs font-semibold text-gray-500">Paid Value</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-50">
              ${orderSales.map(s => `
                <tr class="hover:bg-gray-50">
                  <td class="px-4 py-2 font-medium text-gray-700">${s.period}</td>
                  <td class="px-4 py-2 text-center text-gray-600">${s.orders}</td>
                  <td class="px-4 py-2 text-center text-blue-600">${s.trial_count || 0}</td>
                  <td class="px-4 py-2 text-right font-bold text-green-700">${$$(s.paid_value)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>`}
      `)}

      ${saSection('Credit Pack Sales by Period', 'fa-wallet', `
        ${creditSales.length === 0 ? '<p class="text-gray-400 text-sm">No credit pack sales yet</p>' : `
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-4 py-2 text-left text-xs font-semibold text-gray-500">Period</th>
                <th class="px-4 py-2 text-center text-xs font-semibold text-gray-500">Transactions</th>
                <th class="px-4 py-2 text-right text-xs font-semibold text-gray-500">Revenue</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-50">
              ${creditSales.map(s => `
                <tr class="hover:bg-gray-50">
                  <td class="px-4 py-2 font-medium text-gray-700">${s.period}</td>
                  <td class="px-4 py-2 text-center text-gray-600">${s.transactions}</td>
                  <td class="px-4 py-2 text-right font-bold text-green-700">${centsToD(s.paid_cents)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>`}
      `)}
    </div>

    <!-- Recent Transactions -->
    ${saSection('Recent Credit Pack Purchases', 'fa-receipt', `
      ${recent.length === 0 ? '<p class="text-gray-400 text-sm">No credit pack purchases yet</p>' : `
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-4 py-2 text-left text-xs font-semibold text-gray-500">Customer</th>
              <th class="px-4 py-2 text-left text-xs font-semibold text-gray-500">Type</th>
              <th class="px-4 py-2 text-right text-xs font-semibold text-gray-500">Amount</th>
              <th class="px-4 py-2 text-center text-xs font-semibold text-gray-500">Status</th>
              <th class="px-4 py-2 text-left text-xs font-semibold text-gray-500">Date</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-50">
            ${recent.map(s => `
              <tr class="hover:bg-gray-50">
                <td class="px-4 py-2">
                  <p class="font-medium text-gray-800">${s.customer_name || '-'}</p>
                  <p class="text-[10px] text-gray-400">${s.customer_email || ''}</p>
                </td>
                <td class="px-4 py-2 text-xs text-gray-600 capitalize">${s.payment_type || s.description || '-'}</td>
                <td class="px-4 py-2 text-right font-bold text-gray-800">${centsToD(s.amount)}</td>
                <td class="px-4 py-2 text-center">${statusBadge(s.status)}</td>
                <td class="px-4 py-2 text-xs text-gray-500">${fmtDateTime(s.created_at)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`}
    `)}
  `;
}

// ============================================================
// VIEW: REPORT REQUESTS
// ============================================================
SA.reportReqFilter = SA.reportReqFilter || '';

window.saFilterReportReq = function(s) { SA.reportReqFilter = s; loadView('report-requests'); };

function renderReportRequestsView() {
  var d = SA.data.reportRequests || {};
  var orders = d.orders || [];
  var counts = d.counts || {};
  var needsTrace = (SA.data.needsTrace || {}).orders || [];

  var statusColor = function(s) {
    return { completed: '#22c55e', processing: '#0ea5e9', pending: '#f59e0b', failed: '#ef4444', cancelled: '#6b7280' }[s] || '#6b7280';
  };
  var statusBg = function(s) {
    return { completed: 'rgba(34,197,94,0.12)', processing: 'rgba(14,165,233,0.12)', pending: 'rgba(245,158,11,0.12)', failed: 'rgba(239,68,68,0.12)', cancelled: 'rgba(107,114,128,0.12)' }[s] || 'rgba(107,114,128,0.12)';
  };

  var html = '<div class="mb-6 flex items-center justify-between flex-wrap gap-3">' +
    '<div>' +
      '<h2 style="font-size:22px;font-weight:800;color:#f9fafb"><i class="fas fa-satellite-dish mr-2" style="color:#0ea5e9"></i>Report Requests</h2>' +
      '<p style="font-size:13px;color:#6b7280;margin-top:2px">All measurement report orders — review, trace, and deliver</p>' +
    '</div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
      '<select onchange="saFilterReportReq(this.value)" style="font-size:12px;border:1px solid #374151;border-radius:8px;padding:6px 12px;background:#1f2937;color:#d1d5db">' +
        ['', 'pending', 'processing', 'completed', 'failed', 'cancelled'].map(function(s) {
          var labels = { '': 'All', pending: 'Pending', processing: 'Processing', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled' };
          return '<option value="' + s + '"' + (SA.reportReqFilter === s ? ' selected' : '') + '>' + labels[s] + '</option>';
        }).join('') +
      '</select>' +
      '<button onclick="loadView(\'report-requests\')" style="font-size:12px;border:1px solid #374151;border-radius:8px;padding:6px 12px;background:#1f2937;color:#9ca3af;cursor:pointer"><i class="fas fa-sync-alt mr-1"></i>Refresh</button>' +
    '</div>' +
  '</div>';

  // Stat cards
  html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin-bottom:24px">';
  [['Total', counts.total || 0, '#0ea5e9', 'fa-clipboard-list'],
   ['Completed', counts.completed || 0, '#22c55e', 'fa-check-circle'],
   ['Processing', counts.processing || 0, '#0ea5e9', 'fa-spinner'],
   ['Pending', counts.pending || 0, '#f59e0b', 'fa-clock'],
   ['Failed', counts.failed || 0, '#ef4444', 'fa-times-circle'],
   ['Needs Trace', needsTrace.length, '#f59e0b', 'fa-drafting-compass']
  ].forEach(function(c) {
    html += '<div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:14px;text-align:center">' +
      '<i class="fas ' + c[3] + '" style="color:' + c[2] + ';font-size:18px;margin-bottom:6px;display:block"></i>' +
      '<div style="font-size:22px;font-weight:800;color:#f9fafb">' + c[1] + '</div>' +
      '<div style="font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.5px">' + c[0] + '</div>' +
    '</div>';
  });
  html += '</div>';

  // Needs Trace queue
  if (needsTrace.length > 0) {
    html += '<div style="background:#1a1200;border:2px solid #f59e0b;border-radius:14px;padding:16px;margin-bottom:20px">' +
      '<div style="color:#fbbf24;font-size:14px;font-weight:800;margin-bottom:12px"><i class="fas fa-drafting-compass mr-2"></i>Pending Manual Traces (' + needsTrace.length + ')</div>' +
      needsTrace.map(function(o) {
        var isApi = o.source === 'api';
        var sourceBadge = isApi
          ? '<span style="display:inline-block;padding:2px 7px;background:#7c3aed;color:#fff;font-size:10px;font-weight:800;border-radius:4px;margin-left:6px;vertical-align:middle">⚡ API</span>'
          : '';
        var subLabel = isApi
          ? (o.api_company_name || 'API Client') + ' · ' + (o.order_number || '#' + o.id) + ' · ' + new Date(o.created_at).toLocaleString()
          : (o.customer_name || o.customer_email || '') + ' · ' + (o.order_number || '#' + o.id) + ' · ' + new Date(o.created_at).toLocaleString();
        var borderColor = isApi ? '#7c3aed44' : '#374151';
        return '<div style="background:#111827;border:1px solid ' + borderColor + ';border-radius:10px;padding:10px 14px;display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px;flex-wrap:wrap">' +
          '<div style="flex:1;min-width:0">' +
            '<div style="color:#f9fafb;font-weight:600;font-size:13px">' + (o.property_address || 'Unknown') + sourceBadge + '</div>' +
            '<div style="color:#6b7280;font-size:11px;margin-top:2px">' + subLabel + '</div>' +
          '</div>' +
          '<button onclick="saOpenTraceModal(' + o.id + ',' + (o.latitude || 0) + ',' + (o.longitude || 0) + ',\'' + (o.property_address || '').replace(/'/g, "\\'") + '\',\'' + (o.order_number || '') + '\')" ' +
            'style="padding:8px 16px;background:' + (isApi ? '#7c3aed' : '#f59e0b') + ';color:#fff;font-size:12px;font-weight:700;border:none;border-radius:8px;cursor:pointer;white-space:nowrap">' +
            '<i class="fas fa-drafting-compass mr-1.5"></i>Trace & Submit' +
          '</button>' +
        '</div>';
      }).join('') +
    '</div>';
  }

  // Orders table
  if (orders.length === 0) {
    html += '<div style="text-align:center;padding:48px;color:#4b5563"><i class="fas fa-inbox" style="font-size:40px;margin-bottom:12px;display:block"></i>No report requests found</div>';
  } else {
    html += '<div style="background:#1e293b;border:1px solid #334155;border-radius:14px;overflow:hidden">' +
      '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">' +
        '<thead><tr style="background:#0f172a;border-bottom:1px solid #334155">' +
          ['Order #', 'Customer', 'Property Address', 'Date', 'Status', 'Report', 'Actions'].map(function(h) {
            return '<th style="padding:12px 14px;text-align:left;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap">' + h + '</th>';
          }).join('') +
        '</tr></thead><tbody>';

    orders.forEach(function(o, i) {
      var rs = o.report_status || 'pending';
      var os = o.status || 'pending';
      html += '<tr style="border-bottom:1px solid #1e293b;background:' + (i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)') + '">' +
        '<td style="padding:11px 14px;font-family:monospace;font-size:12px;color:#94a3b8;white-space:nowrap">' + (o.order_number || '#' + o.id) + '</td>' +
        '<td style="padding:11px 14px;color:#cbd5e1;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
          (o.source === 'api' ? '<span style="display:inline-block;padding:1px 6px;background:#7c3aed;color:#fff;font-size:10px;font-weight:800;border-radius:4px;margin-right:5px;vertical-align:middle">⚡ API</span>' : '') +
          (o.homeowner_name || o.requester_name || '—') +
        '</td>' +
        '<td style="padding:11px 14px;color:#e2e8f0;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + (o.property_address || '') + '">' + (o.property_address || '—') + '</td>' +
        '<td style="padding:11px 14px;color:#64748b;white-space:nowrap;font-size:12px">' + (o.created_at || '').slice(0, 10) + '</td>' +
        '<td style="padding:11px 14px"><span style="padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;background:' + statusBg(os) + ';color:' + statusColor(os) + '">' + os + '</span></td>' +
        '<td style="padding:11px 14px"><span style="padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;background:' + statusBg(rs) + ';color:' + statusColor(rs) + '">' + rs + '</span></td>' +
        '<td style="padding:11px 14px;white-space:nowrap">' +
          (o.needs_admin_trace ?
            '<button onclick="saOpenTraceModal(' + o.id + ',' + (o.latitude || 0) + ',' + (o.longitude || 0) + ',\'' + (o.property_address || '').replace(/'/g, "\\'") + '\',\'' + (o.order_number || '') + '\')" style="padding:5px 12px;background:#f59e0b;color:#111;font-size:11px;font-weight:700;border:none;border-radius:6px;cursor:pointer"><i class="fas fa-drafting-compass mr-1"></i>Trace</button>' :
            '<a href="/api/reports/' + o.id + '/html" target="_blank" style="padding:5px 12px;background:rgba(14,165,233,0.15);color:#38bdf8;font-size:11px;font-weight:600;border:none;border-radius:6px;text-decoration:none;display:inline-block"><i class="fas fa-file-alt mr-1"></i>View</a>'
          ) +
        '</td>' +
      '</tr>';
    });

    html += '</tbody></table></div></div>';
  }

  return html;
}

// ============================================================
// VIEW 3: ORDER HISTORY & LOGISTICS
// ============================================================
window.saFilterOrders = function(s) {
  SA.ordersFilter = s;
  loadView('orders');
};

// ── Manual Trace Tool ──────────────────────────────────────
window.saOpenTraceModal = function(orderId, lat, lng, address, orderNum) {
  var existing = document.getElementById('sa-trace-modal');
  if (existing) existing.remove();

  var overlay = document.createElement('div');
  overlay.id = 'sa-trace-modal';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;padding:16px';
  overlay.innerHTML =
    '<div style="background:#111827;border:1px solid #374151;border-radius:16px;width:100%;max-width:900px;height:90vh;display:flex;flex-direction:column">' +
      '<div style="padding:16px 20px;border-bottom:1px solid #374151;display:flex;align-items:center;justify-content:space-between;flex-shrink:0">' +
        '<div>' +
          '<div style="color:#f9fafb;font-size:15px;font-weight:700"><i class="fas fa-drafting-compass mr-2" style="color:#f59e0b"></i>Trace Roof — ' + orderNum + '</div>' +
          '<div style="color:#6b7280;font-size:12px;margin-top:2px">' + address + '</div>' +
        '</div>' +
        '<button onclick="document.getElementById(\'sa-trace-modal\').remove()" style="color:#6b7280;background:none;border:none;font-size:20px;cursor:pointer;line-height:1">&times;</button>' +
      '</div>' +
      '<div style="padding:10px 20px;background:#1f2937;border-bottom:1px solid #374151;font-size:12px;color:#9ca3af;flex-shrink:0">' +
        '<span style="margin-right:12px"><span style="display:inline-block;width:12px;height:12px;background:#22c55e;border-radius:2px;margin-right:4px;vertical-align:middle"></span>Eaves</span>' +
        '<span style="margin-right:12px"><span style="display:inline-block;width:12px;height:3px;background:#dc2626;margin-right:4px;vertical-align:middle"></span>Ridge</span>' +
        '<span style="margin-right:12px"><span style="display:inline-block;width:12px;height:3px;background:#ea580c;margin-right:4px;vertical-align:middle"></span>Hip</span>' +
        '<span style="margin-right:12px"><span style="display:inline-block;width:12px;height:3px;background:#2563eb;margin-right:4px;vertical-align:middle"></span>Valley</span>' +
        '<span style="margin-right:12px"><span style="display:inline-block;width:10px;height:10px;background:#a855f7;border-radius:50%;margin-right:4px;vertical-align:middle"></span>Vent</span>' +
        '<span style="margin-right:12px"><span style="display:inline-block;width:10px;height:10px;background:#eab308;border-radius:50%;margin-right:4px;vertical-align:middle"></span>Skylight</span>' +
        '<span><span style="display:inline-block;width:10px;height:10px;background:#dc2626;border-radius:50%;margin-right:4px;vertical-align:middle"></span>Chimney</span>' +
        '<span style="float:right;color:#f59e0b">2-story? Close lower eaves (click 1st point), then trace upper eaves inside it.</span>' +
      '</div>' +
      '<div id="sa-trace-map" style="flex:1;min-height:0"></div>' +
      '<div style="padding:14px 20px;border-top:1px solid #374151;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;flex-shrink:0">' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
          '<button onclick="saTraceSetTool(\'eave\')" id="sa-tool-eave" style="padding:7px 12px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;background:#22c55e;color:#fff;border:none">Eaves</button>' +
          '<button onclick="saTraceSetTool(\'ridge\')" id="sa-tool-ridge" style="padding:7px 12px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;background:#1f2937;color:#9ca3af;border:1px solid #374151">+ Ridge</button>' +
          '<button onclick="saTraceSetTool(\'hip\')" id="sa-tool-hip" style="padding:7px 12px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;background:#1f2937;color:#9ca3af;border:1px solid #374151">+ Hip</button>' +
          '<button onclick="saTraceSetTool(\'valley\')" id="sa-tool-valley" style="padding:7px 12px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;background:#1f2937;color:#9ca3af;border:1px solid #374151">+ Valley</button>' +
          '<button onclick="saTraceSetTool(\'vent\')" id="sa-tool-vent" style="padding:7px 12px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;background:#1f2937;color:#9ca3af;border:1px solid #374151">+ Vent</button>' +
          '<button onclick="saTraceSetTool(\'skylight\')" id="sa-tool-skylight" style="padding:7px 12px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;background:#1f2937;color:#9ca3af;border:1px solid #374151">+ Skylight</button>' +
          '<button onclick="saTraceSetTool(\'chimney\')" id="sa-tool-chimney" style="padding:7px 12px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;background:#1f2937;color:#9ca3af;border:1px solid #374151">+ Chimney</button>' +
          '<button onclick="saTraceUndo()" style="padding:7px 12px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;background:#1f2937;color:#9ca3af;border:1px solid #374151">Undo</button>' +
          '<button onclick="saTraceClear()" style="padding:7px 12px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;background:#1f2937;color:#ef4444;border:1px solid #374151">Clear All</button>' +
        '</div>' +
        '<button onclick="saSubmitTrace(' + orderId + ')" style="padding:9px 22px;background:#f59e0b;color:#111;font-size:13px;font-weight:700;border:none;border-radius:10px;cursor:pointer">' +
          '<i class="fas fa-paper-plane mr-1.5"></i>Submit Report to Customer' +
        '</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  // Initialize the trace map
  window._saTraceState = {
    orderId: orderId, tool: 'eave',
    eaveSections: [],            // [{points, polygon}] closed sections
    eavePoints: [], eavePoly: null, _eaveLatLngs: [], _eaveMarkers: [],
    ridges: [], hips: [], valleys: [],
    _ridgeData: [], _hipData: [], _valleyData: [],
    _segStart: null, _segStartMarker: null,
    vents: [], skylights: [], chimneys: [],
    _ventMarkers: [], _skylightMarkers: [], _chimneyMarkers: []
  };
  setTimeout(function() { saInitTraceMap(lat, lng, address); }, 100);
};

window.saTraceSetTool = function(tool) {
  var s = window._saTraceState; if (!s) return;
  // Cancel any dangling line-segment start when switching tools
  if (s._segStart && tool !== s.tool) {
    if (s._segStartMarker) { s._segStartMarker.setMap(null); s._segStartMarker = null; }
    s._segStart = null;
  }
  s.tool = tool;
  ['eave','ridge','hip','valley','vent','skylight','chimney'].forEach(function(t) {
    var btn = document.getElementById('sa-tool-' + t);
    if (btn) {
      var active = t === tool;
      var colors = { eave: '#22c55e', ridge: '#dc2626', hip: '#ea580c', valley: '#2563eb', vent: '#a855f7', skylight: '#eab308', chimney: '#dc2626' };
      btn.style.background = active ? (colors[t] || '#0ea5e9') : '#1f2937';
      btn.style.color = active ? '#fff' : '#9ca3af';
      btn.style.borderColor = active ? 'transparent' : '#374151';
    }
  });
};

window.saTraceClear = function() {
  var s = window._saTraceState;
  if (!s || !s.map) return;
  if (s.eavePoly) { s.eavePoly.setMap(null); s.eavePoly = null; }
  (s.eaveSections || []).forEach(function(sec) { if (sec.polygon) sec.polygon.setMap(null); });
  s.eaveSections = [];
  (s._eaveMarkers || []).forEach(function(m) { m.setMap(null); }); s._eaveMarkers = [];
  s.ridges.forEach(function(l) { l.setMap(null); }); s.ridges = [];
  s.hips.forEach(function(l) { l.setMap(null); }); s.hips = [];
  s.valleys.forEach(function(l) { l.setMap(null); }); s.valleys = [];
  (s._ventMarkers || []).forEach(function(m) { m.setMap(null); }); s._ventMarkers = [];
  (s._skylightMarkers || []).forEach(function(m) { m.setMap(null); }); s._skylightMarkers = [];
  (s._chimneyMarkers || []).forEach(function(m) { m.setMap(null); }); s._chimneyMarkers = [];
  if (s._segStartMarker) { s._segStartMarker.setMap(null); s._segStartMarker = null; }
  s.eavePoints = []; s._eaveLatLngs = []; s._segStart = null;
  s._ridgeData = []; s._hipData = []; s._valleyData = [];
  s.vents = []; s.skylights = []; s.chimneys = [];
};

window.saTraceUndo = function() {
  var s = window._saTraceState; if (!s) return;
  // Priority: partial segment start → last draft eave pt → last annotation → last line → last closed eave section
  if (s._segStart) {
    if (s._segStartMarker) { s._segStartMarker.setMap(null); s._segStartMarker = null; }
    s._segStart = null; return;
  }
  if (s.tool === 'eave' && s._eaveLatLngs && s._eaveLatLngs.length > 0) {
    s._eaveLatLngs.pop(); s.eavePoints.pop();
    var m = s._eaveMarkers.pop(); if (m) m.setMap(null);
    if (s.eavePoly) s.eavePoly.setMap(null);
    if (s._eaveLatLngs.length >= 2) {
      s.eavePoly = new google.maps.Polyline({ path: s._eaveLatLngs.concat([s._eaveLatLngs[0]]), strokeColor: '#22c55e', strokeWeight: 2.5, map: s.map });
    } else { s.eavePoly = null; }
    return;
  }
  if ((s.tool === 'vent' || s.tool === 'skylight' || s.tool === 'chimney')) {
    var arr = s[s.tool + 's']; var marr = s['_' + s.tool + 'Markers'];
    if (arr && arr.length > 0) { arr.pop(); var mk = marr.pop(); if (mk) mk.setMap(null); return; }
  }
  if (s.tool === 'ridge' || s.tool === 'hip' || s.tool === 'valley') {
    var key = s.tool + 's'; var dataKey = '_' + s.tool.charAt(0).toUpperCase() + s.tool.slice(1) + 'Data';
    // dataKey needs to match _ridgeData / _hipData / _valleyData
    dataKey = '_' + s.tool + 'Data';
    if (s[key] && s[key].length > 0) {
      var line = s[key].pop(); if (line) line.setMap(null);
      s[dataKey].pop(); return;
    }
  }
  // Fall back to popping a closed eaves section
  if (s.eaveSections && s.eaveSections.length > 0) {
    var last = s.eaveSections.pop();
    if (last.polygon) last.polygon.setMap(null);
  }
};

function saInitTraceMap(lat, lng, address) {
  var s = window._saTraceState;
  if (!s || !window._saGoogleMapsLoaded || !window.google || !window.google.maps) {
    setTimeout(function() { saInitTraceMap(lat, lng, address); }, 300);
    return;
  }
  var mapEl = document.getElementById('sa-trace-map');
  if (!mapEl) return;

  var center = { lat: lat || 53.5, lng: lng || -113.5 };
  var map = new google.maps.Map(mapEl, {
    center: center, zoom: 20,
    mapTypeId: 'satellite', tilt: 0, rotateControl: false,
    mapTypeControl: false, streetViewControl: false, fullscreenControl: false
  });
  s.map = map;

  // Geocode address to ensure map is centered on the right property
  if (address) {
    var geocoder = new google.maps.Geocoder();
    geocoder.geocode({ address: address }, function(results, status) {
      if (status === 'OK' && results && results[0]) {
        map.setCenter(results[0].geometry.location);
        map.setZoom(20);
      }
    });
  }

  map.addListener('click', function(e) {
    var tool = s.tool;
    if (tool === 'eave') {
      var pts = s._eaveLatLngs || (s._eaveLatLngs = []);
      // Close section on click near first point (>=3 pts)
      if (pts.length >= 3) {
        var first = pts[0];
        var dLat = (first.lat() - e.latLng.lat()) * 111320;
        var dLng = (first.lng() - e.latLng.lng()) * 111320 * Math.cos(first.lat() * Math.PI / 180);
        var distM = Math.sqrt(dLat * dLat + dLng * dLng);
        if (distM < 1.5) { saCloseEaveSection(); return; }
      }
      pts.push(e.latLng);
      // Numbered marker
      var mk = new google.maps.Marker({
        position: e.latLng, map: map,
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 5, fillColor: '#22c55e', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 1.5 },
        label: { text: String(pts.length), color: '#fff', fontSize: '10px', fontWeight: '700' }
      });
      s._eaveMarkers.push(mk);
      if (s.eavePoly) s.eavePoly.setMap(null);
      s.eavePoly = new google.maps.Polyline({
        path: pts.concat([pts[0]]),
        strokeColor: '#22c55e', strokeWeight: 2.5, map: map
      });
      s.eavePoints = pts.map(function(p) { return { lat: p.lat(), lng: p.lng() }; });
    } else if (tool === 'vent' || tool === 'skylight' || tool === 'chimney') {
      var colors = { vent: '#a855f7', skylight: '#eab308', chimney: '#dc2626' };
      var annMk = new google.maps.Marker({
        position: e.latLng, map: map,
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 7, fillColor: colors[tool], fillOpacity: 0.9, strokeColor: '#fff', strokeWeight: 2 },
        title: tool
      });
      var pt = { lat: e.latLng.lat(), lng: e.latLng.lng() };
      s[tool + 's'].push(pt);
      s['_' + tool + 'Markers'].push(annMk);
    } else {
      if (!s._segStart) {
        s._segStart = e.latLng;
        var colorMap = { ridge: '#dc2626', hip: '#ea580c', valley: '#2563eb' };
        s._segStartMarker = new google.maps.Marker({
          position: e.latLng, map: map,
          icon: { path: google.maps.SymbolPath.CIRCLE, scale: 4, fillColor: colorMap[tool] || '#fff', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 1 }
        });
      } else {
        var color = tool === 'ridge' ? '#dc2626' : tool === 'hip' ? '#ea580c' : '#2563eb';
        var line = new google.maps.Polyline({ path: [s._segStart, e.latLng], strokeColor: color, strokeWeight: 2, map: map });
        var seg = [{ lat: s._segStart.lat(), lng: s._segStart.lng() }, { lat: e.latLng.lat(), lng: e.latLng.lng() }];
        if (tool === 'ridge') { s.ridges.push(line); s._ridgeData.push(seg); }
        else if (tool === 'hip') { s.hips.push(line); s._hipData.push(seg); }
        else { s.valleys.push(line); s._valleyData.push(seg); }
        if (s._segStartMarker) { s._segStartMarker.setMap(null); s._segStartMarker = null; }
        s._segStart = null;
      }
    }
  });
}

function saCloseEaveSection() {
  var s = window._saTraceState; if (!s || !s.map) return;
  var pts = s._eaveLatLngs || [];
  if (pts.length < 3) return;
  if (s.eavePoly) { s.eavePoly.setMap(null); s.eavePoly = null; }
  (s._eaveMarkers || []).forEach(function(m) { m.setMap(null); }); s._eaveMarkers = [];
  var poly = new google.maps.Polygon({
    paths: pts.slice(),
    strokeColor: '#22c55e', strokeWeight: 3, strokeOpacity: 0.9,
    fillColor: '#22c55e', fillOpacity: 0.15,
    clickable: false, editable: false, draggable: false,
    map: s.map, zIndex: 1
  });
  var sectionPoints = pts.map(function(p) { return { lat: p.lat(), lng: p.lng() }; });
  s.eaveSections.push({ points: sectionPoints, polygon: poly });
  s._eaveLatLngs = [];
  s.eavePoints = [];
}

window.saSubmitTrace = async function(orderId) {
  var s = window._saTraceState;
  if (!s) return;
  // Auto-close current eave draft if it has >=3 points and no closed sections yet
  if ((!s.eaveSections || s.eaveSections.length === 0) && s._eaveLatLngs && s._eaveLatLngs.length >= 3) {
    saCloseEaveSection();
  }
  if (!s.eaveSections || s.eaveSections.length === 0) {
    alert('Please draw the eaves polygon first (at least 3 points). Click the first point again to close it.');
    return;
  }
  var eaves_sections = s.eaveSections.map(function(sec) { return sec.points; });
  var traceJson = {
    eaves: eaves_sections[0],
    eaves_sections: eaves_sections,
    ridges: s._ridgeData || [],
    hips: s._hipData || [],
    valleys: s._valleyData || [],
    annotations: {
      vents: s.vents || [],
      skylights: s.skylights || [],
      chimneys: s.chimneys || []
    },
    traced_at: new Date().toISOString()
  };

  var btn = document.querySelector('#sa-trace-modal button[onclick*="saSubmitTrace"]');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1.5"></i>Generating report...'; }

  try {
    var token = localStorage.getItem('rc_token') || '';
    var res = await fetch('/api/admin/superadmin/orders/' + orderId + '/submit-trace', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ roof_trace_json: traceJson })
    });
    var data = await res.json();
    if (data.success) {
      document.getElementById('sa-trace-modal')?.remove();
      alert('✅ Report generated and delivered to customer!');
      loadView('orders');
    } else {
      alert('Error: ' + (data.error || 'Failed to generate report'));
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane mr-1.5"></i>Submit Report to Customer'; }
    }
  } catch(e) {
    alert('Network error: ' + e.message);
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane mr-1.5"></i>Submit Report to Customer'; }
  }
};

function renderOrdersView() {
  const d = SA.data.orders || {};
  const orders = d.orders || [];
  const counts = d.counts || {};
  const avgSec = d.avg_processing_seconds || 0;
  const needsTraceOrders = (SA.data.needsTrace || {}).orders || [];

  return `
    ${needsTraceOrders.length > 0 ? `
    <div style="background:#1a1200;border:2px solid #f59e0b;border-radius:14px;padding:20px;margin-bottom:24px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:36px;height:36px;background:rgba(245,158,11,0.2);border-radius:8px;display:flex;align-items:center;justify-content:center"><i class="fas fa-drafting-compass" style="color:#f59e0b;font-size:16px"></i></div>
          <div>
            <div style="color:#fbbf24;font-size:15px;font-weight:800">⏱ Pending Manual Traces</div>
            <div style="color:#92400e;font-size:12px">${needsTraceOrders.length} order${needsTraceOrders.length !== 1 ? 's' : ''} waiting for your trace</div>
          </div>
        </div>
        <button onclick="loadView(SA.view)" style="font-size:11px;color:#f59e0b;background:none;border:none;cursor:pointer"><i class="fas fa-sync-alt mr-1"></i>Refresh</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${needsTraceOrders.map(o => `
          <div style="background:#111;border:1px solid #374151;border-radius:10px;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
            <div style="flex:1;min-width:0">
              <div style="color:#f9fafb;font-size:13px;font-weight:700">${o.property_address || 'Unknown address'}</div>
              <div style="color:#9ca3af;font-size:11px;margin-top:2px">${o.customer_name || o.customer_email || ''} · ${o.order_number || 'Order #' + o.id} · ${new Date(o.created_at).toLocaleString()}</div>
            </div>
            <button onclick="saOpenTraceModal(${o.id}, ${o.latitude || 0}, ${o.longitude || 0}, '${(o.property_address || '').replace(/'/g, "\\'")}', '${o.order_number || ''}')"
              style="padding:8px 18px;background:#f59e0b;color:#111;font-size:12px;font-weight:700;border:none;border-radius:8px;cursor:pointer;white-space:nowrap;flex-shrink:0">
              <i class="fas fa-drafting-compass mr-1.5"></i>Trace & Submit
            </button>
          </div>
        `).join('')}
      </div>
    </div>
    ` : ''}
    <div class="mb-6 flex items-center justify-between">
      <div>
        <h2 class="text-2xl font-black text-gray-900"><i class="fas fa-clipboard-list mr-2 text-teal-500"></i>Order History & Logistics</h2>
        <p class="text-sm text-gray-500 mt-1">Report address, order date, pricing, and software completion time</p>
      </div>
      <select onchange="saFilterOrders(this.value)" class="text-xs border border-gray-200 rounded-lg px-3 py-1.5 bg-white focus:ring-2 focus:ring-teal-500">
        <option value="" ${SA.ordersFilter === '' ? 'selected' : ''}>All Statuses</option>
        <option value="pending" ${SA.ordersFilter === 'pending' ? 'selected' : ''}>Pending</option>
        <option value="processing" ${SA.ordersFilter === 'processing' ? 'selected' : ''}>Processing</option>
        <option value="completed" ${SA.ordersFilter === 'completed' ? 'selected' : ''}>Completed</option>
        <option value="failed" ${SA.ordersFilter === 'failed' ? 'selected' : ''}>Failed</option>
        <option value="cancelled" ${SA.ordersFilter === 'cancelled' ? 'selected' : ''}>Cancelled</option>
      </select>
    </div>

    <div class="grid grid-cols-2 lg:grid-cols-6 gap-4 mb-6">
      ${samc('Total Orders', counts.total || 0, 'fa-clipboard-list', 'blue')}
      ${samc('Completed', counts.completed || 0, 'fa-check-circle', 'green')}
      ${samc('Pending', counts.pending || 0, 'fa-clock', 'yellow')}
      ${samc('Processing', counts.processing || 0, 'fa-spinner', 'indigo')}
      ${samc('Avg Price', $$(counts.avg_price), 'fa-tag', 'purple')}
      ${samc('Avg Completion', fmtSeconds(avgSec), 'fa-stopwatch', 'red', 'software time')}
    </div>

    ${saSection('Order Log (' + orders.length + ')', 'fa-table', `
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-3 py-2 text-left text-xs font-semibold text-gray-500">Order #</th>
              <th class="px-3 py-2 text-left text-xs font-semibold text-gray-500">Customer</th>
              <th class="px-3 py-2 text-left text-xs font-semibold text-gray-500">Report Address</th>
              <th class="px-3 py-2 text-left text-xs font-semibold text-gray-500">Order Date</th>
              <th class="px-3 py-2 text-right text-xs font-semibold text-gray-500">Price</th>
              <th class="px-3 py-2 text-center text-xs font-semibold text-gray-500">Status</th>
              <th class="px-3 py-2 text-center text-xs font-semibold text-gray-500">Payment</th>
              <th class="px-3 py-2 text-center text-xs font-semibold text-gray-500">Squares</th>
              <th class="px-3 py-2 text-center text-xs font-semibold text-gray-500">Confidence</th>
              <th class="px-3 py-2 text-center text-xs font-semibold text-gray-500">Complexity</th>
              <th class="px-3 py-2 text-center text-xs font-semibold text-gray-500">Processing Time</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-50">
            ${orders.length === 0 ? '<tr><td colspan="11" class="px-4 py-8 text-center text-gray-400">No orders found</td></tr>' : ''}
            ${orders.map(o => {
              const procTime = o.processing_seconds;
              return `
              <tr class="hover:bg-teal-50/30 transition-colors">
                <td class="px-3 py-2">
                  <span class="font-mono text-xs font-bold text-gray-700">${o.order_number || '-'}</span>
                  ${o.is_trial ? '<span class="ml-1 text-[9px] bg-blue-100 text-blue-700 px-1 rounded">TRIAL</span>' : ''}
                </td>
                <td class="px-3 py-2">
                  <p class="text-xs font-medium text-gray-800">${o.customer_name || o.requester_name || '-'}</p>
                  <p class="text-[10px] text-gray-400">${o.customer_company || o.customer_email || ''}</p>
                </td>
                <td class="px-3 py-2 text-xs text-gray-600 max-w-[200px] truncate" title="${o.property_address || ''}">${o.property_address || '-'}</td>
                <td class="px-3 py-2 text-xs text-gray-500">${fmtDateTime(o.created_at)}</td>
                <td class="px-3 py-2 text-right font-bold text-gray-800">${o.is_trial ? '<span class="text-blue-600">$0 Trial</span>' : $$(o.price)}</td>
                <td class="px-3 py-2 text-center">${statusBadge(o.status)}</td>
                <td class="px-3 py-2 text-center">${payBadge(o.payment_status)}</td>
                <td class="px-3 py-2 text-center text-xs font-medium text-gray-700">${o.gross_squares ? o.gross_squares.toFixed(1) : '-'}</td>
                <td class="px-3 py-2 text-center">
                  ${o.confidence_score ? `<span class="text-xs font-bold ${o.confidence_score >= 80 ? 'text-green-600' : o.confidence_score >= 60 ? 'text-yellow-600' : 'text-red-600'}">${o.confidence_score}%</span>` : '-'}
                </td>
                <td class="px-3 py-2 text-center">
                  ${o.complexity_class ? `<span class="px-1.5 py-0.5 text-[10px] rounded-full font-medium ${o.complexity_class === 'simple' ? 'bg-green-100 text-green-700' : o.complexity_class === 'moderate' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'} capitalize">${o.complexity_class}</span>` : '-'}
                </td>
                <td class="px-3 py-2 text-center">
                  ${procTime ? `<span class="text-xs font-medium ${procTime < 30 ? 'text-green-600' : procTime < 120 ? 'text-yellow-600' : 'text-red-600'}">${fmtSeconds(procTime)}</span>` : '<span class="text-gray-300">-</span>'}
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    `)}
  `;
}

// ============================================================
// VIEW 4: NEW USER SIGN-UPS
// ============================================================
window.saChangeSignupsPeriod = function(p) {
  SA.signupsPeriod = p;
  loadView('signups');
};

function renderSignupsView() {
  const d = SA.data.signups || {};
  const byPeriod = d.signups_by_period || [];
  const recent = d.recent_signups || [];
  const s = d.summary || {};

  return `
    <div class="mb-6 flex items-center justify-between">
      <div>
        <h2 class="text-2xl font-black text-gray-900"><i class="fas fa-user-plus mr-2 text-teal-500"></i>New User Sign-ups</h2>
        <p class="text-sm text-gray-500 mt-1">Registration trends, sign-up method breakdown, and conversion tracking</p>
      </div>
      ${periodDropdown(SA.signupsPeriod, 'saChangeSignupsPeriod')}
    </div>

    <div class="grid grid-cols-2 lg:grid-cols-6 gap-4 mb-6">
      ${samc('All-Time Users', s.total_all_time || 0, 'fa-users', 'blue')}
      ${samc('Today', s.today || 0, 'fa-calendar-day', 'green')}
      ${samc('This Week', s.this_week || 0, 'fa-calendar-week', 'indigo')}
      ${samc('This Month', s.this_month || 0, 'fa-calendar-alt', 'purple')}
      ${samc('Google Sign-In', s.google_total || 0, 'fa-google', 'red')}
      ${samc('Email Sign-Up', s.email_total || 0, 'fa-envelope', 'amber')}
    </div>

    <div class="grid lg:grid-cols-2 gap-6">
      <!-- Sign-ups by Period -->
      ${saSection('Sign-ups by Period', 'fa-chart-line', `
        ${byPeriod.length === 0 ? '<p class="text-gray-400 text-sm">No sign-up data yet</p>' : `
        <div class="space-y-2">
          ${byPeriod.map(p => {
            const maxSignups = Math.max(...byPeriod.map(x => x.signups), 1);
            const pct = Math.round((p.signups / maxSignups) * 100);
            return `<div class="flex items-center gap-3">
              <span class="text-xs font-mono text-gray-600 w-24 flex-shrink-0">${p.period}</span>
              <div class="flex-1 bg-gray-100 rounded-full h-6 overflow-hidden relative">
                <div class="absolute inset-y-0 left-0 bg-gradient-to-r from-teal-500 to-teal-400 rounded-full transition-all" style="width:${pct}%"></div>
                <div class="absolute inset-0 flex items-center px-3">
                  <span class="text-xs font-bold text-white drop-shadow-sm">${p.signups}</span>
                  <span class="text-[10px] text-white/80 ml-2">(${p.google_signups || 0} Google, ${p.email_signups || 0} Email)</span>
                </div>
              </div>
            </div>`;
          }).join('')}
        </div>`}
      `)}

      <!-- Recent Sign-ups -->
      ${saSection('Recent Sign-ups', 'fa-user-clock', `
        <div class="space-y-2 max-h-96 overflow-y-auto">
          ${recent.length === 0 ? '<p class="text-gray-400 text-sm">No recent sign-ups</p>' : ''}
          ${recent.map(u => `
            <div class="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-gray-50 transition-colors">
              <div class="flex items-center gap-3">
                ${u.google_avatar ? `<img src="${u.google_avatar}" class="w-8 h-8 rounded-full">` : `<div class="w-8 h-8 bg-gradient-to-br from-teal-500 to-teal-600 rounded-full flex items-center justify-center text-white text-xs font-bold">${(u.name||'?')[0].toUpperCase()}</div>`}
                <div>
                  <p class="text-sm font-medium text-gray-800">${u.name}</p>
                  <p class="text-[10px] text-gray-400">${u.email} ${u.company_name ? '· ' + u.company_name : ''}</p>
                </div>
              </div>
              <div class="text-right">
                <p class="text-xs text-gray-500">${fmtDate(u.created_at)}</p>
                <p class="text-[10px] ${u.order_count > 0 ? 'text-green-600 font-medium' : 'text-gray-400'}">${u.order_count || 0} orders ${u.trial_orders > 0 ? `(${u.trial_orders} trial)` : ''}</p>
              </div>
            </div>
          `).join('')}
        </div>
      `)}
    </div>
  `;
}

// ============================================================
// VIEW 5: INTERNAL SALES & MARKETING MANAGEMENT
// ============================================================
function renderMarketingView() {
  const d = SA.data.marketing || {};
  const crm = d.crm_stats || {};
  const pi = d.platform_invoices || {};
  const funnel = d.funnel || {};
  const proposals = d.recent_proposals || [];
  const invoices = d.recent_invoices || [];

  const funnelTotal = funnel.total_signups || 1;
  const trialPct = Math.round(((funnel.used_trial || 0) / funnelTotal) * 100);
  const paidPct = Math.round(((funnel.became_paid || 0) / funnelTotal) * 100);

  return `
    <div class="mb-6">
      <h2 class="text-2xl font-black text-gray-900"><i class="fas fa-bullhorn mr-2 text-teal-500"></i>Internal Sales & Marketing</h2>
      <p class="text-sm text-gray-500 mt-1">CRM overview, proposals, invoices, leads, and conversion funnel</p>
    </div>

    <!-- Conversion Funnel -->
    <div class="bg-gradient-to-r from-gray-900 to-gray-800 rounded-2xl p-6 mb-6 text-white">
      <h3 class="font-bold text-lg mb-4"><i class="fas fa-funnel-dollar mr-2 text-teal-400"></i>Conversion Funnel</h3>
      <div class="grid grid-cols-5 gap-4">
        <div class="text-center">
          <div class="w-16 h-16 mx-auto bg-blue-500/20 rounded-2xl flex items-center justify-center mb-2">
            <i class="fas fa-user-plus text-blue-400 text-xl"></i>
          </div>
          <p class="text-2xl font-black">${funnel.total_signups || 0}</p>
          <p class="text-xs text-gray-400">Sign-ups</p>
        </div>
        <div class="text-center flex flex-col items-center justify-center">
          <i class="fas fa-arrow-right text-gray-600 text-lg"></i>
          <p class="text-[10px] text-gray-500 mt-1">${trialPct}%</p>
        </div>
        <div class="text-center">
          <div class="w-16 h-16 mx-auto bg-indigo-500/20 rounded-2xl flex items-center justify-center mb-2">
            <i class="fas fa-gift text-indigo-400 text-xl"></i>
          </div>
          <p class="text-2xl font-black">${funnel.used_trial || 0}</p>
          <p class="text-xs text-gray-400">Used Trial</p>
          <p class="text-[10px] text-indigo-400">${funnel.trial_reports || 0} reports</p>
        </div>
        <div class="text-center flex flex-col items-center justify-center">
          <i class="fas fa-arrow-right text-gray-600 text-lg"></i>
          <p class="text-[10px] text-gray-500 mt-1">${paidPct}%</p>
        </div>
        <div class="text-center">
          <div class="w-16 h-16 mx-auto bg-green-500/20 rounded-2xl flex items-center justify-center mb-2">
            <i class="fas fa-credit-card text-green-400 text-xl"></i>
          </div>
          <p class="text-2xl font-black">${funnel.became_paid || 0}</p>
          <p class="text-xs text-gray-400">Paid Users</p>
          <p class="text-[10px] text-green-400">${funnel.paid_reports || 0} reports</p>
        </div>
      </div>
    </div>

    <!-- CRM Stats -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      ${samc('Total Leads', crm.total_leads || 0, 'fa-address-book', 'blue', (crm.active_leads || 0) + ' active')}
      ${samc('Proposals', crm.total_proposals || 0, 'fa-file-signature', 'indigo', (crm.sold_proposals || 0) + ' sold (' + $$(crm.sold_value) + ')')}
      ${samc('CRM Invoices', crm.total_invoices || 0, 'fa-file-invoice-dollar', 'green', (crm.paid_invoices || 0) + ' paid (' + $$(crm.paid_invoice_value) + ')')}
      ${samc('Jobs', crm.total_jobs || 0, 'fa-hard-hat', 'amber', (crm.completed_jobs || 0) + ' done, ' + (crm.scheduled_jobs || 0) + ' scheduled')}
    </div>

    <!-- Platform Invoices -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      ${samc('Platform Invoices', pi.total || 0, 'fa-receipt', 'purple')}
      ${samc('Paid', $$(pi.paid_value), 'fa-check-circle', 'green')}
      ${samc('Outstanding', $$(pi.outstanding_value), 'fa-clock', 'yellow')}
      ${samc('Overdue', $$(pi.overdue_value), 'fa-exclamation-triangle', 'red')}
    </div>

    <div class="grid lg:grid-cols-2 gap-6">
      <!-- Recent Proposals -->
      ${saSection('Recent Proposals', 'fa-file-signature', `
        ${proposals.length === 0 ? '<p class="text-gray-400 text-sm">No proposals yet</p>' : `
        <div class="space-y-2">
          ${proposals.map(p => `
            <div class="flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-gray-50 border border-gray-100">
              <div>
                <p class="text-sm font-medium text-gray-800">${p.title || p.proposal_number}</p>
                <p class="text-[10px] text-gray-400">To: ${p.customer_name || '-'} · By: ${p.owner_name || '-'}</p>
              </div>
              <div class="text-right">
                <p class="text-sm font-bold text-gray-800">${$$(p.total_amount)}</p>
                <span class="px-2 py-0.5 text-[10px] rounded-full font-medium capitalize ${p.status === 'sold' ? 'bg-green-100 text-green-700' : p.status === 'sent' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}">${p.status}</span>
              </div>
            </div>
          `).join('')}
        </div>`}
      `)}

      <!-- Recent CRM Invoices -->
      ${saSection('Recent CRM Invoices', 'fa-file-invoice', `
        ${invoices.length === 0 ? '<p class="text-gray-400 text-sm">No CRM invoices yet</p>' : `
        <div class="space-y-2">
          ${invoices.map(i => `
            <div class="flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-gray-50 border border-gray-100">
              <div>
                <p class="text-sm font-medium text-gray-800">${i.invoice_number}</p>
                <p class="text-[10px] text-gray-400">To: ${i.customer_name || '-'} · By: ${i.owner_name || '-'}</p>
              </div>
              <div class="text-right">
                <p class="text-sm font-bold text-gray-800">${$$(i.total)}</p>
                <span class="px-2 py-0.5 text-[10px] rounded-full font-medium capitalize ${i.status === 'paid' ? 'bg-green-100 text-green-700' : i.status === 'sent' ? 'bg-blue-100 text-blue-700' : i.status === 'overdue' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}">${i.status}</span>
              </div>
            </div>
          `).join('')}
        </div>`}
      `)}
    </div>

    <!-- Revenue Dashboard -->
    ${(() => {
      const rev = d.revenue || {};
      const mrrDollars = ((rev.mrr_cents || 0) / 100).toFixed(2);
      return `
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        ${samc('Monthly Recurring', '$' + mrrDollars, 'fa-dollar-sign', 'green', (rev.active_subs || 0) + ' active subscribers')}
        ${samc('Trialing', rev.trialing || 0, 'fa-hourglass-half', 'blue', (rev.expired_trials || 0) + ' expired')}
        ${samc('30-Day Revenue', $$(rev.invoiced_30d), 'fa-chart-line', 'indigo', 'from paid invoices')}
        ${samc('Churned', rev.churned || 0, 'fa-user-minus', 'red')}
      </div>`;
    })()}

    <div class="grid lg:grid-cols-2 gap-6 mb-6">
      <!-- Trial Expiry Alerts -->
      ${(() => {
        const alerts = d.trial_alerts || [];
        return saSection('Trial Expiry Alerts', 'fa-clock', `
          ${alerts.length === 0 ? '<p class="text-gray-400 text-sm">No trials expiring in the next 7 days</p>' : `
          <div class="space-y-2">
            ${alerts.map(a => {
              const daysLeft = Math.max(0, Math.ceil((new Date(a.trial_ends_at) - Date.now()) / 86400000));
              const priceFmt = ((a.subscription_price_cents || 4999) / 100).toFixed(2);
              return `<div class="flex items-center justify-between py-2.5 px-3 rounded-lg border ${daysLeft <= 2 ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}">
                <div>
                  <p class="text-sm font-medium text-gray-800">${a.name || a.email}</p>
                  <p class="text-[10px] text-gray-500">${a.email} · ${(a.subscription_plan || 'starter')} · $${priceFmt}/mo</p>
                </div>
                <div class="flex items-center gap-2">
                  <span class="px-2 py-0.5 text-xs rounded-full font-bold ${daysLeft <= 2 ? 'bg-red-200 text-red-700' : 'bg-amber-200 text-amber-700'}">${daysLeft}d left</span>
                  <button onclick="sendTrialExpiryInvoice('${a.email}', ${a.subscription_price_cents || 4999}, '${(a.subscription_plan || 'starter')}')" class="text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-green-700">Send Invoice</button>
                </div>
              </div>`;
            }).join('')}
          </div>`}
        `);
      })()}

      <!-- Lead Source Tracker -->
      ${(() => {
        const sources = d.lead_sources || [];
        return saSection('Lead Sources', 'fa-map-signs', `
          ${sources.length === 0 ? '<p class="text-gray-400 text-sm">No lead source data yet</p>' : `
          <div class="space-y-1">
            ${sources.map(s => `
              <div class="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-gray-50">
                <span class="text-sm font-medium text-gray-700">${s.source}</span>
                <div class="flex items-center gap-3">
                  <span class="text-sm font-bold text-gray-800">${s.count} signups</span>
                  <span class="text-xs text-green-600 font-medium">${s.converted || 0} converted</span>
                </div>
              </div>
            `).join('')}
          </div>`}
        `);
      })()}
    </div>

    <!-- Quick Invoice Sender -->
    ${saSection('Quick Invoice Sender', 'fa-paper-plane', `
      <p class="text-xs text-gray-400 mb-3">Send a one-click invoice with Square payment link to any email</p>
      <div class="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
        <input id="mkt-inv-email" class="border-2 border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:border-teal-400 outline-none" placeholder="customer@email.com">
        <input id="mkt-inv-desc" class="border-2 border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:border-teal-400 outline-none" placeholder="Description" value="Roof Report Credits">
        <input id="mkt-inv-amount" class="border-2 border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:border-teal-400 outline-none" placeholder="Amount (USD)" type="number" value="125">
        <button onclick="sendQuickInvoice()" class="bg-teal-600 text-white px-4 py-2.5 rounded-lg text-sm font-bold hover:bg-teal-700 transition-colors">
          <i class="fas fa-paper-plane mr-1"></i>Create & Send
        </button>
      </div>
    `)}
  `;
}

// ============================================================
// VIEW 7: EMAIL SETUP — Gmail OAuth Configuration
// ============================================================
function renderEmailSetupView() {
  const d = SA.data.emailSetup || {};
  const g = d.gmail_oauth2 || {};

  const isReady = g.ready;
  const hasClientId = g.client_id_configured;
  const hasClientSecret = g.client_secret_configured;
  const csSource = g.client_secret_source || 'missing';
  const hasRefreshToken = g.refresh_token_configured;
  const rtSource = g.refresh_token_source || 'missing';
  const senderEmail = g.sender_email || 'Not configured';

  const statusDot = (ok) => ok
    ? '<span class="w-3 h-3 bg-green-400 rounded-full inline-block mr-2"></span>'
    : '<span class="w-3 h-3 bg-red-400 rounded-full inline-block mr-2"></span>';

  return `
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-2xl font-black text-gray-900">Email Delivery Setup</h2>
        <p class="text-sm text-gray-500 mt-1">Configure Gmail OAuth2 so your app can send verification codes, reports, and outreach emails.</p>
      </div>
      <button onclick="loadView('email-setup')" class="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-xl text-sm font-medium transition-colors">
        <i class="fas fa-sync-alt mr-1"></i> Refresh
      </button>
    </div>

    <!-- Overall Status -->
    <div class="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
      <div class="flex items-center gap-4 mb-4">
        <div class="w-14 h-14 rounded-2xl flex items-center justify-center ${isReady ? 'bg-green-100' : 'bg-red-100'}">
          <i class="fas ${isReady ? 'fa-check-circle text-green-600' : 'fa-exclamation-triangle text-red-600'} text-2xl"></i>
        </div>
        <div>
          <h3 class="text-lg font-bold ${isReady ? 'text-green-800' : 'text-red-800'}">${isReady ? 'Email Delivery Active' : 'Email Delivery Not Configured'}</h3>
          <p class="text-sm text-gray-500">${isReady ? 'Emails are being sent from ' + senderEmail : 'Complete the steps below to enable email sending'}</p>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div class="bg-gray-50 rounded-xl p-4">
          <div class="flex items-center mb-2">${statusDot(hasClientId)}<span class="font-semibold text-sm">Gmail Client ID</span></div>
          <p class="text-xs text-gray-500">${hasClientId ? 'Configured in environment' : 'Missing — set GMAIL_CLIENT_ID'}</p>
        </div>
        <div class="bg-gray-50 rounded-xl p-4">
          <div class="flex items-center mb-2">${statusDot(hasClientSecret)}<span class="font-semibold text-sm">Gmail Client Secret</span></div>
          <p class="text-xs text-gray-500">${hasClientSecret ? 'Source: ' + csSource : 'Missing — paste below'}</p>
        </div>
        <div class="bg-gray-50 rounded-xl p-4">
          <div class="flex items-center mb-2">${statusDot(hasRefreshToken)}<span class="font-semibold text-sm">Gmail Refresh Token</span></div>
          <p class="text-xs text-gray-500">${hasRefreshToken ? 'Source: ' + rtSource : 'Missing — authorize below'}</p>
        </div>
      </div>
    </div>

    <!-- Step 1: Client Secret -->
    <div class="bg-white rounded-2xl border ${hasClientSecret ? 'border-green-200' : 'border-amber-200'} p-6 shadow-sm">
      <div class="flex items-start gap-3 mb-4">
        <div class="w-8 h-8 rounded-full ${hasClientSecret ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'} flex items-center justify-center font-bold text-sm flex-shrink-0">1</div>
        <div class="flex-1">
          <h4 class="font-bold text-gray-800">${hasClientSecret ? 'Client Secret Configured' : 'Paste Your Gmail OAuth Client Secret'}</h4>
          <p class="text-sm text-gray-500 mt-1">Go to <a href="https://console.cloud.google.com/apis/credentials" target="_blank" class="text-blue-600 underline">GCP Console &rarr; Credentials</a>, click your OAuth 2.0 Client ID, copy the <strong>Client Secret</strong>, and paste it below.</p>
        </div>
      </div>
      <div class="flex gap-3">
        <input type="password" id="gmailClientSecret" placeholder="GOCSPX-xxxxxxxxxxxxxxxxxxxxxx"
               class="flex-1 px-4 py-3 border border-gray-200 rounded-xl text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-transparent">
        <button onclick="saveGmailClientSecret()" id="saveSecretBtn"
                class="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-sm transition-colors whitespace-nowrap">
          <i class="fas fa-save mr-1"></i> ${hasClientSecret ? 'Update Secret' : 'Save Secret'}
        </button>
      </div>
      <p class="text-xs text-gray-400 mt-2"><i class="fas fa-lock mr-1"></i> Stored securely in your database. Never exposed to frontend.</p>
    </div>

    <!-- Step 2: Authorize Gmail -->
    <div class="bg-white rounded-2xl border ${hasRefreshToken ? 'border-green-200' : (hasClientSecret ? 'border-blue-200' : 'border-gray-200')} p-6 shadow-sm ${!hasClientSecret ? 'opacity-50 pointer-events-none' : ''}">
      <div class="flex items-start gap-3 mb-4">
        <div class="w-8 h-8 rounded-full ${hasRefreshToken ? 'bg-green-100 text-green-700' : (hasClientSecret ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-400')} flex items-center justify-center font-bold text-sm flex-shrink-0">2</div>
        <div class="flex-1">
          <h4 class="font-bold text-gray-800">${hasRefreshToken ? 'Gmail Authorized' : 'Authorize Gmail Access'}</h4>
          <p class="text-sm text-gray-500 mt-1">${hasRefreshToken ? 'Gmail is authorized to send emails from <strong>' + senderEmail + '</strong>.' : 'Click the button below to sign in with Google and grant email sending permission.'}</p>
        </div>
      </div>
      ${hasClientSecret ? '<div class="flex flex-wrap items-center gap-3"><a href="/api/auth/gmail" class="inline-flex items-center gap-2 px-6 py-3 ' + (hasRefreshToken ? 'bg-gray-100 hover:bg-gray-200 text-gray-700' : 'bg-teal-600 hover:bg-teal-700 text-white') + ' rounded-xl font-semibold text-sm transition-colors"><svg class="w-5 h-5" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>' + (hasRefreshToken ? 'Re-authorize Gmail' : 'Sign in with Google') + '</a>' + (hasRefreshToken ? '<button onclick="disconnectGmailSA()" class="inline-flex items-center gap-2 px-5 py-3 border border-red-200 text-red-600 bg-white hover:bg-red-50 rounded-xl font-semibold text-sm transition-colors"><i class="fas fa-unlink"></i> Disconnect</button>' : '') + '</div>' : '<p class="text-sm text-gray-400"><i class="fas fa-arrow-up mr-1"></i> Complete Step 1 first.</p>'}
    </div>

    <!-- Step 3: Test -->
    <div class="bg-white rounded-2xl border ${isReady ? 'border-green-200' : 'border-gray-200'} p-6 shadow-sm ${!isReady ? 'opacity-50 pointer-events-none' : ''}">
      <div class="flex items-start gap-3 mb-4">
        <div class="w-8 h-8 rounded-full ${isReady ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'} flex items-center justify-center font-bold text-sm flex-shrink-0">3</div>
        <div class="flex-1">
          <h4 class="font-bold text-gray-800">Test Email Delivery</h4>
          <p class="text-sm text-gray-500 mt-1">Send a test verification code to any email address to confirm everything works.</p>
        </div>
      </div>
      ${isReady ? '<div class="flex gap-3"><input type="email" id="testEmailAddr" placeholder="your@email.com" class="flex-1 px-4 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent"><button onclick="testEmailDelivery()" id="testEmailBtn" class="px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl font-semibold text-sm transition-colors whitespace-nowrap"><i class="fas fa-paper-plane mr-1"></i> Send Test</button></div><div id="testEmailResult" class="hidden mt-3 p-3 rounded-xl text-sm"></div>' : '<p class="text-sm text-gray-400"><i class="fas fa-arrow-up mr-1"></i> Complete Steps 1 and 2 first.</p>'}
    </div>

    <!-- Important Notes -->
    <div class="bg-blue-50 border border-blue-100 rounded-2xl p-5">
      <h4 class="font-bold text-blue-800 mb-2"><i class="fas fa-info-circle mr-1"></i> Important Notes</h4>
      <ul class="text-sm text-blue-700 space-y-1 list-disc list-inside">
        <li>Make sure <code class="bg-blue-100 px-1 rounded">https://roofmanager.ca/api/auth/gmail/callback</code> is listed as an authorized redirect URI in your GCP OAuth Client.</li>
        <li>The Gmail API scope <code class="bg-blue-100 px-1 rounded">gmail.send</code> only allows sending — it cannot read your inbox.</li>
        <li>Credentials are stored in your D1 database, not in environment variables.</li>
        <li>This same Gmail connection is used for verification codes, report delivery, and email outreach.</li>
      </ul>
    </div>
  </div>`;
}

// Email Setup action: disconnect Gmail
async function disconnectGmailSA() {
  if (!confirm('Disconnect Gmail? Verification codes, report delivery, and outreach will stop sending until you reconnect.')) return;
  try {
    const res = await saFetch('/api/auth/gmail/disconnect', { method: 'POST' });
    if (!res) return;
    const data = await res.json();
    if (res.ok && data.success) {
      window.rmToast ? window.rmToast('Gmail disconnected', 'success') : alert('Gmail disconnected');
      const gmailStatusRes = await saFetch('/api/auth/gmail/status');
      if (gmailStatusRes) SA.data.emailSetup = await gmailStatusRes.json();
      const host = document.getElementById('sa-root');
      if (host && typeof renderEmailSetupView === 'function') host.innerHTML = renderEmailSetupView();
    } else {
      alert(data.error || 'Failed to disconnect Gmail');
    }
  } catch (e) {
    alert('Failed to disconnect Gmail: ' + e.message);
  }
}
window.disconnectGmailSA = disconnectGmailSA;

// Email Setup action: save client secret
async function saveGmailClientSecret() {
  const input = document.getElementById('gmailClientSecret');
  const btn = document.getElementById('saveSecretBtn');
  const secret = input.value.trim();
  if (!secret || secret.length < 10) { window.rmToast('Please paste a valid Gmail OAuth client secret.', 'warning'); return; }
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Saving...';
  try {
    const res = await saFetch('/api/auth/gmail/setup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_secret: secret })
    });
    if (!res) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save mr-1"></i> Save Secret'; return; }
    const data = await res.json();
    if (res.ok && data.success) {
      btn.innerHTML = '<i class="fas fa-check mr-1"></i> Saved!';
      btn.classList.replace('bg-blue-600', 'bg-green-600');
      input.value = ''; input.placeholder = 'Secret saved successfully';
      setTimeout(() => loadView('email-setup'), 1200);
    } else {
      window.rmToast(data.error || 'Failed to save.', 'info'); btn.disabled = false; btn.innerHTML = '<i class="fas fa-save mr-1"></i> Save Secret';
    }
  } catch (e) { window.rmToast('Network error.', 'error'); btn.disabled = false; btn.innerHTML = '<i class="fas fa-save mr-1"></i> Save Secret'; }
}

// Email Setup action: test email delivery
async function testEmailDelivery() {
  const input = document.getElementById('testEmailAddr');
  const btn = document.getElementById('testEmailBtn');
  const result = document.getElementById('testEmailResult');
  const email = input.value.trim();
  if (!email || !email.includes('@')) { window.rmToast('Please enter a valid email address.', 'warning'); return; }
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Sending...';
  result.classList.add('hidden');
  try {
    const res = await fetch('/api/customer/send-verification', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    result.classList.remove('hidden');
    if (data.email_sent) {
      result.className = 'mt-3 p-3 rounded-xl text-sm bg-green-50 text-green-800 border border-green-200';
      result.innerHTML = '<i class="fas fa-check-circle mr-1"></i> <strong>Email sent!</strong> Check ' + email + ' inbox (and spam).';
    } else if (data.fallback_code) {
      result.className = 'mt-3 p-3 rounded-xl text-sm bg-amber-50 text-amber-800 border border-amber-200';
      result.innerHTML = '<i class="fas fa-exclamation-triangle mr-1"></i> Email delivery failed. Fallback code: <strong class="font-mono text-lg">' + data.fallback_code + '</strong><br><span class="text-xs">Complete Gmail OAuth setup above to fix.</span>';
    } else {
      result.className = 'mt-3 p-3 rounded-xl text-sm bg-red-50 text-red-800 border border-teal-200';
      result.innerHTML = '<i class="fas fa-times-circle mr-1"></i> ' + (data.error || 'Failed.');
    }
  } catch (e) {
    result.classList.remove('hidden');
    result.className = 'mt-3 p-3 rounded-xl text-sm bg-red-50 text-red-800 border border-teal-200';
    result.innerHTML = '<i class="fas fa-times-circle mr-1"></i> Network error.';
  }
  btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane mr-1"></i> Send Test';
}

// ============================================================
// VIEW: SITE ANALYTICS — Every click tracked
// ============================================================
window.saChangeAnalyticsPeriod = function(p) {
  SA.analyticsPeriod = p;
  loadView('analytics');
};

function renderAnalyticsView() {
  const d = SA.data.analytics || {};
  const o = d.overview || {};
  const prev = d.prev_overview || {};
  const geo = d.geo_coverage || {};
  const pages = d.top_pages || [];
  const countries = d.top_countries || [];
  const referrers = d.top_referrers || [];
  const visitors = d.recent_visitors || [];
  const hourly = d.hourly_traffic || [];
  const devices = d.device_breakdown || [];
  const utmSources = d.utm_sources || [];
  const utmMediums = d.utm_mediums || [];
  const utmCampaigns = d.utm_campaigns || [];
  const signupsInPeriod = d.signups_in_period || 0;

  // Country flag emoji helper
  function countryFlag(code) {
    if (!code || code.length !== 2) return '🌍';
    const offset = 127397;
    return String.fromCodePoint(...[...code.toUpperCase()].map(c => c.charCodeAt(0) + offset));
  }

  // Event type badge
  function eventBadge(type) {
    const m = {
      pageview: 'bg-blue-100 text-blue-700',
      click: 'bg-amber-100 text-amber-700',
      page_exit: 'bg-gray-100 text-gray-500',
      scroll: 'bg-indigo-100 text-indigo-700',
      session_start: 'bg-green-100 text-green-700'
    };
    return '<span class="px-1.5 py-0.5 rounded-full text-[10px] font-medium ' + (m[type] || 'bg-gray-100 text-gray-600') + '">' + type + '</span>';
  }

  // Device icon
  function deviceIcon(type) {
    if (type === 'mobile') return '<i class="fas fa-mobile-alt text-blue-500"></i>';
    if (type === 'tablet') return '<i class="fas fa-tablet-alt text-indigo-500"></i>';
    if (type === 'bot') return '<i class="fas fa-robot text-gray-400"></i>';
    return '<i class="fas fa-desktop text-gray-700"></i>';
  }

  // Trend badge: compare current vs previous period value
  function trendBadge(current, previous) {
    if (!previous || previous === 0) return '<span class="text-[10px] text-gray-400 ml-1">—</span>';
    const pct = Math.round(((current - previous) / previous) * 100);
    if (pct === 0) return '<span class="text-[10px] text-gray-400 ml-1">~0%</span>';
    const up = pct > 0;
    return '<span class="text-[10px] font-semibold ml-1 ' + (up ? 'text-green-600' : 'text-red-500') + '">' +
      (up ? '▲' : '▼') + ' ' + Math.abs(pct) + '%' +
    '</span>';
  }

  // Sparkline-style hourly bar chart
  const maxHourly = Math.max(...hourly.map(h => h.pageviews || 0), 1);
  const hourlyBars = hourly.slice(-24).map(h => {
    const pct = Math.round(((h.pageviews || 0) / maxHourly) * 100);
    const hour = (h.hour || '').split(' ')[1] || '';
    return '<div class="flex flex-col items-center gap-1" title="' + h.hour + ': ' + h.pageviews + ' views, ' + h.visitors + ' visitors">' +
      '<div class="w-3 bg-teal-200 rounded-t relative" style="height:40px">' +
        '<div class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-teal-600 to-teal-400 rounded-t" style="height:' + pct + '%"></div>' +
      '</div>' +
      '<span class="text-[8px] text-gray-400">' + hour.replace(':00','') + '</span>' +
    '</div>';
  }).join('');

  // Device totals
  const totalDeviceHits = devices.reduce((s, dv) => s + (dv.count || 0), 0) || 1;

  // Signup conversion rate
  const convRate = (o.unique_visitors || 0) > 0
    ? ((signupsInPeriod / o.unique_visitors) * 100).toFixed(2) + '%'
    : '—';

  const periodLabels = { '24h': 'Last 24 Hours', '7d': 'Last 7 Days', '30d': 'Last 30 Days', '90d': 'Last 90 Days' };

  // UTM table builder
  function utmTable(rows, label) {
    if (!rows.length) return '<p class="text-gray-400 text-xs py-2">No ' + label + ' data yet</p>';
    return '<div class="space-y-1">' + rows.map(function(r) {
      const maxHits = rows[0].hits || 1;
      const pct = Math.round((r.hits / maxHits) * 100);
      return '<div class="flex items-center gap-2 py-1">' +
        '<span class="text-xs text-gray-700 truncate w-32 flex-shrink-0" title="' + r.value + '">' + r.value + '</span>' +
        '<div class="flex-1 bg-gray-100 rounded-full h-1.5"><div class="bg-indigo-500 h-1.5 rounded-full" style="width:' + pct + '%"></div></div>' +
        '<span class="text-xs font-bold text-gray-800 w-8 text-right flex-shrink-0">' + r.hits + '</span>' +
      '</div>';
    }).join('') + '</div>';
  }

  // Auto-refresh countdown display
  const arActive = SA._arActive || false;
  const arLabel = arActive
    ? '<span id="sa-ar-countdown" class="text-xs text-teal-600 font-medium">Auto-refresh on</span>'
    : '';

  return `
    <div class="mb-6 flex items-center justify-between">
      <div>
        <h2 class="text-2xl font-black text-gray-900"><i class="fas fa-chart-line mr-2 text-teal-500"></i>Site Analytics</h2>
        <p class="text-sm text-gray-500 mt-1">Every click, pageview, and visitor tracked in real time</p>
      </div>
      <div class="flex items-center gap-3">
        <span class="text-xs text-gray-400">${periodLabels[d.period] || d.period}</span>
        <select onchange="saChangeAnalyticsPeriod(this.value)" class="text-xs border border-gray-200 rounded-lg px-3 py-1.5 bg-white focus:ring-2 focus:ring-teal-500 focus:border-teal-500">
          <option value="24h" ${SA.analyticsPeriod === '24h' ? 'selected' : ''}>Last 24 Hours</option>
          <option value="7d" ${SA.analyticsPeriod === '7d' ? 'selected' : ''}>Last 7 Days</option>
          <option value="30d" ${SA.analyticsPeriod === '30d' ? 'selected' : ''}>Last 30 Days</option>
          <option value="90d" ${SA.analyticsPeriod === '90d' ? 'selected' : ''}>Last 90 Days</option>
        </select>
      </div>
    </div>

    <!-- KPI Cards — 5-col with trend indicators -->
    <div class="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
      <div class="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
        <div class="flex items-center justify-between mb-1">
          <span class="text-xs font-semibold text-gray-500 uppercase tracking-wide">Pageviews</span>
          <i class="fas fa-eye text-blue-400 text-sm"></i>
        </div>
        <div class="flex items-baseline gap-1">
          <span class="text-2xl font-black text-gray-900">${(o.pageviews || 0).toLocaleString()}</span>
          ${trendBadge(o.pageviews || 0, prev.pageviews || 0)}
        </div>
        <p class="text-[10px] text-gray-400 mt-1">${(o.total_events || 0).toLocaleString()} total events</p>
      </div>
      <div class="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
        <div class="flex items-center justify-between mb-1">
          <span class="text-xs font-semibold text-gray-500 uppercase tracking-wide">Unique Visitors</span>
          <i class="fas fa-users text-green-400 text-sm"></i>
        </div>
        <div class="flex items-baseline gap-1">
          <span class="text-2xl font-black text-gray-900">${(o.unique_visitors || 0).toLocaleString()}</span>
          ${trendBadge(o.unique_visitors || 0, prev.unique_visitors || 0)}
        </div>
        <p class="text-[10px] text-gray-400 mt-1">${(o.sessions || 0).toLocaleString()} sessions</p>
      </div>
      <div class="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
        <div class="flex items-center justify-between mb-1">
          <span class="text-xs font-semibold text-gray-500 uppercase tracking-wide">Clicks</span>
          <i class="fas fa-mouse-pointer text-amber-400 text-sm"></i>
        </div>
        <div class="flex items-baseline gap-1">
          <span class="text-2xl font-black text-gray-900">${(o.clicks || 0).toLocaleString()}</span>
          ${trendBadge(o.clicks || 0, prev.clicks || 0)}
        </div>
        <p class="text-[10px] text-gray-400 mt-1">${(o.unique_ips || 0).toLocaleString()} unique IPs</p>
      </div>
      <div class="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
        <div class="flex items-center justify-between mb-1">
          <span class="text-xs font-semibold text-gray-500 uppercase tracking-wide">Avg Time on Page</span>
          <i class="fas fa-clock text-purple-400 text-sm"></i>
        </div>
        <div class="flex items-baseline gap-1">
          <span class="text-2xl font-black text-gray-900">${(o.avg_time_on_page || 0)}s</span>
          ${trendBadge(o.avg_time_on_page || 0, prev.avg_time_on_page || 0)}
        </div>
        <p class="text-[10px] text-gray-400 mt-1">Avg scroll: ${(o.avg_scroll_depth || 0)}%</p>
      </div>
      <div class="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
        <div class="flex items-center justify-between mb-1">
          <span class="text-xs font-semibold text-gray-500 uppercase tracking-wide">Signup Conversion</span>
          <i class="fas fa-user-plus text-teal-500 text-sm"></i>
        </div>
        <div class="flex items-baseline gap-1">
          <span class="text-2xl font-black text-gray-900">${convRate}</span>
        </div>
        <p class="text-[10px] text-gray-400 mt-1">${signupsInPeriod} new signups this period</p>
      </div>
    </div>

    <!-- Hourly Traffic -->
    ${saSection('Traffic (Last 24 Hours)', 'fa-chart-bar', hourly.length === 0
      ? '<p class="text-gray-400 text-sm text-center py-4">No traffic data yet. Events will appear here once visitors interact with your site.</p>'
      : '<div class="flex items-end gap-0.5 justify-between h-16">' + hourlyBars + '</div>'
    )}

    <div class="grid lg:grid-cols-2 gap-6 mb-6">
      <!-- Top Pages with Bounce Rate -->
      ${saSection('Top Pages', 'fa-file-alt', pages.length === 0
        ? '<p class="text-gray-400 text-sm">No page data yet</p>'
        : '<div class="overflow-x-auto"><table class="w-full text-xs"><thead><tr class="text-[10px] text-gray-400 uppercase border-b border-gray-100">' +
            '<th class="pb-1.5 text-left font-semibold">Page</th>' +
            '<th class="pb-1.5 text-right font-semibold">Views</th>' +
            '<th class="pb-1.5 text-right font-semibold">Uniq</th>' +
            '<th class="pb-1.5 text-right font-semibold">Bounce</th>' +
            '<th class="pb-1.5 text-right font-semibold">Avg Time</th>' +
          '</tr></thead><tbody class="divide-y divide-gray-50">' +
          pages.map(function(p) {
            const br = p.bounce_rate != null ? p.bounce_rate + '%' : '—';
            const brColor = p.bounce_rate > 70 ? 'text-red-500' : p.bounce_rate > 40 ? 'text-amber-600' : 'text-green-600';
            return '<tr class="hover:bg-gray-50 transition-colors">' +
              '<td class="py-1.5 pr-2 font-mono text-gray-700 max-w-[180px] truncate" title="' + p.page_url + '">' + p.page_url + '</td>' +
              '<td class="py-1.5 text-right font-bold text-gray-800">' + (p.views || 0) + '</td>' +
              '<td class="py-1.5 text-right text-gray-500">' + (p.unique_visitors || 0) + '</td>' +
              '<td class="py-1.5 text-right font-semibold ' + brColor + '">' + br + '</td>' +
              '<td class="py-1.5 text-right text-gray-500">' + (p.avg_time ? p.avg_time + 's' : '—') + '</td>' +
            '</tr>';
          }).join('') +
          '</tbody></table></div>'
      )}

      <!-- Top Countries -->
      ${saSection('Visitors by Country', 'fa-globe', countries.length === 0
        ? '<p class="text-gray-400 text-sm">No country data yet</p>'
        : '<div class="space-y-1.5 max-h-80 overflow-y-auto">' + countries.map(function(c) {
            return '<div class="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-gray-50">' +
              '<div class="flex items-center gap-2">' +
                '<span class="text-lg">' + countryFlag(c.country) + '</span>' +
                '<span class="text-sm font-medium text-gray-700">' + (c.country || 'Unknown') + '</span>' +
              '</div>' +
              '<div class="text-right">' +
                '<span class="text-sm font-bold text-gray-800">' + (c.visitors || 0) + '</span>' +
                '<span class="text-[10px] text-gray-400 block">' + (c.hits || 0) + ' pageviews, ' + (c.sessions || 0) + ' sessions</span>' +
              '</div>' +
            '</div>';
          }).join('') + '</div>' +
          (geo.pct != null ? '<div class="mt-3 pt-2 border-t border-gray-100 flex items-center gap-1.5">' +
            '<i class="fas fa-info-circle text-gray-300 text-xs"></i>' +
            '<span class="text-[10px] text-gray-400">Geo data coverage: <strong class="' + (geo.pct >= 90 ? 'text-green-600' : geo.pct >= 70 ? 'text-amber-600' : 'text-red-500') + '">' + geo.pct + '%</strong> of ' + (geo.total_pageviews || 0).toLocaleString() + ' pageviews</span>' +
          '</div>' : '')
      )}
    </div>

    <div class="grid lg:grid-cols-2 gap-6 mb-6">
      <!-- Top Referrers -->
      ${saSection('Top Referrers', 'fa-external-link-alt', referrers.length === 0
        ? '<p class="text-gray-400 text-sm">No referrer data yet — visitors are arriving directly</p>'
        : '<div class="space-y-1.5 max-h-60 overflow-y-auto">' + referrers.map(function(r) {
            let domain = r.referrer;
            try { domain = new URL(r.referrer).hostname; } catch(e) {}
            return '<div class="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-gray-50">' +
              '<span class="text-xs text-gray-600 truncate max-w-[250px]" title="' + r.referrer + '">' +
                '<i class="fas fa-link mr-1 text-gray-400"></i>' + domain +
              '</span>' +
              '<div class="text-right flex-shrink-0">' +
                '<span class="text-sm font-bold text-gray-800">' + r.hits + '</span>' +
                '<span class="text-[10px] text-gray-400 block">' + (r.visitors || 0) + ' visitors</span>' +
              '</div>' +
            '</div>';
          }).join('') + '</div>'
      )}

      <!-- Device Breakdown -->
      ${saSection('Devices & Browsers', 'fa-laptop', devices.length === 0
        ? '<p class="text-gray-400 text-sm">No device data yet</p>'
        : '<div class="space-y-3">' + devices.map(function(dv) {
            const pct = Math.round((dv.count / totalDeviceHits) * 100);
            return '<div class="flex items-center gap-3">' +
              '<div class="w-8 text-center">' + deviceIcon(dv.device_type) + '</div>' +
              '<div class="flex-1">' +
                '<div class="flex justify-between mb-0.5">' +
                  '<span class="text-sm font-medium text-gray-700 capitalize">' + (dv.device_type || 'unknown') + '</span>' +
                  '<span class="text-xs text-gray-500">' + dv.count + ' (' + pct + '%)</span>' +
                '</div>' +
                '<div class="w-full bg-gray-100 rounded-full h-2"><div class="bg-gradient-to-r from-teal-500 to-teal-400 h-2 rounded-full" style="width:' + pct + '%"></div></div>' +
              '</div>' +
            '</div>';
          }).join('') + '</div>'
      )}
    </div>

    <!-- UTM Campaign Attribution -->
    ${saSection('UTM Campaign Attribution', 'fa-bullseye', (() => {
      const hasAny = utmSources.length || utmMediums.length || utmCampaigns.length;
      if (!hasAny) return '<p class="text-gray-400 text-sm">No UTM-tagged traffic yet. Add <code class="bg-gray-100 px-1 rounded text-xs">?utm_source=...</code> to your campaign links to track attribution here.</p>';
      return '<div class="grid grid-cols-3 gap-4">' +
        '<div><p class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2"><i class="fas fa-tag mr-1 text-indigo-400"></i>Source</p>' + utmTable(utmSources, 'source') + '</div>' +
        '<div><p class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2"><i class="fas fa-layer-group mr-1 text-indigo-400"></i>Medium</p>' + utmTable(utmMediums, 'medium') + '</div>' +
        '<div><p class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2"><i class="fas fa-flag mr-1 text-indigo-400"></i>Campaign</p>' + utmTable(utmCampaigns, 'campaign') + '</div>' +
      '</div>';
    })())}

    <!-- Live Event Feed -->
    ${saSection('Live Event Feed (Last 50)', 'fa-stream', visitors.length === 0
      ? '<p class="text-gray-400 text-sm text-center py-4">No events recorded yet. The tracker will capture every click and pageview automatically.</p>'
      : '<div class="overflow-x-auto"><table class="w-full text-sm"><thead class="bg-gray-50"><tr>' +
          '<th class="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">Time</th>' +
          '<th class="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">Event</th>' +
          '<th class="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">Page</th>' +
          '<th class="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">Detail</th>' +
          '<th class="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">Location</th>' +
          '<th class="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">Device</th>' +
          '<th class="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">IP</th>' +
        '</tr></thead><tbody class="divide-y divide-gray-50">' +
        visitors.map(function(v) {
          const detail = v.event_type === 'click'
            ? '<span class="text-[10px] text-amber-700" title="' + (v.click_element||'') + '">' + (v.click_text || v.click_element || '-').substring(0,40) + '</span>'
            : v.event_type === 'page_exit'
              ? '<span class="text-[10px] text-gray-500">' + (v.time_on_page || 0) + 's / ' + (v.scroll_depth || 0) + '% scroll</span>'
              : '<span class="text-[10px] text-gray-400">' + (v.referrer ? 'from ' + v.referrer.substring(0,30) : '-') + '</span>';
          return '<tr class="hover:bg-teal-50/30 transition-colors">' +
            '<td class="px-3 py-1.5 text-[10px] text-gray-500 whitespace-nowrap">' + fmtDateTime(v.created_at) + '</td>' +
            '<td class="px-3 py-1.5">' + eventBadge(v.event_type) + '</td>' +
            '<td class="px-3 py-1.5 text-xs font-mono text-gray-700 max-w-[150px] truncate" title="' + v.page_url + '">' + (v.page_url || '/') + '</td>' +
            '<td class="px-3 py-1.5">' + detail + '</td>' +
            '<td class="px-3 py-1.5 text-[10px] text-gray-600">' +
              (v.country ? countryFlag(v.country) + ' ' : '') + (v.city || '') + (v.region ? ', ' + v.region : '') +
            '</td>' +
            '<td class="px-3 py-1.5 text-[10px] text-gray-500">' + deviceIcon(v.device_type) + ' ' + (v.browser || '') + ' / ' + (v.os || '') + '</td>' +
            '<td class="px-3 py-1.5 text-[10px] font-mono text-gray-400">' + (v.ip_address || '-') + '</td>' +
          '</tr>';
        }).join('') +
        '</tbody></table></div>',
      // Live feed header actions: auto-refresh toggle + manual refresh
      '<div class="flex items-center gap-3">' +
        arLabel +
        '<button onclick="saToggleAutoRefresh()" class="text-xs px-2.5 py-1 rounded-lg border ' + (arActive ? 'border-teal-500 text-teal-600 bg-teal-50' : 'border-gray-200 text-gray-500 hover:border-teal-400 hover:text-teal-600') + ' font-medium transition-colors">' +
          '<i class="fas fa-sync-alt mr-1"></i>' + (arActive ? 'Auto On' : 'Auto Off') +
        '</button>' +
        '<button onclick="saRefreshAnalytics()" class="text-xs text-teal-600 hover:text-teal-800 font-medium"><i class="fas fa-sync-alt mr-1"></i>Refresh</button>' +
      '</div>'
    )}
  `;
}

window.saRefreshAnalytics = function() {
  loadView('analytics');
};

// Auto-refresh: 30-second interval for the live feed
window.saToggleAutoRefresh = function() {
  SA._arActive = !SA._arActive;
  if (SA._arActive) {
    SA._arCountdown = 30;
    SA._arInterval = setInterval(function() {
      SA._arCountdown--;
      const el = document.getElementById('sa-ar-countdown');
      if (el) el.textContent = 'Refreshing in ' + SA._arCountdown + 's';
      if (SA._arCountdown <= 0) {
        SA._arCountdown = 30;
        loadView('analytics');
      }
    }, 1000);
  } else {
    clearInterval(SA._arInterval);
    SA._arInterval = null;
    SA._arCountdown = 30;
  }
  renderContent();
};

// ============================================================
// VIEW: GOOGLE ANALYTICS 4 — GA4 Data API + Realtime + Measurement Protocol
// Full GA4 integration for super-admin monitoring
// ============================================================

window.saChangeGA4Period = function(p) {
  SA.ga4Period = p;
  loadView('ga4');
};

window.saSetGA4Tab = function(tab) {
  SA.ga4Tab = tab;
  renderContent();
};

window.saRefreshGA4 = function() {
  loadView('ga4');
};

window.saTestGA4Event = function() {
  saFetch('/api/analytics/ga4/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...saHeaders() },
    body: JSON.stringify({
      client_id: 'superadmin_test_' + Date.now(),
      events: [{ name: 'admin_test_ping', params: { source: 'super_admin_dashboard', timestamp: new Date().toISOString() } }]
    })
  }).then(async r => {
    if (!r) return;
    const d = await r.json();
    window.rmToast(d.success ? 'Test event sent successfully to GA4!' : 'Event send failed: ' + JSON.stringify(d, 'info'));
  });
};

// ============================================================
// VIEW: BLOG MANAGER — Full CRUD for blog posts
// ============================================================
var BM = { editingId: null, filter: 'all' };

window.bmOpenCreate = function() {
  BM.editingId = null;
  document.getElementById('bm-modal-title').textContent = 'New Post';
  document.getElementById('bm-form').reset();
  document.getElementById('bm-slug').value = '';
  document.getElementById('bm-modal').classList.remove('hidden');
};

window.bmOpenEdit = async function(id) {
  BM.editingId = id;
  document.getElementById('bm-modal-title').textContent = 'Edit Post';
  const res = await saFetch('/api/blog/admin/posts?limit=200');
  if (!res || !res.ok) return;
  const d = await res.json();
  const post = (d.posts || d).find(function(p) { return p.id === id; });
  if (!post) return;
  document.getElementById('bm-title').value = post.title || '';
  document.getElementById('bm-slug').value = post.slug || '';
  document.getElementById('bm-category').value = post.category || 'roofing';
  document.getElementById('bm-status').value = post.status || 'draft';
  document.getElementById('bm-featured').checked = !!post.is_featured;
  document.getElementById('bm-cover').value = post.cover_image_url || '';
  document.getElementById('bm-excerpt').value = post.excerpt || '';
  document.getElementById('bm-meta-desc').value = post.meta_description || '';
  document.getElementById('bm-tags').value = post.tags || '';
  document.getElementById('bm-author').value = post.author_name || 'Roof Manager Team';
  document.getElementById('bm-read-time').value = post.read_time_minutes || 5;
  document.getElementById('bm-content').value = post.content || '';
  document.getElementById('bm-modal').classList.remove('hidden');
};

window.bmCloseModal = function() {
  document.getElementById('bm-modal').classList.add('hidden');
  BM.editingId = null;
};

window.bmAutoSlug = function() {
  var t = document.getElementById('bm-title').value;
  if (!BM.editingId) {
    document.getElementById('bm-slug').value = t.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').substring(0,100);
  }
};

window.bmSave = async function() {
  var payload = {
    title: document.getElementById('bm-title').value.trim(),
    slug: document.getElementById('bm-slug').value.trim(),
    category: document.getElementById('bm-category').value,
    status: document.getElementById('bm-status').value,
    is_featured: document.getElementById('bm-featured').checked ? 1 : 0,
    cover_image_url: document.getElementById('bm-cover').value.trim(),
    excerpt: document.getElementById('bm-excerpt').value.trim(),
    meta_description: document.getElementById('bm-meta-desc').value.trim(),
    tags: document.getElementById('bm-tags').value.trim(),
    author_name: document.getElementById('bm-author').value.trim() || 'Roof Manager Team',
    read_time_minutes: parseInt(document.getElementById('bm-read-time').value) || 5,
    content: document.getElementById('bm-content').value.trim()
  };
  if (!payload.title) { window.rmToast('Title is required', 'error'); return; }
  var url = BM.editingId ? '/api/blog/admin/posts/' + BM.editingId : '/api/blog/admin/posts';
  var method = BM.editingId ? 'PUT' : 'POST';
  const res = await saFetch(url, { method: method, headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
  if (!res) return;
  const d = await res.json();
  if (d.error) { window.rmToast('Error: ' + d.error, 'error'); return; }
  window.rmToast(BM.editingId ? 'Post updated!' : 'Post created!');
  bmCloseModal();
  loadView('blog-manager');
};

window.bmDelete = async function(id, title) {
  if (!confirm('Delete "' + title + '"?\nThis cannot be undone.')) return;
  const res = await saFetch('/api/blog/admin/posts/' + id, { method: 'DELETE' });
  if (!res) return;
  const d = await res.json();
  if (d.error) { window.rmToast('Error: ' + d.error, 'error'); return; }
  window.rmToast('Post deleted');
  loadView('blog-manager');
};

window.bmToggleStatus = async function(id, currentStatus) {
  var newStatus = currentStatus === 'published' ? 'draft' : 'published';
  const res = await saFetch('/api/blog/admin/posts/' + id, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ status: newStatus }) });
  if (!res) return;
  window.rmToast('Status changed to ' + newStatus);
  loadView('blog-manager');
};

window.bmSetFilter = function(f, el) {
  BM.filter = f;
  document.querySelectorAll('.bm-filter-btn').forEach(function(b){ b.classList.remove('bg-[#00FF88]','text-black'); b.classList.add('bg-white/5','text-gray-400'); });
  if(el){ el.classList.add('bg-[#00FF88]','text-black'); el.classList.remove('bg-white/5','text-gray-400'); }
  renderContent();
};

function renderBlogManagerView() {
  var allPosts = (SA.data.blog_posts && (SA.data.blog_posts.posts || SA.data.blog_posts)) || [];
  var published = allPosts.filter(function(p){ return p.status === 'published'; });
  var drafts = allPosts.filter(function(p){ return p.status === 'draft'; });
  var featured = allPosts.filter(function(p){ return p.is_featured; });

  var filtered = BM.filter === 'published' ? published : BM.filter === 'drafts' ? drafts : allPosts;

  var CATS = ['roofing','technology','business','guides','industry','tips','case-studies','product','city-guides','international','ai-voice','storm-response','commercial','marketing','insurance','sales'];

  var categoryBadge = function(cat) {
    var colors = { roofing:'bg-sky-500/20 text-sky-400', technology:'bg-purple-500/20 text-purple-400', business:'bg-emerald-500/20 text-emerald-400', guides:'bg-amber-500/20 text-amber-400', industry:'bg-blue-500/20 text-blue-400', tips:'bg-yellow-500/20 text-yellow-400', 'case-studies':'bg-rose-500/20 text-rose-400', product:'bg-indigo-500/20 text-indigo-400', 'city-guides':'bg-teal-500/20 text-teal-400', international:'bg-cyan-500/20 text-cyan-400', 'ai-voice':'bg-violet-500/20 text-violet-400', 'storm-response':'bg-slate-400/20 text-slate-300', commercial:'bg-stone-400/20 text-stone-300', marketing:'bg-orange-500/20 text-orange-400', insurance:'bg-green-500/20 text-green-400', sales:'bg-pink-500/20 text-pink-400' };
    var cls = colors[cat] || 'bg-white/10 text-gray-400';
    return '<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold ' + cls + '">' + cat + '</span>';
  };

  var rows = filtered.map(function(p) {
    var statusBadge = p.status === 'published'
      ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-500/20 text-green-400">Published</span>'
      : '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-500/20 text-gray-400">Draft</span>';
    var featuredStar = p.is_featured ? '<i class="fas fa-star text-amber-400 text-xs"></i>' : '<i class="far fa-star text-gray-700 text-xs"></i>';
    var date = p.published_at ? p.published_at.substring(0,10) : '—';
    return '<tr class="border-t border-white/5 hover:bg-white/[0.02] transition-colors">' +
      '<td class="px-4 py-3 text-center">' + featuredStar + '</td>' +
      '<td class="px-4 py-3"><p class="text-sm font-semibold text-white leading-tight max-w-xs">' + (p.title || '') + '</p><p class="text-[10px] text-gray-500 mt-0.5 font-mono">' + (p.slug || '') + '</p></td>' +
      '<td class="px-4 py-3">' + categoryBadge(p.category || '') + '</td>' +
      '<td class="px-4 py-3">' + statusBadge + '</td>' +
      '<td class="px-4 py-3 text-xs text-gray-400 text-center">' + (p.read_time_minutes || '—') + 'm</td>' +
      '<td class="px-4 py-3 text-xs text-gray-500">' + date + '</td>' +
      '<td class="px-4 py-3">' +
        '<div class="flex items-center gap-2">' +
          '<button onclick="bmOpenEdit(' + p.id + ')" class="text-xs px-2.5 py-1 bg-white/5 hover:bg-white/10 text-gray-300 rounded-lg transition-colors">Edit</button>' +
          '<button onclick="bmToggleStatus(' + p.id + ',\'' + p.status + '\')" class="text-xs px-2.5 py-1 ' + (p.status==='published' ? 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-400' : 'bg-green-500/10 hover:bg-green-500/20 text-green-400') + ' rounded-lg transition-colors">' + (p.status==='published' ? 'Unpublish' : 'Publish') + '</button>' +
          '<button onclick="bmDelete(' + p.id + ',\'' + (p.title||'').replace(/'/g,"\\'").substring(0,40) + '\')" class="text-xs px-2.5 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors"><i class="fas fa-trash"></i></button>' +
        '</div>' +
      '</td>' +
    '</tr>';
  }).join('');

  var catOptions = CATS.map(function(c){ return '<option value="'+c+'">'+c+'</option>'; }).join('');

  return `
    <div class="mb-6 flex items-center justify-between">
      <div>
        <h2 class="text-2xl font-black text-gray-900"><i class="fas fa-pen-nib mr-2 text-teal-500"></i>Blog Manager</h2>
        <p class="text-sm text-gray-500 mt-1">Create, edit, and publish blog posts</p>
      </div>
      <button onclick="bmOpenCreate()" class="flex items-center gap-2 bg-[#00FF88] hover:bg-[#00e67a] text-black font-bold px-5 py-2.5 rounded-xl text-sm transition-colors">
        <i class="fas fa-plus"></i> New Post
      </button>
    </div>

    <div class="grid grid-cols-4 gap-4 mb-6">
      ${samc('Total Posts', allPosts.length, 'fa-file-alt', 'blue')}
      ${samc('Published', published.length, 'fa-check-circle', 'green')}
      ${samc('Drafts', drafts.length, 'fa-edit', 'amber')}
      ${samc('Featured', featured.length, 'fa-star', 'indigo')}
    </div>

    <div class="flex items-center gap-2 mb-4">
      <button class="bm-filter-btn text-xs px-3 py-1.5 rounded-full font-semibold transition-colors bg-[#00FF88] text-black" onclick="bmSetFilter('all',this)">All (${allPosts.length})</button>
      <button class="bm-filter-btn text-xs px-3 py-1.5 rounded-full font-semibold transition-colors bg-white/5 text-gray-400" onclick="bmSetFilter('published',this)">Published (${published.length})</button>
      <button class="bm-filter-btn text-xs px-3 py-1.5 rounded-full font-semibold transition-colors bg-white/5 text-gray-400" onclick="bmSetFilter('drafts',this)">Drafts (${drafts.length})</button>
    </div>

    <div class="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase w-8"><i class="fas fa-star text-amber-400"></i></th>
              <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Title / Slug</th>
              <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Category</th>
              <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
              <th class="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Read Time</th>
              <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Published</th>
              <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="7" class="px-4 py-8 text-center text-gray-400 text-sm">No posts found</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Create / Edit Modal -->
    <div id="bm-modal" class="hidden fixed inset-0 z-50 flex items-start justify-center pt-8 px-4" style="background:rgba(0,0,0,0.7);overflow-y:auto">
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-3xl mb-8">
        <div class="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 id="bm-modal-title" class="text-lg font-black text-gray-900">New Post</h3>
          <button onclick="bmCloseModal()" class="text-gray-400 hover:text-gray-600 text-xl"><i class="fas fa-times"></i></button>
        </div>
        <form id="bm-form" class="px-6 py-5 space-y-4" onsubmit="event.preventDefault();bmSave()">
          <div class="grid grid-cols-2 gap-4">
            <div class="col-span-2">
              <label class="block text-xs font-semibold text-gray-600 mb-1">Title *</label>
              <input id="bm-title" type="text" oninput="bmAutoSlug()" placeholder="Post title..." class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none" required>
            </div>
            <div class="col-span-2">
              <label class="block text-xs font-semibold text-gray-600 mb-1">Slug (URL)</label>
              <input id="bm-slug" type="text" placeholder="auto-generated-from-title" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none">
            </div>
            <div>
              <label class="block text-xs font-semibold text-gray-600 mb-1">Category</label>
              <select id="bm-category" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none">${catOptions}</select>
            </div>
            <div>
              <label class="block text-xs font-semibold text-gray-600 mb-1">Status</label>
              <select id="bm-status" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none">
                <option value="draft">Draft</option>
                <option value="published">Published</option>
              </select>
            </div>
            <div>
              <label class="block text-xs font-semibold text-gray-600 mb-1">Cover Image URL</label>
              <input id="bm-cover" type="url" placeholder="https://..." class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none">
            </div>
            <div>
              <label class="block text-xs font-semibold text-gray-600 mb-1">Author Name</label>
              <input id="bm-author" type="text" placeholder="Roof Manager Team" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none">
            </div>
            <div>
              <label class="block text-xs font-semibold text-gray-600 mb-1">Read Time (mins)</label>
              <input id="bm-read-time" type="number" min="1" max="60" value="5" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none">
            </div>
            <div class="flex items-center gap-2 pt-4">
              <input id="bm-featured" type="checkbox" class="w-4 h-4 accent-teal-500">
              <label for="bm-featured" class="text-sm text-gray-700 font-medium">Featured post</label>
            </div>
            <div class="col-span-2">
              <label class="block text-xs font-semibold text-gray-600 mb-1">Excerpt (150 chars)</label>
              <textarea id="bm-excerpt" rows="2" maxlength="300" placeholder="Short summary shown on blog listing..." class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none resize-none"></textarea>
            </div>
            <div class="col-span-2">
              <label class="block text-xs font-semibold text-gray-600 mb-1">Meta Description (SEO)</label>
              <textarea id="bm-meta-desc" rows="2" maxlength="160" placeholder="SEO description (160 chars max)..." class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none resize-none"></textarea>
            </div>
            <div class="col-span-2">
              <label class="block text-xs font-semibold text-gray-600 mb-1">Tags (comma-separated)</label>
              <input id="bm-tags" type="text" placeholder="roofing, measurement, CRM, Alberta" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none">
            </div>
            <div class="col-span-2">
              <label class="block text-xs font-semibold text-gray-600 mb-1">Content (HTML)</label>
              <textarea id="bm-content" rows="16" placeholder="<h2>Section</h2><p>Content here...</p>" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none resize-y" style="min-height:300px"></textarea>
            </div>
          </div>
          <div class="flex items-center gap-3 pt-2 border-t border-gray-100">
            <button type="submit" class="flex-1 bg-[#00FF88] hover:bg-[#00e67a] text-black font-bold py-2.5 rounded-xl text-sm transition-colors">Save Post</button>
            <button type="button" onclick="bmCloseModal()" class="px-6 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-xl text-sm transition-colors">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderGA4View() {
  const status = SA.data.ga4_status || {};
  const report = SA.data.ga4_report || {};
  const realtime = SA.data.ga4_realtime || {};
  const tab = SA.ga4Tab || 'overview';

  const periodLabels = { '24h': 'Last 24h', '7d': '7 Days', '30d': '30 Days', '90d': '90 Days', '365d': '1 Year' };

  // Check if GA4 is configured at all
  const ga4Configured = status.ga4_measurement_id || status.ga4_property_id;

  // Helper: extract GA4 row data into readable format
  function ga4Rows(dataset) {
    if (!dataset || !dataset.rows) return [];
    return dataset.rows;
  }
  function ga4Headers(dataset) {
    if (!dataset || !dataset.headers) return [];
    return dataset.headers;
  }
  function ga4Totals(dataset) {
    if (!dataset || !dataset.totals) return {};
    return dataset.totals;
  }

  // ── Tab navigation ──
  const tabItems = [
    { id: 'overview', label: 'Overview', icon: 'fa-tachometer-alt' },
    { id: 'pages', label: 'Pages', icon: 'fa-file-alt' },
    { id: 'sources', label: 'Traffic Sources', icon: 'fa-route' },
    { id: 'geo', label: 'Geography', icon: 'fa-globe-americas' },
    { id: 'realtime', label: 'Realtime', icon: 'fa-bolt' },
    { id: 'config', label: 'Configuration', icon: 'fa-cog' }
  ];

  const tabNav = '<div class="flex gap-1 overflow-x-auto pb-2 mb-4">' +
    tabItems.map(t => '<button onclick="saSetGA4Tab(\'' + t.id + '\')" class="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ' +
      (tab === t.id ? 'bg-teal-600 text-white shadow-md' : 'bg-white text-gray-500 hover:bg-gray-100 border border-gray-200') +
      '"><i class="fas ' + t.icon + '"></i> ' + t.label + '</button>'
    ).join('') + '</div>';

  // ── Header ──
  const header = '<div class="mb-4 flex items-center justify-between">' +
    '<div>' +
      '<h2 class="text-2xl font-black text-gray-900"><i class="fab fa-google mr-2 text-teal-500"></i>Google Analytics 4</h2>' +
      '<p class="text-sm text-gray-500 mt-1">GA4 Data API, Real-Time Reporting & Measurement Protocol</p>' +
    '</div>' +
    '<div class="flex items-center gap-3">' +
      '<select onchange="saChangeGA4Period(this.value)" class="text-xs border border-gray-200 rounded-lg px-3 py-1.5 bg-white focus:ring-2 focus:ring-teal-500">' +
        ['24h','7d','30d','90d','365d'].map(p => '<option value="' + p + '"' + (SA.ga4Period === p ? ' selected' : '') + '>' + periodLabels[p] + '</option>').join('') +
      '</select>' +
      '<button onclick="saRefreshGA4()" class="px-3 py-2 bg-white border border-gray-200 rounded-xl text-xs font-medium hover:bg-gray-50"><i class="fas fa-sync-alt mr-1"></i>Refresh</button>' +
    '</div>' +
  '</div>';

  // ── Not configured banner ──
  if (!ga4Configured && tab !== 'config') {
    return header + tabNav +
      '<div class="bg-amber-50 border border-amber-200 rounded-2xl p-8 text-center">' +
        '<div class="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4"><i class="fab fa-google text-amber-600 text-2xl"></i></div>' +
        '<h3 class="text-lg font-bold text-amber-800 mb-2">Google Analytics 4 Not Configured</h3>' +
        '<p class="text-sm text-amber-700 mb-4">Set up GA4 environment variables to enable traffic monitoring via Google Analytics.</p>' +
        '<button onclick="saSetGA4Tab(\'config\')" class="px-4 py-2 bg-amber-600 text-white rounded-xl text-sm font-semibold hover:bg-amber-700"><i class="fas fa-cog mr-1"></i>Configure GA4</button>' +
      '</div>';
  }

  // ── OVERVIEW TAB ──
  if (tab === 'overview') {
    const summary = report.summary || {};
    const totals = ga4Totals(summary);
    const acq = report.acquisition || {};

    const kpiCards = '<div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">' +
      samc('Pageviews', (totals.screenPageViews || 0).toLocaleString(), 'fa-eye', 'blue', 'GA4 Data API') +
      samc('Total Users', (totals.totalUsers || 0).toLocaleString(), 'fa-users', 'green', (totals.newUsers || 0).toLocaleString() + ' new users') +
      samc('Sessions', (totals.sessions || 0).toLocaleString(), 'fa-clock', 'indigo', 'Avg duration: ' + fmtSeconds(totals.averageSessionDuration || 0)) +
      samc('Bounce Rate', ((totals.bounceRate || 0) * 100).toFixed(1) + '%', 'fa-sign-out-alt', 'amber', (totals.engagedSessions || 0).toLocaleString() + ' engaged') +
    '</div>';

    // Acquisition source/medium table
    const acqRows = ga4Rows(acq);
    const acqTable = acqRows.length === 0 ? '<p class="text-gray-400 text-sm py-4">No acquisition data available.</p>'
      : '<div class="overflow-x-auto"><table class="w-full text-sm"><thead class="bg-gray-50"><tr>' +
          '<th class="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">Source</th>' +
          '<th class="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">Medium</th>' +
          '<th class="px-3 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">Sessions</th>' +
          '<th class="px-3 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">Users</th>' +
          '<th class="px-3 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">Engaged</th>' +
          '<th class="px-3 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">Conversions</th>' +
        '</tr></thead><tbody class="divide-y divide-gray-50">' +
        acqRows.slice(0, 15).map(r => '<tr class="hover:bg-teal-50/30">' +
          '<td class="px-3 py-2 text-xs font-medium text-gray-700">' + (r[0] || '(direct)') + '</td>' +
          '<td class="px-3 py-2 text-xs text-gray-500">' + (r[1] || '(none)') + '</td>' +
          '<td class="px-3 py-2 text-xs text-right font-mono">' + (r[2] || 0) + '</td>' +
          '<td class="px-3 py-2 text-xs text-right font-mono">' + (r[3] || 0) + '</td>' +
          '<td class="px-3 py-2 text-xs text-right font-mono">' + (r[4] || 0) + '</td>' +
          '<td class="px-3 py-2 text-xs text-right font-mono">' + (r[5] || 0) + '</td>' +
        '</tr>').join('') +
        '</tbody></table></div>';

    // Device breakdown from GA4
    const devData = report.devices || {};
    const devRows = ga4Rows(devData);
    const totalDevUsers = devRows.reduce((s, r) => s + (r[1] || 0), 0) || 1;
    const deviceBars = devRows.length === 0 ? '<p class="text-gray-400 text-sm">No device data</p>'
      : '<div class="space-y-3">' + devRows.map(r => {
          const cat = r[0] || 'unknown';
          const users = r[1] || 0;
          const pct = Math.round((users / totalDevUsers) * 100);
          const icons = { desktop: 'fa-desktop', mobile: 'fa-mobile-alt', tablet: 'fa-tablet-alt' };
          return '<div class="flex items-center gap-3">' +
            '<div class="w-8 text-center"><i class="fas ' + (icons[cat] || 'fa-question') + ' text-gray-700"></i></div>' +
            '<div class="flex-1">' +
              '<div class="flex justify-between mb-0.5"><span class="text-sm font-medium text-gray-700 capitalize">' + cat + '</span><span class="text-xs text-gray-500">' + users + ' users (' + pct + '%)</span></div>' +
              '<div class="w-full bg-gray-100 rounded-full h-2"><div class="bg-gradient-to-r from-teal-500 to-teal-400 h-2 rounded-full" style="width:' + pct + '%"></div></div>' +
            '</div></div>';
        }).join('') + '</div>';

    return header + tabNav + kpiCards +
      '<div class="grid lg:grid-cols-2 gap-6 mb-6">' +
        saSection('User Acquisition (Source/Medium)', 'fa-route', acqTable) +
        saSection('Devices (GA4)', 'fa-laptop', deviceBars) +
      '</div>';
  }

  // ── PAGES TAB ──
  if (tab === 'pages') {
    const topPages = report.top_pages || {};
    const pgRows = ga4Rows(topPages);
    const maxPV = pgRows.length > 0 ? Math.max(...pgRows.map(r => r[1] || 0), 1) : 1;

    const pagesContent = pgRows.length === 0 ? '<p class="text-gray-400 text-sm py-4">No page data from GA4 for this period.</p>'
      : '<div class="space-y-1.5 max-h-[500px] overflow-y-auto">' + pgRows.map(r => {
          const path = r[0] || '/';
          const views = r[1] || 0;
          const users = r[2] || 0;
          const avgDur = r[3] || 0;
          const bounce = r[4] || 0;
          const pct = Math.round((views / maxPV) * 100);
          return '<div class="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-gray-50">' +
            '<div class="flex-1 min-w-0">' +
              '<div class="flex items-center gap-2">' +
                '<span class="text-xs font-mono text-gray-700 truncate max-w-[300px]" title="' + path + '">' + path + '</span>' +
              '</div>' +
              '<div class="w-full bg-gray-100 rounded-full h-1.5 mt-1"><div class="bg-teal-500 h-1.5 rounded-full" style="width:' + pct + '%"></div></div>' +
            '</div>' +
            '<div class="text-right flex-shrink-0 flex gap-4">' +
              '<div><span class="text-sm font-bold text-gray-800">' + views + '</span><span class="text-[10px] text-gray-400 block">views</span></div>' +
              '<div><span class="text-sm font-bold text-gray-600">' + users + '</span><span class="text-[10px] text-gray-400 block">users</span></div>' +
              '<div><span class="text-sm font-bold text-gray-600">' + fmtSeconds(avgDur) + '</span><span class="text-[10px] text-gray-400 block">avg time</span></div>' +
              '<div><span class="text-sm font-bold ' + (bounce > 0.7 ? 'text-red-600' : bounce > 0.5 ? 'text-amber-600' : 'text-green-600') + '">' + (bounce * 100).toFixed(0) + '%</span><span class="text-[10px] text-gray-400 block">bounce</span></div>' +
            '</div>' +
          '</div>';
        }).join('') + '</div>';

    return header + tabNav + saSection('Top Pages (GA4 Data API)', 'fa-file-alt', pagesContent);
  }

  // ── TRAFFIC SOURCES TAB ──
  if (tab === 'sources') {
    const srcData = report.traffic_sources || {};
    const srcRows = ga4Rows(srcData);

    const channelContent = srcRows.length === 0 ? '<p class="text-gray-400 text-sm py-4">No traffic source data.</p>'
      : '<div class="overflow-x-auto"><table class="w-full text-sm"><thead class="bg-gray-50"><tr>' +
          '<th class="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">Channel Group</th>' +
          '<th class="px-3 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">Sessions</th>' +
          '<th class="px-3 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">Users</th>' +
          '<th class="px-3 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">Conversions</th>' +
        '</tr></thead><tbody class="divide-y divide-gray-50">' +
        srcRows.map(r => {
          const channelIcons = {
            'Organic Search': 'fa-search text-green-500', 'Direct': 'fa-link text-blue-500',
            'Referral': 'fa-external-link-alt text-purple-500', 'Organic Social': 'fa-share-alt text-pink-500',
            'Paid Search': 'fa-ad text-amber-500', 'Email': 'fa-envelope text-red-500',
            'Paid Social': 'fa-bullhorn text-indigo-500', 'Display': 'fa-image text-teal-500'
          };
          const icon = channelIcons[r[0]] || 'fa-globe text-gray-400';
          return '<tr class="hover:bg-teal-50/30">' +
            '<td class="px-3 py-2 text-xs font-medium text-gray-700"><i class="fas ' + icon + ' mr-2"></i>' + (r[0] || 'Unknown') + '</td>' +
            '<td class="px-3 py-2 text-xs text-right font-mono font-bold">' + (r[1] || 0) + '</td>' +
            '<td class="px-3 py-2 text-xs text-right font-mono">' + (r[2] || 0) + '</td>' +
            '<td class="px-3 py-2 text-xs text-right font-mono">' + (r[3] || 0) + '</td>' +
          '</tr>';
        }).join('') +
        '</tbody></table></div>';

    // Acquisition detail
    const acqRows2 = ga4Rows(report.acquisition || {});
    const acqContent = acqRows2.length === 0 ? ''
      : saSection('Acquisition Detail (Source / Medium)', 'fa-route',
          '<div class="overflow-x-auto"><table class="w-full text-sm"><thead class="bg-gray-50"><tr>' +
          '<th class="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">Source</th>' +
          '<th class="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">Medium</th>' +
          '<th class="px-3 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">Sessions</th>' +
          '<th class="px-3 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">Users</th>' +
          '<th class="px-3 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">Engaged</th>' +
          '<th class="px-3 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">Conversions</th>' +
          '</tr></thead><tbody class="divide-y divide-gray-50">' +
          acqRows2.map(r => '<tr class="hover:bg-teal-50/30">' +
            '<td class="px-3 py-2 text-xs font-medium text-gray-700">' + (r[0] || '(direct)') + '</td>' +
            '<td class="px-3 py-2 text-xs text-gray-500">' + (r[1] || '(none)') + '</td>' +
            '<td class="px-3 py-2 text-xs text-right font-mono">' + (r[2] || 0) + '</td>' +
            '<td class="px-3 py-2 text-xs text-right font-mono">' + (r[3] || 0) + '</td>' +
            '<td class="px-3 py-2 text-xs text-right font-mono">' + (r[4] || 0) + '</td>' +
            '<td class="px-3 py-2 text-xs text-right font-mono">' + (r[5] || 0) + '</td>' +
          '</tr>').join('') +
          '</tbody></table></div>');

    return header + tabNav + saSection('Traffic Channels (GA4)', 'fa-route', channelContent) + acqContent;
  }

  // ── GEOGRAPHY TAB ──
  if (tab === 'geo') {
    const geoData = report.geography || {};
    const geoRows = ga4Rows(geoData);
    const maxGeoUsers = geoRows.length > 0 ? Math.max(...geoRows.map(r => r[2] || 0), 1) : 1;

    function countryFlag(code) {
      if (!code || code.length < 2) return '';
      // GA4 returns full country names, not ISO codes, so we skip emoji
      return '';
    }

    const geoContent = geoRows.length === 0 ? '<p class="text-gray-400 text-sm py-4">No geography data from GA4.</p>'
      : '<div class="space-y-1.5 max-h-[500px] overflow-y-auto">' + geoRows.map(r => {
          const country = r[0] || 'Unknown';
          const city = r[1] || '';
          const users = r[2] || 0;
          const sessions = r[3] || 0;
          const views = r[4] || 0;
          const pct = Math.round((users / maxGeoUsers) * 100);
          return '<div class="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-gray-50">' +
            '<div class="flex-1 min-w-0">' +
              '<div class="flex items-center gap-2">' +
                '<i class="fas fa-map-marker-alt text-red-400 text-xs"></i>' +
                '<span class="text-sm font-medium text-gray-700">' + country + (city ? ' <span class="text-gray-400">/ ' + city + '</span>' : '') + '</span>' +
              '</div>' +
              '<div class="w-full bg-gray-100 rounded-full h-1.5 mt-1"><div class="bg-gradient-to-r from-teal-500 to-teal-400 h-1.5 rounded-full" style="width:' + pct + '%"></div></div>' +
            '</div>' +
            '<div class="text-right flex-shrink-0 flex gap-4">' +
              '<div><span class="text-sm font-bold text-gray-800">' + users + '</span><span class="text-[10px] text-gray-400 block">users</span></div>' +
              '<div><span class="text-sm font-bold text-gray-600">' + sessions + '</span><span class="text-[10px] text-gray-400 block">sessions</span></div>' +
              '<div><span class="text-sm font-bold text-gray-600">' + views + '</span><span class="text-[10px] text-gray-400 block">views</span></div>' +
            '</div>' +
          '</div>';
        }).join('') + '</div>';

    return header + tabNav + saSection('Geography (GA4 Data API)', 'fa-globe-americas', geoContent);
  }

  // ── REALTIME TAB ──
  if (tab === 'realtime') {
    const rtPages = realtime.pages || {};
    const rtGeo = realtime.geography || {};
    const rtSources = realtime.sources || {};
    const rtDevices = realtime.devices || {};

    const rtPgRows = ga4Rows(rtPages);
    const rtGeoRows = ga4Rows(rtGeo);
    const rtSrcRows = ga4Rows(rtSources);
    const rtDevRows = ga4Rows(rtDevices);

    const totalActiveUsers = rtPgRows.reduce((s, r) => s + (r[1] || 0), 0);

    const activeUsersBanner = '<div class="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-2xl p-6 mb-6 flex items-center gap-6">' +
      '<div class="w-20 h-20 bg-green-100 rounded-2xl flex items-center justify-center"><i class="fas fa-users text-green-600 text-3xl"></i></div>' +
      '<div>' +
        '<p class="text-xs font-semibold text-green-600 uppercase tracking-wider">Active Users Right Now</p>' +
        '<p class="text-5xl font-black text-green-800">' + totalActiveUsers + '</p>' +
        '<p class="text-sm text-green-600 mt-1">Live via GA4 Realtime API</p>' +
      '</div>' +
      '<div class="ml-auto">' +
        '<button onclick="saRefreshGA4()" class="px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 shadow-sm"><i class="fas fa-sync-alt mr-1 fa-spin"></i>Refresh</button>' +
      '</div>' +
    '</div>';

    const rtPagesContent = rtPgRows.length === 0 ? '<p class="text-gray-400 text-sm">No active pages</p>'
      : '<div class="space-y-1">' + rtPgRows.slice(0, 20).map(r => '<div class="flex items-center justify-between py-1.5 px-2 rounded hover:bg-gray-50">' +
          '<span class="text-xs font-mono text-gray-700 truncate max-w-[300px]">' + (r[0] || '/') + '</span>' +
          '<span class="text-sm font-bold text-green-700">' + (r[1] || 0) + ' <span class="text-[10px] text-gray-400">active</span></span>' +
        '</div>').join('') + '</div>';

    const rtGeoContent = rtGeoRows.length === 0 ? '<p class="text-gray-400 text-sm">No geo data</p>'
      : '<div class="space-y-1">' + rtGeoRows.slice(0, 15).map(r => '<div class="flex items-center justify-between py-1.5 px-2 rounded hover:bg-gray-50">' +
          '<span class="text-sm text-gray-700"><i class="fas fa-map-marker-alt text-red-400 mr-1"></i>' + (r[0] || 'Unknown') + '</span>' +
          '<span class="text-sm font-bold text-green-700">' + (r[1] || 0) + '</span>' +
        '</div>').join('') + '</div>';

    const rtSrcContent = rtSrcRows.length === 0 ? '<p class="text-gray-400 text-sm">No source data</p>'
      : '<div class="space-y-1">' + rtSrcRows.map(r => '<div class="flex items-center justify-between py-1.5 px-2 rounded hover:bg-gray-50">' +
          '<span class="text-sm text-gray-700">' + (r[0] || 'Unknown') + '</span>' +
          '<span class="text-sm font-bold text-green-700">' + (r[1] || 0) + '</span>' +
        '</div>').join('') + '</div>';

    const rtDevContent = rtDevRows.length === 0 ? '<p class="text-gray-400 text-sm">No device data</p>'
      : '<div class="space-y-1">' + rtDevRows.map(r => {
          const icons = { desktop: 'fa-desktop', mobile: 'fa-mobile-alt', tablet: 'fa-tablet-alt' };
          return '<div class="flex items-center justify-between py-1.5 px-2 rounded hover:bg-gray-50">' +
            '<span class="text-sm text-gray-700"><i class="fas ' + (icons[r[0]] || 'fa-question') + ' mr-2 text-gray-500"></i>' + (r[0] || 'Unknown') + '</span>' +
            '<span class="text-sm font-bold text-green-700">' + (r[1] || 0) + '</span>' +
          '</div>';
        }).join('') + '</div>';

    return header + tabNav + activeUsersBanner +
      '<div class="grid lg:grid-cols-2 gap-6">' +
        saSection('Active Pages', 'fa-file-alt', rtPagesContent) +
        saSection('Active Countries', 'fa-globe', rtGeoContent) +
        saSection('Active Sources', 'fa-route', rtSrcContent) +
        saSection('Active Devices', 'fa-laptop', rtDevContent) +
      '</div>';
  }

  // ── CONFIGURATION TAB ──
  if (tab === 'config') {
    const envItems = [
      { key: 'GA4_MEASUREMENT_ID', value: status.ga4_measurement_id || '(not set)', ok: !!status.ga4_measurement_id, desc: 'GA4 Measurement ID (e.g. G-XXXXXXXXXX). Required for frontend tracking via gtag.js and server-side Measurement Protocol events.' },
      { key: 'GA4_API_SECRET', value: status.ga4_api_secret ? 'Set' : '(not set)', ok: status.ga4_api_secret, desc: 'Measurement Protocol API Secret from GA4 Admin > Data Streams > Measurement Protocol. Required for server-side event tracking.' },
      { key: 'GA4_PROPERTY_ID', value: status.ga4_property_id || '(not set)', ok: !!status.ga4_property_id, desc: 'GA4 Property ID (numeric or "properties/123456789"). Required for Data API report queries and Realtime API.' },
      { key: 'GCP_SERVICE_ACCOUNT_KEY', value: status.gcp_service_account ? 'Set' : '(not set)', ok: status.gcp_service_account, desc: 'GCP Service Account JSON key with Analytics Viewer role. Used for OAuth2 authentication to the GA4 Data API.' }
    ];

    const capabilities = [
      { label: 'Frontend GA4 Tracking (gtag.js)', ok: status.frontend_tracking, desc: 'Auto-injects GA4 gtag.js into all HTML pages' },
      { label: 'Server-Side Event Tracking (Measurement Protocol)', ok: status.server_side_events, desc: 'Send backend events (report_generated, payment_completed) to GA4' },
      { label: 'GA4 Data API (Reports)', ok: status.data_api, desc: 'Query pageviews, users, sessions, acquisition, geography data' },
      { label: 'GA4 Realtime API', ok: status.realtime_api, desc: 'See active users, pages, and sources in real-time' }
    ];

    const envContent = '<div class="space-y-3">' + envItems.map(e =>
      '<div class="flex items-start gap-3 p-3 rounded-xl ' + (e.ok ? 'bg-green-50 border border-green-200' : 'bg-gray-50 border border-gray-200') + '">' +
        '<div class="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ' + (e.ok ? 'bg-green-100' : 'bg-gray-200') + '"><i class="fas ' + (e.ok ? 'fa-check text-green-600' : 'fa-times text-gray-400') + '"></i></div>' +
        '<div class="flex-1">' +
          '<div class="flex items-center gap-2"><code class="text-xs font-mono font-bold text-gray-800">' + e.key + '</code>' +
            '<span class="text-xs px-2 py-0.5 rounded-full font-medium ' + (e.ok ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500') + '">' + e.value + '</span>' +
          '</div>' +
          '<p class="text-[11px] text-gray-500 mt-1">' + e.desc + '</p>' +
        '</div>' +
      '</div>'
    ).join('') + '</div>';

    const capContent = '<div class="space-y-2 mt-4">' + capabilities.map(c =>
      '<div class="flex items-center gap-3 p-2 rounded-lg">' +
        '<div class="w-6 h-6 rounded-full flex items-center justify-center ' + (c.ok ? 'bg-green-100' : 'bg-red-100') + '"><i class="fas ' + (c.ok ? 'fa-check text-green-600 text-xs' : 'fa-times text-red-500 text-xs') + '"></i></div>' +
        '<div class="flex-1"><span class="text-sm font-medium ' + (c.ok ? 'text-green-800' : 'text-gray-500') + '">' + c.label + '</span>' +
          '<p class="text-[10px] text-gray-400">' + c.desc + '</p>' +
        '</div>' +
      '</div>'
    ).join('') + '</div>';

    const setupGuide = '<div class="bg-blue-50 border border-blue-200 rounded-xl p-4 mt-4">' +
      '<h4 class="font-bold text-blue-800 text-sm mb-2"><i class="fas fa-info-circle mr-1"></i>Setup Guide</h4>' +
      '<ol class="text-xs text-blue-700 space-y-2 list-decimal list-inside">' +
        '<li>Go to <a href="https://analytics.google.com" target="_blank" class="underline">Google Analytics</a> &rarr; create a GA4 property for your website</li>' +
        '<li>Copy the <strong>Measurement ID</strong> (G-XXXXXXXXXX) from Admin &rarr; Data Streams</li>' +
        '<li>Create a <strong>Measurement Protocol API Secret</strong> under the same Data Stream</li>' +
        '<li>Note the <strong>Property ID</strong> (numeric) from Admin &rarr; Property Settings</li>' +
        '<li>Ensure your GCP service account has <strong>Analytics Viewer</strong> role on the GA4 property</li>' +
        '<li>Set all env vars in Cloudflare Pages: <code>GA4_MEASUREMENT_ID</code>, <code>GA4_API_SECRET</code>, <code>GA4_PROPERTY_ID</code></li>' +
      '</ol>' +
    '</div>';

    const testSection = status.server_side_events
      ? '<div class="mt-4"><button onclick="saTestGA4Event()" class="px-4 py-2 bg-teal-600 text-white rounded-xl text-sm font-semibold hover:bg-red-700"><i class="fas fa-paper-plane mr-1"></i>Send Test Event to GA4</button><span class="text-xs text-gray-400 ml-2">Sends an admin_test_ping event via Measurement Protocol</span></div>'
      : '';

    return header + tabNav +
      saSection('Environment Variables', 'fa-key', envContent) +
      saSection('GA4 Capabilities', 'fa-check-double', capContent + testSection) +
      '<div class="mb-6">' + setupGuide + '</div>';
  }

  return header + tabNav + '<p class="text-gray-400">Unknown tab</p>';
}

// Fix saTestGA4Event to use POST properly
window.saTestGA4Event = async function() {
  try {
    const res = await fetch('/api/analytics/ga4/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...saHeaders() },
      body: JSON.stringify({
        client_id: 'superadmin_test_' + Date.now(),
        events: [{ name: 'admin_test_ping', params: { source: 'super_admin_dashboard', timestamp: new Date().toISOString() } }]
      })
    });
    const d = await res.json();
    window.rmToast(d.success ? 'Test event sent successfully to GA4!' : 'Event send failed: ' + JSON.stringify(d, 'info'));
  } catch(e) {
    window.rmToast('Error: ' + e.message, 'error');
  }
};

// ============================================================
// VIEW: PRICING & BILLING — Full control over all pricing
// ============================================================

function renderPricingView() {
  const d = SA.data.pricing || {};
  const p = d.pricing || {};
  const packages = d.packages || [];
  const sq = SA.data.square || {};

  const activePackages = packages.filter(x => x.is_active);
  const inactivePackages = packages.filter(x => !x.is_active);

  return `
    <div class="mb-6">
      <h2 class="text-2xl font-black text-gray-900"><i class="fas fa-dollar-sign mr-2 text-teal-500"></i>Pricing & Billing</h2>
      <p class="text-sm text-gray-500 mt-1">Manage report pricing, credit packages, subscriptions, and Square payment terminal</p>
    </div>

    <!-- Square Status Banner -->
    <div class="mb-6 rounded-2xl p-5 ${sq.connected ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-teal-200'}">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-12 h-12 rounded-xl flex items-center justify-center ${sq.connected ? 'bg-green-100' : 'bg-red-100'}">
            <i class="fas ${sq.connected ? 'fa-check-circle text-green-600' : 'fa-exclamation-triangle text-red-600'} text-xl"></i>
          </div>
          <div>
            <h3 class="font-bold ${sq.connected ? 'text-green-800' : 'text-red-800'}">${sq.connected ? 'Square Payment Terminal Connected' : 'Square Not Connected'}</h3>
            <p class="text-sm ${sq.connected ? 'text-green-600' : 'text-red-600'}">
              ${sq.connected
                ? (sq.merchant?.business_name || 'Connected') + (sq.location?.name ? ' — Location: ' + sq.location.name : '') + (sq.location?.currency ? ' (' + sq.location.currency + ')' : '')
                : (sq.error || 'Configure SQUARE_ACCESS_TOKEN and SQUARE_LOCATION_ID in Cloudflare Pages secrets')}
            </p>
          </div>
        </div>
        <div class="flex items-center gap-3">
          ${sq.stats ? `
            <div class="text-right">
              <p class="text-xs text-gray-500">${sq.stats.total_payments || 0} payments</p>
              <p class="text-xs text-gray-500">${sq.stats.total_webhooks || 0} webhooks</p>
            </div>
          ` : ''}
          <button onclick="loadView('pricing')" class="px-3 py-2 bg-white border border-gray-200 rounded-xl text-xs font-medium hover:bg-gray-50 transition-colors">
            <i class="fas fa-sync-alt mr-1"></i> Refresh
          </button>
        </div>
      </div>
    </div>

    <!-- Core Pricing Section -->
    ${saSection('Core Pricing', 'fa-tag', `
      <form id="pricingForm" onsubmit="savePricingSettings(event)">
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

          <!-- Price Per Report -->
          <div class="space-y-2">
            <label class="block text-sm font-semibold text-gray-700"><i class="fas fa-file-alt mr-1 text-blue-500"></i> Price Per Report (CAD)</label>
            <div class="relative">
              <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">$</span>
              <input type="number" step="0.01" min="0" id="pricePerReport"
                value="${(p.price_per_report_cents / 100).toFixed(2)}"
                class="w-full pl-8 pr-4 py-3 border border-gray-200 rounded-xl text-sm font-mono focus:ring-2 focus:ring-teal-500 focus:border-teal-500">
            </div>
            <p class="text-[10px] text-gray-400">Default charge for a single roof measurement report</p>
          </div>

          <!-- Free Trial Reports -->
          <div class="space-y-2">
            <label class="block text-sm font-semibold text-gray-700"><i class="fas fa-gift mr-1 text-purple-500"></i> Free Trial Reports</label>
            <input type="number" min="0" max="50" id="freeTrialReports"
              value="${p.free_trial_reports || 3}"
              class="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm font-mono focus:ring-2 focus:ring-teal-500 focus:border-teal-500">
            <p class="text-[10px] text-gray-400">Number of free reports for new users</p>
          </div>

          <!-- Monthly Subscription -->
          <div class="space-y-2">
            <label class="block text-sm font-semibold text-gray-700"><i class="fas fa-calendar-alt mr-1 text-green-500"></i> Monthly Subscription (CAD)</label>
            <div class="relative">
              <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">$</span>
              <input type="number" step="0.01" min="0" id="subscriptionMonthly"
                value="${(p.subscription_monthly_price_cents / 100).toFixed(2)}"
                class="w-full pl-8 pr-4 py-3 border border-gray-200 rounded-xl text-sm font-mono focus:ring-2 focus:ring-teal-500 focus:border-teal-500">
            </div>
            <p class="text-[10px] text-gray-400">Monthly fee for full CRM + unlimited reports (after free trial)</p>
          </div>

          <!-- Annual Subscription -->
          <div class="space-y-2">
            <label class="block text-sm font-semibold text-gray-700"><i class="fas fa-calendar-check mr-1 text-indigo-500"></i> Annual Subscription (CAD)</label>
            <div class="relative">
              <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">$</span>
              <input type="number" step="0.01" min="0" id="subscriptionAnnual"
                value="${(p.subscription_annual_price_cents / 100).toFixed(2)}"
                class="w-full pl-8 pr-4 py-3 border border-gray-200 rounded-xl text-sm font-mono focus:ring-2 focus:ring-teal-500 focus:border-teal-500">
            </div>
            <p class="text-[10px] text-gray-400">Annual fee (discounted) for full CRM + unlimited reports</p>
          </div>

          <!-- Roofer Secretary Monthly -->
          <div class="space-y-2">
            <label class="block text-sm font-semibold text-gray-700"><i class="fas fa-headset mr-1 text-amber-500"></i> Roofer Secretary — Monthly (CAD)</label>
            <div class="relative">
              <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">$</span>
              <input type="number" step="0.01" min="0" id="secretaryMonthly"
                value="${(p.secretary_monthly_price_cents / 100).toFixed(2)}"
                class="w-full pl-8 pr-4 py-3 border border-gray-200 rounded-xl text-sm font-mono focus:ring-2 focus:ring-teal-500 focus:border-teal-500">
            </div>
            <p class="text-[10px] text-gray-400">Monthly subscription for AI receptionist / call answering</p>
          </div>

          <!-- Roofer Secretary Per-Call -->
          <div class="space-y-2">
            <label class="block text-sm font-semibold text-gray-700"><i class="fas fa-phone-alt mr-1 text-teal-500"></i> Roofer Secretary — Per Call (CAD)</label>
            <div class="relative">
              <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">$</span>
              <input type="number" step="0.01" min="0" id="secretaryPerCall"
                value="${(p.secretary_per_call_price_cents / 100).toFixed(2)}"
                class="w-full pl-8 pr-4 py-3 border border-gray-200 rounded-xl text-sm font-mono focus:ring-2 focus:ring-teal-500 focus:border-teal-500">
            </div>
            <p class="text-[10px] text-gray-400">Per-call fee if using pay-as-you-go model</p>
          </div>
        </div>

        <!-- Subscription Features -->
        <div class="mt-6 space-y-2">
          <label class="block text-sm font-semibold text-gray-700"><i class="fas fa-list-check mr-1 text-sky-500"></i> Subscription Features (comma-separated)</label>
          <textarea id="subscriptionFeatures" rows="3"
            class="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
            placeholder="Unlimited reports, Full CRM access, AI Secretary, Custom branding, Priority support">${p.subscription_features || ''}</textarea>
          <p class="text-[10px] text-gray-400">Features shown on public pricing page for the subscription plan</p>
        </div>

        <div class="mt-6 flex items-center justify-between">
          <p class="text-xs text-gray-400"><i class="fas fa-info-circle mr-1"></i> Changes take effect immediately for new transactions</p>
          <button type="submit" id="savePricingBtn" class="px-6 py-3 bg-teal-600 hover:bg-teal-700 text-white rounded-xl font-semibold text-sm transition-colors">
            <i class="fas fa-save mr-1"></i> Save Pricing
          </button>
        </div>
      </form>
    `)}

    <!-- Credit Packages Section -->
    ${saSection('Credit Report Packages', 'fa-box-open', `
      <p class="text-sm text-gray-500 mb-4">Bulk credit packs customers purchase through Square checkout. Each credit = 1 roof report.</p>

      <!-- Active Packages -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6" id="packageGrid">
        ${activePackages.map(pkg => renderPackageCard(pkg, true)).join('')}

        <!-- Add New Package Card -->
        <div onclick="showAddPackageModal()" class="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center cursor-pointer hover:border-teal-400 hover:bg-teal-50/30 transition-all group">
          <div class="w-12 h-12 bg-gray-100 group-hover:bg-teal-100 rounded-xl flex items-center justify-center mx-auto mb-3 transition-colors">
            <i class="fas fa-plus text-gray-400 group-hover:text-teal-500 text-lg transition-colors"></i>
          </div>
          <p class="text-sm font-semibold text-gray-500 group-hover:text-teal-600 transition-colors">Add Package</p>
          <p class="text-[10px] text-gray-400">Create a new credit pack</p>
        </div>
      </div>

      ${inactivePackages.length > 0 ? `
        <div class="border-t border-gray-100 pt-4">
          <p class="text-xs text-gray-400 mb-3"><i class="fas fa-eye-slash mr-1"></i> Inactive Packages (hidden from customers)</p>
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            ${inactivePackages.map(pkg => renderPackageCard(pkg, false)).join('')}
          </div>
        </div>
      ` : ''}
    `)}

    <!-- Package Edit Modal (hidden) -->
    <div id="pkgModal" class="fixed inset-0 z-50 hidden items-center justify-center bg-black/50 backdrop-blur-sm" style="display:none">
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
        <div class="flex items-center justify-between mb-5">
          <h3 class="text-lg font-bold text-gray-800" id="pkgModalTitle">Edit Package</h3>
          <button onclick="closePkgModal()" class="text-gray-400 hover:text-gray-600"><i class="fas fa-times text-lg"></i></button>
        </div>
        <form onsubmit="savePackage(event)">
          <input type="hidden" id="pkgId" value="">
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Package Name</label>
              <input type="text" id="pkgName" placeholder="e.g. 10 Pack" required
                class="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <input type="text" id="pkgDesc" placeholder="e.g. 10 reports, $9 each"
                class="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500">
            </div>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Credits (Reports)</label>
                <input type="number" id="pkgCredits" min="1" required
                  class="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-mono focus:ring-2 focus:ring-teal-500 focus:border-teal-500">
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Total Price (CAD)</label>
                <div class="relative">
                  <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">$</span>
                  <input type="number" step="0.01" min="0.01" id="pkgPrice" required
                    class="w-full pl-8 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm font-mono focus:ring-2 focus:ring-teal-500 focus:border-teal-500">
                </div>
              </div>
            </div>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Sort Order</label>
                <input type="number" id="pkgSort" min="0" value="0"
                  class="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-mono focus:ring-2 focus:ring-teal-500 focus:border-teal-500">
              </div>
              <div class="flex items-end">
                <label class="flex items-center gap-2 cursor-pointer py-2.5">
                  <input type="checkbox" id="pkgActive" checked class="w-4 h-4 text-red-600 rounded focus:ring-teal-500">
                  <span class="text-sm font-medium text-gray-700">Active (visible)</span>
                </label>
              </div>
            </div>
            <div id="pkgPricePreview" class="text-center py-3 bg-gray-50 rounded-xl">
              <p class="text-xs text-gray-500">Price per report will show here</p>
            </div>
          </div>
          <div class="flex gap-3 mt-6">
            <button type="button" onclick="closePkgModal()" class="flex-1 px-4 py-2.5 bg-gray-100 hover:bg-gray-200 rounded-xl text-sm font-medium transition-colors">Cancel</button>
            <button type="submit" id="pkgSaveBtn" class="flex-1 px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-sm font-semibold transition-colors">
              <i class="fas fa-save mr-1"></i> Save
            </button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderPackageCard(pkg, isActive) {
  const pricePerReport = pkg.credits > 0 ? (pkg.price_cents / 100 / pkg.credits).toFixed(2) : '0.00';
  return `
    <div class="border ${isActive ? 'border-gray-200' : 'border-gray-100 opacity-60'} rounded-xl p-5 relative hover:shadow-md transition-all ${isActive ? 'bg-white' : 'bg-gray-50'}">
      ${!isActive ? '<span class="absolute top-2 right-2 text-[9px] bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded-full font-medium">INACTIVE</span>' : ''}
      <div class="text-center mb-3">
        <p class="text-3xl font-black text-gray-900">${pkg.credits}</p>
        <p class="text-xs font-semibold text-gray-500 uppercase">${pkg.name}</p>
      </div>
      <div class="text-center mb-3">
        <p class="text-xl font-bold text-red-600">$${(pkg.price_cents / 100).toFixed(2)}</p>
        <p class="text-[10px] text-gray-400">$${pricePerReport} / report</p>
      </div>
      <p class="text-[10px] text-gray-400 text-center mb-4 min-h-[16px]">${pkg.description || ''}</p>
      <div class="flex gap-2">
        <button onclick="editPackage(${pkg.id}, '${(pkg.name || '').replace(/'/g, "\\'")}', '${(pkg.description || '').replace(/'/g, "\\'")}', ${pkg.credits}, ${pkg.price_cents}, ${pkg.sort_order || 0}, ${pkg.is_active})"
          class="flex-1 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs font-medium text-gray-700 transition-colors">
          <i class="fas fa-edit mr-1"></i> Edit
        </button>
        ${isActive
          ? `<button onclick="deactivatePackage(${pkg.id})" class="px-3 py-2 bg-teal-50 hover:bg-teal-100 rounded-lg text-xs font-medium text-teal-600 transition-colors" title="Deactivate"><i class="fas fa-eye-slash"></i></button>`
          : `<button onclick="activatePackage(${pkg.id})" class="px-3 py-2 bg-green-50 hover:bg-green-100 rounded-lg text-xs font-medium text-green-600 transition-colors" title="Reactivate"><i class="fas fa-eye"></i></button>`
        }
      </div>
    </div>`;
}

// ============================================================
// PRICING ACTIONS
// ============================================================

// Save core pricing settings
async function savePricingSettings(e) {
  e.preventDefault();
  const btn = document.getElementById('savePricingBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Saving...';

  try {
    const body = {
      price_per_report_cents: Math.round(parseFloat(document.getElementById('pricePerReport').value) * 100),
      free_trial_reports: parseInt(document.getElementById('freeTrialReports').value) || 3,
      subscription_monthly_price_cents: Math.round(parseFloat(document.getElementById('subscriptionMonthly').value) * 100),
      subscription_annual_price_cents: Math.round(parseFloat(document.getElementById('subscriptionAnnual').value) * 100),
      secretary_monthly_price_cents: Math.round(parseFloat(document.getElementById('secretaryMonthly').value) * 100),
      secretary_per_call_price_cents: Math.round(parseFloat(document.getElementById('secretaryPerCall').value) * 100),
      subscription_features: document.getElementById('subscriptionFeatures').value.trim(),
    };

    const res = await fetch('/api/settings/pricing/config', {
      method: 'PUT',
      headers: { ...saHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to save');
    }

    btn.innerHTML = '<i class="fas fa-check mr-1"></i> Saved!';
    btn.classList.replace('bg-teal-600', 'bg-green-600');
    // Reload pricing data from DB to show updated values
    setTimeout(() => { loadView('pricing'); }, 1500);
  } catch (err) {
    window.rmToast('Error saving pricing: ' + err.message, 'error');
    btn.innerHTML = '<i class="fas fa-save mr-1"></i> Save Pricing';
    btn.disabled = false;
  }
}
window.savePricingSettings = savePricingSettings;

// Show add-package modal
function showAddPackageModal() {
  document.getElementById('pkgModalTitle').textContent = 'Add New Package';
  document.getElementById('pkgId').value = '';
  document.getElementById('pkgName').value = '';
  document.getElementById('pkgDesc').value = '';
  document.getElementById('pkgCredits').value = '';
  document.getElementById('pkgPrice').value = '';
  document.getElementById('pkgSort').value = '0';
  document.getElementById('pkgActive').checked = true;
  document.getElementById('pkgPricePreview').innerHTML = '<p class="text-xs text-gray-500">Enter credits and price to see per-report cost</p>';
  const modal = document.getElementById('pkgModal');
  modal.style.display = 'flex';
  modal.classList.remove('hidden');
}
window.showAddPackageModal = showAddPackageModal;

// Edit existing package
function editPackage(id, name, desc, credits, priceCents, sortOrder, isActive) {
  document.getElementById('pkgModalTitle').textContent = 'Edit Package';
  document.getElementById('pkgId').value = id;
  document.getElementById('pkgName').value = name;
  document.getElementById('pkgDesc').value = desc;
  document.getElementById('pkgCredits').value = credits;
  document.getElementById('pkgPrice').value = (priceCents / 100).toFixed(2);
  document.getElementById('pkgSort').value = sortOrder;
  document.getElementById('pkgActive').checked = !!isActive;
  updatePkgPreview();
  const modal = document.getElementById('pkgModal');
  modal.style.display = 'flex';
  modal.classList.remove('hidden');
}
window.editPackage = editPackage;

function closePkgModal() {
  const modal = document.getElementById('pkgModal');
  modal.style.display = 'none';
  modal.classList.add('hidden');
}
window.closePkgModal = closePkgModal;

// Update price preview in modal
function updatePkgPreview() {
  const credits = parseInt(document.getElementById('pkgCredits')?.value) || 0;
  const price = parseFloat(document.getElementById('pkgPrice')?.value) || 0;
  const preview = document.getElementById('pkgPricePreview');
  if (!preview) return;
  if (credits > 0 && price > 0) {
    const perReport = (price / credits).toFixed(2);
    preview.innerHTML = `<p class="text-sm font-bold text-green-700">$${perReport} per report</p><p class="text-[10px] text-gray-400">${credits} credits for $${price.toFixed(2)} CAD</p>`;
  } else {
    preview.innerHTML = '<p class="text-xs text-gray-500">Enter credits and price to see per-report cost</p>';
  }
}

// Attach preview updaters after render
document.addEventListener('input', function(e) {
  if (e.target && (e.target.id === 'pkgCredits' || e.target.id === 'pkgPrice')) {
    updatePkgPreview();
  }
});

// Save (create or update) a package
async function savePackage(e) {
  e.preventDefault();
  const btn = document.getElementById('pkgSaveBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Saving...';

  const id = document.getElementById('pkgId').value;
  const body = {
    name: document.getElementById('pkgName').value.trim(),
    description: document.getElementById('pkgDesc').value.trim(),
    credits: parseInt(document.getElementById('pkgCredits').value),
    price_cents: Math.round(parseFloat(document.getElementById('pkgPrice').value) * 100),
    sort_order: parseInt(document.getElementById('pkgSort').value) || 0,
    is_active: document.getElementById('pkgActive').checked,
  };

  if (!body.name || !body.credits || !body.price_cents) {
    window.rmToast('Name, credits, and price are required.', 'warning');
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-save mr-1"></i> Save';
    return;
  }

  try {
    const url = id ? `/api/settings/packages/${id}` : '/api/settings/packages';
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { ...saHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to save package');
    }

    closePkgModal();
    loadView('pricing');
  } catch (err) {
    window.rmToast('Error: ' + err.message, 'error');
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-save mr-1"></i> Save';
  }
}
window.savePackage = savePackage;

// Deactivate a package
async function deactivatePackage(id) {
  if (!(await window.rmConfirm('Deactivate this package? It will be hidden from customers but not deleted.'))) return
  try {
    const res = await fetch(`/api/settings/packages/${id}`, {
      method: 'DELETE',
      headers: saHeaders()
    });
    if (!res.ok) throw new Error('Failed');
    loadView('pricing');
  } catch (err) {
    window.rmToast('Error deactivating package: ' + err.message, 'error');
  }
}
window.deactivatePackage = deactivatePackage;

// Reactivate a package
async function activatePackage(id) {
  try {
    const res = await fetch(`/api/settings/packages/${id}/activate`, {
      method: 'PUT',
      headers: saHeaders()
    });
    if (!res.ok) throw new Error('Failed');
    loadView('pricing');
  } catch (err) {
    window.rmToast('Error activating package: ' + err.message, 'error');
  }
}
window.activatePackage = activatePackage;

// ============================================================
// VIEW: ROOFER SECRETARY AI — Admin Management Dashboard
// ============================================================
function renderSecretaryAdminView() {
  const ov = SA.data.secretary_overview || {};
  const subs = ov.subscriptions || {};
  const calls = ov.calls || {};
  const recent = ov.recent_calls || {};
  const week = ov.week_calls || {};
  const configs = ov.configs || {};
  const msgs = ov.messages || {};
  const subsList = (SA.data.secretary_subscribers || {}).subscribers || [];
  const mrrDollars = ((subs.monthly_mrr_cents || 0) / 100).toFixed(2);

  return `<div class="slide-in space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-2xl font-black text-gray-900"><i class="fas fa-phone-volume mr-2 text-emerald-600"></i>Roofer Secretary AI</h2>
        <p class="text-sm text-gray-500 mt-1">Monitor subscribers, call usage, and service health across all customers</p>
      </div>
      <div class="flex gap-2">
        <button onclick="SA.view='secretary-revenue'; loadView('secretary-revenue')" class="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 transition-colors shadow-sm">
          <i class="fas fa-chart-line mr-1"></i>Revenue & Billing
        </button>
        <button onclick="loadView('secretary-admin')" class="px-3 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm hover:bg-gray-200 transition-colors">
          <i class="fas fa-sync-alt"></i>
        </button>
      </div>
    </div>

    <!-- Key Metrics -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
      ${samc('Active Subscribers', subs.active_count || 0, 'fa-users', 'emerald', 'Paying $249/mo')}
      ${samc('Monthly MRR', '$' + mrrDollars, 'fa-dollar-sign', 'green', (subs.active_count || 0) + ' active subs')}
      ${samc('Total Calls (All Time)', calls.total_calls || 0, 'fa-phone', 'blue', fmtSeconds(calls.total_seconds || 0) + ' total')}
      ${samc('Calls (30d)', recent.calls_30d || 0, 'fa-chart-bar', 'purple', (recent.active_users_30d || 0) + ' active users')}
    </div>

    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
      ${samc('Calls (7d)', week.calls_7d || 0, 'fa-calendar-week', 'sky', fmtSeconds(week.seconds_7d || 0))}
      ${samc('Avg Call Duration', fmtSeconds(calls.avg_duration || 0), 'fa-clock', 'amber', 'Across all calls')}
      ${samc('Active Services', configs.active_services || 0, 'fa-toggle-on', 'teal', 'of ' + (configs.total_configs || 0) + ' configured')}
      ${samc('Pending/Past Due', (subs.pending_count || 0) + (subs.past_due_count || 0), 'fa-exclamation-triangle', 'red', (subs.cancelled_count || 0) + ' cancelled')}
    </div>

    <!-- Call Outcomes Breakdown -->
    ${saSection('Call Outcomes', 'fa-chart-pie', `
      <div class="grid grid-cols-4 gap-4">
        <div class="text-center p-4 bg-green-50 rounded-xl">
          <div class="text-2xl font-black text-green-700">${calls.answered || 0}</div>
          <div class="text-xs text-green-600 font-semibold mt-1"><i class="fas fa-check-circle mr-1"></i>Answered</div>
        </div>
        <div class="text-center p-4 bg-blue-50 rounded-xl">
          <div class="text-2xl font-black text-blue-700">${calls.transferred || 0}</div>
          <div class="text-xs text-blue-600 font-semibold mt-1"><i class="fas fa-exchange-alt mr-1"></i>Transferred</div>
        </div>
        <div class="text-center p-4 bg-yellow-50 rounded-xl">
          <div class="text-2xl font-black text-yellow-700">${calls.voicemail || 0}</div>
          <div class="text-xs text-yellow-600 font-semibold mt-1"><i class="fas fa-voicemail mr-1"></i>Voicemail</div>
        </div>
        <div class="text-center p-4 bg-red-50 rounded-xl">
          <div class="text-2xl font-black text-red-700">${calls.missed || 0}</div>
          <div class="text-xs text-red-600 font-semibold mt-1"><i class="fas fa-phone-slash mr-1"></i>Missed</div>
        </div>
      </div>
    `)}

    <!-- Messages & Appointments -->
    ${saSection('Messages & Appointments', 'fa-envelope', `
      <div class="grid grid-cols-3 gap-4">
        <div class="text-center p-4 bg-indigo-50 rounded-xl">
          <div class="text-2xl font-black text-indigo-700">${msgs.total_messages || 0}</div>
          <div class="text-xs text-indigo-600 font-semibold mt-1"><i class="fas fa-envelope mr-1"></i>Messages (${msgs.unread_messages || 0} unread)</div>
        </div>
        <div class="text-center p-4 bg-purple-50 rounded-xl">
          <div class="text-2xl font-black text-purple-700">${msgs.total_appointments || 0}</div>
          <div class="text-xs text-purple-600 font-semibold mt-1"><i class="fas fa-calendar mr-1"></i>Appointments (${msgs.pending_appointments || 0} pending)</div>
        </div>
        <div class="text-center p-4 bg-orange-50 rounded-xl">
          <div class="text-2xl font-black text-orange-700">${msgs.total_callbacks || 0}</div>
          <div class="text-xs text-orange-600 font-semibold mt-1"><i class="fas fa-phone-alt mr-1"></i>Callbacks (${msgs.pending_callbacks || 0} pending)</div>
        </div>
      </div>
    `)}

    <!-- Subscribers Table -->
    ${saSection('All Subscribers', 'fa-list', `
      ${subsList.length === 0 ? '<div class="py-8 text-center text-gray-400"><i class="fas fa-users text-4xl mb-3 block opacity-30"></i><p>No subscribers yet</p></div>' : `
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                <th class="px-4 py-3">Customer</th>
                <th class="px-4 py-3">Company</th>
                <th class="px-4 py-3">Status</th>
                <th class="px-4 py-3">Service</th>
                <th class="px-4 py-3">Calls (30d)</th>
                <th class="px-4 py-3">Minutes (30d)</th>
                <th class="px-4 py-3">Total Calls</th>
                <th class="px-4 py-3">Price</th>
                <th class="px-4 py-3">Period End</th>
                <th class="px-4 py-3">Subscribed</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-50">
              ${subsList.map(s => {
                const subColor = s.status === 'active' ? 'green' : s.status === 'past_due' ? 'red' : s.status === 'pending' ? 'yellow' : 'gray';
                const serviceColor = s.service_active ? 'green' : 'gray';
                return '<tr class="hover:bg-gray-50 transition-colors">' +
                  '<td class="px-4 py-3"><div class="font-medium text-gray-900">' + (s.customer_name || 'Unknown') + '</div><div class="text-xs text-gray-400">' + (s.customer_email || '') + '</div></td>' +
                  '<td class="px-4 py-3 text-xs text-gray-600">' + (s.customer_company || '—') + '</td>' +
                  '<td class="px-4 py-3"><span class="px-2 py-0.5 bg-' + subColor + '-100 text-' + subColor + '-700 rounded-full text-xs font-semibold capitalize">' + s.status + '</span></td>' +
                  '<td class="px-4 py-3"><span class="px-2 py-0.5 bg-' + serviceColor + '-100 text-' + serviceColor + '-700 rounded-full text-xs font-semibold">' + (s.service_active ? 'Active' : 'Inactive') + '</span></td>' +
                  '<td class="px-4 py-3 font-medium text-gray-900">' + (s.calls_30d || 0) + '</td>' +
                  '<td class="px-4 py-3 text-gray-600">' + fmtSeconds(s.seconds_30d || 0) + '</td>' +
                  '<td class="px-4 py-3 text-gray-600">' + (s.total_calls || 0) + ' <span class="text-xs text-gray-400">(' + fmtSeconds(s.total_call_seconds || 0) + ')</span></td>' +
                  '<td class="px-4 py-3 font-semibold text-gray-900">$' + ((s.monthly_price_cents || 0) / 100).toFixed(0) + '/mo</td>' +
                  '<td class="px-4 py-3 text-xs text-gray-500">' + fmtDate(s.current_period_end) + '</td>' +
                  '<td class="px-4 py-3 text-xs text-gray-400">' + fmtDate(s.created_at) + '</td>' +
                '</tr>';
              }).join('')}
            </tbody>
          </table>
        </div>
      `}
    `, '<span class="text-xs text-gray-400">' + subsList.length + ' subscriber' + (subsList.length !== 1 ? 's' : '') + '</span>')}
  </div>`;
}

// ============================================================
// VIEW: SECRETARY REVENUE — Financial tracking & subscription lifecycle
// ============================================================
function renderSecretaryRevenueView() {
  const rev = SA.data.secretary_revenue || {};
  const mrr = rev.mrr || {};
  const lifetime = rev.lifetime || {};
  const periods = rev.revenue_by_period || [];
  const renewals = rev.upcoming_renewals || [];
  const expired = rev.expired || [];
  const activeMrrDollars = ((mrr.active_mrr_cents || 0) / 100).toFixed(2);
  const atRiskMrrDollars = ((mrr.at_risk_mrr_cents || 0) / 100).toFixed(2);
  const lifetimeDollars = ((lifetime.total_lifetime_cents || 0) / 100).toFixed(2);
  const currentPeriod = rev.period || SA.secRevPeriod || 'monthly';

  return `<div class="slide-in space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-2xl font-black text-gray-900"><i class="fas fa-chart-line mr-2 text-emerald-600"></i>Secretary AI Revenue & Billing</h2>
        <p class="text-sm text-gray-500 mt-1">Track sales, MRR, renewals, and subscription lifecycle</p>
      </div>
      <div class="flex gap-2">
        <button onclick="SA.view='secretary-admin'; loadView('secretary-admin')" class="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm font-semibold hover:bg-gray-200 transition-colors">
          <i class="fas fa-arrow-left mr-1"></i>Back to Overview
        </button>
        <button onclick="loadView('secretary-revenue')" class="px-3 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm hover:bg-gray-200 transition-colors">
          <i class="fas fa-sync-alt"></i>
        </button>
      </div>
    </div>

    <!-- Revenue Key Metrics -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
      ${samc('Active MRR', '$' + activeMrrDollars, 'fa-dollar-sign', 'green', (mrr.active_count || 0) + ' active subs')}
      ${samc('At-Risk MRR', '$' + atRiskMrrDollars, 'fa-exclamation-triangle', 'red', (mrr.at_risk_count || 0) + ' past due')}
      ${samc('Lifetime Revenue', '$' + lifetimeDollars, 'fa-coins', 'amber', (lifetime.total_subscriptions_ever || 0) + ' total subs')}
      ${samc('Churned', mrr.churned_count || 0, 'fa-user-minus', 'gray', 'Cancelled subs')}
    </div>

    <!-- Revenue Trend -->
    ${saSection('Revenue Trend', 'fa-chart-area', `
      <div class="flex gap-2 mb-4">
        ${['daily', 'weekly', 'monthly'].map(p => 
          '<button onclick="SA.secRevPeriod=&quot;'+p+'&quot;; loadView(&quot;secretary-revenue&quot;)" class="px-3 py-1.5 rounded-lg text-xs font-semibold ' + (currentPeriod === p ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200') + ' transition-colors">' + p.charAt(0).toUpperCase() + p.slice(1) + '</button>'
        ).join('')}
      </div>
      ${periods.length === 0 ? '<div class="py-8 text-center text-gray-400">No revenue data yet</div>' : `
        <div class="space-y-2">
          ${periods.map(p => {
            const dollars = ((p.revenue_cents || 0) / 100).toFixed(0);
            const maxRevenue = Math.max(...periods.map(x => x.revenue_cents || 0), 1);
            const pct = Math.round(((p.revenue_cents || 0) / maxRevenue) * 100);
            return '<div class="flex items-center gap-3">' +
              '<div class="w-20 text-xs text-gray-500 font-mono shrink-0">' + p.period + '</div>' +
              '<div class="flex-1 bg-gray-100 rounded-full h-6 overflow-hidden">' +
                '<div class="h-full bg-gradient-to-r from-emerald-400 to-emerald-600 rounded-full flex items-center px-2" style="width:' + Math.max(pct, 5) + '%">' +
                  '<span class="text-[10px] font-bold text-white whitespace-nowrap">$' + dollars + '</span>' +
                '</div>' +
              '</div>' +
              '<div class="w-16 text-right text-xs font-semibold text-gray-700">' + (p.new_subs || 0) + ' new</div>' +
            '</div>';
          }).join('')}
        </div>
      `}
    `)}

    <!-- Upcoming Renewals -->
    ${saSection('Upcoming Renewals (Next 30 Days)', 'fa-calendar-alt', `
      ${renewals.length === 0 ? '<div class="py-6 text-center text-gray-400"><i class="fas fa-check-circle text-green-400 text-xl mr-2"></i>No imminent renewals</div>' : `
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                <th class="px-4 py-3">Customer</th>
                <th class="px-4 py-3">Company</th>
                <th class="px-4 py-3">Amount</th>
                <th class="px-4 py-3">Renewal Date</th>
                <th class="px-4 py-3">Days Left</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-50">
              ${renewals.map(r => {
                const daysLeft = r.current_period_end ? Math.ceil((new Date(r.current_period_end) - new Date()) / 86400000) : 0;
                const urgency = daysLeft <= 7 ? 'red' : daysLeft <= 14 ? 'amber' : 'green';
                return '<tr class="hover:bg-gray-50 transition-colors">' +
                  '<td class="px-4 py-3"><div class="font-medium text-gray-900">' + (r.customer_name || 'Unknown') + '</div><div class="text-xs text-gray-400">' + (r.customer_email || '') + '</div></td>' +
                  '<td class="px-4 py-3 text-xs text-gray-600">' + (r.customer_company || '—') + '</td>' +
                  '<td class="px-4 py-3 font-semibold text-gray-900">$' + ((r.monthly_price_cents || 0) / 100).toFixed(0) + '</td>' +
                  '<td class="px-4 py-3 text-xs text-gray-500">' + fmtDate(r.current_period_end) + '</td>' +
                  '<td class="px-4 py-3"><span class="px-2 py-0.5 bg-' + urgency + '-100 text-' + urgency + '-700 rounded-full text-xs font-bold">' + daysLeft + ' days</span></td>' +
                '</tr>';
              }).join('')}
            </tbody>
          </table>
        </div>
      `}
    `, '<span class="text-xs text-gray-400">' + renewals.length + ' renewal' + (renewals.length !== 1 ? 's' : '') + '</span>')}

    <!-- Expired / Past Due -->
    ${saSection('Past Due & Cancelled', 'fa-user-minus', `
      ${expired.length === 0 ? '<div class="py-6 text-center text-gray-400"><i class="fas fa-smile text-green-400 text-xl mr-2"></i>No churned subscribers</div>' : `
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                <th class="px-4 py-3">Customer</th>
                <th class="px-4 py-3">Company</th>
                <th class="px-4 py-3">Status</th>
                <th class="px-4 py-3">Amount Lost</th>
                <th class="px-4 py-3">Period End</th>
                <th class="px-4 py-3">Cancelled</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-50">
              ${expired.map(e => {
                const statusColor = e.status === 'past_due' ? 'red' : 'gray';
                return '<tr class="hover:bg-gray-50 transition-colors">' +
                  '<td class="px-4 py-3"><div class="font-medium text-gray-900">' + (e.customer_name || 'Unknown') + '</div><div class="text-xs text-gray-400">' + (e.customer_email || '') + '</div></td>' +
                  '<td class="px-4 py-3 text-xs text-gray-600">' + (e.customer_company || '—') + '</td>' +
                  '<td class="px-4 py-3"><span class="px-2 py-0.5 bg-' + statusColor + '-100 text-' + statusColor + '-700 rounded-full text-xs font-semibold capitalize">' + e.status + '</span></td>' +
                  '<td class="px-4 py-3 font-semibold text-red-600">-$' + ((e.monthly_price_cents || 0) / 100).toFixed(0) + '/mo</td>' +
                  '<td class="px-4 py-3 text-xs text-gray-500">' + fmtDate(e.current_period_end) + '</td>' +
                  '<td class="px-4 py-3 text-xs text-gray-400">' + fmtDate(e.cancelled_at) + '</td>' +
                '</tr>';
              }).join('')}
            </tbody>
          </table>
        </div>
      `}
    `, '<span class="text-xs text-gray-400">' + expired.length + ' record' + (expired.length !== 1 ? 's' : '') + '</span>')}

    <!-- First Subscription Date -->
    ${lifetime.first_subscription ? '<div class="text-center text-xs text-gray-400 mt-4"><i class="fas fa-calendar mr-1"></i>Secretary AI service since ' + fmtDate(lifetime.first_subscription) + '</div>' : ''}
  </div>`;
}

// ============================================================
// CONTACT FORMS — View all website contact form submissions
// ============================================================
function renderContactFormsView() {
  return `<div class="mb-6">
    <h2 class="text-2xl font-bold text-gray-900 flex items-center gap-3"><i class="fas fa-inbox text-cyan-500"></i>Contact Form Submissions</h2>
    <p class="text-sm text-gray-500 mt-1">All inquiries from roofmanager.ca contact forms — also forwarded to admin email</p>
  </div>
  <div id="contactFormsContent"><div class="text-center py-12 text-gray-400"><i class="fas fa-spinner fa-spin text-2xl mb-3"></i><p>Loading submissions...</p></div></div>`;
}

async function loadContactForms() {
  try {
    const res = await saFetch('/api/agents/leads?limit=100');
    if (!res) return;
    const data = await res.json();
    const leads = data.leads || [];
    const el = document.getElementById('contactFormsContent');
    if (!el) return;

    if (leads.length === 0) {
      el.innerHTML = '<div class="bg-white rounded-2xl border border-gray-200 p-12 text-center"><i class="fas fa-inbox text-gray-300 text-4xl mb-4"></i><h3 class="font-bold text-gray-600 text-lg">No submissions yet</h3><p class="text-gray-400 text-sm mt-1">Contact form submissions from roofmanager.ca will appear here.</p></div>';
      return;
    }

    el.innerHTML = `
      <div class="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div class="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <span class="font-bold text-gray-800"><i class="fas fa-envelope text-cyan-500 mr-2"></i>${leads.length} Submissions</span>
          <span class="text-xs text-gray-400">Notifications also sent to admin Gmail</span>
        </div>
        <div class="divide-y divide-gray-100">
          ${leads.map(function(l) {
            const date = l.created_at ? new Date(l.created_at + 'Z').toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit' }) : '—';
            return '<div class="px-5 py-4 hover:bg-gray-50 transition-colors">' +
              '<div class="flex items-start justify-between gap-4">' +
                '<div class="flex-1 min-w-0">' +
                  '<div class="flex items-center gap-2 mb-1">' +
                    '<span class="font-semibold text-gray-900">' + (l.name || 'Unknown') + '</span>' +
                    (l.company_name ? '<span class="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">' + l.company_name + '</span>' : '') +
                    '<span class="text-xs bg-cyan-50 text-cyan-600 px-2 py-0.5 rounded-full">' + (l.source_page || 'website') + '</span>' +
                  '</div>' +
                  '<div class="flex items-center gap-4 text-xs text-gray-500 mb-2">' +
                    (l.email ? '<span><i class="fas fa-envelope mr-1"></i><a href="mailto:' + l.email + '" class="text-cyan-600 hover:underline">' + l.email + '</a></span>' : '') +
                    (l.phone ? '<span><i class="fas fa-phone mr-1"></i>' + l.phone + '</span>' : '') +
                  '</div>' +
                  (l.message ? '<p class="text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2 border-l-3 border-cyan-400">' + l.message.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</p>' : '<p class="text-xs text-gray-400 italic">No message</p>') +
                '</div>' +
                '<div class="text-xs text-gray-400 whitespace-nowrap">' + date + '</div>' +
              '</div>' +
            '</div>';
          }).join('')}
        </div>
      </div>`;
  } catch (e) {
    const el = document.getElementById('contactFormsContent');
    if (el) el.innerHTML = '<div class="bg-red-50 rounded-xl p-6 text-center text-red-600"><i class="fas fa-exclamation-circle mr-2"></i>Failed to load contact forms</div>';
  }
}

// ============================================================
// SEO MANAGER — Manage backlinks and meta tags for pages/blogs
// ============================================================
function renderSEOManagerView() {
  return `<div class="mb-6">
    <h2 class="text-2xl font-bold text-gray-900 flex items-center gap-3"><i class="fas fa-search-plus text-purple-500"></i>SEO Manager</h2>
    <p class="text-sm text-gray-500 mt-1">Manage meta tags, backlinks, and SEO settings for all webpages and blog posts</p>
  </div>

  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
    <!-- Page Meta Tags -->
    <div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
      <h3 class="font-bold text-gray-800 mb-4"><i class="fas fa-file-code text-purple-400 mr-2"></i>Page Meta Tags</h3>
      <div class="space-y-4">
        <div>
          <label class="block text-xs font-semibold text-gray-600 mb-1">Select Page</label>
          <select id="seo-page-select" onchange="seoLoadPageMeta()" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-400">
            <option value="homepage">Homepage (/)</option>
            <option value="pricing">Pricing (/pricing)</option>
            <option value="blog">Blog Index (/blog)</option>
            <option value="lander">Landing Page (/lander)</option>
            <option value="customer-login">Customer Login (/customer/login)</option>
          </select>
        </div>
        <div>
          <label class="block text-xs font-semibold text-gray-600 mb-1">Meta Title</label>
          <input type="text" id="seo-meta-title" placeholder="Roof Manager — AI Roof Measurement Reports" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-400" maxlength="70">
          <p class="text-xs text-gray-400 mt-1"><span id="seo-title-count">0</span>/70 chars</p>
        </div>
        <div>
          <label class="block text-xs font-semibold text-gray-600 mb-1">Meta Description</label>
          <textarea id="seo-meta-desc" rows="3" placeholder="AI-powered roof measurement reports in under 60 seconds..." class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-400 resize-none" maxlength="160"></textarea>
          <p class="text-xs text-gray-400 mt-1"><span id="seo-desc-count">0</span>/160 chars</p>
        </div>
        <div>
          <label class="block text-xs font-semibold text-gray-600 mb-1">Canonical URL</label>
          <input type="url" id="seo-canonical" placeholder="https://roofmanager.ca/" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-400">
        </div>
        <div>
          <label class="block text-xs font-semibold text-gray-600 mb-1">Keywords (comma-separated)</label>
          <input type="text" id="seo-keywords" placeholder="roof measurement, AI roofing, roof report" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-400">
        </div>
        <div>
          <label class="block text-xs font-semibold text-gray-600 mb-1">OG Image URL</label>
          <input type="url" id="seo-og-image" placeholder="https://roofmanager.ca/og-image.jpg" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-400">
        </div>
        <button onclick="seoSavePageMeta()" class="px-5 py-2.5 bg-purple-500 text-white rounded-lg font-semibold text-sm hover:bg-purple-600 transition-all"><i class="fas fa-save mr-2"></i>Save Meta Tags</button>
      </div>
    </div>

    <!-- Backlink Manager -->
    <div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
      <h3 class="font-bold text-gray-800 mb-4"><i class="fas fa-link text-blue-400 mr-2"></i>Backlink Manager</h3>
      <p class="text-sm text-gray-500 mb-4">Add external backlinks to inject into page footers, headers, or structured data for SEO juice.</p>
      <div class="space-y-4">
        <div>
          <label class="block text-xs font-semibold text-gray-600 mb-1">Target Page</label>
          <select id="seo-backlink-page" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400">
            <option value="all">All Pages (sitewide)</option>
            <option value="homepage">Homepage</option>
            <option value="blog">Blog Posts</option>
            <option value="pricing">Pricing Page</option>
          </select>
        </div>
        <div>
          <label class="block text-xs font-semibold text-gray-600 mb-1">Backlink URL</label>
          <input type="url" id="seo-backlink-url" placeholder="https://example.com/partner-page" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400">
        </div>
        <div>
          <label class="block text-xs font-semibold text-gray-600 mb-1">Anchor Text</label>
          <input type="text" id="seo-backlink-anchor" placeholder="Professional Roofing Solutions" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400">
        </div>
        <div class="flex items-center gap-4">
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" id="seo-backlink-nofollow" class="rounded text-blue-500"> nofollow</label>
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" id="seo-backlink-newwindow" checked class="rounded text-blue-500"> Open in new window</label>
        </div>
        <button onclick="seoAddBacklink()" class="px-5 py-2.5 bg-blue-500 text-white rounded-lg font-semibold text-sm hover:bg-blue-600 transition-all"><i class="fas fa-plus mr-2"></i>Add Backlink</button>
      </div>

      <div class="mt-6 border-t border-gray-100 pt-4">
        <h4 class="font-semibold text-gray-700 text-sm mb-3">Active Backlinks</h4>
        <div id="seo-backlinks-list" class="text-xs text-gray-400">Loading...</div>
      </div>
    </div>
  </div>

  <!-- Blog Post SEO -->
  <div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
    <h3 class="font-bold text-gray-800 mb-2"><i class="fas fa-blog text-green-400 mr-2"></i>Blog Post SEO</h3>
    <p class="text-sm text-gray-500 mb-4">SEO settings are managed per-post in the Blog Editor. Edit any blog post to set custom title, description, and schema markup.</p>
    <div class="bg-green-50 border border-green-200 rounded-lg p-4">
      <p class="text-sm text-green-700"><i class="fas fa-check-circle mr-1"></i><strong>Auto-SEO Active:</strong> All blog posts automatically get structured data (Article schema), Open Graph tags, Twitter cards, and canonical URLs. Customize per-post in the blog editor.</p>
    </div>
    <button onclick="saSetView('marketing')" class="mt-4 px-5 py-2.5 bg-green-500 text-white rounded-lg font-semibold text-sm hover:bg-green-600 transition-all"><i class="fas fa-edit mr-2"></i>Go to Blog Editor</button>
  </div>`;
}

// SEO Manager helper functions
window.seoSavePageMeta = async function() {
  const page = document.getElementById('seo-page-select').value;
  const data = {
    page: page,
    meta_title: document.getElementById('seo-meta-title').value.trim(),
    meta_description: document.getElementById('seo-meta-desc').value.trim(),
    canonical_url: document.getElementById('seo-canonical').value.trim(),
    keywords: document.getElementById('seo-keywords').value.trim(),
    og_image: document.getElementById('seo-og-image').value.trim()
  };
  try {
    const res = await saFetch('/api/admin/superadmin/seo/page-meta', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (res && res.ok) window.rmToast('SEO settings saved for ' + page, 'success');
    else window.rmToast('Failed to save — API endpoint may need configuration', 'error');
  } catch(e) { window.rmToast('Error saving SEO settings', 'error'); }
};

window.seoAddBacklink = async function() {
  const data = {
    target_page: document.getElementById('seo-backlink-page').value,
    url: document.getElementById('seo-backlink-url').value.trim(),
    anchor_text: document.getElementById('seo-backlink-anchor').value.trim(),
    nofollow: document.getElementById('seo-backlink-nofollow').checked,
    new_window: document.getElementById('seo-backlink-newwindow').checked
  };
  if (!data.url) { window.rmToast('Backlink URL is required', 'warning'); return; }
  try {
    const res = await saFetch('/api/admin/superadmin/seo/backlinks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (res && res.ok) { window.rmToast('Backlink added!', 'success'); seoLoadBacklinks(); }
    else window.rmToast('Failed to add backlink', 'error');
  } catch(e) { window.rmToast('Error adding backlink', 'error'); }
};

window.seoLoadBacklinks = async function() {
  try {
    const res = await saFetch('/api/admin/superadmin/seo/backlinks');
    if (!res) return;
    const data = await res.json();
    const el = document.getElementById('seo-backlinks-list');
    if (!el) return;
    const links = data.backlinks || [];
    if (links.length === 0) { el.innerHTML = '<p class="text-gray-400 text-xs">No backlinks added yet.</p>'; return; }
    el.innerHTML = links.map(function(l) {
      return '<div class="flex items-center justify-between py-2 border-b border-gray-50">' +
        '<div><a href="' + l.url + '" target="_blank" class="text-blue-600 hover:underline text-xs">' + (l.anchor_text || l.url) + '</a>' +
        '<span class="text-gray-400 ml-2">→ ' + l.target_page + '</span>' +
        (l.nofollow ? ' <span class="bg-gray-100 text-gray-500 px-1 rounded text-[10px]">nofollow</span>' : '') +
        '</div><button onclick="seoDeleteBacklink(' + l.id + ')" class="text-red-400 hover:text-red-600 text-xs"><i class="fas fa-trash"></i></button></div>';
    }).join('');
  } catch(e) {}
};

window.seoDeleteBacklink = async function(id) {
  if (!(await window.rmConfirm('Delete this backlink?'))) return
  await saFetch('/api/admin/superadmin/seo/backlinks/' + id, { method: 'DELETE' });
  seoLoadBacklinks();
};

window.seoLoadPageMeta = function() {
  // Placeholder — will load saved meta from DB when API is ready
  document.getElementById('seo-meta-title').value = '';
  document.getElementById('seo-meta-desc').value = '';
  document.getElementById('seo-canonical').value = '';
  document.getElementById('seo-keywords').value = '';
  document.getElementById('seo-og-image').value = '';
};

// ============================================================
// VIEW: ONBOARDING CONFIGURATION — Fees, Packs, Discounts
// ============================================================
var onboardCfg = {};

function renderOnboardingConfigView() {
  return `
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-2xl font-black text-gray-900"><i class="fas fa-sliders-h mr-2 text-blue-500"></i>Customer Onboarding Configuration</h2>
        <p class="text-sm text-gray-500 mt-1">Control setup fees, trial length, report packs, feature gating, and ad-supported free tier</p>
      </div>
      <button onclick="loadView('onboarding-config')" class="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-xl text-sm font-medium"><i class="fas fa-sync-alt mr-1"></i>Refresh</button>
    </div>
    <div id="obc-form"></div>
  </div>`;
}

async function loadOnboardingConfig() {
  var el = document.getElementById('obc-form');
  if (!el) return;
  var d = SA.data.onboarding_config || {};
  var c = d.config || {};
  onboardCfg = JSON.parse(JSON.stringify(c));

  el.innerHTML = `
    <!-- Pricing & Fees -->
    <div class="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm mb-6">
      <h3 class="font-bold text-gray-800 mb-4"><i class="fas fa-dollar-sign mr-2 text-green-500"></i>Pricing & Fees</h3>
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <label class="block text-xs font-medium text-gray-500 mb-1">Setup Fee ($)</label>
          <input type="number" step="0.01" id="obc-setup-fee" value="${((c.setup_fee_cents||0)/100).toFixed(2)}" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-500 mb-1">Setup Fee Label</label>
          <input type="text" id="obc-setup-label" value="${c.setup_fee_label||'One-Time Setup Fee'}" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-500 mb-1">Monthly Sub ($)</label>
          <input type="number" step="0.01" id="obc-monthly" value="${((c.monthly_price_cents||4999)/100).toFixed(2)}" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-500 mb-1">Annual Sub ($)</label>
          <input type="number" step="0.01" id="obc-annual" value="${((c.annual_price_cents||49999)/100).toFixed(2)}" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
        </div>
      </div>
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
        <div>
          <label class="block text-xs font-medium text-gray-500 mb-1">Free Trial Reports</label>
          <input type="number" id="obc-trial-reports" value="${c.free_trial_reports||3}" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-500 mb-1">Free Trial Days</label>
          <input type="number" id="obc-trial-days" value="${c.free_trial_days||14}" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
        </div>
        <div class="flex items-end">
          <label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" id="obc-ad-free" ${c.ad_supported_free_tier?'checked':''} class="w-4 h-4 text-blue-600 rounded"><span class="text-sm text-gray-700">Ad-Supported Free Tier</span></label>
        </div>
        <div class="flex items-end">
          <label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" id="obc-req-pay" ${c.require_payment_after_trial?'checked':''} class="w-4 h-4 text-blue-600 rounded"><span class="text-sm text-gray-700">Require Payment After Trial</span></label>
        </div>
      </div>
    </div>

    <!-- Ad Network IDs -->
    <div class="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm mb-6">
      <h3 class="font-bold text-gray-800 mb-4"><i class="fas fa-ad mr-2 text-amber-500"></i>Ad Network (AdMob for iOS)</h3>
      <p class="text-xs text-gray-500 mb-3">After the free trial, users can either pay $49.99/mo or continue with small non-intrusive ads. These IDs enable Google AdMob on iOS.</p>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-xs font-medium text-gray-500 mb-1">AdMob Banner Unit ID</label>
          <input type="text" id="obc-admob-banner" value="${c.admob_banner_id||''}" placeholder="ca-app-pub-xxxxxxxxxx/yyyyyyyyyy" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono">
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-500 mb-1">AdMob Interstitial Unit ID</label>
          <input type="text" id="obc-admob-interstitial" value="${c.admob_interstitial_id||''}" placeholder="ca-app-pub-xxxxxxxxxx/zzzzzzzzzz" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono">
        </div>
      </div>
    </div>

    <!-- Report Packs -->
    <div class="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm mb-6">
      <h3 class="font-bold text-gray-800 mb-4"><i class="fas fa-box-open mr-2 text-indigo-500"></i>Report Packs (Discounted Bundles on Signup)</h3>
      <div id="obc-packs-list"></div>
      <button onclick="obcAddPack()" class="mt-3 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700"><i class="fas fa-plus mr-1"></i>Add Pack</button>
    </div>

    <!-- Features Toggle -->
    <div class="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm mb-6">
      <h3 class="font-bold text-gray-800 mb-4"><i class="fas fa-toggle-on mr-2 text-teal-500"></i>Feature Gating</h3>
      <p class="text-xs text-gray-500 mb-3">Toggle which features are enabled and which are available on the free/ad-supported tier.</p>
      <div id="obc-features-list"></div>
    </div>

    <button onclick="obcSave()" id="obc-save-btn" class="px-6 py-3 bg-teal-600 hover:bg-teal-700 text-white rounded-xl font-semibold text-sm"><i class="fas fa-save mr-1"></i>Save Onboarding Configuration</button>
  `;

  renderObcPacks();
  renderObcFeatures();
}

function renderObcPacks() {
  var el = document.getElementById('obc-packs-list');
  if (!el) return;
  var packs = onboardCfg.report_packs || [];
  if (packs.length === 0) { el.innerHTML = '<p class="text-gray-400 text-sm">No packs configured. Add one below.</p>'; return; }
  el.innerHTML = '<div class="grid grid-cols-1 md:grid-cols-3 gap-3">' + packs.map(function(p, i) {
    return '<div class="border border-gray-200 rounded-xl p-4">' +
      '<div class="flex items-center justify-between mb-2"><input type="text" value="' + (p.name||'') + '" onchange="obcUpdatePack(' + i + ',\'name\',this.value)" class="text-sm font-bold text-gray-800 border-0 bg-transparent w-full" placeholder="Pack Name">' +
      '<button onclick="obcRemovePack(' + i + ')" class="text-red-400 hover:text-red-600 text-xs"><i class="fas fa-trash"></i></button></div>' +
      '<div class="grid grid-cols-3 gap-2">' +
      '<div><label class="text-[10px] text-gray-400">Reports</label><input type="number" value="' + (p.reports||0) + '" onchange="obcUpdatePack(' + i + ',\'reports\',parseInt(this.value))" class="w-full text-sm border border-gray-200 rounded px-2 py-1"></div>' +
      '<div><label class="text-[10px] text-gray-400">Price ($)</label><input type="number" step="0.01" value="' + ((p.price_cents||0)/100).toFixed(2) + '" onchange="obcUpdatePack(' + i + ',\'price_cents\',Math.round(parseFloat(this.value)*100))" class="w-full text-sm border border-gray-200 rounded px-2 py-1"></div>' +
      '<div><label class="text-[10px] text-gray-400">Discount %</label><input type="number" value="' + (p.discount_pct||0) + '" onchange="obcUpdatePack(' + i + ',\'discount_pct\',parseInt(this.value))" class="w-full text-sm border border-gray-200 rounded px-2 py-1"></div>' +
      '</div></div>';
  }).join('') + '</div>';
}
window.obcUpdatePack = function(i, key, val) { if(onboardCfg.report_packs && onboardCfg.report_packs[i]) onboardCfg.report_packs[i][key] = val; };
window.obcRemovePack = function(i) { onboardCfg.report_packs.splice(i, 1); renderObcPacks(); };
window.obcAddPack = function() {
  if (!onboardCfg.report_packs) onboardCfg.report_packs = [];
  onboardCfg.report_packs.push({ name: 'New Pack', reports: 10, price_cents: 7500, discount_pct: 25 });
  renderObcPacks();
};

function renderObcFeatures() {
  var el = document.getElementById('obc-features-list');
  if (!el) return;
  var features = onboardCfg.features || [];
  el.innerHTML = '<div class="space-y-2">' + features.map(function(f, i) {
    return '<div class="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-gray-50 border border-gray-100">' +
      '<div class="flex items-center gap-3">' +
        '<label class="flex items-center gap-2"><input type="checkbox" ' + (f.enabled?'checked':'') + ' onchange="obcToggleFeature(' + i + ',\'enabled\',this.checked)" class="w-4 h-4 text-teal-600 rounded"><span class="text-sm font-medium text-gray-800">' + f.label + '</span></label>' +
      '</div>' +
      '<label class="flex items-center gap-2 text-xs text-gray-500"><input type="checkbox" ' + (f.free_tier?'checked':'') + ' onchange="obcToggleFeature(' + i + ',\'free_tier\',this.checked)" class="w-3 h-3 text-amber-500 rounded"> Free/Ad Tier</label>' +
    '</div>';
  }).join('') + '</div>';
}
window.obcToggleFeature = function(i, key, val) { if(onboardCfg.features && onboardCfg.features[i]) onboardCfg.features[i][key] = val; };

window.obcSave = async function() {
  var btn = document.getElementById('obc-save-btn');
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Saving...';
  try {
    onboardCfg.setup_fee_cents = Math.round(parseFloat(document.getElementById('obc-setup-fee').value) * 100);
    onboardCfg.setup_fee_label = document.getElementById('obc-setup-label').value;
    onboardCfg.monthly_price_cents = Math.round(parseFloat(document.getElementById('obc-monthly').value) * 100);
    onboardCfg.annual_price_cents = Math.round(parseFloat(document.getElementById('obc-annual').value) * 100);
    onboardCfg.free_trial_reports = parseInt(document.getElementById('obc-trial-reports').value);
    onboardCfg.free_trial_days = parseInt(document.getElementById('obc-trial-days').value);
    onboardCfg.ad_supported_free_tier = document.getElementById('obc-ad-free').checked;
    onboardCfg.require_payment_after_trial = document.getElementById('obc-req-pay').checked;
    onboardCfg.admob_banner_id = document.getElementById('obc-admob-banner').value;
    onboardCfg.admob_interstitial_id = document.getElementById('obc-admob-interstitial').value;

    var res = await saFetch('/api/admin/superadmin/onboarding/config', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(onboardCfg)
    });
    if (res && res.ok) {
      btn.innerHTML = '<i class="fas fa-check mr-1"></i>Saved!'; btn.classList.replace('bg-teal-600','bg-green-600');
      setTimeout(function(){ loadView('onboarding-config'); }, 1500);
    } else { window.rmToast('Save failed', 'error'); btn.disabled = false; btn.innerHTML = '<i class="fas fa-save mr-1"></i>Save'; }
  } catch(e) { window.rmToast('Error: ' + e.message, 'error'); btn.disabled = false; btn.innerHTML = '<i class="fas fa-save mr-1"></i>Save'; }
};

// ============================================================
// VIEW: PHONE NUMBER MARKETPLACE — Twilio DID Purchase
// ============================================================
function renderPhoneMarketplaceView() {
  return `
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-2xl font-black text-gray-900"><i class="fas fa-phone-volume mr-2 text-green-500"></i>Phone Number Marketplace</h2>
        <p class="text-sm text-gray-500 mt-1">Purchase and manage DID phone numbers for Roofer Secretary AI via Twilio</p>
      </div>
      <button onclick="loadView('phone-marketplace')" class="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-xl text-sm font-medium"><i class="fas fa-sync-alt mr-1"></i>Refresh</button>
    </div>

    <!-- Search for Numbers -->
    <div class="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
      <h3 class="font-bold text-gray-800 mb-4"><i class="fas fa-search mr-2 text-blue-500"></i>Search Available Numbers</h3>
      <div class="flex gap-3 mb-4">
        <select id="pn-country" class="border border-gray-300 rounded-lg px-3 py-2 text-sm">
          <option value="CA">Canada</option>
          <option value="US">United States</option>
        </select>
        <input type="text" id="pn-area-code" placeholder="Area code (e.g. 780, 403)" class="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm">
        <button onclick="pnSearch()" id="pn-search-btn" class="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700"><i class="fas fa-search mr-1"></i>Search</button>
      </div>
      <div id="pn-results" class="text-gray-400 text-sm">Enter an area code and search to find available numbers.</div>
    </div>

    <!-- Owned Numbers -->
    <div class="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
      <h3 class="font-bold text-gray-800 mb-4"><i class="fas fa-phone mr-2 text-green-500"></i>Owned Numbers</h3>
      <div id="pn-owned"></div>
    </div>
  </div>`;
}

async function loadPhoneNumbers() {
  var el = document.getElementById('pn-owned');
  if (!el) return;
  var d = SA.data.phone_numbers || {};
  var numbers = d.numbers || [];
  if (numbers.length === 0) { el.innerHTML = '<p class="text-gray-400 text-sm">No numbers purchased yet. Search and buy one above.</p>'; return; }
  el.innerHTML = '<div class="space-y-2">' + numbers.map(function(n) {
    return '<div class="flex items-center justify-between py-3 px-4 rounded-xl border border-gray-100 hover:bg-gray-50">' +
      '<div class="flex items-center gap-3"><div class="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center"><i class="fas fa-phone text-green-600"></i></div>' +
        '<div><p class="font-mono font-bold text-gray-800">' + n.phone_number + '</p><p class="text-xs text-gray-400">' + (n.friendly_name||'') + ' · ' + (n.purpose||'secretary') + '</p></div></div>' +
      '<div class="text-right"><span class="px-2 py-1 text-xs rounded-full font-medium ' + (n.status==='active'?'bg-green-100 text-green-700':'bg-gray-100 text-gray-500') + '">' + (n.status||'active') + '</span>' +
        (n.customer_name ? '<p class="text-xs text-gray-400 mt-1">Assigned: ' + n.customer_name + '</p>' : '') + '</div></div>';
  }).join('') + '</div>';
}

window.pnSearch = async function() {
  var btn = document.getElementById('pn-search-btn');
  var el = document.getElementById('pn-results');
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Searching...';
  try {
    var country = document.getElementById('pn-country').value;
    var areaCode = document.getElementById('pn-area-code').value.trim();
    var res = await saFetch('/api/admin/superadmin/phone-numbers/available?country=' + country + (areaCode ? '&area_code=' + areaCode : ''));
    if (!res) { el.innerHTML = '<p class="text-red-500 text-sm">Auth error</p>'; return; }
    var data = await res.json();
    var numbers = data.numbers || [];
    if (data.error) { el.innerHTML = '<p class="text-red-500 text-sm">' + data.error + '</p>'; return; }
    if (numbers.length === 0) { el.innerHTML = '<p class="text-gray-400 text-sm">No numbers available for that area code. Try a different one.</p>'; return; }
    el.innerHTML = '<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">' + numbers.map(function(n) {
      return '<div class="border border-gray-200 rounded-xl p-4 hover:border-green-300 hover:shadow-md transition-all cursor-pointer" onclick="pnPurchase(\'' + n.phone_number + '\')">' +
        '<p class="font-mono font-bold text-gray-900 text-lg">' + n.phone_number + '</p>' +
        '<p class="text-xs text-gray-500">' + (n.locality||'') + (n.region ? ', ' + n.region : '') + '</p>' +
        '<div class="mt-2 flex items-center justify-between"><span class="text-xs text-gray-400"><i class="fas fa-phone mr-1"></i>Voice + SMS</span>' +
        '<span class="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">~$1.50/mo</span></div>' +
        '<button class="mt-2 w-full text-center bg-green-600 text-white rounded-lg py-1.5 text-sm font-semibold hover:bg-green-700"><i class="fas fa-cart-plus mr-1"></i>Purchase</button></div>';
    }).join('') + '</div>';
  } catch(e) { el.innerHTML = '<p class="text-red-500 text-sm">Error: ' + e.message + '</p>'; }
  btn.disabled = false; btn.innerHTML = '<i class="fas fa-search mr-1"></i>Search';
};

window.pnPurchase = async function(phoneNumber) {
  if (!(await window.rmConfirm('Purchase ' + phoneNumber + '? This will charge your Twilio account ~$1.50/mo.'))) return
  try {
    var res = await saFetch('/api/admin/superadmin/phone-numbers/purchase', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone_number: phoneNumber, purpose: 'secretary' })
    });
    if (!res) return;
    var data = await res.json();
    if (data.success) { window.rmToast('Number purchased: ' + data.phone_number, 'info'); loadView('phone-marketplace'); }
    else window.rmToast('Purchase failed: ' + (data.error || 'Unknown error'), 'error');
  } catch(e) { window.rmToast('Error: ' + e.message, 'error'); }
};

// ============================================================
// VIEW: PRICING ENGINE PRESETS
// ============================================================
function renderPricingEngineView() {
  return `
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <h2 class="text-xl font-bold text-gray-800"><i class="fas fa-calculator mr-2 text-green-500"></i>Roofing Pricing Engine</h2>
      <span class="text-xs px-3 py-1 rounded-full bg-green-100 text-green-700">From EagleView Analysis</span>
    </div>

    <div class="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-xl p-6">
      <p class="text-sm text-gray-600">Configure your material & labor costs. These presets are used to auto-generate proposals from roof measurement reports. You can also test the calculator with sample measurements and download PDF proposals.</p>
    </div>

    <div class="bg-white border border-gray-200 rounded-xl p-6">
      <h3 class="font-bold text-gray-800 mb-4">Material Costs (per square = 100 sq ft)</h3>
      <div class="grid md:grid-cols-3 gap-4">
        <div><label class="block text-xs font-medium text-gray-500 mb-1">Shingles ($/sq)</label><input id="pe-shingles" type="number" step="0.01" value="145.00" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"></div>
        <div><label class="block text-xs font-medium text-gray-500 mb-1">Underlayment ($/sq)</label><input id="pe-underlay" type="number" step="0.01" value="25.00" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"></div>
        <div><label class="block text-xs font-medium text-gray-500 mb-1">Ice Shield ($/roll)</label><input id="pe-iceshield" type="number" step="0.01" value="85.00" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"></div>
      </div>
    </div>

    <div class="bg-white border border-gray-200 rounded-xl p-6">
      <h3 class="font-bold text-gray-800 mb-4">Edge & Flashing Costs (per linear ft)</h3>
      <div class="grid md:grid-cols-4 gap-4">
        <div><label class="block text-xs font-medium text-gray-500 mb-1">Drip Edge ($/ft)</label><input id="pe-drip" type="number" step="0.01" value="1.50" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"></div>
        <div><label class="block text-xs font-medium text-gray-500 mb-1">Ridge Cap ($/ft)</label><input id="pe-ridge" type="number" step="0.01" value="3.25" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"></div>
        <div><label class="block text-xs font-medium text-gray-500 mb-1">Valley Flash ($/ft)</label><input id="pe-valley" type="number" step="0.01" value="2.75" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"></div>
        <div><label class="block text-xs font-medium text-gray-500 mb-1">Step Flash ($/ft)</label><input id="pe-step" type="number" step="0.01" value="3.50" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"></div>
      </div>
    </div>

    <div class="bg-white border border-gray-200 rounded-xl p-6">
      <h3 class="font-bold text-gray-800 mb-4">Labor & Overhead</h3>
      <div class="grid md:grid-cols-4 gap-4">
        <div><label class="block text-xs font-medium text-gray-500 mb-1">Labor ($/sq)</label><input id="pe-labor" type="number" step="0.01" value="180.00" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"></div>
        <div><label class="block text-xs font-medium text-gray-500 mb-1">Tear-off ($/sq)</label><input id="pe-tearoff" type="number" step="0.01" value="45.00" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"></div>
        <div><label class="block text-xs font-medium text-gray-500 mb-1">Disposal ($/sq)</label><input id="pe-disposal" type="number" step="0.01" value="25.00" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"></div>
        <div><label class="block text-xs font-medium text-gray-500 mb-1">Waste Factor (%)</label><input id="pe-waste" type="number" step="1" value="15" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"></div>
      </div>
    </div>

    <div class="bg-white border border-gray-200 rounded-xl p-6">
      <h3 class="font-bold text-gray-800 mb-4">Tax Rate</h3>
      <div class="grid md:grid-cols-2 gap-4">
        <div><label class="block text-xs font-medium text-gray-500 mb-1">Tax Rate (%)</label><input id="pe-tax" type="number" step="0.01" value="5.00" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"></div>
      </div>
    </div>

    <div class="flex gap-3">
      <button onclick="savePricingPresets()" class="bg-green-600 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-green-700"><i class="fas fa-save mr-2"></i>Save Presets</button>
      <button onclick="resetPricingPresets()" class="bg-gray-200 text-gray-700 px-4 py-2.5 rounded-lg text-sm hover:bg-gray-300">Reset to Defaults</button>
    </div>

    <div id="pe-save-msg" class="hidden text-sm px-4 py-3 rounded-lg"></div>

    <!-- TEST CALCULATOR -->
    <div class="border-t border-gray-200 pt-6">
      <h3 class="text-lg font-bold text-gray-800 mb-4"><i class="fas fa-flask mr-2 text-blue-500"></i>Test Calculator — Good / Better / Best</h3>
      <p class="text-sm text-gray-500 mb-4">Enter sample roof measurements to preview pricing across all three tiers.</p>
      <div class="bg-white border border-gray-200 rounded-xl p-6">
        <div class="grid md:grid-cols-4 gap-4 mb-4">
          <div><label class="block text-xs font-medium text-gray-500 mb-1">Total Roof Area (sq ft) *</label><input id="pe-test-area" type="number" value="3200" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"></div>
          <div><label class="block text-xs font-medium text-gray-500 mb-1">Ridge (ft)</label><input id="pe-test-ridge" type="number" value="60" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"></div>
          <div><label class="block text-xs font-medium text-gray-500 mb-1">Hip (ft)</label><input id="pe-test-hip" type="number" value="40" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"></div>
          <div><label class="block text-xs font-medium text-gray-500 mb-1">Valley (ft)</label><input id="pe-test-valley" type="number" value="30" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"></div>
        </div>
        <div class="grid md:grid-cols-4 gap-4 mb-4">
          <div><label class="block text-xs font-medium text-gray-500 mb-1">Eave (ft)</label><input id="pe-test-eave" type="number" value="120" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"></div>
          <div><label class="block text-xs font-medium text-gray-500 mb-1">Rake (ft)</label><input id="pe-test-rake" type="number" value="80" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"></div>
          <div><label class="block text-xs font-medium text-gray-500 mb-1">Step Flash (ft)</label><input id="pe-test-step" type="number" value="0" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"></div>
          <div><label class="block text-xs font-medium text-gray-500 mb-1">Dominant Pitch</label><input id="pe-test-pitch" type="text" value="7/12" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"></div>
        </div>
        <div class="flex gap-3">
          <button onclick="runTestCalculation()" class="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"><i class="fas fa-calculator mr-2"></i>Calculate Good / Better / Best</button>
          <button onclick="runTestCalculation(true)" class="bg-gray-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-gray-700"><i class="fas fa-calculator mr-2"></i>Custom Preset Only</button>
        </div>
      </div>
      <div id="pe-test-results" class="mt-4"></div>
    </div>
  </div>`;
}

async function loadPricingPresets() {
  try {
    var resp = await saFetch('/api/invoices/pricing/presets');
    var data = await resp.json();
    var p = data.presets || {};
    if (p.shingles_per_square) document.getElementById('pe-shingles').value = p.shingles_per_square;
    if (p.underlayment_per_square) document.getElementById('pe-underlay').value = p.underlayment_per_square;
    if (p.ice_shield_per_roll) document.getElementById('pe-iceshield').value = p.ice_shield_per_roll;
    if (p.drip_edge_per_ft) document.getElementById('pe-drip').value = p.drip_edge_per_ft;
    if (p.ridge_cap_per_ft) document.getElementById('pe-ridge').value = p.ridge_cap_per_ft;
    if (p.valley_flashing_per_ft) document.getElementById('pe-valley').value = p.valley_flashing_per_ft;
    if (p.step_flashing_per_ft) document.getElementById('pe-step').value = p.step_flashing_per_ft;
    if (p.labor_per_square) document.getElementById('pe-labor').value = p.labor_per_square;
    if (p.tearoff_per_square) document.getElementById('pe-tearoff').value = p.tearoff_per_square;
    if (p.disposal_per_square) document.getElementById('pe-disposal').value = p.disposal_per_square;
    if (p.waste_factor != null) document.getElementById('pe-waste').value = Math.round(p.waste_factor * 100);
    if (p.tax_rate != null) document.getElementById('pe-tax').value = (p.tax_rate * 100).toFixed(2);
  } catch (e) {}
}

window.savePricingPresets = async function() {
  var presets = {
    shingles_per_square: parseFloat(document.getElementById('pe-shingles').value) || 145,
    underlayment_per_square: parseFloat(document.getElementById('pe-underlay').value) || 25,
    ice_shield_per_roll: parseFloat(document.getElementById('pe-iceshield').value) || 85,
    drip_edge_per_ft: parseFloat(document.getElementById('pe-drip').value) || 1.50,
    ridge_cap_per_ft: parseFloat(document.getElementById('pe-ridge').value) || 3.25,
    valley_flashing_per_ft: parseFloat(document.getElementById('pe-valley').value) || 2.75,
    step_flashing_per_ft: parseFloat(document.getElementById('pe-step').value) || 3.50,
    labor_per_square: parseFloat(document.getElementById('pe-labor').value) || 180,
    tearoff_per_square: parseFloat(document.getElementById('pe-tearoff').value) || 45,
    disposal_per_square: parseFloat(document.getElementById('pe-disposal').value) || 25,
    waste_factor: (parseFloat(document.getElementById('pe-waste').value) || 15) / 100,
    tax_rate: (parseFloat(document.getElementById('pe-tax').value) || 5) / 100
  };
  var resp = await saFetch('/api/invoices/pricing/presets', {
    method: 'PUT', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ presets: presets })
  });
  var data = await resp.json();
  var msg = document.getElementById('pe-save-msg');
  if (data.success) {
    msg.className = 'text-sm px-4 py-3 rounded-lg bg-green-50 text-green-700 border border-green-200';
    msg.innerHTML = '<i class="fas fa-check-circle mr-2"></i>Presets saved! These will be used when generating proposals from roof reports.';
  } else {
    msg.className = 'text-sm px-4 py-3 rounded-lg bg-red-50 text-red-700 border border-teal-200';
    msg.innerHTML = '<i class="fas fa-times-circle mr-2"></i>' + (data.error || 'Save failed');
  }
};

window.resetPricingPresets = function() {
  document.getElementById('pe-shingles').value = '145.00';
  document.getElementById('pe-underlay').value = '25.00';
  document.getElementById('pe-iceshield').value = '85.00';
  document.getElementById('pe-drip').value = '1.50';
  document.getElementById('pe-ridge').value = '3.25';
  document.getElementById('pe-valley').value = '2.75';
  document.getElementById('pe-step').value = '3.50';
  document.getElementById('pe-labor').value = '180.00';
  document.getElementById('pe-tearoff').value = '45.00';
  document.getElementById('pe-disposal').value = '25.00';
  document.getElementById('pe-waste').value = '15';
  document.getElementById('pe-tax').value = '5.00';
};

// ---- Test Calculator ----
window.runTestCalculation = async function(customOnly) {
  var resultsEl = document.getElementById('pe-test-results');
  if (!resultsEl) return;
  resultsEl.innerHTML = '<div class="text-center py-4 text-gray-400"><i class="fas fa-spinner fa-spin mr-2"></i>Calculating...</div>';

  var measurements = {
    total_area_sqft: parseFloat(document.getElementById('pe-test-area').value) || 3200,
    ridge_ft: parseFloat(document.getElementById('pe-test-ridge').value) || 0,
    hip_ft: parseFloat(document.getElementById('pe-test-hip').value) || 0,
    valley_ft: parseFloat(document.getElementById('pe-test-valley').value) || 0,
    eave_ft: parseFloat(document.getElementById('pe-test-eave').value) || 0,
    rake_ft: parseFloat(document.getElementById('pe-test-rake').value) || 0,
    step_flashing_ft: parseFloat(document.getElementById('pe-test-step').value) || 0,
    dominant_pitch: document.getElementById('pe-test-pitch').value || '7/12'
  };

  try {
    var resp = await saFetch('/api/invoices/pricing/calculate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ measurements: measurements, tiered: !customOnly })
    });
    var data = await resp.json();
    if (!data.success) { resultsEl.innerHTML = '<div class="text-red-500">' + (data.error || 'Calculation failed') + '</div>'; return; }

    if (data.tiered) {
      var tiers = data.tiered;
      resultsEl.innerHTML = '<div class="grid md:grid-cols-3 gap-4">' +
        renderTierCard('Good', tiers.good, 'gray', 'fa-thumbs-up') +
        renderTierCard('Better', tiers.better, 'blue', 'fa-star') +
        renderTierCard('Best', tiers.best, 'green', 'fa-crown') +
      '</div>';
    } else {
      var p = data.proposal;
      resultsEl.innerHTML = renderTierCard('Custom Estimate', p, 'indigo', 'fa-calculator');
    }

    // Store for PDF generation
    SA.data._lastTestCalc = data;
    SA.data._lastTestMeasurements = measurements;
  } catch(e) { resultsEl.innerHTML = '<div class="text-red-500">Error: ' + e.message + '</div>'; }
};

function renderTierCard(title, proposal, color, icon) {
  if (!proposal) return '';
  var items = proposal.line_items || [];
  return '<div class="bg-white border-2 border-' + color + '-200 rounded-xl overflow-hidden">' +
    '<div class="bg-' + color + '-50 px-4 py-3 border-b border-' + color + '-200">' +
      '<div class="flex items-center justify-between">' +
        '<h4 class="font-bold text-' + color + '-800"><i class="fas ' + icon + ' mr-2"></i>' + title + '</h4>' +
        '<span class="text-xl font-black text-' + color + '-700">$' + proposal.total_price.toFixed(2) + '</span>' +
      '</div>' +
      '<p class="text-xs text-' + color + '-600 mt-1">' + (proposal.metadata.preset_name || 'Custom') + '</p>' +
    '</div>' +
    '<div class="p-4">' +
      '<table class="w-full text-xs">' +
        '<tbody class="divide-y divide-gray-50">' +
        items.map(function(li) {
          return '<tr><td class="py-1 text-gray-600">' + li.item + '</td><td class="py-1 text-right font-medium text-gray-800">$' + li.price.toFixed(2) + '</td></tr>';
        }).join('') +
        '</tbody>' +
      '</table>' +
      '<div class="border-t border-gray-200 mt-3 pt-3 space-y-1">' +
        '<div class="flex justify-between text-xs"><span class="text-gray-500">Subtotal</span><span>$' + proposal.subtotal.toFixed(2) + '</span></div>' +
        '<div class="flex justify-between text-xs"><span class="text-gray-500">Tax (' + (proposal.tax_rate * 100).toFixed(1) + '%)</span><span>$' + proposal.tax_amount.toFixed(2) + '</span></div>' +
        '<div class="flex justify-between text-sm font-bold border-t pt-1 mt-1"><span>Total</span><span class="text-' + color + '-700">$' + proposal.total_price.toFixed(2) + ' CAD</span></div>' +
      '</div>' +
      '<div class="mt-3 flex gap-2">' +
        '<button onclick="downloadTierPdf(\'' + title + '\')" class="text-xs bg-' + color + '-100 text-' + color + '-700 px-3 py-1.5 rounded-lg hover:bg-' + color + '-200 font-medium"><i class="fas fa-file-pdf mr-1"></i>Download PDF</button>' +
        '<button onclick="createInvoiceFromTier(\'' + title + '\')" class="text-xs bg-green-100 text-green-700 px-3 py-1.5 rounded-lg hover:bg-green-200 font-medium"><i class="fas fa-file-invoice mr-1"></i>Create Invoice</button>' +
      '</div>' +
    '</div>' +
  '</div>';
}

window.downloadTierPdf = function(tierName) {
  var data = SA.data._lastTestCalc;
  var measurements = SA.data._lastTestMeasurements;
  if (!data) { window.rmToast('Run a calculation first', 'info'); return; }
  var proposal;
  if (data.tiered) {
    var key = tierName.toLowerCase();
    proposal = data.tiered[key];
  } else {
    proposal = data.proposal;
  }
  if (!proposal) { window.rmToast('Proposal data not found', 'info'); return; }
  if (typeof window.generateProposalPdf === 'function') {
    window.generateProposalPdf(proposal, measurements, 'Homeowner', 'Property Address');
  } else {
    window.rmToast('PDF library not loaded', 'info');
  }
};

window.createInvoiceFromTier = function(tierName) {
  var data = SA.data._lastTestCalc;
  if (!data) { window.rmToast('Run a calculation first', 'info'); return; }
  var proposal;
  if (data.tiered) {
    var key = tierName.toLowerCase();
    proposal = data.tiered[key];
  } else {
    proposal = data.proposal;
  }
  if (!proposal) return;
  // Switch to invoices view and pre-populate
  SA.data._pendingInvoiceItems = proposal.line_items;
  loadView('invoices');
  setTimeout(function() { showCreateInvoiceModal(); populateInvoiceFromProposal(); }, 500);
};

window.populateInvoiceFromProposal = function() {
  var items = SA.data._pendingInvoiceItems;
  if (!items || !items.length) return;
  var container = document.getElementById('inv-line-items');
  if (!container) return;
  container.innerHTML = '';
  items.forEach(function(li) {
    var row = document.createElement('div');
    row.className = 'inv-line-item grid grid-cols-12 gap-2 mb-2';
    row.innerHTML = '<input type="text" value="' + li.item + ' — ' + li.description + '" class="col-span-6 border border-gray-300 rounded-lg px-3 py-2 text-sm inv-desc">' +
      '<input type="number" value="' + li.qty + '" class="col-span-2 border border-gray-300 rounded-lg px-3 py-2 text-sm inv-qty">' +
      '<input type="number" step="0.01" value="' + li.unit_price + '" class="col-span-3 border border-gray-300 rounded-lg px-3 py-2 text-sm inv-price">' +
      '<button onclick="this.closest(\'.inv-line-item\').remove()" class="col-span-1 text-red-400 hover:text-red-600"><i class="fas fa-times"></i></button>';
    container.appendChild(row);
  });
  SA.data._pendingInvoiceItems = null;
};

// ============================================================
// VIEW: INVOICES DASHBOARD — Full CRUD + PDF + Gmail Send
// ============================================================
function invStatusBadge(s) {
  var m = {
    draft: 'bg-gray-100 text-gray-600', sent: 'bg-blue-100 text-blue-700',
    viewed: 'bg-indigo-100 text-indigo-700', paid: 'bg-green-100 text-green-800',
    overdue: 'bg-red-100 text-red-700', cancelled: 'bg-gray-200 text-gray-500',
    refunded: 'bg-purple-100 text-purple-700'
  };
  return '<span class="px-2 py-0.5 ' + (m[s] || 'bg-gray-100 text-gray-600') + ' rounded-full text-xs font-semibold capitalize">' + (s || 'draft') + '</span>';
}

function renderInvoicesView() {
  var d = SA.data.invoices || {};
  var stats = (SA.data.invoice_stats || {}).stats || {};
  var invoices = d.invoices || [];
  var customers = (SA.data.invoice_customers || {}).customers || [];

  return '<div class="space-y-6">' +
    '<div class="flex items-center justify-between">' +
      '<div><h2 class="text-2xl font-black text-gray-900"><i class="fas fa-file-invoice-dollar mr-2 text-green-500"></i>Invoice Manager</h2>' +
      '<p class="text-sm text-gray-500 mt-1">Create, send, and track invoices for roofing jobs</p></div>' +
      '<button onclick="showCreateInvoiceModal()" class="bg-green-600 text-white px-5 py-2.5 rounded-xl font-medium hover:bg-green-700 shadow-sm"><i class="fas fa-plus mr-2"></i>New Invoice</button>' +
    '</div>' +

    // Stats row
    '<div class="grid grid-cols-2 lg:grid-cols-5 gap-4">' +
      samc('Total Invoices', stats.total_invoices || 0, 'fa-file-invoice', 'blue') +
      samc('Paid', stats.paid_count || 0, 'fa-check-circle', 'green', '$' + ((stats.total_collected || 0)).toFixed(2) + ' collected') +
      samc('Outstanding', stats.outstanding_count || 0, 'fa-clock', 'amber', '$' + ((stats.total_outstanding || 0)).toFixed(2)) +
      samc('Overdue', stats.overdue_count || 0, 'fa-exclamation-triangle', 'red', '$' + ((stats.total_overdue || 0)).toFixed(2)) +
      samc('Grand Total', '$' + ((stats.grand_total || 0)).toFixed(2), 'fa-dollar-sign', 'indigo') +
    '</div>' +

    // Invoice Table
    saSection('Invoices (' + invoices.length + ')', 'fa-table', 
      '<div class="overflow-x-auto"><table class="w-full text-sm">' +
      '<thead class="bg-gray-50"><tr>' +
        '<th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Invoice #</th>' +
        '<th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Customer</th>' +
        '<th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Property</th>' +
        '<th class="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Total</th>' +
        '<th class="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Status</th>' +
        '<th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Due Date</th>' +
        '<th class="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Actions</th>' +
      '</tr></thead><tbody class="divide-y divide-gray-50">' +
      (invoices.length === 0 ? '<tr><td colspan="7" class="px-4 py-12 text-center text-gray-400"><i class="fas fa-file-invoice text-4xl mb-3 block"></i>No invoices yet. Create your first one!</td></tr>' : '') +
      invoices.map(function(inv) {
        return '<tr class="hover:bg-green-50/30 transition-colors">' +
          '<td class="px-4 py-3 font-mono font-bold text-gray-800 text-sm">' + (inv.invoice_number || '-') + '</td>' +
          '<td class="px-4 py-3"><div class="font-medium text-gray-800">' + (inv.customer_name || '-') + '</div><div class="text-xs text-gray-400">' + (inv.customer_email || '') + '</div></td>' +
          '<td class="px-4 py-3 text-gray-600 text-xs">' + (inv.property_address || '-') + '</td>' +
          '<td class="px-4 py-3 text-right font-bold text-gray-900">$' + parseFloat(inv.total || 0).toFixed(2) + '</td>' +
          '<td class="px-4 py-3 text-center">' + invStatusBadge(inv.status) + '</td>' +
          '<td class="px-4 py-3 text-gray-600 text-xs">' + fmtDate(inv.due_date) + '</td>' +
          '<td class="px-4 py-3 text-center">' +
            '<div class="flex items-center justify-center gap-1">' +
              '<button onclick="viewInvoiceDetail(' + inv.id + ')" class="text-blue-500 hover:text-blue-700 p-1" title="View"><i class="fas fa-eye"></i></button>' +
              '<button onclick="downloadInvoicePdf(' + inv.id + ')" class="text-green-500 hover:text-green-700 p-1" title="Download PDF"><i class="fas fa-file-pdf"></i></button>' +
              (inv.status === 'draft' ? '<button onclick="sendInvoiceGmail(' + inv.id + ')" class="text-indigo-500 hover:text-indigo-700 p-1" title="Send via Gmail"><i class="fas fa-paper-plane"></i></button>' : '') +
              (inv.status === 'sent' || inv.status === 'viewed' ? '<button onclick="markInvoicePaid(' + inv.id + ')" class="text-green-600 hover:text-green-800 p-1" title="Mark Paid"><i class="fas fa-check-double"></i></button>' : '') +
              (inv.status === 'draft' ? '<button onclick="deleteInvoice(' + inv.id + ')" class="text-red-400 hover:text-red-600 p-1" title="Delete"><i class="fas fa-trash"></i></button>' : '') +
            '</div>' +
          '</td>' +
        '</tr>';
      }).join('') +
      '</tbody></table></div>'
    ) +

    // Hidden modals container
    '<div id="inv-modal-container"></div>' +
    '<div id="inv-detail-container"></div>' +
  '</div>';
}

// ---- Create Invoice Modal ----
window.showCreateInvoiceModal = function() {
  var customers = ((SA.data.invoice_customers || {}).customers || []);
  var invoices = ((SA.data.invoices || {}).invoices || []);
  var recentCustomers = [];
  var seenIds = new Set();
  for (var ri = 0; ri < invoices.length && recentCustomers.length < 4; ri++) {
    var rinv = invoices[ri];
    if (rinv.customer_id && !seenIds.has(String(rinv.customer_id))) {
      seenIds.add(String(rinv.customer_id));
      var rc = customers.find(function(c) { return c.id == rinv.customer_id; });
      if (rc) recentCustomers.push(rc);
    }
  }
  var recentChips = recentCustomers.length > 0
    ? '<div class="flex flex-wrap gap-2 mb-2"><span class="text-xs text-gray-400 self-center">Recent:</span>' +
        recentCustomers.map(function(c) {
          return '<button type="button" onclick="invSelectCustomer(\'' + c.id + '\')" data-cid="' + c.id + '" class="inv-cust-chip px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600 hover:bg-green-100 hover:text-green-700 border border-gray-200">' +
            (c.name || c.email) + (c.company_name ? ' \xb7 ' + c.company_name : '') + '</button>';
        }).join('') + '</div>'
    : '';

  var modal = document.getElementById('inv-modal-container');
  if (!modal) return;
  modal.innerHTML = '<div class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onclick="if(event.target===this)closeInvModal()">' +
    '<div class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">' +
      '<div class="px-6 py-4 border-b border-gray-100 flex items-center justify-between">' +
        '<h3 class="font-bold text-gray-800 text-lg"><i class="fas fa-plus-circle mr-2 text-green-500"></i>Create New Invoice</h3>' +
        '<div class="flex items-center gap-3">' +
          '<div class="text-right"><div class="text-xs text-gray-400">Invoice Total</div><div id="inv-header-total" class="text-xl font-black text-green-600">$0.00</div></div>' +
          '<button onclick="closeInvModal()" class="text-gray-400 hover:text-gray-600"><i class="fas fa-times"></i></button>' +
        '</div>' +
      '</div>' +
      '<div class="p-6 space-y-4">' +

        '<div class="border border-gray-200 rounded-xl p-4">' +
          '<label class="block text-xs font-semibold text-gray-500 uppercase mb-2">Customer *</label>' +
          recentChips +
          '<div class="relative">' +
            '<div class="flex items-center gap-2 border border-gray-300 rounded-lg px-3 py-2">' +
              '<i class="fas fa-search text-xs text-gray-400"></i>' +
              '<input type="text" id="inv-customer-search" placeholder="Search customers..." autocomplete="off"' +
                ' oninput="invFilterCustomers(this.value)"' +
                ' onfocus="invFilterCustomers(this.value)"' +
                ' onblur="setTimeout(function(){var d=document.getElementById(\'inv-cust-drop\');if(d)d.style.display=\'none\';},200)"' +
                ' class="flex-1 outline-none text-sm text-gray-800 bg-transparent">' +
              '<span id="inv-cust-clear" style="display:none" onclick="invClearCustomer()" class="cursor-pointer text-gray-400 hover:text-gray-600 text-xs"><i class="fas fa-times"></i></span>' +
            '</div>' +
            '<div id="inv-cust-drop" style="display:none;position:absolute;z-index:100;width:100%;margin-top:4px;background:white;border:1px solid #e5e7eb;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.12);max-height:200px;overflow-y:auto"></div>' +
          '</div>' +
          '<div id="inv-cust-address" style="display:none" class="mt-2 text-xs text-gray-500"><i class="fas fa-map-marker-alt text-green-500 mr-1"></i><span id="inv-cust-address-text"></span></div>' +
          '<input type="hidden" id="inv-customer" value="">' +
        '</div>' +

        '<div><label class="block text-xs font-medium text-gray-500 mb-1">Due (days)</label>' +
          '<input id="inv-due-days" type="number" value="30" class="w-40 border border-gray-300 rounded-lg px-3 py-2 text-sm"></div>' +

        '<div class="border border-gray-200 rounded-xl p-4">' +
          '<h4 class="font-semibold text-gray-700 text-sm mb-3"><i class="fas fa-percent mr-1 text-green-500"></i>Tax Rates</h4>' +
          '<div class="grid grid-cols-2 gap-3">' +
            '<div><label class="block text-xs font-medium text-gray-500 mb-1">GST (%)</label>' +
              '<input id="inv-gst-rate" type="number" step="0.1" min="0" max="30" value="5" oninput="invUpdateTotals()" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"></div>' +
            '<div><label class="block text-xs font-medium text-gray-500 mb-1">PST (%)</label>' +
              '<input id="inv-pst-rate" type="number" step="0.1" min="0" max="30" value="0" oninput="invUpdateTotals()" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"></div>' +
          '</div>' +
        '</div>' +

        '<div class="border border-gray-200 rounded-xl p-4">' +
          '<h4 class="font-semibold text-gray-700 text-sm mb-3"><i class="fas fa-tag mr-1 text-green-500"></i>Discount <span class="text-xs text-gray-400 font-normal">(optional)</span></h4>' +
          '<div class="grid grid-cols-2 gap-3">' +
            '<div><label class="block text-xs font-medium text-gray-500 mb-1">Type</label>' +
              '<select id="inv-discount-type" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" onchange="toggleInvDiscountInput()">' +
                '<option value="none">No Discount</option>' +
                '<option value="fixed">Fixed Amount ($)</option>' +
                '<option value="percentage">Percentage (%)</option>' +
              '</select></div>' +
            '<div id="inv-discount-input-wrap" style="display:none"><label id="inv-discount-label" class="block text-xs font-medium text-gray-500 mb-1">Amount</label>' +
              '<input id="inv-discount-amount" type="number" step="0.01" min="0" placeholder="0.00" oninput="invUpdateTotals()" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"></div>' +
          '</div>' +
        '</div>' +

        '<div class="border border-gray-200 rounded-xl p-4">' +
          '<div class="flex items-center justify-between mb-3">' +
            '<h4 class="font-semibold text-gray-700 text-sm">Line Items</h4>' +
            '<button onclick="addInvLineItem()" class="text-xs text-green-600 hover:text-green-800 font-medium"><i class="fas fa-plus mr-1"></i>Add Item</button>' +
          '</div>' +
          '<div class="grid grid-cols-12 gap-2 mb-1 text-xs font-semibold text-gray-400 uppercase px-1">' +
            '<div class="col-span-5">Description</div><div class="col-span-2 text-center">Qty</div>' +
            '<div class="col-span-2 text-right">Price</div><div class="col-span-2 text-right">Amount</div><div class="col-span-1"></div>' +
          '</div>' +
          '<div id="inv-line-items">' +
            '<div class="inv-line-item grid grid-cols-12 gap-2 mb-2 items-center">' +
              '<input type="text" placeholder="Description" oninput="invUpdateTotals()" class="col-span-5 border border-gray-300 rounded-lg px-3 py-2 text-sm inv-desc">' +
              '<input type="number" placeholder="1" value="1" oninput="invUpdateTotals()" class="col-span-2 border border-gray-300 rounded-lg px-2 py-2 text-sm text-center inv-qty">' +
              '<input type="number" step="0.01" placeholder="0.00" oninput="invUpdateTotals()" class="col-span-2 border border-gray-300 rounded-lg px-2 py-2 text-sm text-right inv-price">' +
              '<div class="col-span-2 text-right text-sm font-medium text-gray-700 inv-amt">$0.00</div>' +
              '<button onclick="this.closest(\'.inv-line-item\').remove();invUpdateTotals()" class="col-span-1 text-red-400 hover:text-red-600 text-center"><i class="fas fa-times"></i></button>' +
            '</div>' +
          '</div>' +
          '<div class="mt-3 pt-3 border-t border-gray-100 flex justify-end">' +
            '<div class="w-56 space-y-1 text-sm">' +
              '<div class="flex justify-between text-gray-500"><span>Subtotal</span><span id="inv-sub">$0.00</span></div>' +
              '<div class="flex justify-between text-gray-500"><span id="inv-gst-label">GST (5%)</span><span id="inv-gst-amt">$0.00</span></div>' +
              '<div class="flex justify-between text-gray-500" id="inv-pst-row" style="display:none"><span id="inv-pst-label">PST (0%)</span><span id="inv-pst-amt">$0.00</span></div>' +
              '<div class="flex justify-between font-bold text-gray-900 pt-1 border-t border-gray-200"><span>Total</span><span id="inv-total-disp" class="text-green-600">$0.00</span></div>' +
            '</div>' +
          '</div>' +
        '</div>' +

        '<div><label class="block text-xs font-medium text-gray-500 mb-1">Notes <span class="font-normal text-gray-400">(visible to customer on invoice)</span></label>' +
          '<textarea id="inv-notes" rows="2" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="e.g. Thank you for your business!"></textarea></div>' +

        '<div class="bg-amber-50 border border-amber-200 rounded-lg p-3">' +
          '<p class="text-xs text-amber-700"><i class="fas fa-lightbulb mr-1"></i><strong>Tip:</strong> Use the Pricing Engine to auto-calculate line items from a roof report, then create an invoice from those results.</p>' +
        '</div>' +

        '<div id="inv-create-msg" class="hidden"></div>' +
        '<div class="flex justify-end gap-3 pt-2">' +
          '<button onclick="closeInvModal()" class="px-4 py-2 text-gray-600 hover:text-gray-800 text-sm">Cancel</button>' +
          '<button onclick="createInvoice()" class="bg-green-600 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-green-700"><i class="fas fa-save mr-2"></i>Create Invoice</button>' +
        '</div>' +
      '</div>' +
    '</div>' +
  '</div>';

  window._invCustomers = customers;
};

window.invFilterCustomers = function(term) {
  var drop = document.getElementById('inv-cust-drop');
  if (!drop) return;
  var lc = (term || '').toLowerCase();
  var list = window._invCustomers || [];
  var filtered = lc ? list.filter(function(c) {
    return (c.name||'').toLowerCase().includes(lc) || (c.email||'').toLowerCase().includes(lc) || (c.company_name||'').toLowerCase().includes(lc);
  }).slice(0, 12) : list.slice(0, 12);
  drop.style.display = 'block';
  drop.innerHTML = filtered.map(function(c) {
    return '<div onclick="invSelectCustomer(\'' + c.id + '\')" style="padding:10px 16px;cursor:pointer;border-bottom:1px solid #f3f4f6" onmouseenter="this.style.background=\'#f0fdf4\'" onmouseleave="this.style.background=\'\'">' +
      '<div style="font-size:13px;font-weight:600;color:#1f2937">' + (c.name || c.email) + '</div>' +
      (c.company_name ? '<div style="font-size:11px;color:#6b7280">' + c.company_name + '</div>' : '') +
    '</div>';
  }).join('') +
  '<div onclick="window.rmToast(\'To add a new customer, use the Customers section.\',\'info\')" style="padding:10px 16px;cursor:pointer;color:#16a34a;font-size:13px;font-weight:600;border-top:1px solid #f3f4f6" onmouseenter="this.style.background=\'#f0fdf4\'" onmouseleave="this.style.background=\'\'"><i class="fas fa-plus mr-1"></i>New Customer</div>';
};

window.invSelectCustomer = function(id) {
  var c = (window._invCustomers || []).find(function(x) { return String(x.id) === String(id); });
  if (!c) return;
  var hiddenInput = document.getElementById('inv-customer');
  if (hiddenInput) hiddenInput.value = id;
  var search = document.getElementById('inv-customer-search');
  if (search) search.value = (c.name || c.email) + (c.company_name ? ' \xb7 ' + c.company_name : '');
  var drop = document.getElementById('inv-cust-drop');
  if (drop) drop.style.display = 'none';
  var clearBtn = document.getElementById('inv-cust-clear');
  if (clearBtn) clearBtn.style.display = '';
  var addrDiv = document.getElementById('inv-cust-address');
  var addrText = document.getElementById('inv-cust-address-text');
  if (addrDiv && addrText) {
    if (c.address) { addrText.textContent = c.address; addrDiv.style.display = ''; }
    else addrDiv.style.display = 'none';
  }
  document.querySelectorAll('.inv-cust-chip').forEach(function(chip) {
    if (chip.dataset.cid === String(id)) { chip.style.background='#dcfce7'; chip.style.color='#15803d'; chip.style.borderColor='#86efac'; }
    else { chip.style.background=''; chip.style.color=''; chip.style.borderColor=''; }
  });
};

window.invClearCustomer = function() {
  var hiddenInput = document.getElementById('inv-customer');
  if (hiddenInput) hiddenInput.value = '';
  var search = document.getElementById('inv-customer-search');
  if (search) search.value = '';
  var clearBtn = document.getElementById('inv-cust-clear');
  if (clearBtn) clearBtn.style.display = 'none';
  var addrDiv = document.getElementById('inv-cust-address');
  if (addrDiv) addrDiv.style.display = 'none';
};

window.invUpdateTotals = function() {
  var sub = 0;
  document.querySelectorAll('.inv-line-item').forEach(function(row) {
    var qty = parseFloat((row.querySelector('.inv-qty')||{}).value) || 0;
    var price = parseFloat((row.querySelector('.inv-price')||{}).value) || 0;
    var amt = qty * price;
    var amtEl = row.querySelector('.inv-amt');
    if (amtEl) amtEl.textContent = '$' + amt.toFixed(2);
    sub += amt;
  });
  var gstRate = parseFloat((document.getElementById('inv-gst-rate')||{}).value) || 0;
  var pstRate = parseFloat((document.getElementById('inv-pst-rate')||{}).value) || 0;
  var discType = (document.getElementById('inv-discount-type')||{}).value || 'none';
  var discAmt = discType !== 'none' ? (parseFloat((document.getElementById('inv-discount-amount')||{}).value) || 0) : 0;
  var disc = discType === 'percentage' ? sub * discAmt / 100 : discAmt;
  var taxable = sub - disc;
  var gst = Math.round(taxable * gstRate / 100 * 100) / 100;
  var pst = Math.round(taxable * pstRate / 100 * 100) / 100;
  var total = Math.round((sub - disc + gst + pst) * 100) / 100;
  var subEl = document.getElementById('inv-sub'); if (subEl) subEl.textContent = '$' + sub.toFixed(2);
  var gstLbl = document.getElementById('inv-gst-label'); if (gstLbl) gstLbl.textContent = 'GST (' + gstRate + '%)';
  var gstAmt = document.getElementById('inv-gst-amt'); if (gstAmt) gstAmt.textContent = '$' + gst.toFixed(2);
  var pstRow = document.getElementById('inv-pst-row'); if (pstRow) pstRow.style.display = pstRate > 0 ? '' : 'none';
  var pstLbl = document.getElementById('inv-pst-label'); if (pstLbl) pstLbl.textContent = 'PST (' + pstRate + '%)';
  var pstAmt = document.getElementById('inv-pst-amt'); if (pstAmt) pstAmt.textContent = '$' + pst.toFixed(2);
  var totDisp = document.getElementById('inv-total-disp'); if (totDisp) totDisp.textContent = '$' + total.toFixed(2);
  var hdrTot = document.getElementById('inv-header-total'); if (hdrTot) hdrTot.textContent = '$' + total.toFixed(2);
};

window.addInvLineItem = function() {
  var container = document.getElementById('inv-line-items');
  if (!container) return;
  var row = document.createElement('div');
  row.className = 'inv-line-item grid grid-cols-12 gap-2 mb-2 items-center';
  row.innerHTML = '<input type="text" placeholder="Description" oninput="invUpdateTotals()" class="col-span-5 border border-gray-300 rounded-lg px-3 py-2 text-sm inv-desc">' +
    '<input type="number" placeholder="1" value="1" oninput="invUpdateTotals()" class="col-span-2 border border-gray-300 rounded-lg px-2 py-2 text-sm text-center inv-qty">' +
    '<input type="number" step="0.01" placeholder="0.00" oninput="invUpdateTotals()" class="col-span-2 border border-gray-300 rounded-lg px-2 py-2 text-sm text-right inv-price">' +
    '<div class="col-span-2 text-right text-sm font-medium text-gray-700 inv-amt">$0.00</div>' +
    '<button onclick="this.closest(\'.inv-line-item\').remove();invUpdateTotals()" class="col-span-1 text-red-400 hover:text-red-600 text-center"><i class="fas fa-times"></i></button>';
  container.appendChild(row);
};

window.closeInvModal = function() {
  var modal = document.getElementById('inv-modal-container');
  if (modal) modal.innerHTML = '';
  var detail = document.getElementById('inv-detail-container');
  if (detail) detail.innerHTML = '';
};

window.toggleInvDiscountInput = function() {
  var type = document.getElementById('inv-discount-type')?.value;
  var wrap = document.getElementById('inv-discount-input-wrap');
  var label = document.getElementById('inv-discount-label');
  if (!wrap) return;
  if (type === 'none') { wrap.style.display = 'none'; }
  else { wrap.style.display = ''; if (label) label.textContent = type === 'percentage' ? 'Percentage (%)' : 'Amount ($)'; }
};

window.createInvoice = async function() {
  var customerId = (document.getElementById('inv-customer') || {}).value;
  if (!customerId) { window.rmToast('Please select a customer', 'warning'); return; }
  var rows = document.querySelectorAll('.inv-line-item');
  var items = [];
  rows.forEach(function(r) {
    var desc = r.querySelector('.inv-desc').value.trim();
    var qty = parseFloat(r.querySelector('.inv-qty').value) || 1;
    var price = parseFloat(r.querySelector('.inv-price').value) || 0;
    if (desc && price > 0) items.push({ description: desc, quantity: qty, unit_price: price });
  });
  if (items.length === 0) { window.rmToast('Add at least one line item with a non-zero amount', 'warning'); return; }
  var gstRate = parseFloat((document.getElementById('inv-gst-rate') || {}).value) || 0;
  var pstRate = parseFloat((document.getElementById('inv-pst-rate') || {}).value) || 0;
  var taxRate = gstRate + pstRate;
  var dueDays = parseInt(document.getElementById('inv-due-days').value) || 30;
  var notes = document.getElementById('inv-notes').value;
  var discountType = (document.getElementById('inv-discount-type') || {}).value || 'none';
  var discountAmount = (discountType !== 'none') ? (parseFloat((document.getElementById('inv-discount-amount') || {}).value) || 0) : 0;

  try {
    var resp = await saFetch('/api/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer_id: parseInt(customerId), items: items, tax_rate: taxRate, due_days: dueDays, notes: notes, discount_amount: discountAmount, discount_type: discountType !== 'none' ? discountType : 'fixed' })
    });
    var data = await resp.json();
    if (data.success) {
      closeInvModal();
      loadView('invoices');
    } else {
      window.rmToast(data.error || 'Failed to create invoice', 'info');
    }
  } catch(e) { window.rmToast('Error: ' + e.message, 'error'); }
};

window.viewInvoiceDetail = async function(id) {
  try {
    var resp = await saFetch('/api/invoices/' + id);
    var data = await resp.json();
    var inv = data.invoice;
    var items = data.items || [];
    if (!inv) { window.rmToast('Invoice not found', 'info'); return; }

    var container = document.getElementById('inv-detail-container');
    if (!container) return;
    container.innerHTML = '<div class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onclick="if(event.target===this)closeInvModal()">' +
      '<div class="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">' +
        '<div class="px-6 py-4 border-b border-gray-100 flex items-center justify-between">' +
          '<h3 class="font-bold text-gray-800 text-lg"><i class="fas fa-file-invoice mr-2 text-green-500"></i>Invoice ' + inv.invoice_number + '</h3>' +
          '<div class="flex items-center gap-2">' +
            '<button onclick="downloadInvoicePdf(' + id + ')" class="text-green-600 hover:text-green-800 text-sm font-medium"><i class="fas fa-file-pdf mr-1"></i>PDF</button>' +
            '<button onclick="closeInvModal()" class="text-gray-400 hover:text-gray-600"><i class="fas fa-times text-lg"></i></button>' +
          '</div>' +
        '</div>' +
        '<div class="p-6 space-y-6">' +
          // Header info
          '<div class="grid md:grid-cols-3 gap-4">' +
            '<div><p class="text-xs text-gray-400 uppercase">Customer</p><p class="font-semibold text-gray-800">' + (inv.customer_name || '-') + '</p><p class="text-xs text-gray-500">' + (inv.customer_email || '') + '</p></div>' +
            '<div><p class="text-xs text-gray-400 uppercase">Status</p><div class="mt-1">' + invStatusBadge(inv.status) + '</div></div>' +
            '<div><p class="text-xs text-gray-400 uppercase">Due Date</p><p class="font-semibold text-gray-800">' + fmtDate(inv.due_date) + '</p></div>' +
          '</div>' +
          // Line items table
          '<div class="border border-gray-200 rounded-xl overflow-hidden">' +
            '<table class="w-full text-sm">' +
              '<thead class="bg-gray-50"><tr>' +
                '<th class="px-4 py-3 text-left text-xs font-semibold text-gray-500">Description</th>' +
                '<th class="px-4 py-3 text-center text-xs font-semibold text-gray-500">Qty</th>' +
                '<th class="px-4 py-3 text-right text-xs font-semibold text-gray-500">Unit Price</th>' +
                '<th class="px-4 py-3 text-right text-xs font-semibold text-gray-500">Amount</th>' +
              '</tr></thead><tbody class="divide-y divide-gray-50">' +
              items.map(function(it) {
                return '<tr><td class="px-4 py-3 text-gray-700">' + (it.description || '-') + '</td>' +
                  '<td class="px-4 py-3 text-center text-gray-600">' + (it.quantity || 1) + '</td>' +
                  '<td class="px-4 py-3 text-right text-gray-600">$' + parseFloat(it.unit_price || 0).toFixed(2) + '</td>' +
                  '<td class="px-4 py-3 text-right font-medium text-gray-800">$' + parseFloat(it.amount || 0).toFixed(2) + '</td></tr>';
              }).join('') +
              '</tbody>' +
            '</table>' +
            '<div class="bg-gray-50 px-4 py-3 space-y-1">' +
              '<div class="flex justify-between text-sm"><span class="text-gray-500">Subtotal</span><span class="text-gray-800">$' + parseFloat(inv.subtotal || 0).toFixed(2) + '</span></div>' +
              '<div class="flex justify-between text-sm"><span class="text-gray-500">Tax (' + parseFloat(inv.tax_rate || 5).toFixed(1) + '%)</span><span class="text-gray-800">$' + parseFloat(inv.tax_amount || 0).toFixed(2) + '</span></div>' +
              (inv.discount_amount > 0 ? (function(){ var dt=inv.discount_type||'fixed'; var dl=dt==='percentage'?'Discount ('+inv.discount_amount+'%)':'Discount'; var dd=dt==='percentage'?parseFloat(inv.subtotal||0)*parseFloat(inv.discount_amount)/100:parseFloat(inv.discount_amount); return '<div class="flex justify-between text-sm"><span class="text-gray-500">'+dl+'</span><span class="text-green-600">-$'+dd.toFixed(2)+'</span></div>'; })() : '') +
              '<div class="flex justify-between text-lg font-bold border-t border-gray-200 pt-2 mt-2"><span class="text-gray-900">Total</span><span class="text-green-700">$' + parseFloat(inv.total || 0).toFixed(2) + ' CAD</span></div>' +
            '</div>' +
          '</div>' +
          (inv.notes ? '<div class="bg-gray-50 rounded-lg p-4"><p class="text-xs text-gray-400 uppercase mb-1">Notes</p><p class="text-sm text-gray-600">' + inv.notes + '</p></div>' : '') +
          // Action buttons
          '<div class="flex gap-3 justify-end">' +
            (inv.status === 'draft' ? '<button onclick="sendInvoiceGmail(' + id + ')" class="bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700"><i class="fas fa-paper-plane mr-2"></i>Send via Gmail</button>' : '') +
            (inv.status === 'sent' || inv.status === 'viewed' ? '<button onclick="markInvoicePaid(' + id + ')" class="bg-green-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-green-700"><i class="fas fa-check-double mr-2"></i>Mark as Paid</button>' : '') +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
    // Store items for PDF generation
    SA.data._currentInvoice = inv;
    SA.data._currentInvoiceItems = items;
  } catch(e) { window.rmToast('Failed to load invoice: ' + e.message, 'error'); }
};

window.sendInvoiceGmail = async function(id) {
  if (!(await window.rmConfirm('Send this invoice to the customer via Gmail?'))) return
  try {
    var resp = await saFetch('/api/invoices/' + id + '/send-gmail', { method: 'POST' });
    var data = await resp.json();
    if (data.success) {
      window.rmToast('Invoice sent successfully to ' + (data.message || 'customer'), 'success');
      closeInvModal();
      loadView('invoices');
    } else {
      window.rmToast(data.error || 'Failed to send invoice', 'info');
    }
  } catch(e) { window.rmToast('Error: ' + e.message, 'error'); }
};

window.markInvoicePaid = async function(id) {
  if (!(await window.rmConfirm('Mark this invoice as paid?'))) return
  try {
    var resp = await saFetch('/api/invoices/' + id + '/status', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'paid' })
    });
    var data = await resp.json();
    if (data.success) {
      closeInvModal();
      loadView('invoices');
    } else {
      window.rmToast(data.error || 'Failed to update status', 'info');
    }
  } catch(e) { window.rmToast('Error: ' + e.message, 'error'); }
};

window.deleteInvoice = async function(id) {
  if (!(await window.rmConfirm('Delete this draft invoice?'))) return
  try {
    var resp = await saFetch('/api/invoices/' + id, { method: 'DELETE' });
    var data = await resp.json();
    if (data.success) {
      loadView('invoices');
    } else {
      window.rmToast(data.error || 'Failed to delete', 'info');
    }
  } catch(e) { window.rmToast('Error: ' + e.message, 'error'); }
};

// ============================================================
// CLIENT-SIDE PDF GENERATION — jsPDF + autoTable
// ============================================================
window.downloadInvoicePdf = async function(id) {
  try {
    // Fetch invoice data if not cached
    var resp = await saFetch('/api/invoices/' + id);
    var data = await resp.json();
    var inv = data.invoice;
    var items = data.items || [];
    if (!inv) { window.rmToast('Invoice not found', 'info'); return; }

    // Check jsPDF is loaded
    if (typeof window.jspdf === 'undefined') { window.rmToast('PDF library not loaded. Please refresh the page.', 'warning'); return; }
    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF();

    // Colors
    var primary = [3, 105, 161]; // sky-700
    var dark = [30, 41, 59]; // slate-800
    var gray = [100, 116, 139]; // slate-500
    var lightBg = [248, 250, 252]; // slate-50

    // Header bar
    doc.setFillColor(primary[0], primary[1], primary[2]);
    doc.rect(0, 0, 210, 38, 'F');

    // Company name
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.text('INVOICE', 15, 18);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text('#' + (inv.invoice_number || 'N/A'), 15, 26);
    doc.text('Generated by Roof Manager', 15, 32);

    // Status badge on right
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    var statusText = (inv.status || 'draft').toUpperCase();
    doc.text(statusText, 195, 20, { align: 'right' });
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text('Due: ' + (inv.due_date || 'N/A'), 195, 28, { align: 'right' });

    // Bill To / From section
    var y = 50;
    doc.setTextColor(gray[0], gray[1], gray[2]);
    doc.setFontSize(8);
    doc.text('BILL TO', 15, y);
    doc.text('INVOICE DETAILS', 120, y);
    y += 6;
    doc.setTextColor(dark[0], dark[1], dark[2]);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(inv.customer_name || 'Customer', 15, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    if (inv.customer_email) { doc.text(inv.customer_email, 15, y); y += 4; }
    if (inv.customer_phone) { doc.text(inv.customer_phone, 15, y); y += 4; }
    if (inv.customer_address) { doc.text(inv.customer_address, 15, y); y += 4; }
    if (inv.customer_city) { doc.text(inv.customer_city + ', ' + (inv.customer_province || '') + ' ' + (inv.customer_postal || ''), 15, y); }

    // Invoice details on right
    var dy = 56;
    doc.setFontSize(9);
    doc.setTextColor(gray[0], gray[1], gray[2]);
    doc.text('Invoice Date:', 120, dy); doc.setTextColor(dark[0], dark[1], dark[2]); doc.text(fmtDate(inv.created_at), 155, dy); dy += 5;
    doc.setTextColor(gray[0], gray[1], gray[2]);
    doc.text('Due Date:', 120, dy); doc.setTextColor(dark[0], dark[1], dark[2]); doc.text(fmtDate(inv.due_date), 155, dy); dy += 5;
    doc.setTextColor(gray[0], gray[1], gray[2]);
    doc.text('Tax Rate:', 120, dy); doc.setTextColor(dark[0], dark[1], dark[2]); doc.text((inv.tax_rate || 5) + '%', 155, dy); dy += 5;
    if (inv.property_address) {
      doc.setTextColor(gray[0], gray[1], gray[2]);
      doc.text('Property:', 120, dy); doc.setTextColor(dark[0], dark[1], dark[2]); doc.text(inv.property_address, 155, dy);
    }

    // Line items table using autoTable
    var tableBody = items.map(function(it) {
      return [
        it.description || '-',
        (it.quantity || 1).toString(),
        '$' + parseFloat(it.unit_price || 0).toFixed(2),
        '$' + parseFloat(it.amount || 0).toFixed(2)
      ];
    });

    doc.autoTable({
      startY: 90,
      head: [['Description', 'Qty', 'Unit Price', 'Amount']],
      body: tableBody,
      theme: 'striped',
      headStyles: { fillColor: primary, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9 },
      bodyStyles: { fontSize: 9, textColor: dark },
      alternateRowStyles: { fillColor: lightBg },
      columnStyles: {
        0: { cellWidth: 90 },
        1: { halign: 'center', cellWidth: 25 },
        2: { halign: 'right', cellWidth: 35 },
        3: { halign: 'right', cellWidth: 35 }
      },
      margin: { left: 15, right: 15 }
    });

    // Totals section below table
    var finalY = doc.lastAutoTable.finalY + 10;
    var totalsX = 130;
    doc.setFontSize(10);
    doc.setTextColor(gray[0], gray[1], gray[2]);
    doc.text('Subtotal:', totalsX, finalY);
    doc.setTextColor(dark[0], dark[1], dark[2]);
    doc.text('$' + parseFloat(inv.subtotal || 0).toFixed(2), 195, finalY, { align: 'right' });
    finalY += 6;

    doc.setTextColor(gray[0], gray[1], gray[2]);
    doc.text('Tax (' + (inv.tax_rate || 5) + '% GST):', totalsX, finalY);
    doc.setTextColor(dark[0], dark[1], dark[2]);
    doc.text('$' + parseFloat(inv.tax_amount || 0).toFixed(2), 195, finalY, { align: 'right' });
    finalY += 6;

    if (inv.discount_amount > 0) {
      var pdfDiscType = inv.discount_type || 'fixed';
      var pdfDiscDollar = pdfDiscType === 'percentage' ? parseFloat(inv.subtotal || 0) * parseFloat(inv.discount_amount) / 100 : parseFloat(inv.discount_amount);
      var pdfDiscLabel = pdfDiscType === 'percentage' ? 'Discount (' + inv.discount_amount + '%):' : 'Discount:';
      doc.setTextColor(22, 163, 74);
      doc.text(pdfDiscLabel, totalsX, finalY);
      doc.text('-$' + pdfDiscDollar.toFixed(2), 195, finalY, { align: 'right' });
      finalY += 6;
    }

    // Total line
    doc.setDrawColor(primary[0], primary[1], primary[2]);
    doc.setLineWidth(0.5);
    doc.line(totalsX, finalY - 2, 195, finalY - 2);
    finalY += 3;
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(primary[0], primary[1], primary[2]);
    doc.text('Total Due:', totalsX, finalY);
    doc.text('$' + parseFloat(inv.total || 0).toFixed(2) + ' CAD', 195, finalY, { align: 'right' });

    // Notes
    if (inv.notes) {
      finalY += 15;
      doc.setFontSize(8);
      doc.setTextColor(gray[0], gray[1], gray[2]);
      doc.text('NOTES', 15, finalY);
      finalY += 5;
      doc.setFontSize(9);
      doc.setTextColor(dark[0], dark[1], dark[2]);
      var noteLines = doc.splitTextToSize(inv.notes, 180);
      doc.text(noteLines, 15, finalY);
    }

    // Terms
    finalY += 15;
    doc.setFillColor(lightBg[0], lightBg[1], lightBg[2]);
    doc.rect(15, finalY - 3, 180, 18, 'F');
    doc.setFontSize(8);
    doc.setTextColor(gray[0], gray[1], gray[2]);
    doc.text('TERMS & CONDITIONS', 20, finalY + 2);
    doc.setFontSize(8);
    doc.setTextColor(dark[0], dark[1], dark[2]);
    doc.text(inv.terms || 'Payment due within 30 days of invoice date. All amounts in Canadian Dollars (CAD).', 20, finalY + 8);

    // Footer
    doc.setFontSize(7);
    doc.setTextColor(gray[0], gray[1], gray[2]);
    doc.text('Powered by Roof Manager — www.roofmanager.ca', 105, 285, { align: 'center' });

    // Save
    doc.save('Invoice_' + (inv.invoice_number || id) + '.pdf');
  } catch(e) {
    window.rmToast('PDF generation failed: ' + e.message, 'error');
    console.error('PDF Error:', e);
  }
};

// ============================================================
// PROPOSAL PDF — Generate from pricing engine results
// ============================================================
window.generateProposalPdf = function(proposal, measurements, customerName, propertyAddress) {
  if (typeof window.jspdf === 'undefined') { window.rmToast('PDF library not loaded', 'info'); return; }
  var jsPDF = window.jspdf.jsPDF;
  var doc = new jsPDF();

  var primary = [3, 105, 161];
  var dark = [30, 41, 59];
  var gray = [100, 116, 139];

  // Header
  doc.setFillColor(primary[0], primary[1], primary[2]);
  doc.rect(0, 0, 210, 38, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.text('ROOFING PROPOSAL', 15, 18);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(proposal.metadata.preset_name || 'Custom Estimate', 15, 26);
  doc.text(new Date().toLocaleDateString('en-CA'), 15, 32);

  // Customer info
  var y = 50;
  doc.setTextColor(gray[0], gray[1], gray[2]);
  doc.setFontSize(8);
  doc.text('PREPARED FOR', 15, y);
  y += 6;
  doc.setTextColor(dark[0], dark[1], dark[2]);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text(customerName || 'Homeowner', 15, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  if (propertyAddress) doc.text(propertyAddress, 15, y);

  // Measurements summary
  y = 50;
  doc.setTextColor(gray[0], gray[1], gray[2]);
  doc.setFontSize(8);
  doc.text('ROOF MEASUREMENTS', 120, y);
  y += 6;
  doc.setFontSize(9);
  doc.setTextColor(dark[0], dark[1], dark[2]);
  doc.text('Total Area: ' + (measurements.total_area_sqft || 0).toLocaleString() + ' sq ft', 120, y); y += 5;
  doc.text('Waste Factor: ' + (proposal.waste_factor_pct || 15) + '%', 120, y); y += 5;
  doc.text('Gross Squares: ' + (proposal.gross_squares || 0).toFixed(1), 120, y); y += 5;
  if (measurements.dominant_pitch) doc.text('Dominant Pitch: ' + measurements.dominant_pitch, 120, y);

  // Line items
  var tableBody = proposal.line_items.map(function(li) {
    return [li.item, li.description, li.qty.toString() + ' ' + li.unit, '$' + li.unit_price.toFixed(2), '$' + li.price.toFixed(2)];
  });

  doc.autoTable({
    startY: 85,
    head: [['Item', 'Description', 'Qty', 'Unit Price', 'Total']],
    body: tableBody,
    theme: 'striped',
    headStyles: { fillColor: primary, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    bodyStyles: { fontSize: 8, textColor: dark },
    columnStyles: { 0: { cellWidth: 35, fontStyle: 'bold' }, 1: { cellWidth: 55 }, 3: { halign: 'right' }, 4: { halign: 'right' } },
    margin: { left: 15, right: 15 }
  });

  // Totals
  var finalY = doc.lastAutoTable.finalY + 8;
  doc.setFontSize(10);
  doc.setTextColor(gray[0], gray[1], gray[2]);
  doc.text('Subtotal:', 135, finalY); doc.setTextColor(dark[0], dark[1], dark[2]); doc.text('$' + proposal.subtotal.toFixed(2), 195, finalY, { align: 'right' }); finalY += 6;
  doc.setTextColor(gray[0], gray[1], gray[2]);
  doc.text('Tax (' + (proposal.tax_rate * 100).toFixed(1) + '%):', 135, finalY); doc.setTextColor(dark[0], dark[1], dark[2]); doc.text('$' + proposal.tax_amount.toFixed(2), 195, finalY, { align: 'right' }); finalY += 8;

  doc.setDrawColor(primary[0], primary[1], primary[2]);
  doc.line(135, finalY - 3, 195, finalY - 3);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(primary[0], primary[1], primary[2]);
  doc.text('Total Estimate:', 135, finalY + 2);
  doc.text('$' + proposal.total_price.toFixed(2) + ' CAD', 195, finalY + 2, { align: 'right' });

  // Footer
  doc.setFontSize(7);
  doc.setTextColor(gray[0], gray[1], gray[2]);
  doc.text('This is an estimate only. Final costs may vary. Valid for 30 days.', 105, 275, { align: 'center' });
  doc.text('Powered by Roof Manager — ' + proposal.metadata.engine_version, 105, 280, { align: 'center' });

  doc.save('Proposal_' + (proposal.metadata.preset_name || 'Custom').replace(/[^a-zA-Z0-9]/g, '_') + '.pdf');
};

// ============================================================
// VIEW: TELEPHONY / LIVEKIT — Call Forwarding + Number Purchase
// ============================================================
function renderTelephonyView() {
  var d = SA.data.telephony || {};

  return '<div class="space-y-6">' +
    '<div class="flex items-center justify-between">' +
      '<div><h2 class="text-2xl font-black text-gray-900"><i class="fas fa-phone-alt mr-2 text-indigo-500"></i>Telephony & LiveKit</h2>' +
      '<p class="text-sm text-gray-500 mt-1">Number management, call forwarding, and LiveKit SIP integration</p></div>' +
    '</div>' +

    // Status cards
    '<div class="grid grid-cols-2 lg:grid-cols-4 gap-4">' +
      samc('LiveKit Status', d.livekit_configured ? 'Connected' : 'Not Set', 'fa-plug', d.livekit_configured ? 'green' : 'red') +
      samc('SIP Trunks', d.sip_trunk_count || 0, 'fa-phone-volume', 'blue') +
      samc('Phone Numbers', d.phone_numbers_count || 0, 'fa-hashtag', 'indigo') +
      samc('Active Forwards', d.active_forwards || 0, 'fa-exchange-alt', 'amber') +
    '</div>' +

    // LiveKit Configuration
    saSection('LiveKit Configuration', 'fa-cog',
      '<div class="space-y-4">' +
        '<div class="grid md:grid-cols-2 gap-4">' +
          '<div><label class="block text-xs font-medium text-gray-500 mb-1">LiveKit Server URL</label>' +
            '<input id="tel-lk-url" type="text" value="' + (d.livekit_url || '') + '" placeholder="wss://your-livekit.livekit.cloud" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"></div>' +
          '<div><label class="block text-xs font-medium text-gray-500 mb-1">LiveKit API Key</label>' +
            '<input id="tel-lk-key" type="text" value="' + (d.livekit_api_key ? '••••••••' : '') + '" placeholder="APIxxxxxxxxxx" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"></div>' +
        '</div>' +
        '<div class="grid md:grid-cols-2 gap-4">' +
          '<div><label class="block text-xs font-medium text-gray-500 mb-1">LiveKit API Secret</label>' +
            '<input id="tel-lk-secret" type="password" value="' + (d.livekit_api_secret ? '••••••••' : '') + '" placeholder="Secret key" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"></div>' +
          '<div><label class="block text-xs font-medium text-gray-500 mb-1">SIP Trunk Provider</label>' +
            '<select id="tel-sip-provider" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">' +
              '<option value="twilio"' + (d.sip_provider === 'twilio' ? ' selected' : '') + '>Twilio</option>' +
              '<option value="telnyx"' + (d.sip_provider === 'telnyx' ? ' selected' : '') + '>Telnyx</option>' +
              '<option value="vonage"' + (d.sip_provider === 'vonage' ? ' selected' : '') + '>Vonage</option>' +
              '<option value="telus"' + (d.sip_provider === 'telus' ? ' selected' : '') + '>TELUS Mobility</option>' +
            '</select></div>' +
        '</div>' +
        '<div id="tel-lk-msg" class="hidden"></div>' +
        '<button onclick="saveLivekitConfig()" class="bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700"><i class="fas fa-save mr-2"></i>Save LiveKit Config</button>' +
      '</div>'
    ) +

    // Phone Number Management
    saSection('Phone Number Management', 'fa-phone',
      '<div class="space-y-4">' +
        '<div class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">' +
          '<p class="text-sm text-blue-800"><i class="fas fa-info-circle mr-2"></i><strong>How it works:</strong> Purchase a phone number through your SIP provider (Twilio/Telnyx), then configure call forwarding to route calls through LiveKit AI agents.</p>' +
        '</div>' +
        '<div class="grid md:grid-cols-3 gap-4">' +
          '<div><label class="block text-xs font-medium text-gray-500 mb-1">Area Code / Region</label>' +
            '<input id="tel-area-code" type="text" placeholder="403, 587, 780..." class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"></div>' +
          '<div><label class="block text-xs font-medium text-gray-500 mb-1">Number Type</label>' +
            '<select id="tel-num-type" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">' +
              '<option value="local">Local</option>' +
              '<option value="toll-free">Toll-Free</option>' +
            '</select></div>' +
          '<div class="flex items-end"><button onclick="searchAvailableNumbers()" class="w-full bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"><i class="fas fa-search mr-2"></i>Search Numbers</button></div>' +
        '</div>' +
        '<div id="tel-search-results" class="hidden"></div>' +
        // Existing numbers
        '<div id="tel-existing-numbers" class="border-t border-gray-200 pt-4 mt-4">' +
          '<h4 class="font-semibold text-gray-700 text-sm mb-3">Your Phone Numbers</h4>' +
          (d.phone_numbers && d.phone_numbers.length > 0 ?
            '<div class="space-y-2">' +
              d.phone_numbers.map(function(pn) {
                return '<div class="flex items-center justify-between bg-white border border-gray-200 rounded-lg px-4 py-3">' +
                  '<div class="flex items-center gap-3">' +
                    '<i class="fas fa-phone text-indigo-500"></i>' +
                    '<div><p class="font-mono font-bold text-gray-800">' + pn.number + '</p><p class="text-xs text-gray-400">' + (pn.label || pn.type || 'Local') + '</p></div>' +
                  '</div>' +
                  '<div class="flex items-center gap-2">' +
                    '<span class="px-2 py-0.5 rounded-full text-xs font-medium ' + (pn.forwarding_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500') + '">' + (pn.forwarding_active ? 'Forwarding Active' : 'No Forward') + '</span>' +
                    '<button onclick="configureForwarding(\'' + pn.number + '\')" class="text-indigo-500 hover:text-indigo-700 text-sm"><i class="fas fa-cog"></i></button>' +
                  '</div>' +
                '</div>';
              }).join('') +
            '</div>'
          : '<p class="text-gray-400 text-sm">No phone numbers configured yet. Search and purchase one above, or enter your existing number below.</p>') +
        '</div>' +
      '</div>'
    ) +

    // Call Forwarding Setup
    saSection('Call Forwarding Configuration', 'fa-exchange-alt',
      '<div class="space-y-4">' +
        '<p class="text-sm text-gray-600">Route incoming calls from your business number to the LiveKit AI agent. The AI will answer, qualify leads, and book appointments.</p>' +
        '<div class="grid md:grid-cols-2 gap-4">' +
          '<div><label class="block text-xs font-medium text-gray-500 mb-1">Your Business Number</label>' +
            '<input id="tel-biz-number" type="tel" value="' + (d.business_number || '') + '" placeholder="+1 (403) 555-1234" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"></div>' +
          '<div><label class="block text-xs font-medium text-gray-500 mb-1">Forward To (LiveKit SIP)</label>' +
            '<input id="tel-fwd-number" type="tel" value="' + (d.forward_to_number || '') + '" placeholder="SIP number from LiveKit" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"></div>' +
        '</div>' +
        '<div class="grid md:grid-cols-2 gap-4">' +
          '<div><label class="block text-xs font-medium text-gray-500 mb-1">Forwarding Mode</label>' +
            '<select id="tel-fwd-mode" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">' +
              '<option value="always"' + (d.forwarding_mode === 'always' ? ' selected' : '') + '>Always Forward</option>' +
              '<option value="no-answer"' + (d.forwarding_mode === 'no-answer' ? ' selected' : '') + '>Forward on No Answer (after 15s)</option>' +
              '<option value="busy"' + (d.forwarding_mode === 'busy' ? ' selected' : '') + '>Forward When Busy</option>' +
              '<option value="after-hours"' + (d.forwarding_mode === 'after-hours' ? ' selected' : '') + '>After Hours Only</option>' +
            '</select></div>' +
          '<div><label class="block text-xs font-medium text-gray-500 mb-1">After-Hours Window</label>' +
            '<div class="flex gap-2">' +
              '<input id="tel-hrs-start" type="time" value="' + (d.business_hours_start || '08:00') + '" class="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm">' +
              '<span class="self-center text-gray-400 text-sm">to</span>' +
              '<input id="tel-hrs-end" type="time" value="' + (d.business_hours_end || '17:00') + '" class="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm">' +
            '</div></div>' +
        '</div>' +

        // Provider-specific instructions
        '<div class="bg-amber-50 border border-amber-200 rounded-xl p-4">' +
          '<h4 class="font-semibold text-amber-800 text-sm mb-2"><i class="fas fa-lightbulb mr-2"></i>Setup Instructions by Provider</h4>' +
          '<div class="grid md:grid-cols-2 gap-4 text-xs text-amber-900">' +
            '<div><p class="font-bold mb-1">TELUS Mobility:</p>' +
              '<p>1. Dial *73 to enable call forwarding</p>' +
              '<p>2. Enter the SIP number shown above</p>' +
              '<p>3. Hang up — forwarding is now active</p>' +
              '<p>4. To cancel: Dial *73 again</p></div>' +
            '<div><p class="font-bold mb-1">Twilio / Telnyx (API-based):</p>' +
              '<p>1. Click "Save Forwarding Config" below</p>' +
              '<p>2. We\'ll auto-configure via API</p>' +
              '<p>3. Test with a call to your number</p>' +
              '<p>4. Calls route to LiveKit → AI answers</p></div>' +
          '</div>' +
        '</div>' +

        '<div id="tel-fwd-msg" class="hidden"></div>' +
        '<div class="flex gap-3">' +
          '<button onclick="saveForwardingConfig()" class="bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700"><i class="fas fa-save mr-2"></i>Save Forwarding Config</button>' +
          '<button onclick="testForwarding()" class="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm hover:bg-gray-300"><i class="fas fa-phone mr-2"></i>Test Call</button>' +
        '</div>' +
      '</div>'
    ) +

    // LiveKit SIP Trunk Setup
    saSection('LiveKit SIP Trunk Configuration', 'fa-server',
      '<div class="space-y-4">' +
        '<p class="text-sm text-gray-600">Configure the SIP trunk that connects your phone numbers to LiveKit rooms for AI-powered call handling.</p>' +
        '<div class="grid md:grid-cols-2 gap-4">' +
          '<div><label class="block text-xs font-medium text-gray-500 mb-1">SIP Trunk Name</label>' +
            '<input id="tel-trunk-name" type="text" value="' + (d.sip_trunk_name || 'Roof Manager-Inbound') + '" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"></div>' +
          '<div><label class="block text-xs font-medium text-gray-500 mb-1">Inbound Number (E.164)</label>' +
            '<input id="tel-trunk-number" type="text" value="' + (d.sip_trunk_number || '') + '" placeholder="+14035551234" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"></div>' +
        '</div>' +
        '<div class="grid md:grid-cols-2 gap-4">' +
          '<div><label class="block text-xs font-medium text-gray-500 mb-1">SIP Server Host (from provider)</label>' +
            '<input id="tel-sip-host" type="text" value="' + (d.sip_server_host || '') + '" placeholder="sip.twilio.com" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"></div>' +
          '<div><label class="block text-xs font-medium text-gray-500 mb-1">SIP Username (optional)</label>' +
            '<input id="tel-sip-user" type="text" value="' + (d.sip_username || '') + '" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"></div>' +
        '</div>' +
        '<div><label class="block text-xs font-medium text-gray-500 mb-1">SIP Password (optional)</label>' +
          '<input id="tel-sip-pass" type="password" value="' + (d.sip_password ? '••••••••' : '') + '" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono max-w-md"></div>' +
        '<div id="tel-trunk-msg" class="hidden"></div>' +
        '<div class="flex gap-3">' +
          '<button onclick="saveSipTrunkConfig()" class="bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700"><i class="fas fa-save mr-2"></i>Save SIP Trunk</button>' +
          '<button onclick="testSipConnection()" class="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm hover:bg-gray-300"><i class="fas fa-plug mr-2"></i>Test Connection</button>' +
        '</div>' +
      '</div>'
    ) +

  '</div>';
}

// ---- Telephony Functions ----
window.saveLivekitConfig = async function() {
  var msg = document.getElementById('tel-lk-msg');
  var url = document.getElementById('tel-lk-url').value.trim();
  var key = document.getElementById('tel-lk-key').value.trim();
  var secret = document.getElementById('tel-lk-secret').value.trim();
  var provider = document.getElementById('tel-sip-provider').value;

  if (!url) { showTelMsg(msg, 'error', 'LiveKit URL is required'); return; }

  try {
    var resp = await saFetch('/api/admin/superadmin/telephony-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        livekit_url: url,
        livekit_api_key: key.includes('•') ? undefined : key,
        livekit_api_secret: secret.includes('•') ? undefined : secret,
        sip_provider: provider
      })
    });
    var data = await resp.json();
    showTelMsg(msg, data.success ? 'success' : 'error', data.success ? 'LiveKit config saved!' : (data.error || 'Save failed'));
  } catch(e) { showTelMsg(msg, 'error', 'Error: ' + e.message); }
};

window.saveForwardingConfig = async function() {
  var msg = document.getElementById('tel-fwd-msg');
  try {
    var resp = await saFetch('/api/admin/superadmin/telephony-forwarding', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        business_number: document.getElementById('tel-biz-number').value.trim(),
        forward_to_number: document.getElementById('tel-fwd-number').value.trim(),
        forwarding_mode: document.getElementById('tel-fwd-mode').value,
        business_hours_start: document.getElementById('tel-hrs-start').value,
        business_hours_end: document.getElementById('tel-hrs-end').value
      })
    });
    var data = await resp.json();
    showTelMsg(msg, data.success ? 'success' : 'error', data.success ? 'Forwarding config saved! ' + (data.api_configured ? 'API-based forwarding is now active.' : 'Manual setup required — see provider instructions above.') : (data.error || 'Save failed'));
  } catch(e) { showTelMsg(msg, 'error', 'Error: ' + e.message); }
};

window.saveSipTrunkConfig = async function() {
  var msg = document.getElementById('tel-trunk-msg');
  try {
    var resp = await saFetch('/api/admin/superadmin/telephony-sip-trunk', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sip_trunk_name: document.getElementById('tel-trunk-name').value.trim(),
        sip_trunk_number: document.getElementById('tel-trunk-number').value.trim(),
        sip_server_host: document.getElementById('tel-sip-host').value.trim(),
        sip_username: document.getElementById('tel-sip-user').value.trim(),
        sip_password: document.getElementById('tel-sip-pass').value.includes('•') ? undefined : document.getElementById('tel-sip-pass').value.trim()
      })
    });
    var data = await resp.json();
    showTelMsg(msg, data.success ? 'success' : 'error', data.success ? 'SIP trunk config saved!' : (data.error || 'Save failed'));
  } catch(e) { showTelMsg(msg, 'error', 'Error: ' + e.message); }
};

window.searchAvailableNumbers = async function() {
  var container = document.getElementById('tel-search-results');
  if (!container) return;
  container.className = '';
  container.innerHTML = '<div class="py-4 text-center text-gray-400"><i class="fas fa-spinner fa-spin mr-2"></i>Searching available numbers...</div>';
  var areaCode = document.getElementById('tel-area-code').value.trim();
  var numType = document.getElementById('tel-num-type').value;
  try {
    var resp = await saFetch('/api/admin/superadmin/telephony-search-numbers?area_code=' + encodeURIComponent(areaCode) + '&type=' + numType);
    var data = await resp.json();
    var numbers = data.numbers || [];
    if (numbers.length === 0) {
      container.innerHTML = '<div class="py-4 text-center text-gray-400">No numbers found for area code ' + areaCode + '. Try a different code.</div>';
      return;
    }
    container.innerHTML = '<div class="space-y-2 mt-3">' +
      numbers.map(function(n) {
        return '<div class="flex items-center justify-between bg-white border border-gray-200 rounded-lg px-4 py-2">' +
          '<span class="font-mono font-bold text-gray-800">' + n.number + '</span>' +
          '<div class="flex items-center gap-2">' +
            '<span class="text-xs text-gray-500">' + (n.monthly_cost ? '$' + n.monthly_cost + '/mo' : '') + '</span>' +
            '<button onclick="purchaseNumber(\'' + n.number + '\')" class="bg-green-600 text-white px-3 py-1 rounded-lg text-xs font-medium hover:bg-green-700"><i class="fas fa-cart-plus mr-1"></i>Purchase</button>' +
          '</div>' +
        '</div>';
      }).join('') +
    '</div>';
  } catch(e) { container.innerHTML = '<div class="text-red-500 text-sm">Search failed: ' + e.message + '</div>'; }
};

window.purchaseNumber = async function(number) {
  if (!(await window.rmConfirm('Purchase ' + number + '? Monthly charges will apply from your SIP provider.'))) return
  try {
    var resp = await saFetch('/api/admin/superadmin/telephony-purchase-number', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: number })
    });
    var data = await resp.json();
    if (data.success) {
      window.rmToast('Number ' + number + ' purchased! It will appear in your phone numbers list.', 'info');
      loadView('telephony');
    } else {
      window.rmToast(data.error || 'Purchase failed', 'info');
    }
  } catch(e) { window.rmToast('Error: ' + e.message, 'error'); }
};

window.configureForwarding = function(number) {
  document.getElementById('tel-biz-number').value = number;
  document.getElementById('tel-biz-number').scrollIntoView({ behavior: 'smooth', block: 'center' });
};

window.testForwarding = async function() {
  window.rmToast('Test call initiated. Your LiveKit AI agent should answer within 5 seconds. Check the Call Center logs for results.', 'info');
};

window.testSipConnection = async function() {
  try {
    var resp = await saFetch('/api/admin/superadmin/telephony-sip-test', { method: 'POST' });
    var data = await resp.json();
    var msg = document.getElementById('tel-trunk-msg');
    showTelMsg(msg, data.success ? 'success' : 'error', data.success ? 'SIP connection test passed!' : (data.error || 'Connection test failed'));
  } catch(e) { window.rmToast('Test failed: ' + e.message, 'error'); }
};

function showTelMsg(el, type, text) {
  if (!el) return;
  el.className = 'text-sm px-4 py-3 rounded-lg ' + (type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-teal-200');
  el.innerHTML = '<i class="fas ' + (type === 'success' ? 'fa-check-circle' : 'fa-times-circle') + ' mr-2"></i>' + text;
}

// ============================================================
// VIEW: PAYWALL / APP STORE READINESS
// ============================================================
function renderPaywallView() {
  return `
  <div class="space-y-6">
    <h2 class="text-xl font-bold text-gray-800"><i class="fas fa-shield-alt mr-2 text-indigo-500"></i>Paywall & App Store Readiness</h2>
    <div id="paywall-content" class="text-center py-12 text-gray-400"><i class="fas fa-spinner fa-spin text-2xl"></i><p class="mt-2">Checking readiness...</p></div>
  </div>`;
}

async function loadPaywallStatus() {
  try {
    var resp = await saFetch('/api/admin/superadmin/paywall-status');
    var d = await resp.json();
    var el = document.getElementById('paywall-content');
    if (!el) return;

    var checkIcon = function(ok) { return ok ? '<i class="fas fa-check-circle text-green-500"></i>' : '<i class="fas fa-times-circle text-teal-400"></i>'; };

    el.innerHTML = `
    <div class="grid md:grid-cols-3 gap-6 mb-6">
      <div class="bg-white border border-gray-200 rounded-xl p-6">
        <h3 class="font-bold text-gray-800 mb-3"><i class="fas fa-credit-card mr-2 text-blue-500"></i>Payment Gateway</h3>
        <ul class="space-y-2 text-sm">
          <li class="flex items-center gap-2">${checkIcon(d.payment_gateway.square_configured)} Square</li>
        </ul>
      </div>
      <div class="bg-white border border-gray-200 rounded-xl p-6">
        <h3 class="font-bold text-gray-800 mb-3"><i class="fas fa-tags mr-2 text-green-500"></i>Subscription Model</h3>
        <ul class="space-y-2 text-sm">
          <li class="flex items-center gap-2">${checkIcon(d.subscription_model.has_pricing)} Pricing Set${d.subscription_model.monthly_price_cents ? ' ($' + (d.subscription_model.monthly_price_cents / 100).toFixed(2) + '/mo)' : ''}</li>
          <li class="flex items-center gap-2">${checkIcon(d.subscription_model.has_credit_packages)} Credit Packages</li>
        </ul>
      </div>
      <div class="bg-white border border-gray-200 rounded-xl p-6">
        <h3 class="font-bold text-gray-800 mb-3"><i class="fas fa-mobile-alt mr-2 text-indigo-500"></i>App Store</h3>
        <ul class="space-y-2 text-sm">
          <li class="flex items-center gap-2">${checkIcon(d.app_store_requirements.user_auth_system)} User Auth</li>
          <li class="flex items-center gap-2">${checkIcon(d.app_store_requirements.free_trial_enabled)} Free Trial</li>
          <li class="flex items-center gap-2">${checkIcon(d.app_store_requirements.terms_of_service)} Terms of Service</li>
          <li class="flex items-center gap-2">${checkIcon(d.app_store_requirements.privacy_policy)} Privacy Policy</li>
          <li class="flex items-center gap-2">${checkIcon(d.app_store_requirements.app_store_listing)} App Store Listing</li>
        </ul>
      </div>
    </div>
    <div class="bg-${d.overall_ready ? 'green' : 'amber'}-50 border border-${d.overall_ready ? 'green' : 'amber'}-200 rounded-xl p-6">
      <h3 class="font-bold text-gray-800 mb-2">${d.overall_ready ? '<i class="fas fa-rocket mr-2 text-green-600"></i>Ready for Launch!' : '<i class="fas fa-exclamation-triangle mr-2 text-amber-600"></i>Missing Requirements'}</h3>
      ${d.missing_for_launch.length > 0 ? '<ul class="text-sm text-gray-600 space-y-1 list-disc list-inside">' + d.missing_for_launch.map(function(m) { return '<li>' + m + '</li>'; }).join('') + '</ul>' : '<p class="text-sm text-green-700">All checks passed. You are ready to submit to the App Store.</p>'}
    </div>`;
  } catch (e) {
    var el = document.getElementById('paywall-content');
    if (el) el.innerHTML = '<div class="text-red-500">Failed to load paywall status</div>';
  }
}

// ============================================================
// REVENUE PIPELINE — Conversion funnel & deal analytics
// ============================================================
function renderRevenuePipelineView() {
  return `
    <div class="mb-6">
      <h2 class="text-2xl font-black text-gray-900"><i class="fas fa-funnel-dollar mr-2 text-green-500"></i>Revenue Pipeline</h2>
      <p class="text-sm text-gray-500 mt-1">Track proposals through acceptance, invoicing, and payment</p>
    </div>
    <div id="pipeline-content">
      <div class="flex items-center justify-center py-12">
        <div class="w-8 h-8 border-4 border-green-200 border-t-green-600 rounded-full animate-spin"></div>
        <span class="ml-3 text-gray-500">Loading pipeline data...</span>
      </div>
    </div>`;
}

async function loadRevenuePipeline() {
  try {
    const res = await saFetch('/api/crm/analytics/pipeline');
    if (!res) return;
    const d = await res.json();
    const el = document.getElementById('pipeline-content');
    if (!el) return;

    const stages = d.stages || [];
    const p = d.proposals || {};
    const inv = d.invoices || {};
    const convRate = d.conversion_rate || 0;
    const avgDeal = d.avg_deal_size || 0;

    // Funnel visualization
    const stageNames = { lead: 'Leads', proposal_sent: 'Sent', proposal_viewed: 'Viewed', proposal_accepted: 'Accepted', invoice_sent: 'Invoiced', invoice_paid: 'Paid' };
    const stageColors = { lead: 'blue', proposal_sent: 'sky', proposal_viewed: 'yellow', proposal_accepted: 'green', invoice_sent: 'purple', invoice_paid: 'emerald' };
    const stageIcons = { lead: 'fa-user-plus', proposal_sent: 'fa-paper-plane', proposal_viewed: 'fa-eye', proposal_accepted: 'fa-check-circle', invoice_sent: 'fa-file-invoice', invoice_paid: 'fa-money-bill-wave' };

    let funnelHtml = '<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">';
    const allStages = ['lead', 'proposal_sent', 'proposal_viewed', 'proposal_accepted', 'invoice_sent', 'invoice_paid'];
    for (const stg of allStages) {
      const data = stages.find(function(s) { return s.stage === stg; }) || { count: 0, total_amount: 0 };
      const col = stageColors[stg] || 'gray';
      funnelHtml += '<div class="bg-white border border-gray-200 rounded-xl p-4 text-center hover:shadow-md transition-shadow">' +
        '<i class="fas ' + (stageIcons[stg] || 'fa-circle') + ' text-2xl text-' + col + '-500 mb-2"></i>' +
        '<p class="text-2xl font-black text-gray-800">' + (data.count || 0) + '</p>' +
        '<p class="text-xs text-gray-500">' + (stageNames[stg] || stg) + '</p>' +
        '<p class="text-xs font-bold text-' + col + '-600 mt-1">$' + parseFloat(data.total_amount || 0).toLocaleString('en-CA', {minimumFractionDigits: 0, maximumFractionDigits: 0}) + '</p>' +
        '</div>';
    }
    funnelHtml += '</div>';

    // KPI cards
    let kpiHtml = '<div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">' +
      samc('Conversion Rate', convRate + '%', 'fa-percentage', 'green') +
      samc('Avg Deal Size', '$' + avgDeal.toLocaleString('en-CA', {minimumFractionDigits: 0}), 'fa-dollar-sign', 'blue') +
      samc('Revenue (30d)', '$' + parseFloat(inv.paid_amount || 0).toLocaleString('en-CA', {minimumFractionDigits: 0}), 'fa-money-bill-wave', 'emerald') +
      samc('Outstanding', '$' + parseFloat(inv.outstanding_amount || 0).toLocaleString('en-CA', {minimumFractionDigits: 0}), 'fa-clock', 'amber') +
      '</div>';

    // Proposal stats
    let proposalHtml = saSection('Proposal Performance (Last 30 Days)', 'fa-chart-pie', '<div class="grid grid-cols-2 md:grid-cols-4 gap-4">' +
      '<div class="text-center p-4 bg-blue-50 rounded-xl"><p class="text-2xl font-bold text-blue-700">' + (p.total || 0) + '</p><p class="text-xs text-gray-500">Total Sent</p></div>' +
      '<div class="text-center p-4 bg-green-50 rounded-xl"><p class="text-2xl font-bold text-green-700">' + (p.accepted || 0) + '</p><p class="text-xs text-gray-500">Accepted</p></div>' +
      '<div class="text-center p-4 bg-red-50 rounded-xl"><p class="text-2xl font-bold text-red-700">' + (p.declined || 0) + '</p><p class="text-xs text-gray-500">Declined</p></div>' +
      '<div class="text-center p-4 bg-yellow-50 rounded-xl"><p class="text-2xl font-bold text-yellow-700">' + (p.pending || 0) + '</p><p class="text-xs text-gray-500">Pending</p></div>' +
      '</div>' +
      '<div class="mt-4 bg-green-50 border border-green-200 rounded-lg p-4 text-center">' +
      '<p class="text-sm text-gray-600">Accepted Revenue</p>' +
      '<p class="text-3xl font-black text-green-700">$' + parseFloat(p.accepted_amount || 0).toLocaleString('en-CA', {minimumFractionDigits: 2}) + ' CAD</p>' +
      '</div>');

    el.innerHTML = funnelHtml + kpiHtml + proposalHtml;
  } catch (e) {
    var el = document.getElementById('pipeline-content');
    if (el) el.innerHTML = '<div class="text-center py-8 text-gray-500"><i class="fas fa-info-circle mr-1"></i>No pipeline data yet. Send your first proposal to start tracking.</div>';
  }
}

// ============================================================
// NOTIFICATIONS ADMIN — View & manage notifications
// ============================================================
function renderNotificationsAdminView() {
  return `
    <div class="mb-6 flex items-center justify-between">
      <div>
        <h2 class="text-2xl font-black text-gray-900"><i class="fas fa-bell mr-2 text-amber-500"></i>Notifications</h2>
        <p class="text-sm text-gray-500 mt-1">System alerts, proposal activity, and payment notifications</p>
      </div>
      <button onclick="markAllNotificationsRead()" class="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium text-gray-700">
        <i class="fas fa-check-double mr-1"></i>Mark All Read
      </button>
    </div>
    <div id="notifications-content">
      <div class="flex items-center justify-center py-12">
        <div class="w-8 h-8 border-4 border-amber-200 border-t-amber-600 rounded-full animate-spin"></div>
        <span class="ml-3 text-gray-500">Loading notifications...</span>
      </div>
    </div>`;
}

async function loadNotifications() {
  try {
    const res = await saFetch('/api/crm/notifications');
    if (!res) return;
    const d = await res.json();
    const el = document.getElementById('notifications-content');
    if (!el) return;

    const notifs = d.notifications || [];
    const unread = d.unread_count || 0;

    if (notifs.length === 0) {
      el.innerHTML = '<div class="text-center py-12 bg-white rounded-xl border border-gray-200"><i class="fas fa-bell-slash text-gray-300 text-4xl mb-3"></i><p class="text-gray-500">No notifications yet</p></div>';
      return;
    }

    const typeIcons = {
      proposal_accepted: 'fa-check-circle text-green-500',
      proposal_declined: 'fa-times-circle text-red-500',
      invoice_paid: 'fa-money-bill-wave text-emerald-500',
      lead_captured: 'fa-user-plus text-blue-500',
      call_answered: 'fa-phone text-teal-500',
      followup_due: 'fa-clock text-amber-500'
    };

    let html = '<div class="mb-4">' + samc('Unread', unread, 'fa-bell', 'amber') + '</div>';
    html += '<div class="space-y-2">';
    for (const n of notifs) {
      const icon = typeIcons[n.type] || 'fa-info-circle text-gray-400';
      const timeAgo = getTimeAgo(n.created_at);
      html += '<div class="bg-white border border-gray-200 rounded-xl p-4 flex items-start gap-4 ' + (n.is_read ? 'opacity-60' : '') + ' hover:shadow-sm transition-shadow">' +
        '<div class="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center flex-shrink-0"><i class="fas ' + icon + '"></i></div>' +
        '<div class="flex-1 min-w-0">' +
        '<p class="font-semibold text-gray-800 text-sm">' + (n.title || '') + '</p>' +
        '<p class="text-gray-500 text-xs mt-0.5">' + (n.message || '') + '</p>' +
        '<p class="text-gray-400 text-[10px] mt-1">' + timeAgo + '</p>' +
        '</div>' +
        (!n.is_read ? '<button onclick="markNotificationRead(' + n.id + ')" class="text-xs text-gray-400 hover:text-gray-600 flex-shrink-0"><i class="fas fa-check"></i></button>' : '') +
        '</div>';
    }
    html += '</div>';
    el.innerHTML = html;
  } catch (e) {
    var el = document.getElementById('notifications-content');
    if (el) el.innerHTML = '<div class="text-red-500">Failed to load notifications</div>';
  }
}

async function markNotificationRead(id) {
  await saFetch('/api/crm/notifications/' + id + '/read', { method: 'POST' });
  loadNotifications();
}

async function markAllNotificationsRead() {
  await saFetch('/api/crm/notifications/all/read', { method: 'POST' });
  loadNotifications();
}

function getTimeAgo(dateStr) {
  if (!dateStr) return '';
  var diff = Date.now() - new Date(dateStr).getTime();
  var mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return mins + 'm ago';
  var hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  var days = Math.floor(hrs / 24);
  if (days < 7) return days + 'd ago';
  return new Date(dateStr).toLocaleDateString('en-CA');
}

// ============================================================
// WEBHOOKS MANAGEMENT — Configure webhook endpoints
// ============================================================
function renderWebhooksView() {
  return `
    <div class="mb-6 flex items-center justify-between">
      <div>
        <h2 class="text-2xl font-black text-gray-900"><i class="fas fa-plug mr-2 text-purple-500"></i>Webhooks</h2>
        <p class="text-sm text-gray-500 mt-1">Send real-time event notifications to external services (Slack, Zapier, etc.)</p>
      </div>
      <button onclick="showAddWebhookForm()" class="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium">
        <i class="fas fa-plus mr-1"></i>Add Webhook
      </button>
    </div>
    <div id="webhook-form" class="hidden mb-6 bg-white border border-gray-200 rounded-xl p-6">
      <h3 class="font-bold text-gray-800 mb-4">New Webhook</h3>
      <div class="grid md:grid-cols-2 gap-4 mb-4">
        <div>
          <label class="block text-xs font-semibold text-gray-500 mb-1">Event Type</label>
          <select id="webhook-event" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
            <option value="proposal_accepted">Proposal Accepted</option>
            <option value="proposal_declined">Proposal Declined</option>
            <option value="invoice_paid">Invoice Paid</option>
            <option value="lead_captured">Lead Captured</option>
            <option value="call_answered">Call Answered</option>
          </select>
        </div>
        <div>
          <label class="block text-xs font-semibold text-gray-500 mb-1">URL</label>
          <input type="url" id="webhook-url" placeholder="https://hooks.slack.com/services/..." class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
        </div>
      </div>
      <div class="mb-4">
        <label class="block text-xs font-semibold text-gray-500 mb-1">Secret (optional)</label>
        <input type="text" id="webhook-secret" placeholder="Signing secret for verification" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
      </div>
      <div class="flex gap-2">
        <button onclick="saveWebhook()" class="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium">Save Webhook</button>
        <button onclick="document.getElementById('webhook-form').classList.add('hidden')" class="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium">Cancel</button>
      </div>
    </div>
    <div id="webhooks-content">
      <div class="flex items-center justify-center py-12">
        <div class="w-8 h-8 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin"></div>
        <span class="ml-3 text-gray-500">Loading webhooks...</span>
      </div>
    </div>`;
}

function showAddWebhookForm() {
  document.getElementById('webhook-form').classList.remove('hidden');
}

async function loadWebhooks() {
  try {
    const res = await saFetch('/api/crm/webhooks');
    if (!res) return;
    const d = await res.json();
    const el = document.getElementById('webhooks-content');
    if (!el) return;

    const hooks = d.webhooks || [];
    if (hooks.length === 0) {
      el.innerHTML = '<div class="text-center py-12 bg-white rounded-xl border border-gray-200"><i class="fas fa-plug text-gray-300 text-4xl mb-3"></i><p class="text-gray-500">No webhooks configured</p><p class="text-gray-400 text-xs mt-1">Add a webhook to receive real-time notifications</p></div>';
      return;
    }

    var html = '<div class="space-y-3">';
    for (var h of hooks) {
      var eventLabel = { proposal_accepted: 'Proposal Accepted', proposal_declined: 'Proposal Declined', invoice_paid: 'Invoice Paid', lead_captured: 'Lead Captured', call_answered: 'Call Answered' }[h.event_type] || h.event_type;
      html += '<div class="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between">' +
        '<div class="flex items-center gap-3">' +
        '<div class="w-10 h-10 rounded-full bg-purple-50 flex items-center justify-center"><i class="fas fa-plug text-purple-500"></i></div>' +
        '<div><p class="font-semibold text-gray-800 text-sm">' + eventLabel + '</p><p class="text-gray-400 text-xs truncate max-w-xs">' + h.url + '</p></div>' +
        '</div>' +
        '<div class="flex items-center gap-2">' +
        '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold ' + (h.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500') + '">' + (h.is_active ? 'ACTIVE' : 'INACTIVE') + '</span>' +
        '<button onclick="deleteWebhook(' + h.id + ')" class="text-red-400 hover:text-red-600 text-xs"><i class="fas fa-trash"></i></button>' +
        '</div></div>';
    }
    html += '</div>';
    el.innerHTML = html;
  } catch (e) {
    var el = document.getElementById('webhooks-content');
    if (el) el.innerHTML = '<div class="text-red-500">Failed to load webhooks</div>';
  }
}

async function saveWebhook() {
  var event_type = document.getElementById('webhook-event').value;
  var url = document.getElementById('webhook-url').value;
  var secret = document.getElementById('webhook-secret').value;
  if (!url) { window.rmToast('URL is required', 'warning'); return; }

  try {
    var res = await saFetch('/api/crm/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_type: event_type, url: url, secret: secret })
    });
    var data = await res.json();
    if (data.success) {
      document.getElementById('webhook-form').classList.add('hidden');
      document.getElementById('webhook-url').value = '';
      document.getElementById('webhook-secret').value = '';
      loadWebhooks();
    } else {
      window.rmToast(data.error || 'Failed to save', 'info');
    }
  } catch (e) { window.rmToast('Error saving webhook', 'error'); }
}

async function deleteWebhook(id) {
  if (!(await window.rmConfirm('Delete this webhook?'))) return
  await saFetch('/api/crm/webhooks/' + id, { method: 'DELETE' });
  loadWebhooks();
}

// ============================================================
// CUSTOMER ONBOARDING — Provision accounts + Secretary AI
// ============================================================
function renderCustomerOnboardingView() {
  var d = SA.data.onboarding || {};
  var customers = d.customers || [];
  var rows = customers.map(function(c) {
    var secBadge = c.secretary_enabled ? '<span class="px-2 py-0.5 bg-green-100 text-green-800 rounded-full text-xs font-medium"><i class="fas fa-check-circle mr-1"></i>Active</span>' : '<span class="px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full text-xs font-medium">Off</span>';
    var modeBadge = c.secretary_mode === 'always_on' ? '<span class="text-xs text-blue-600 font-medium">Always On</span>' : c.secretary_mode === 'answering_service' ? '<span class="text-xs text-purple-600 font-medium">Answering</span>' : '<span class="text-xs text-sky-600 font-medium">Receptionist</span>';
    var provBadge = c.phone_provider === 'livekit' ? '<span class="px-1.5 py-0.5 bg-violet-100 text-violet-700 rounded text-[10px] font-bold">LiveKit</span>' : c.phone_provider === 'twilio' ? '<span class="px-1.5 py-0.5 bg-red-100 text-red-700 rounded text-[10px] font-bold">Twilio</span>' : '<span class="px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-[10px]">N/A</span>';
    var lkDeployed = (c.livekit_trunk_id || c.livekit_inbound_trunk_id) && (c.livekit_trunk_id || c.livekit_inbound_trunk_id) !== '';
    var lkBadge = lkDeployed ? '<span class="px-2 py-0.5 bg-green-100 text-green-800 rounded-full text-[10px] font-bold"><i class="fas fa-check mr-0.5"></i>Deployed</span>' : '<span class="px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full text-[10px] font-medium">Not Deployed</span>';
    var hasAgentPhone = c.agent_phone_number || c.secretary_phone_number;
    var deployBtn = lkDeployed ? '' : (hasAgentPhone ? '<button onclick="deployLiveKitAgent(' + c.id + ')" class="text-xs bg-violet-600 hover:bg-violet-700 text-white px-2.5 py-1 rounded-lg font-medium ml-1"><i class="fas fa-rocket mr-1"></i>Deploy</button>' : '');
    var testBtn = lkDeployed ? '<button onclick="testSecretaryCall(' + c.id + ')" class="text-xs bg-amber-500 hover:bg-amber-600 text-white px-2.5 py-1 rounded-lg font-medium ml-1"><i class="fas fa-vial mr-1"></i>Test</button>' : '';
    return '<tr class="border-b border-gray-100 hover:bg-gray-50">' +
      '<td class="px-4 py-3"><div class="font-bold text-gray-800 text-sm">' + (c.business_name || c.contact_name || 'N/A') + '</div><div class="text-xs text-gray-500">' + (c.email || '') + '</div></td>' +
      '<td class="px-4 py-3 text-sm text-gray-600"><div>' + (c.personal_phone || c.phone || '-') + '</div><div class="text-[10px] text-gray-400">Personal Cell</div></td>' +
      '<td class="px-4 py-3 text-sm text-gray-600"><div class="font-mono">' + (c.agent_phone_number || c.secretary_phone_number || '-') + '</div><div class="text-[10px] text-gray-400">AI Agent #</div></td>' +
      '<td class="px-4 py-3 text-center">' + provBadge + '</td>' +
      '<td class="px-4 py-3 text-center">' + secBadge + '</td>' +
      '<td class="px-4 py-3 text-center">' + modeBadge + '</td>' +
      '<td class="px-4 py-3 text-center">' + lkBadge + '</td>' +
      '<td class="px-4 py-3 text-xs text-gray-400">' + fmtDate(c.created_at) + '</td>' +
      '<td class="px-4 py-3 whitespace-nowrap"><button onclick="toggleSecretaryMode(' + c.id + ', ' + (c.secretary_enabled ? 0 : 1) + ')" class="text-xs ' + (c.secretary_enabled ? 'text-red-600 hover:text-red-800' : 'text-green-600 hover:text-green-800') + ' font-medium">' + (c.secretary_enabled ? '<i class="fas fa-power-off mr-1"></i>Disable' : '<i class="fas fa-play mr-1"></i>Enable') + '</button>' + deployBtn + testBtn + '</td>' +
      '</tr>';
  }).join('');

  return '<div class="mb-6"><h2 class="text-2xl font-black text-gray-900"><i class="fas fa-user-cog mr-2 text-indigo-500"></i>Customer Onboarding</h2><p class="text-sm text-gray-500 mt-1">Create accounts, set passwords, send invoices, and provision Secretary AI</p></div>' +

    // --- Quick Account Setup ---
    '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">' +
    '<div class="flex items-center gap-3 mb-4">' +
    '<div class="w-9 h-9 bg-blue-100 rounded-xl flex items-center justify-center"><i class="fas fa-user-plus text-blue-600"></i></div>' +
    '<div><h3 class="font-bold text-gray-800 text-lg">Create New Account</h3><p class="text-xs text-gray-500">Set up login credentials for a new roof reporting customer</p></div>' +
    '</div>' +
    '<div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">' +
    '<div><label class="text-xs text-gray-500 font-medium block mb-1">Business Name</label><input id="qa-business" class="w-full border rounded-lg px-3 py-2 text-sm" placeholder="ABC Roofing Ltd"></div>' +
    '<div><label class="text-xs text-gray-500 font-medium block mb-1">Contact Name *</label><input id="qa-name" class="w-full border rounded-lg px-3 py-2 text-sm" placeholder="John Smith"></div>' +
    '<div><label class="text-xs text-gray-500 font-medium block mb-1">Email (username) *</label><input id="qa-email" type="email" class="w-full border rounded-lg px-3 py-2 text-sm" placeholder="john@abcroofing.ca"></div>' +
    '</div>' +
    '<div class="grid grid-cols-1 md:grid-cols-3 gap-4">' +
    '<div><label class="text-xs text-gray-500 font-medium block mb-1">Password *</label><div class="relative"><input id="qa-password" type="password" class="w-full border rounded-lg px-3 py-2 text-sm pr-9" placeholder="Set a secure password"><button type="button" onclick="var f=document.getElementById(\'qa-password\');f.type=f.type===\'password\'?\'text\':\'password\'" class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"><i class="fas fa-eye"></i></button></div></div>' +
    '<div><label class="text-xs text-gray-500 font-medium block mb-1">Starter Report Credits</label><select id="qa-credits" class="w-full border rounded-lg px-3 py-2 text-sm"><option value="0">0 — trial only</option><option value="3" selected>3 — free trial</option><option value="5">5 credits</option><option value="10">10 credits</option></select></div>' +
    '<div class="flex items-end"><button id="qa-create-btn" type="button" class="w-full bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-bold text-sm transition-all cursor-pointer"><i class="fas fa-user-plus mr-2"></i>Create Account</button></div>' +
    '</div>' +
    '<div id="qa-result" class="mt-3 hidden"></div>' +
    '</div>' +

    // --- Send Invoice ---
    '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">' +
    '<div class="flex items-center gap-3 mb-4">' +
    '<div class="w-9 h-9 bg-green-100 rounded-xl flex items-center justify-center"><i class="fas fa-file-invoice-dollar text-green-600"></i></div>' +
    '<div><h3 class="font-bold text-gray-800 text-lg">Send Invoice</h3><p class="text-xs text-gray-500">Invoice a customer for report packs, annual membership, or custom items</p></div>' +
    '</div>' +
    '<div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">' +
    '<div><label class="text-xs text-gray-500 font-medium block mb-1">Customer Email *</label><input id="inv-email" type="email" class="w-full border rounded-lg px-3 py-2 text-sm" placeholder="john@abcroofing.ca"></div>' +
    '<div><label class="text-xs text-gray-500 font-medium block mb-1">Customer Name *</label><input id="inv-name" class="w-full border rounded-lg px-3 py-2 text-sm" placeholder="John Smith"></div>' +
    '<div><label class="text-xs text-gray-500 font-medium block mb-1">Business Name</label><input id="inv-business" class="w-full border rounded-lg px-3 py-2 text-sm" placeholder="ABC Roofing Ltd"></div>' +
    '</div>' +
    '<div class="mb-4"><label class="text-xs text-gray-500 font-medium block mb-1">Notes (optional)</label><input id="inv-notes" class="w-full border rounded-lg px-3 py-2 text-sm" placeholder="e.g. Welcome package, annual renewal..."></div>' +
    // Inline account creation
    '<div class="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-4">' +
    '<label class="flex items-center gap-2 text-sm font-semibold text-blue-800 cursor-pointer"><input type="checkbox" id="inv-create-account" class="rounded" onchange="document.getElementById(\'inv-acct-fields\').classList.toggle(\'hidden\', !this.checked)"> <i class="fas fa-user-plus"></i> Also create a customer account with login</label>' +
    '<div id="inv-acct-fields" class="hidden grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">' +
    '<div><label class="text-xs text-gray-600 font-medium block mb-1">Password *</label><input id="inv-acct-password" type="text" class="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Secure password (min 8 chars)"></div>' +
    '<div><label class="text-xs text-gray-600 font-medium block mb-1">Starter Credits</label><select id="inv-acct-credits" class="w-full border rounded-lg px-3 py-2 text-sm"><option value="0">0 — trial only</option><option value="3" selected>3 — free trial</option><option value="5">5 credits</option><option value="10">10 credits</option></select></div>' +
    '</div>' +
    '<p class="text-[10px] text-blue-700 mt-2"><i class="fas fa-info-circle mr-1"></i>Account will be created using the Customer Email / Name / Business above, then the invoice will be sent.</p>' +
    '</div>' +
    '<p class="text-xs text-gray-500 font-medium mb-2">Select items to include:</p>' +
    '<div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">' +
    '<label class="flex items-center gap-3 p-3 border rounded-xl cursor-pointer hover:bg-gray-50 has-[:checked]:border-green-400 has-[:checked]:bg-green-50">' +
    '<input type="checkbox" id="inv-10pack" class="rounded" value="10-pack"><div><div class="text-sm font-semibold text-gray-800">10 Report Credits</div><div class="text-xs text-gray-500">$55.00 ($5.50 each)</div></div>' +
    '</label>' +
    '<label class="flex items-center gap-3 p-3 border rounded-xl cursor-pointer hover:bg-gray-50 has-[:checked]:border-green-400 has-[:checked]:bg-green-50">' +
    '<input type="checkbox" id="inv-25pack" class="rounded" value="25-pack"><div><div class="text-sm font-semibold text-gray-800">25 Report Credits</div><div class="text-xs text-gray-500">$175.00 ($7.00 each)</div></div>' +
    '</label>' +
    '<label class="flex items-center gap-3 p-3 border rounded-xl cursor-pointer hover:bg-gray-50 has-[:checked]:border-green-400 has-[:checked]:bg-green-50">' +
    '<input type="checkbox" id="inv-100pack" class="rounded" value="100-pack"><div><div class="text-sm font-semibold text-gray-800">100 Report Credits</div><div class="text-xs text-gray-500">$595.00 ($5.95 each)</div></div>' +
    '</label>' +
    '<label class="flex items-center gap-3 p-3 border rounded-xl cursor-pointer hover:bg-gray-50 has-[:checked]:border-green-400 has-[:checked]:bg-green-50">' +
    '<input type="checkbox" id="inv-annual" class="rounded" value="annual"><div><div class="text-sm font-semibold text-gray-800">Annual Membership <span class="ml-1 px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-[10px] font-bold">SAVE 2 MONTHS</span></div><div class="text-xs text-gray-500">$499.00/yr (equiv. $41.58/mo)</div></div>' +
    '</label>' +
    '<label class="flex items-center gap-3 p-3 border rounded-xl cursor-pointer hover:bg-gray-50 has-[:checked]:border-violet-400 has-[:checked]:bg-violet-50">' +
    '<input type="checkbox" id="inv-secretary-1mo" class="rounded" value="secretary-1mo"><div><div class="text-sm font-semibold text-gray-800">AI Secretary — 1st Month</div><div class="text-xs text-gray-500">$149.00 (first month of Secretary AI subscription)</div></div>' +
    '</label>' +
    '<label class="flex items-center gap-3 p-3 border rounded-xl cursor-pointer hover:bg-gray-50 has-[:checked]:border-blue-400 has-[:checked]:bg-blue-50">' +
    '<input type="checkbox" id="inv-mem-starter" class="rounded" value="mem-starter"><div><div class="text-sm font-semibold text-gray-800">Monthly Membership — Starter</div><div class="text-xs text-gray-500">$49.99/mo</div></div>' +
    '</label>' +
    '<label class="flex items-center gap-3 p-3 border rounded-xl cursor-pointer hover:bg-gray-50 has-[:checked]:border-blue-400 has-[:checked]:bg-blue-50">' +
    '<input type="checkbox" id="inv-mem-pro" class="rounded" value="mem-pro"><div><div class="text-sm font-semibold text-gray-800">Monthly Membership — Pro</div><div class="text-xs text-gray-500">$149.00/mo</div></div>' +
    '</label>' +
    '<label class="flex items-center gap-3 p-3 border rounded-xl cursor-pointer hover:bg-gray-50 has-[:checked]:border-blue-400 has-[:checked]:bg-blue-50">' +
    '<input type="checkbox" id="inv-mem-enterprise" class="rounded" value="mem-enterprise"><div><div class="text-sm font-semibold text-gray-800">Monthly Membership — Enterprise</div><div class="text-xs text-gray-500">$499.00/mo</div></div>' +
    '</label>' +
    '</div>' +
    '<div class="border rounded-xl p-3 mb-4 bg-gray-50">' +
    '<p class="text-xs text-gray-500 font-medium mb-2"><i class="fas fa-plus mr-1"></i>Custom Line Item</p>' +
    '<div class="flex gap-3"><input id="inv-custom-desc" class="flex-1 border rounded-lg px-3 py-2 text-sm bg-white" placeholder="Description (e.g. Setup fee)"><input id="inv-custom-price" type="number" min="0" step="0.01" class="w-28 border rounded-lg px-3 py-2 text-sm bg-white" placeholder="$0.00"></div>' +
    '</div>' +
    '<div class="flex items-center justify-between gap-3 flex-wrap">' +
    '<div id="inv-total-display" class="text-sm font-bold text-gray-700"></div>' +
    '<div class="flex gap-2">' +
    '<button onclick="saPreviewOnboardingInvoice()" class="bg-white border-2 border-gray-300 hover:border-blue-500 hover:text-blue-600 text-gray-700 px-6 py-2.5 rounded-lg font-bold text-sm transition-all"><i class="fas fa-eye mr-2"></i>Preview Invoice</button>' +
    '<button onclick="saSendOnboardingInvoice()" class="bg-green-600 hover:bg-green-700 text-white px-8 py-2.5 rounded-lg font-bold text-sm transition-all"><i class="fas fa-paper-plane mr-2"></i>Create &amp; Send Invoice</button>' +
    '</div>' +
    '</div>' +
    '<div id="inv-result" class="mt-3 hidden"></div>' +
    '</div>' +

    // --- Twilio/Phone Provider Guide ---
    '<div class="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-2xl p-5 mb-6">' +
    '<div class="flex items-start gap-3">' +
    '<div class="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center shrink-0"><i class="fas fa-phone-volume text-amber-600"></i></div>' +
    '<div>' +
    '<h3 class="font-bold text-amber-900 mb-1">Phone Number Setup Guide</h3>' +
    '<p class="text-xs text-amber-800 leading-relaxed mb-3">Each Roofer Secretary AI customer needs <b>two phone numbers</b>:</p>' +
    '<div class="grid md:grid-cols-2 gap-4">' +
    '<div class="bg-white rounded-xl p-4 border border-amber-200">' +
    '<div class="flex items-center gap-2 mb-2"><span class="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center text-xs font-bold text-blue-700">1</span><span class="font-bold text-gray-800 text-sm">Personal Phone Number</span></div>' +
    '<p class="text-xs text-gray-600 leading-relaxed">The customer\'s <b>personal cell phone</b> they currently use for business. This is the number they will <b>forward calls FROM</b> when they can\'t answer (busy, after hours, etc.). The customer sets up call forwarding through their cell provider (Telus, Bell, Rogers, etc.).</p>' +
    '</div>' +
    '<div class="bg-white rounded-xl p-4 border border-amber-200">' +
    '<div class="flex items-center gap-2 mb-2"><span class="w-6 h-6 bg-purple-100 rounded-full flex items-center justify-center text-xs font-bold text-purple-700">2</span><span class="font-bold text-gray-800 text-sm">Agent Phone Number (SIP/VoIP)</span></div>' +
    '<p class="text-xs text-gray-600 leading-relaxed">A purchased SIP phone number the AI agent uses for <b>inbound and outbound</b> calls. Customers must purchase this from a provider like <b>Twilio</b>, <b>Vonage</b>, or <b>Telnyx</b>.</p>' +
    '<div class="mt-2 p-2 bg-violet-50 rounded-lg border border-violet-200">' +
    '<p class="text-[10px] text-violet-700 font-medium"><i class="fas fa-star mr-1"></i><b>dev@reusecanada.ca</b> uses pre-owned LiveKit number: <span class="font-mono">+1 (484) 964-9758</span></p>' +
    '</div>' +
    '</div>' +
    '</div>' +
    '<div class="mt-3 bg-white rounded-xl p-3 border border-amber-200">' +
    '<p class="text-xs font-bold text-gray-700 mb-1"><i class="fas fa-external-link-alt mr-1 text-amber-600"></i>Recommended SIP Phone Providers:</p>' +
    '<div class="flex flex-wrap gap-2">' +
    '<a href="https://www.twilio.com/en-us/phone-numbers" target="_blank" class="px-3 py-1.5 bg-red-50 border border-teal-200 rounded-lg text-xs font-bold text-red-700 hover:bg-red-100 transition-colors"><i class="fas fa-phone mr-1"></i>Twilio — Buy Phone Number</a>' +
    '<a href="https://www.vonage.com/communications-apis/phone-numbers/" target="_blank" class="px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-lg text-xs font-bold text-blue-700 hover:bg-blue-100 transition-colors"><i class="fas fa-phone mr-1"></i>Vonage Numbers</a>' +
    '<a href="https://telnyx.com/products/phone-numbers" target="_blank" class="px-3 py-1.5 bg-green-50 border border-green-200 rounded-lg text-xs font-bold text-green-700 hover:bg-green-100 transition-colors"><i class="fas fa-phone mr-1"></i>Telnyx Numbers</a>' +
    '</div>' +
    '<p class="text-[10px] text-gray-400 mt-2">After purchasing, enter the number in the "Agent Phone Number" field below. Configure SIP trunk credentials in the Secretary AI telephony settings.</p>' +
    '</div>' +
    '</div></div></div>' +

    // --- Create New Customer Form ---
    '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">' +
    '<div class="flex items-center justify-between mb-4"><h3 class="font-bold text-gray-800 text-lg"><i class="fas fa-user-plus mr-2 text-indigo-500"></i>Create New Customer</h3></div>' +
    '<div id="onboard-form" class="space-y-4">' +

    // Row 1: Basic info
    '<div class="grid grid-cols-1 md:grid-cols-3 gap-4">' +
    '<div><label class="text-xs text-gray-500 font-medium block mb-1">Business Name</label><input id="ob-business" class="w-full border rounded-lg px-3 py-2 text-sm" placeholder="ABC Roofing Ltd"></div>' +
    '<div><label class="text-xs text-gray-500 font-medium block mb-1">Contact Name *</label><input id="ob-name" class="w-full border rounded-lg px-3 py-2 text-sm" placeholder="John Smith"></div>' +
    '<div><label class="text-xs text-gray-500 font-medium block mb-1">Email *</label><input id="ob-email" class="w-full border rounded-lg px-3 py-2 text-sm" placeholder="john@abcroofing.ca" type="email"></div>' +
    '</div>' +

    // Row 2: Password + Secretary Mode
    '<div class="grid grid-cols-1 md:grid-cols-3 gap-4">' +
    '<div><label class="text-xs text-gray-500 font-medium block mb-1">Password *</label><input id="ob-password" class="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Secure password" type="text"></div>' +
    '<div><label class="text-xs text-gray-500 font-medium block mb-1">Secretary AI Mode</label><select id="ob-sec-mode" class="w-full border rounded-lg px-3 py-2 text-sm"><option value="receptionist">Receptionist</option><option value="answering_service">Answering Service</option><option value="always_on">Always On</option></select></div>' +
    '<div><label class="text-xs text-gray-500 font-medium block mb-1">Phone Provider</label><select id="ob-provider" class="w-full border rounded-lg px-3 py-2 text-sm"><option value="twilio">Twilio</option><option value="livekit">LiveKit (Pre-owned)</option><option value="vonage">Vonage</option><option value="telnyx">Telnyx</option></select></div>' +
    '</div>' +

    // Row 3: Phone Numbers — THE KEY FIELDS
    '<div class="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-4 border border-blue-200">' +
    '<h4 class="text-sm font-bold text-blue-800 mb-3"><i class="fas fa-phone-alt mr-1"></i>Phone Number Configuration</h4>' +
    '<div class="grid grid-cols-1 md:grid-cols-2 gap-4">' +

    '<div>' +
    '<label class="text-xs text-gray-600 font-bold block mb-1"><span class="inline-flex items-center gap-1"><span class="w-5 h-5 bg-blue-100 rounded-full flex items-center justify-center text-[10px] font-bold text-blue-700">1</span> Personal Phone Number</span></label>' +
    '<input id="ob-personal-phone" class="w-full border-2 border-blue-200 rounded-lg px-3 py-2.5 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200" placeholder="+1 403 555 1234">' +
    '<p class="text-[10px] text-gray-500 mt-1"><i class="fas fa-info-circle mr-1"></i>Customer\'s personal cell — they forward calls <b>FROM</b> this number when unavailable</p>' +
    '</div>' +

    '<div>' +
    '<label class="text-xs text-gray-600 font-bold block mb-1"><span class="inline-flex items-center gap-1"><span class="w-5 h-5 bg-purple-100 rounded-full flex items-center justify-center text-[10px] font-bold text-purple-700">2</span> Agent Phone Number (SIP)</span></label>' +
    '<input id="ob-agent-phone" class="w-full border-2 border-purple-200 rounded-lg px-3 py-2.5 text-sm focus:border-purple-500 focus:ring-2 focus:ring-purple-200" placeholder="+1 484 964 9758">' +
    '<p class="text-[10px] text-gray-500 mt-1"><i class="fas fa-robot mr-1"></i>Purchased Twilio/LiveKit number the AI agent uses for inbound/outbound calls</p>' +
    '</div>' +

    '</div>' +
    '<div class="mt-3 p-2 bg-white rounded-lg border border-blue-100 flex items-center gap-2">' +
    '<i class="fas fa-lightbulb text-amber-500 text-sm"></i>' +
    '<p class="text-[10px] text-gray-600"><b>How it works:</b> Customer forwards their personal phone to the Agent Phone # when they can\'t answer. The AI Secretary picks up, handles the call, and routes/notifies as configured. Customer sets up forwarding via their cell provider (Telus: *21*[number]#, Rogers: **21*[number]#, Bell: *72[number]).</p>' +
    '</div>' +
    '</div>' +

    // Row 3b: SIP Bridge Configuration
    '<div class="bg-gradient-to-r from-violet-50 to-purple-50 rounded-xl p-4 border border-violet-200">' +
    '<h4 class="text-sm font-bold text-violet-800 mb-3"><i class="fas fa-network-wired mr-1"></i>SIP Bridge / Forwarding Method</h4>' +
    '<div class="grid grid-cols-1 md:grid-cols-2 gap-4">' +
    '<div><label class="text-xs text-gray-600 font-bold block mb-1">Forwarding Method</label>' +
    '<select id="ob-forwarding-method" class="w-full border-2 border-violet-200 rounded-lg px-3 py-2.5 text-sm" onchange="updateForwardingMethodUI()">' +
    '<option value="livekit_number">LiveKit-issued number (auto-provision)</option>' +
    '<option value="call_forwarding">Call forwarding from existing line</option>' +
    '<option value="sip_trunk">SIP trunk (BYO carrier credentials)</option>' +
    '</select></div>' +
    '<div id="ob-fwd-help" class="text-xs text-gray-600 self-end pb-1">Customer forwards their personal cell to the assigned LiveKit number.</div>' +
    '</div>' +
    '<div id="ob-sip-fields" class="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3 hidden">' +
    '<div><label class="text-xs text-gray-600 font-bold block mb-1">SIP URI</label><input id="ob-sip-uri" class="w-full border rounded-lg px-3 py-2 text-sm font-mono" placeholder="sip:trunk.carrier.com"></div>' +
    '<div><label class="text-xs text-gray-600 font-bold block mb-1">SIP Auth Username</label><input id="ob-sip-username" class="w-full border rounded-lg px-3 py-2 text-sm" placeholder="trunk-user"></div>' +
    '<div><label class="text-xs text-gray-600 font-bold block mb-1">SIP Auth Password</label><input id="ob-sip-password" type="password" class="w-full border rounded-lg px-3 py-2 text-sm" placeholder="********"></div>' +
    '</div>' +
    '</div>' +

    // Row 4: Notes + Enable toggle
    '<div class="grid grid-cols-1 md:grid-cols-2 gap-4">' +
    '<div><label class="text-xs text-gray-500 font-medium block mb-1">Notes</label><input id="ob-notes" class="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Optional notes about this customer"></div>' +
    '<div class="flex items-end pb-1"><label class="flex items-center gap-2 text-sm"><input type="checkbox" id="ob-enable-sec" checked class="rounded"> Enable Secretary AI on creation</label></div>' +
    '</div>' +

    // Subscription & Billing section
    '<div class="bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl p-4 border border-green-200 mt-4">' +
    '<h4 class="text-sm font-bold text-green-800 mb-3"><i class="fas fa-credit-card mr-1"></i>Subscription & Billing</h4>' +
    '<div class="grid grid-cols-1 md:grid-cols-4 gap-4">' +
    '<div><label class="text-xs text-gray-600 font-bold block mb-1">Subscription Tier</label>' +
    '<select id="ob-sub-tier" class="w-full border-2 border-green-200 rounded-lg px-3 py-2.5 text-sm">' +
    '<option value="starter">Starter — $49.99/mo</option>' +
    '<option value="pro">Pro — $149/mo</option>' +
    '<option value="enterprise">Enterprise — $499/mo</option>' +
    '</select></div>' +
    '<div><label class="text-xs text-gray-600 font-bold block mb-1">Trial Period</label>' +
    '<select id="ob-trial-days" class="w-full border-2 border-green-200 rounded-lg px-3 py-2.5 text-sm" onchange="updateTrialEndDate()">' +
    '<option value="30">30 days (default)</option>' +
    '<option value="14">14 days</option>' +
    '<option value="60">60 days</option>' +
    '</select>' +
    '<p id="ob-trial-end-display" class="text-[10px] text-green-700 mt-1 font-medium"></p></div>' +
    '<div><label class="text-xs text-gray-600 font-bold block mb-1">Report Credit Pack</label>' +
    '<select id="ob-credit-pack" class="w-full border-2 border-green-200 rounded-lg px-3 py-2.5 text-sm">' +
    '<option value="none">No credits (trial only)</option>' +
    '<option value="10-pack">10-pack — $55</option>' +
    '<option value="25-pack">25-pack — $175</option>' +
    '<option value="100-pack">100-pack — $595</option>' +
    '</select></div>' +
    '<div class="flex items-end pb-1"><label class="flex items-center gap-2 text-sm"><input type="checkbox" id="ob-send-invoice" class="rounded"> Send Invoice with Payment Link</label></div>' +
    '</div></div>' +

    '</div>' +
    '<button onclick="createOnboardingCustomer()" class="mt-5 bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-3 rounded-xl font-bold text-sm transition-all shadow-md hover:shadow-lg"><i class="fas fa-user-plus mr-2"></i>Create Account & Setup Secretary AI</button>' +
    '</div>' +

    // --- LiveKit Deployment Center ---
    '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mb-6">' +
    '<div class="p-5 border-b bg-gradient-to-r from-violet-50 to-purple-50 flex items-center justify-between">' +
    '<div class="flex items-center gap-3"><div class="w-9 h-9 bg-violet-100 rounded-xl flex items-center justify-center"><i class="fas fa-satellite-dish text-violet-600"></i></div>' +
    '<div><h3 class="font-bold text-gray-800 text-lg">LiveKit Deployment Center</h3><p class="text-xs text-gray-500">Configure SIP trunks, phone numbers, and deploy the Roofer Secretary AI per customer</p></div></div>' +
    '<button onclick="obLoadDeployments()" class="text-xs text-violet-600 hover:text-violet-800 font-medium px-3 py-1.5 bg-white border border-violet-200 rounded-lg"><i class="fas fa-sync mr-1"></i>Refresh</button>' +
    '</div>' +
    '<div id="ob-deployment-center" class="p-5">' +
    '<div class="text-center text-gray-400 py-6"><i class="fas fa-spinner fa-spin text-2xl mb-2"></i><p class="text-sm">Loading deployment status...</p></div>' +
    '</div>' +
    '</div>' +

    // --- Phone Pool Management ---
    '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mb-6">' +
    '<div class="p-5 border-b bg-gradient-to-r from-green-50 to-teal-50 flex items-center justify-between">' +
    '<div class="flex items-center gap-3"><div class="w-9 h-9 bg-green-100 rounded-xl flex items-center justify-center"><i class="fas fa-phone-square-alt text-green-600"></i></div>' +
    '<div><h3 class="font-bold text-gray-800 text-lg">Phone Pool</h3><p class="text-xs text-gray-500">Purchased numbers available to assign to Secretary AI customers</p></div></div>' +
    '<div class="flex gap-2">' +
    '<button onclick="loadView(\'phone-marketplace\')" class="text-xs text-green-700 hover:text-green-900 font-medium px-3 py-1.5 bg-white border border-green-200 rounded-lg"><i class="fas fa-cart-plus mr-1"></i>Buy Number</button>' +
    '<button onclick="obLoadPhonePool()" class="text-xs text-green-600 hover:text-green-800 font-medium px-3 py-1.5 bg-white border border-green-200 rounded-lg"><i class="fas fa-sync mr-1"></i>Refresh</button>' +
    '</div></div>' +
    // Add number to pool manually
    '<div class="p-5 border-b">' +
    '<p class="text-xs font-bold text-gray-600 mb-2"><i class="fas fa-plus-circle mr-1 text-green-500"></i>Add Number to Pool (manual entry)</p>' +
    '<div class="flex gap-3">' +
    '<input id="ob-pool-phone" class="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono" placeholder="+1 780 555 1234">' +
    '<button onclick="obAddToPool()" class="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-bold whitespace-nowrap"><i class="fas fa-plus mr-1"></i>Add to Pool</button>' +
    '</div>' +
    '<p class="text-[10px] text-gray-400 mt-1">Enter a number you\'ve already purchased from Twilio/LiveKit and want to track in the pool.</p>' +
    '</div>' +
    '<div id="ob-phone-pool-table" class="p-5">' +
    '<div class="text-center text-gray-400 py-4"><i class="fas fa-spinner fa-spin text-xl mb-1"></i><p class="text-sm">Loading phone pool...</p></div>' +
    '</div>' +
    '</div>' +

    // --- Onboarded Customers Table ---
    '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">' +
    '<div class="p-4 border-b bg-gray-50 flex items-center justify-between"><h3 class="font-bold text-gray-800">Onboarded Customers (' + customers.length + ')</h3><button onclick="loadView(\'customer-onboarding\')" class="text-xs text-blue-600 hover:text-blue-800 font-medium"><i class="fas fa-sync mr-1"></i>Refresh</button></div>' +
    (customers.length === 0 ? '<div class="p-8 text-center text-gray-400"><i class="fas fa-users text-3xl mb-3 opacity-30"></i><p>No customers onboarded yet</p></div>' :
    '<div class="overflow-x-auto"><table class="w-full"><thead><tr class="bg-gray-50 text-xs text-gray-500 uppercase"><th class="px-4 py-3 text-left">Customer</th><th class="px-4 py-3 text-left">Personal Phone</th><th class="px-4 py-3 text-left">Agent Phone #</th><th class="px-4 py-3 text-center">Provider</th><th class="px-4 py-3 text-center">Secretary</th><th class="px-4 py-3 text-center">Mode</th><th class="px-4 py-3 text-center">LiveKit</th><th class="px-4 py-3 text-left">Onboarded</th><th class="px-4 py-3 text-left">Actions</th></tr></thead><tbody>' + rows + '</tbody></table></div>') +
    '</div>';
}

// ── Quick Account Setup ──────────────────────────────────────
// Delegate clicks — robust to re-renders and inline-onclick issues
document.addEventListener('click', function(ev) {
  var btn = ev.target && ev.target.closest && ev.target.closest('#qa-create-btn');
  if (btn) { ev.preventDefault(); window.saCreateRoofAccount(); }
});

window.saCreateRoofAccount = async function() {
  var email = (document.getElementById('qa-email').value || '').trim();
  var password = (document.getElementById('qa-password').value || '').trim();
  var name = (document.getElementById('qa-name').value || '').trim();
  var business = (document.getElementById('qa-business').value || '').trim();
  var credits = parseInt(document.getElementById('qa-credits').value) || 0;
  var resultEl = document.getElementById('qa-result');

  if (!email || !password || !name) {
    window.rmToast('Contact Name, Email, and Password are required', 'warning');
    return;
  }
  if (password.length < 8) {
    window.rmToast('Password must be at least 8 characters', 'warning');
    return;
  }

  resultEl.className = 'mt-3 text-xs text-gray-500 italic';
  resultEl.classList.remove('hidden');
  resultEl.textContent = 'Creating account...';

  try {
    var res = await saFetch('/api/admin/superadmin/users/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: email,
        password: password,
        name: name,
        company_name: business || name
      })
    });
    var data = await res.json();
    if (data.success) {
      if (credits > 0 && data.customer_id) {
        await saFetch('/api/admin/superadmin/users/' + data.customer_id + '/adjust-credits', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: credits, reason: 'Onboarding grant' })
        });
      }
      resultEl.className = 'mt-3 p-3 rounded-lg bg-green-50 border border-green-200 text-sm text-green-800';
      resultEl.innerHTML =
        '<i class="fas fa-check-circle mr-2 text-green-600"></i><b>' + name + '</b> account created! ' +
        'Login: <span class="font-mono bg-white px-1.5 py-0.5 rounded border border-green-200">' + email + '</span> &nbsp;' +
        '<button onclick="document.getElementById(\'inv-email\').value=\'' + email.replace(/'/g, '') + '\';document.getElementById(\'qa-result\').classList.add(\'hidden\')" ' +
        'class="ml-2 text-xs underline text-green-700 hover:text-green-900">Pre-fill invoice &rarr;</button>';
      document.getElementById('qa-email').value = '';
      document.getElementById('qa-password').value = '';
      document.getElementById('qa-name').value = '';
      document.getElementById('qa-business').value = '';
    } else {
      resultEl.className = 'mt-3 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800';
      resultEl.innerHTML = '<i class="fas fa-exclamation-circle mr-2"></i>' + (data.error || 'Failed to create account');
    }
  } catch(e) {
    resultEl.className = 'mt-3 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800';
    resultEl.textContent = 'Error: ' + e.message;
  }
};

// ── Send Invoice ─────────────────────────────────────────────
window.saSendOnboardingInvoice = async function() {
  var email = (document.getElementById('inv-email').value || '').trim();
  var name = (document.getElementById('inv-name').value || '').trim();
  var business = (document.getElementById('inv-business').value || '').trim();
  if (!email) { window.rmToast('Customer email is required', 'warning'); return; }
  if (!name) { window.rmToast('Customer name is required', 'warning'); return; }

  var createAcct = document.getElementById('inv-create-account') && document.getElementById('inv-create-account').checked;
  var acctPassword = createAcct ? (document.getElementById('inv-acct-password').value || '').trim() : '';
  var acctCredits = createAcct ? (parseInt(document.getElementById('inv-acct-credits').value) || 0) : 0;
  if (createAcct && acctPassword.length < 8) { window.rmToast('Account password must be at least 8 characters', 'warning'); return; }

  var items = [];
  if (document.getElementById('inv-10pack').checked)  items.push({ description: '10 Roof Report Credits',  quantity: 10,  unit_price: 5.50 });
  if (document.getElementById('inv-25pack').checked)  items.push({ description: '25 Roof Report Credits',  quantity: 25,  unit_price: 7.00 });
  if (document.getElementById('inv-100pack').checked) items.push({ description: '100 Roof Report Credits', quantity: 100, unit_price: 5.95 });
  if (document.getElementById('inv-annual').checked)  items.push({ description: 'Annual Membership — 12 months (2 months free)', quantity: 1, unit_price: 499.00 });
  var secEl = document.getElementById('inv-secretary-1mo');       if (secEl && secEl.checked) items.push({ description: 'AI Secretary — 1st Month Subscription', quantity: 1, unit_price: 149.00 });
  var msEl = document.getElementById('inv-mem-starter');           if (msEl && msEl.checked) items.push({ description: 'Monthly Membership — Starter (1 month)', quantity: 1, unit_price: 49.99 });
  var mpEl = document.getElementById('inv-mem-pro');               if (mpEl && mpEl.checked) items.push({ description: 'Monthly Membership — Pro (1 month)', quantity: 1, unit_price: 149.00 });
  var meEl = document.getElementById('inv-mem-enterprise');        if (meEl && meEl.checked) items.push({ description: 'Monthly Membership — Enterprise (1 month)', quantity: 1, unit_price: 499.00 });

  var customDesc  = (document.getElementById('inv-custom-desc').value || '').trim();
  var customPrice = parseFloat(document.getElementById('inv-custom-price').value) || 0;
  if (customDesc && customPrice > 0) items.push({ description: customDesc, quantity: 1, unit_price: customPrice });

  if (!items.length) { window.rmToast('Select at least one item to invoice', 'warning'); return; }

  var notes = document.getElementById('inv-notes').value || '';
  var resultEl = document.getElementById('inv-result');
  resultEl.className = 'mt-3 text-xs text-gray-500 italic';
  resultEl.classList.remove('hidden');
  resultEl.textContent = createAcct ? 'Creating account...' : 'Creating invoice...';

  try {
    var acctMsg = '';
    if (createAcct) {
      var acctRes = await saFetch('/api/admin/superadmin/users/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, password: acctPassword, name: name, company_name: business || name })
      });
      var acctData = await acctRes.json();
      if (acctData.success) {
        if (acctCredits > 0 && acctData.customer_id) {
          await saFetch('/api/admin/superadmin/users/' + acctData.customer_id + '/adjust-credits', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: acctCredits, reason: 'Onboarding grant via Send Invoice' })
          });
        }
        acctMsg = ' Account created for <b>' + email + '</b>.';
      } else if (acctData.error && /exists|duplicate/i.test(acctData.error)) {
        acctMsg = ' (Account already existed — continuing.)';
      } else {
        throw new Error('Account creation failed: ' + (acctData.error || 'unknown'));
      }
    }
    resultEl.textContent = 'Creating invoice...';
    var res = await saFetch('/api/admin/superadmin/service-invoices/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer_email: email, customer_name: name, business_name: business, items: items, notes: notes })
    });
    var data = await res.json();
    if (!data.invoice_id && !data.success) throw new Error(data.error || 'Create failed');

    var invoiceId = data.invoice_id || data.id;
    resultEl.textContent = 'Sending...';
    await saFetch('/api/admin/superadmin/service-invoices/' + invoiceId + '/send', { method: 'POST' });

    var total = items.reduce(function(s, it) { return s + it.quantity * it.unit_price; }, 0);
    resultEl.className = 'mt-3 p-3 rounded-lg bg-green-50 border border-green-200 text-sm text-green-800';
    resultEl.innerHTML =
      '<i class="fas fa-check-circle mr-2 text-green-600"></i>Invoice <b>' + (data.invoice_number || '#' + invoiceId) + '</b> ' +
      'for <b>$' + total.toFixed(2) + '</b> sent to <b>' + email + '</b>!' + acctMsg;
    // Clear form
    ['inv-10pack','inv-25pack','inv-100pack','inv-annual','inv-secretary-1mo','inv-mem-starter','inv-mem-pro','inv-mem-enterprise'].forEach(function(id) {
      var el = document.getElementById(id); if (el) el.checked = false;
    });
    document.getElementById('inv-custom-desc').value = '';
    document.getElementById('inv-custom-price').value = '';
    document.getElementById('inv-total-display').textContent = '';
  } catch(e) {
    resultEl.className = 'mt-3 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800';
    resultEl.innerHTML = '<i class="fas fa-exclamation-circle mr-2"></i>Error: ' + e.message;
  }
};

// Live invoice total preview
document.addEventListener('change', function(e) {
  var t = e.target;
  if (!t) return;
  var ids = ['inv-10pack','inv-25pack','inv-100pack','inv-annual','inv-secretary-1mo','inv-mem-starter','inv-mem-pro','inv-mem-enterprise'];
  if (ids.indexOf(t.id) === -1 && t.id !== 'inv-custom-price') return;
  var prices = { 'inv-10pack': 55, 'inv-25pack': 175, 'inv-100pack': 475, 'inv-annual': 499, 'inv-secretary-1mo': 149, 'inv-mem-starter': 49.99, 'inv-mem-pro': 149, 'inv-mem-enterprise': 499 };
  var total = 0;
  ids.forEach(function(id) { var el = document.getElementById(id); if (el && el.checked) total += prices[id]; });
  var cp = parseFloat((document.getElementById('inv-custom-price') || {}).value) || 0;
  total += cp;
  var disp = document.getElementById('inv-total-display');
  if (disp) disp.textContent = total > 0 ? 'Total: $' + total.toFixed(2) : '';
});

// ── Preview Invoice (creates draft, opens public view in new tab) ──
window.saPreviewOnboardingInvoice = async function() {
  var email = (document.getElementById('inv-email').value || '').trim();
  var name = (document.getElementById('inv-name').value || '').trim();
  var business = (document.getElementById('inv-business').value || '').trim();
  if (!email) { window.rmToast('Customer email is required', 'warning'); return; }

  var items = [];
  if (document.getElementById('inv-10pack').checked)  items.push({ description: '10 Roof Report Credits',  quantity: 10,  unit_price: 5.50 });
  if (document.getElementById('inv-25pack').checked)  items.push({ description: '25 Roof Report Credits',  quantity: 25,  unit_price: 7.00 });
  if (document.getElementById('inv-100pack').checked) items.push({ description: '100 Roof Report Credits', quantity: 100, unit_price: 5.95 });
  if (document.getElementById('inv-annual').checked)  items.push({ description: 'Annual Membership — 12 months (2 months free)', quantity: 1, unit_price: 499.00 });
  var secEl = document.getElementById('inv-secretary-1mo');       if (secEl && secEl.checked) items.push({ description: 'AI Secretary — 1st Month Subscription', quantity: 1, unit_price: 149.00 });
  var msEl = document.getElementById('inv-mem-starter');           if (msEl && msEl.checked) items.push({ description: 'Monthly Membership — Starter (1 month)', quantity: 1, unit_price: 49.99 });
  var mpEl = document.getElementById('inv-mem-pro');               if (mpEl && mpEl.checked) items.push({ description: 'Monthly Membership — Pro (1 month)', quantity: 1, unit_price: 149.00 });
  var meEl = document.getElementById('inv-mem-enterprise');        if (meEl && meEl.checked) items.push({ description: 'Monthly Membership — Enterprise (1 month)', quantity: 1, unit_price: 499.00 });

  var customDesc  = (document.getElementById('inv-custom-desc').value || '').trim();
  var customPrice = parseFloat(document.getElementById('inv-custom-price').value) || 0;
  if (customDesc && customPrice > 0) items.push({ description: customDesc, quantity: 1, unit_price: customPrice });

  if (!items.length) { window.rmToast('Select at least one item to preview', 'warning'); return; }

  var notes = document.getElementById('inv-notes').value || '';
  var resultEl = document.getElementById('inv-result');
  resultEl.className = 'mt-3 text-xs text-gray-500 italic';
  resultEl.classList.remove('hidden');
  resultEl.textContent = 'Building preview...';

  try {
    var res = await saFetch('/api/admin/superadmin/service-invoices/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer_email: email, customer_name: name, business_name: business, items: items, notes: notes })
    });
    var data = await res.json();
    if (!data.invoice_id && !data.success) throw new Error(data.error || 'Preview failed');
    if (!data.share_token) throw new Error('No share token returned');

    var url = '/invoice/view/' + data.share_token;
    window.open(url, '_blank');
    resultEl.className = 'mt-3 p-3 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-800';
    resultEl.innerHTML =
      '<i class="fas fa-eye mr-2"></i>Draft invoice <b>' + (data.invoice_number || '#' + data.invoice_id) + '</b> opened in new tab. ' +
      'It has <b>not</b> been emailed yet — click "Create &amp; Send Invoice" to send it, or edit selections and preview again.';
  } catch(e) {
    resultEl.className = 'mt-3 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800';
    resultEl.innerHTML = '<i class="fas fa-exclamation-circle mr-2"></i>Preview failed: ' + e.message;
  }
};

window.createOnboardingCustomer = async function() {
  var email = document.getElementById('ob-email').value;
  var password = document.getElementById('ob-password').value;
  var contactName = document.getElementById('ob-name').value;
  if (!email || !password) { window.rmToast('Email and Password are required', 'warning'); return; }
  if (!contactName) { window.rmToast('Contact Name is required', 'warning'); return; }

  var personalPhone = document.getElementById('ob-personal-phone').value;
  var agentPhone = document.getElementById('ob-agent-phone').value;

  if (!personalPhone) { window.rmToast('Personal Phone Number is required — this is the customer\'s cell they forward calls FROM', 'warning'); return; }
  if (!agentPhone) {
    if (!(await window.rmConfirm('No Agent Phone Number entered. The customer will need to purchase a phone number from Twilio or similar provider before Secretary AI can make/receive calls. Continue anyway?'))) return
  }

  var body = {
    business_name: document.getElementById('ob-business').value,
    contact_name: contactName,
    email: email,
    phone: personalPhone,
    password: password,
    secretary_mode: document.getElementById('ob-sec-mode').value,
    personal_phone: personalPhone,
    agent_phone_number: agentPhone,
    phone_provider: document.getElementById('ob-provider').value,
    secretary_phone_number: agentPhone,
    call_forwarding_number: personalPhone,
    notes: document.getElementById('ob-notes').value,
    enable_secretary: document.getElementById('ob-enable-sec').checked,
    forwarding_method: (document.getElementById('ob-forwarding-method') || {}).value || 'livekit_number',
    sip_uri: (document.getElementById('ob-sip-uri') || {}).value || '',
    sip_username: (document.getElementById('ob-sip-username') || {}).value || '',
    sip_password: (document.getElementById('ob-sip-password') || {}).value || '',
    // Subscription & billing
    subscription_tier: document.getElementById('ob-sub-tier') ? document.getElementById('ob-sub-tier').value : 'starter',
    trial_days: document.getElementById('ob-trial-days') ? document.getElementById('ob-trial-days').value : '30',
    credit_pack: document.getElementById('ob-credit-pack') ? document.getElementById('ob-credit-pack').value : 'none',
    send_invoice: document.getElementById('ob-send-invoice') ? document.getElementById('ob-send-invoice').checked : false
  };

  try {
    var res = await saFetch('/api/admin/superadmin/onboarding/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    var data = await res.json();
    if (data.success) {
      var msg = 'Customer account created for ' + contactName + '!\n\n';
      if (data.subscription_tier) {
        msg += 'Subscription: ' + data.subscription_tier.toUpperCase() + '\n';
        msg += 'Trial Ends: ' + new Date(data.trial_ends_at).toLocaleDateString('en-CA') + '\n\n';
      }
      if (data.invoice) {
        msg += 'Invoice ' + data.invoice.invoice_number + ' created & emailed!\n';
        if (data.invoice.checkout_url) msg += 'Payment Link: ' + data.invoice.checkout_url + '\n';
        msg += '\n';
      }
      if (data.secretary_setup) {
        msg += 'Secretary AI: ACTIVE\n';
        msg += 'Agent Phone: ' + (data.agent_phone_number || agentPhone) + '\n';
        msg += 'Personal Phone: ' + (data.personal_phone || personalPhone) + '\n';
        if (data.livekit_deployed) {
          msg += '\nLiveKit Agent: DEPLOYED (trunk: ' + data.livekit_trunk_id + ')\n';
        } else if (data.livekit_error) {
          msg += '\nLiveKit Agent: NOT DEPLOYED — ' + data.livekit_error + '\n';
        }
      }
      window.rmToast(msg, 'info');
      loadView('customer-onboarding');
    } else {
      window.rmToast(data.error || 'Failed to create customer', 'info');
    }
  } catch(e) { window.rmToast('Error creating customer: ' + e.message, 'error'); }
}

function updateForwardingMethodUI() {
  var sel = document.getElementById('ob-forwarding-method');
  var sipBox = document.getElementById('ob-sip-fields');
  var help = document.getElementById('ob-fwd-help');
  if (!sel) return;
  var m = sel.value;
  if (sipBox) sipBox.classList.toggle('hidden', m !== 'sip_trunk');
  if (help) {
    if (m === 'livekit_number') help.textContent = 'Customer forwards their personal cell to the assigned LiveKit number.';
    else if (m === 'call_forwarding') help.textContent = 'Customer keeps existing carrier number and forwards busy/no-answer to LiveKit.';
    else help.textContent = 'Bring-your-own SIP trunk: enter the carrier URI + auth credentials below.';
  }
}

window.testSecretaryCall = async function(customerId) {
  window.rmToast('Running trunk health test...', 'info');
  try {
    var res = await saFetch('/api/admin/superadmin/secretary/' + customerId + '/test-call', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    var data = await res.json();
    window.rmToast((data.success ? 'PASS — ' : 'FAIL — ') + (data.details || data.result), data.success ? 'success' : 'error');
  } catch (e) { window.rmToast('Test failed: ' + e.message, 'error'); }
};

function updateTrialEndDate() {
  var el = document.getElementById('ob-trial-end-display');
  var sel = document.getElementById('ob-trial-days');
  if (!el || !sel) return;
  var days = parseInt(sel.value) || 30;
  var end = new Date(Date.now() + days * 86400000);
  el.textContent = 'Trial ends: ' + end.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
}

async function sendQuickInvoice() {
  var email = document.getElementById('mkt-inv-email')?.value;
  var desc = document.getElementById('mkt-inv-desc')?.value || 'Service';
  var amount = parseFloat(document.getElementById('mkt-inv-amount')?.value);
  if (!email || !amount) { window.rmToast('Email and amount are required', 'warning'); return; }
  try {
    var res = await saFetch('/api/admin/superadmin/service-invoices/create', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer_email: email, items: [{ description: desc, quantity: 1, unit_price: amount }] })
    });
    var data = await res.json();
    if (data.success || data.invoice_id) {
      await saFetch('/api/admin/superadmin/service-invoices/' + (data.invoice_id || data.id) + '/send', { method: 'POST' });
      window.rmToast('Invoice ' + (data.invoice_number || '') + ' created and sent to ' + email, 'success');
      loadView('marketing');
    } else { window.rmToast(data.error || 'Failed to create invoice', 'info'); }
  } catch(e) { window.rmToast('Error: ' + e.message, 'error'); }
}

async function sendTrialExpiryInvoice(email, priceCents, plan) {
  if (!(await window.rmConfirm('Send $' + (priceCents / 100).toFixed(2) + '/mo subscription invoice to ' + email + '?', 'Send Invoice', 'Cancel'))) return;
  try {
    var price = priceCents / 100;
    var res = await saFetch('/api/admin/superadmin/service-invoices/create', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_email: email,
        items: [{ description: plan.charAt(0).toUpperCase() + plan.slice(1) + ' Plan - Monthly Subscription', quantity: 1, unit_price: price }],
        notes: 'Monthly subscription invoice'
      })
    });
    var data = await res.json();
    if (data.success || data.invoice_id) {
      await saFetch('/api/admin/superadmin/service-invoices/' + (data.invoice_id || data.id) + '/send', { method: 'POST' });
      window.rmToast('Subscription invoice sent to ' + email, 'success');
      loadView('marketing');
    } else { window.rmToast(data.error || 'Failed', 'info'); }
  } catch(e) { window.rmToast('Error: ' + e.message, 'error'); }
}

async function toggleSecretaryMode(id, enable) {
  try {
    await saFetch('/api/admin/superadmin/onboarding/' + id + '/toggle-secretary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: enable })
    });
    loadView('customer-onboarding');
  } catch(e) { window.rmToast('Error toggling secretary', 'error'); }
}

async function deployLiveKitAgent(customerId) {
  if (!(await window.rmConfirm('Deploy LiveKit AI agent for customer #' + customerId + '?\n\nThis will create a SIP trunk and dispatch rule in LiveKit Cloud so the AI agent can receive calls.'))) return
  try {
    var res = await saFetch('/api/admin/superadmin/deploy-secretary/' + customerId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    var data = await res.json();
    if (data.success) {
      window.rmToast('LiveKit Agent Deployed!\n\nTrunk ID: ' + data.trunk_id + '\nDispatch Rule: ' + data.dispatch_rule_id + '\n\n' + data.message, 'info');
      loadView('customer-onboarding');
    } else {
      window.rmToast('Deploy failed: ' + (data.error || 'Unknown error') + (data.details ? '\n\nDetails: ' + data.details : ''), 'error');
    }
  } catch(e) { window.rmToast('Error deploying LiveKit agent: ' + e.message, 'error'); }
}

// ============================================================
// LIVEKIT DEPLOYMENT CENTER — render / reload helpers
// ============================================================

window.obLoadDeployments = async function() {
  try {
    var res = await saFetch('/api/admin/superadmin/secretary/deployment-status');
    if (!res) return;
    SA.data.deployments = await res.json();
    obRenderDeployments();
  } catch(e) { window.rmToast('Error loading deployments: ' + e.message, 'error'); }
};

function obRenderDeployments() {
  var el = document.getElementById('ob-deployment-center');
  if (!el) return;
  var d = SA.data.deployments || {};
  var deps = d.deployments || [];
  if (d.error) { el.innerHTML = '<p class="text-red-500 text-sm p-2"><i class="fas fa-exclamation-triangle mr-1"></i>' + d.error + '</p>'; return; }
  if (deps.length === 0) { el.innerHTML = '<p class="text-gray-400 text-sm text-center py-4">No Secretary AI customers yet. Create one above.</p>'; return; }

  var html = '<div class="overflow-x-auto"><table class="w-full text-sm">' +
    '<thead><tr class="border-b text-xs text-gray-400 uppercase">' +
    '<th class="pb-2 text-left">Customer</th>' +
    '<th class="pb-2 text-left">Agent Phone</th>' +
    '<th class="pb-2 text-left">Trunk ID</th>' +
    '<th class="pb-2 text-center">Status</th>' +
    '<th class="pb-2 text-center">Last Test</th>' +
    '<th class="pb-2 text-right">Actions</th>' +
    '</tr></thead><tbody>';

  deps.forEach(function(dep) {
    var deployed = dep.trunk_id && dep.trunk_id !== '';
    var statusBadge = dep.connection_status === 'connected'
      ? '<span class="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-[10px] font-bold">Connected</span>'
      : dep.connection_status === 'pending_forwarding'
      ? '<span class="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-[10px] font-bold">Pending</span>'
      : dep.connection_status === 'failed'
      ? '<span class="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-[10px] font-bold">Failed</span>'
      : '<span class="px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full text-[10px]">Not Set</span>';

    var lastTest = dep.last_test_result
      ? (dep.last_test_result === 'passed' ? '<span class="text-green-600 text-[10px]"><i class="fas fa-check mr-0.5"></i>Pass</span>' : '<span class="text-red-500 text-[10px]"><i class="fas fa-times mr-0.5"></i>Fail</span>')
      : '<span class="text-gray-300 text-[10px]">—</span>';

    var trunkDisplay = deployed ? '<span class="font-mono text-[10px] text-violet-700 bg-violet-50 px-1.5 py-0.5 rounded">' + dep.trunk_id.substring(0, 16) + '…</span>' : '<span class="text-gray-300 text-[10px]">—</span>';

    var phoneDisplay = dep.agent_phone ? '<span class="font-mono text-gray-800">' + dep.agent_phone + '</span>' : '<span class="text-gray-300 text-xs italic">No number set</span>';

    html += '<tr class="border-b border-gray-50 hover:bg-gray-50">' +
      '<td class="py-3 pr-3"><div class="font-semibold text-gray-800">' + (dep.business_name || dep.contact_name || dep.email) + '</div><div class="text-[10px] text-gray-400">' + dep.email + '</div></td>' +
      '<td class="py-3 pr-3">' + phoneDisplay + '</td>' +
      '<td class="py-3 pr-3">' + trunkDisplay + '</td>' +
      '<td class="py-3 pr-3 text-center">' + statusBadge + '</td>' +
      '<td class="py-3 pr-3 text-center">' + lastTest + '</td>' +
      '<td class="py-3 text-right whitespace-nowrap">' +
        '<button onclick="obOpenSipConfig(' + dep.id + ', \'' + encodeURIComponent(JSON.stringify({id: dep.id, business_name: dep.business_name||dep.contact_name, email: dep.email, agent_phone: dep.agent_phone||'', sip_uri: dep.sip_uri||'', sip_username: dep.sip_username||'', trunk_id: dep.trunk_id||'', dispatch_id: dep.dispatch_id||''})) + '\')" class="text-xs bg-violet-600 hover:bg-violet-700 text-white px-2.5 py-1 rounded-lg font-medium mr-1"><i class="fas fa-cog mr-1"></i>Configure</button>' +
        (deployed ? '<button onclick="testSecretaryCall(' + dep.id + ')" class="text-xs bg-amber-500 hover:bg-amber-600 text-white px-2.5 py-1 rounded-lg font-medium"><i class="fas fa-vial mr-1"></i>Test</button>' : '') +
      '</td>' +
      '</tr>';
  });

  html += '</tbody></table></div>';
  el.innerHTML = html;
}

window.obOpenSipConfig = function(customerId, encodedData) {
  var data = JSON.parse(decodeURIComponent(encodedData));
  var deployed = data.trunk_id && data.trunk_id !== '';

  // Remove any existing modal
  var existing = document.getElementById('ob-sip-modal');
  if (existing) existing.remove();

  var modal = document.createElement('div');
  modal.id = 'ob-sip-modal';
  modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4';
  modal.innerHTML =
    '<div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg">' +
    '<div class="p-5 border-b flex items-center justify-between">' +
    '<div><h3 class="font-bold text-gray-900 text-lg"><i class="fas fa-satellite-dish mr-2 text-violet-500"></i>SIP Trunk Config</h3>' +
    '<p class="text-xs text-gray-500">' + (data.business_name || data.email) + '</p></div>' +
    '<button onclick="document.getElementById(\'ob-sip-modal\').remove()" class="text-gray-400 hover:text-gray-600 text-xl">&times;</button>' +
    '</div>' +
    '<div class="p-5 space-y-4">' +

    // Agent phone
    '<div><label class="text-xs font-bold text-gray-600 block mb-1"><i class="fas fa-phone mr-1 text-purple-500"></i>Agent Phone Number (SIP)</label>' +
    '<input id="sip-agent-phone" class="w-full border-2 border-purple-200 rounded-lg px-3 py-2.5 text-sm font-mono focus:border-purple-500" value="' + (data.agent_phone || '') + '" placeholder="+1 780 555 1234">' +
    '<p class="text-[10px] text-gray-400 mt-1">The number the AI agent answers on (purchased from Twilio/LiveKit)</p></div>' +

    // SIP URI
    '<div><label class="text-xs font-bold text-gray-600 block mb-1"><i class="fas fa-network-wired mr-1 text-blue-500"></i>SIP URI <span class="font-normal text-gray-400">(optional — for BYO trunk)</span></label>' +
    '<input id="sip-uri" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono" value="' + (data.sip_uri || '') + '" placeholder="sip:trunk.carrier.com"></div>' +

    // SIP auth
    '<div class="grid grid-cols-2 gap-3">' +
    '<div><label class="text-xs font-bold text-gray-600 block mb-1">SIP Username</label><input id="sip-username" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" value="' + (data.sip_username || '') + '" placeholder="trunk-user"></div>' +
    '<div><label class="text-xs font-bold text-gray-600 block mb-1">SIP Password</label><input id="sip-password" type="password" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="leave blank to keep current"></div>' +
    '</div>' +

    // Current trunk info
    (deployed ? '<div class="bg-violet-50 border border-violet-200 rounded-xl p-3 text-xs space-y-1">' +
    '<p class="font-bold text-violet-700"><i class="fas fa-check-circle mr-1"></i>LiveKit Trunk Deployed</p>' +
    '<p class="font-mono text-violet-600">Trunk: ' + data.trunk_id + '</p>' +
    '<p class="font-mono text-violet-600">Dispatch: ' + (data.dispatch_id || '—') + '</p>' +
    '</div>' : '<div class="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs"><p class="font-bold text-amber-700"><i class="fas fa-exclamation-triangle mr-1"></i>No LiveKit trunk deployed yet</p><p class="text-amber-600 mt-1">Save the agent phone number then click "Save &amp; Deploy" to create the SIP trunk.</p></div>') +

    '<div id="sip-config-result" class="hidden"></div>' +

    '</div>' +
    '<div class="p-5 border-t flex gap-3 justify-end">' +
    '<button onclick="document.getElementById(\'ob-sip-modal\').remove()" class="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">Cancel</button>' +
    '<button onclick="obSaveSipConfig(' + customerId + ', false)" class="px-5 py-2 bg-gray-800 hover:bg-gray-900 text-white rounded-lg text-sm font-bold"><i class="fas fa-save mr-1"></i>Save Only</button>' +
    '<button onclick="obSaveSipConfig(' + customerId + ', true)" class="px-5 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-bold"><i class="fas fa-rocket mr-1"></i>Save &amp; Deploy</button>' +
    '</div>' +
    '</div>';

  document.body.appendChild(modal);
};

window.obSaveSipConfig = async function(customerId, deploy) {
  var phone = (document.getElementById('sip-agent-phone').value || '').trim();
  var sipUri = (document.getElementById('sip-uri').value || '').trim();
  var sipUser = (document.getElementById('sip-username').value || '').trim();
  var sipPass = (document.getElementById('sip-password').value || '').trim();
  var resultEl = document.getElementById('sip-config-result');

  if (!phone) { window.rmToast('Agent phone number is required', 'warning'); return; }

  resultEl.className = 'text-xs text-gray-500 italic p-2';
  resultEl.classList.remove('hidden');
  resultEl.textContent = deploy ? 'Saving config and deploying LiveKit trunk...' : 'Saving SIP config...';

  try {
    var body = { agent_phone_number: phone, deploy_livekit: deploy };
    if (sipUri)  body.sip_uri = sipUri;
    if (sipUser) body.sip_username = sipUser;
    if (sipPass) body.sip_password = sipPass;

    var res = await saFetch('/api/admin/superadmin/secretary/' + customerId + '/update-phone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    var data = await res.json();
    if (data.success) {
      if (deploy && data.livekit) {
        if (data.livekit.success) {
          resultEl.className = 'text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg p-3';
          resultEl.innerHTML = '<i class="fas fa-check-circle mr-1"></i><b>Deployed!</b> Trunk: <span class="font-mono">' + data.livekit.trunk_id + '</span>';
        } else {
          resultEl.className = 'text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3';
          resultEl.innerHTML = '<i class="fas fa-exclamation-circle mr-1"></i>Config saved but LiveKit deploy failed: ' + (data.livekit.error || 'Unknown error');
        }
      } else {
        resultEl.className = 'text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg p-3';
        resultEl.innerHTML = '<i class="fas fa-check-circle mr-1"></i>SIP config saved successfully.';
      }
      obLoadDeployments();
    } else {
      resultEl.className = 'text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3';
      resultEl.innerHTML = '<i class="fas fa-exclamation-circle mr-1"></i>' + (data.error || 'Save failed');
    }
  } catch(e) {
    resultEl.className = 'text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3';
    resultEl.innerHTML = '<i class="fas fa-exclamation-circle mr-1"></i>Error: ' + e.message;
  }
};

// ============================================================
// PHONE POOL — render / reload / assign helpers
// ============================================================

window.obLoadPhonePool = async function() {
  try {
    var res = await saFetch('/api/admin/superadmin/phone-numbers/owned');
    if (!res) return;
    SA.data.phonePool = await res.json();
    obRenderPhonePool();
  } catch(e) { window.rmToast('Error loading phone pool: ' + e.message, 'error'); }
};

function obRenderPhonePool() {
  var el = document.getElementById('ob-phone-pool-table');
  if (!el) return;
  var d = SA.data.phonePool || {};
  // The owned endpoint returns either `phones` or `numbers`
  var pool = d.phones || d.numbers || [];

  if (pool.length === 0) {
    el.innerHTML = '<div class="text-center text-gray-400 py-4"><i class="fas fa-phone-slash text-2xl mb-2 opacity-30"></i><p class="text-sm">No numbers in pool yet.</p>' +
      '<button onclick="loadView(\'phone-marketplace\')" class="mt-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-bold"><i class="fas fa-cart-plus mr-1"></i>Buy a Number</button></div>';
    return;
  }

  // Build customer options for assign dropdown (from onboarding data)
  var customers = (SA.data.onboarding || {}).customers || [];
  var custOptions = '<option value="">— Select customer —</option>' + customers.map(function(c) {
    return '<option value="' + c.id + '">' + (c.business_name || c.contact_name) + ' (' + c.email + ')</option>';
  }).join('');

  var html = '<div class="overflow-x-auto"><table class="w-full text-sm">' +
    '<thead><tr class="border-b text-xs text-gray-400 uppercase">' +
    '<th class="pb-2 text-left">Number</th><th class="pb-2 text-center">Status</th><th class="pb-2 text-left">Assigned To</th><th class="pb-2 text-right">Action</th>' +
    '</tr></thead><tbody>';

  pool.forEach(function(p) {
    var statusBadge = p.status === 'assigned'
      ? '<span class="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-[10px] font-bold">Assigned</span>'
      : '<span class="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-[10px] font-bold">Available</span>';

    var assignedTo = p.customer_name ? ('<span class="text-xs text-gray-600">' + p.customer_name + '</span>') : '<span class="text-gray-300 text-xs">—</span>';

    var actionCell = p.status !== 'assigned'
      ? '<div class="flex items-center gap-2 justify-end">' +
        '<select id="pool-assign-cust-' + p.id + '" class="border border-gray-300 rounded-lg px-2 py-1 text-xs">' + custOptions + '</select>' +
        '<button onclick="obAssignFromPool(' + p.id + ', \'' + (p.phone_number || '') + '\')" class="px-2.5 py-1 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-[10px] font-bold whitespace-nowrap"><i class="fas fa-link mr-0.5"></i>Assign + Deploy</button>' +
        '</div>'
      : '<span class="text-xs text-gray-300">In use</span>';

    html += '<tr class="border-b border-gray-50 hover:bg-gray-50">' +
      '<td class="py-3 pr-3 font-mono font-bold text-gray-800">' + (p.phone_number || '—') + '</td>' +
      '<td class="py-3 pr-3 text-center">' + statusBadge + '</td>' +
      '<td class="py-3 pr-3">' + assignedTo + '</td>' +
      '<td class="py-3">' + actionCell + '</td>' +
      '</tr>';
  });

  html += '</tbody></table></div>';
  el.innerHTML = html;
}

window.obAddToPool = async function() {
  var phone = (document.getElementById('ob-pool-phone').value || '').trim();
  if (!phone) { window.rmToast('Enter a phone number', 'warning'); return; }
  try {
    var res = await saFetch('/api/admin/superadmin/phone-pool/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone_number: phone })
    });
    var data = await res.json();
    if (data.success) {
      window.rmToast('Number added to pool: ' + phone, 'success');
      document.getElementById('ob-pool-phone').value = '';
      obLoadPhonePool();
    } else {
      window.rmToast('Error: ' + (data.error || 'Unknown'), 'error');
    }
  } catch(e) { window.rmToast('Error: ' + e.message, 'error'); }
};

window.obAssignFromPool = async function(poolId, phoneNumber) {
  var sel = document.getElementById('pool-assign-cust-' + poolId);
  var customerId = sel ? sel.value : '';
  if (!customerId) { window.rmToast('Select a customer to assign to', 'warning'); return; }
  if (!(await window.rmConfirm('Assign ' + phoneNumber + ' to this customer and deploy LiveKit SIP trunk?\n\nThis will create an inbound trunk and dispatch rule in LiveKit Cloud.'))) return;
  try {
    var res = await saFetch('/api/admin/superadmin/phone-pool/assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone_number: phoneNumber, customer_id: parseInt(customerId), deploy_livekit: true })
    });
    var data = await res.json();
    if (data.success) {
      if (data.livekit_deployed) {
        window.rmToast('Number assigned and LiveKit trunk deployed!\n\nTrunk: ' + (data.livekit && data.livekit.trunk_id ? data.livekit.trunk_id : 'see deployment center'), 'info');
      } else {
        window.rmToast('Number assigned. LiveKit deploy may have failed — check the Deployment Center.', 'info');
      }
      obLoadPhonePool();
      obLoadDeployments();
      loadView('customer-onboarding');
    } else {
      window.rmToast('Assign failed: ' + (data.error || 'Unknown'), 'error');
    }
  } catch(e) { window.rmToast('Error: ' + e.message, 'error'); }
};

// ============================================================
// SERVICE INVOICES — Cold-call customer invoicing
// ============================================================
function renderServiceInvoicesView() {
  var d = SA.data.service_invoices || {};
  var invoices = d.invoices || [];
  var rows = invoices.map(function(inv) {
    var sBadge = { draft: 'bg-gray-100 text-gray-600', sent: 'bg-blue-100 text-blue-700', viewed: 'bg-purple-100 text-purple-700', paid: 'bg-green-100 text-green-800', overdue: 'bg-red-100 text-red-700', cancelled: 'bg-gray-100 text-gray-400' };
    return '<tr class="border-b border-gray-100 hover:bg-gray-50">' +
      '<td class="px-4 py-3 text-sm font-mono font-bold text-gray-800">' + (inv.invoice_number || '-') + '</td>' +
      '<td class="px-4 py-3"><div class="font-medium text-gray-800 text-sm">' + (inv.customer_name || 'N/A') + '</div><div class="text-xs text-gray-500">' + (inv.customer_email || '') + '</div></td>' +
      '<td class="px-4 py-3 text-sm font-bold text-gray-800">$' + parseFloat(inv.total || 0).toFixed(2) + '</td>' +
      '<td class="px-4 py-3 text-center"><span class="px-2 py-0.5 ' + (sBadge[inv.status] || 'bg-gray-100 text-gray-600') + ' rounded-full text-xs font-medium capitalize">' + (inv.status || 'draft') + '</span></td>' +
      '<td class="px-4 py-3 text-xs text-gray-400">' + fmtDate(inv.created_at) + '</td>' +
      '<td class="px-4 py-3">' +
        (inv.status === 'draft' ? '<button onclick="sendServiceInvoice(' + inv.id + ')" class="text-xs text-blue-600 hover:text-blue-800 font-medium mr-2"><i class="fas fa-paper-plane mr-1"></i>Send</button>' : '') +
        ((inv.payment_link || inv.square_payment_link_url) ? '<a href="' + (inv.payment_link || inv.square_payment_link_url) + '" target="_blank" class="text-xs text-green-600 hover:text-green-800 font-medium"><i class="fas fa-external-link-alt mr-1"></i>Payment Link</a>' : '') +
      '</td></tr>';
  }).join('');

  return '<div class="mb-6"><h2 class="text-2xl font-black text-gray-900"><i class="fas fa-file-invoice mr-2 text-amber-500"></i>Cold Call Invoices</h2><p class="text-sm text-gray-500 mt-1">Send invoices for Roofer Secretary AI subscriptions and setup fees to cold-call customers</p></div>' +
    '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">' +
    '<h3 class="font-bold text-gray-800 text-lg mb-4">Create Service Invoice</h3>' +
    '<div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">' +
    '<div><label class="text-xs text-gray-500 font-medium block mb-1">Customer Name</label><input id="si-name" class="w-full border rounded-lg px-3 py-2 text-sm" placeholder="John Smith"></div>' +
    '<div><label class="text-xs text-gray-500 font-medium block mb-1">Customer Email *</label><input id="si-email" class="w-full border rounded-lg px-3 py-2 text-sm" placeholder="john@company.ca" type="email"></div>' +
    '<div><label class="text-xs text-gray-500 font-medium block mb-1">Customer Phone</label><input id="si-phone" class="w-full border rounded-lg px-3 py-2 text-sm" placeholder="+1 403 555 1234"></div>' +
    '</div>' +
    '<div class="mb-4"><label class="text-xs text-gray-500 font-medium block mb-1">Line Items</label>' +
    '<div id="si-items">' +
    '<div class="flex gap-2 mb-2 si-item"><input class="flex-1 border rounded-lg px-3 py-2 text-sm si-desc" placeholder="Description" value="Roofer Secretary AI — Monthly Subscription"><input class="w-24 border rounded-lg px-3 py-2 text-sm text-right si-price" placeholder="Price" value="149.00" type="number" step="0.01"><button onclick="this.parentElement.remove()" class="text-red-400 hover:text-red-600 text-sm px-2"><i class="fas fa-trash"></i></button></div>' +
    '<div class="flex gap-2 mb-2 si-item"><input class="flex-1 border rounded-lg px-3 py-2 text-sm si-desc" placeholder="Description" value="Secretary AI Setup Fee (One-Time)"><input class="w-24 border rounded-lg px-3 py-2 text-sm text-right si-price" placeholder="Price" value="299.00" type="number" step="0.01"><button onclick="this.parentElement.remove()" class="text-red-400 hover:text-red-600 text-sm px-2"><i class="fas fa-trash"></i></button></div>' +
    '</div>' +
    '<button onclick="addServiceInvoiceItem()" class="text-xs text-blue-600 hover:text-blue-800 font-medium mt-1"><i class="fas fa-plus mr-1"></i>Add Line Item</button></div>' +
    '<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">' +
    '<div><label class="text-xs text-gray-500 font-medium block mb-1">Due Date</label><input id="si-due" class="w-full border rounded-lg px-3 py-2 text-sm" type="date"></div>' +
    '<div><label class="text-xs text-gray-500 font-medium block mb-1">Notes</label><input id="si-notes" class="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Optional invoice notes"></div>' +
    '</div>' +
    '<button onclick="createServiceInvoice()" class="bg-amber-600 hover:bg-amber-700 text-white px-6 py-2.5 rounded-xl font-bold text-sm transition-all shadow-md"><i class="fas fa-file-invoice mr-2"></i>Create Invoice</button>' +
    '</div>' +
    '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">' +
    '<div class="p-4 border-b bg-gray-50"><h3 class="font-bold text-gray-800">Service Invoices (' + invoices.length + ')</h3></div>' +
    (invoices.length === 0 ? '<div class="p-8 text-center text-gray-400"><i class="fas fa-file-invoice text-3xl mb-3 opacity-30"></i><p>No service invoices yet</p></div>' :
    '<div class="overflow-x-auto"><table class="w-full"><thead><tr class="bg-gray-50 text-xs text-gray-500 uppercase"><th class="px-4 py-3 text-left">Invoice #</th><th class="px-4 py-3 text-left">Customer</th><th class="px-4 py-3 text-left">Total</th><th class="px-4 py-3 text-center">Status</th><th class="px-4 py-3 text-left">Created</th><th class="px-4 py-3 text-left">Actions</th></tr></thead><tbody>' + rows + '</tbody></table></div>') +
    '</div>';
}

function addServiceInvoiceItem() {
  var container = document.getElementById('si-items');
  var row = document.createElement('div');
  row.className = 'flex gap-2 mb-2 si-item';
  row.innerHTML = '<input class="flex-1 border rounded-lg px-3 py-2 text-sm si-desc" placeholder="Description"><input class="w-24 border rounded-lg px-3 py-2 text-sm text-right si-price" placeholder="Price" type="number" step="0.01"><button onclick="this.parentElement.remove()" class="text-red-400 hover:text-red-600 text-sm px-2"><i class="fas fa-trash"></i></button>';
  container.appendChild(row);
}

async function createServiceInvoice() {
  var email = document.getElementById('si-email').value;
  if (!email) { window.rmToast('Customer email is required', 'warning'); return; }

  var items = [];
  document.querySelectorAll('.si-item').forEach(function(row) {
    var desc = row.querySelector('.si-desc').value;
    var price = parseFloat(row.querySelector('.si-price').value) || 0;
    if (desc && price > 0) items.push({ description: desc, quantity: 1, unit_price: price });
  });
  if (items.length === 0) { window.rmToast('At least one line item is required', 'warning'); return; }

  var body = {
    customer_name: document.getElementById('si-name').value,
    customer_email: email,
    customer_phone: document.getElementById('si-phone').value,
    items: items,
    due_date: document.getElementById('si-due').value,
    notes: document.getElementById('si-notes').value
  };

  try {
    var res = await saFetch('/api/admin/superadmin/service-invoices/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    var data = await res.json();
    if (data.success) {
      var totalStr = data.total != null ? parseFloat(data.total).toFixed(2) : '0.00';
      var linkMsg = data.checkout_url ? ' (payment link ready)' : '';
      window.rmToast('Invoice ' + data.invoice_number + ' created! Total: $' + totalStr + linkMsg, 'success');
      loadView('service-invoices');
    } else {
      window.rmToast(data.error || 'Failed to create invoice', 'info');
    }
  } catch(e) { window.rmToast('Error: ' + e.message, 'error'); }
}

async function sendServiceInvoice(id) {
  if (!(await window.rmConfirm('Send this invoice to the customer via email with Square payment link?'))) return
  try {
    var res = await saFetch('/api/admin/superadmin/service-invoices/' + id + '/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    var data = await res.json();
    if (data.success) {
      window.rmToast('Invoice sent with payment link!', 'success');
      loadView('service-invoices');
    } else {
      window.rmToast(data.error || 'Failed to send invoice', 'info');
    }
  } catch(e) { window.rmToast('Error sending: ' + e.message, 'error'); }
}

// ============================================================
// CALL CENTER MANAGEMENT — Track calls, manage sales scripts
// ============================================================
function renderCallCenterManageView() {
  var stats = SA.data.cc_stats || {};
  var scripts = (SA.data.cc_scripts || {}).scripts || [];
  var today = stats.today || {};
  var week = stats.week || {};
  var recentCalls = stats.recent_calls || [];
  var agents = stats.agent_performance || [];

  var callRows = recentCalls.slice(0, 30).map(function(c) {
    var outcome = c.call_outcome || 'unknown';
    var oColor = { interested: 'text-green-600', demo_scheduled: 'text-blue-600', converted: 'text-emerald-700', not_interested: 'text-red-500', voicemail: 'text-gray-500', no_answer: 'text-gray-400', callback: 'text-purple-600' };
    return '<tr class="border-b border-gray-100 hover:bg-gray-50 text-sm">' +
      '<td class="px-3 py-2 text-gray-800 font-medium">' + (c.company_name || c.contact_name || 'Unknown') + '</td>' +
      '<td class="px-3 py-2 text-gray-500">' + (c.agent_name || '-') + '</td>' +
      '<td class="px-3 py-2 text-center"><span class="' + (oColor[outcome] || 'text-gray-500') + ' font-medium text-xs capitalize">' + outcome.replace('_', ' ') + '</span></td>' +
      '<td class="px-3 py-2 text-gray-500 text-center">' + fmtSeconds(c.call_duration_seconds || 0) + '</td>' +
      '<td class="px-3 py-2 text-gray-400 text-xs">' + fmtDateTime(c.started_at) + '</td>' +
      '</tr>';
  }).join('');

  var agentRows = agents.map(function(a) {
    return '<tr class="border-b border-gray-100">' +
      '<td class="px-4 py-3 font-bold text-gray-800 text-sm">' + (a.agent_name || 'Unknown') + '</td>' +
      '<td class="px-4 py-3 text-center text-sm">' + (a.total_calls || 0) + '</td>' +
      '<td class="px-4 py-3 text-center text-sm text-green-600 font-medium">' + (a.connects || 0) + '</td>' +
      '<td class="px-4 py-3 text-center text-sm text-blue-600 font-medium">' + (a.demos || 0) + '</td>' +
      '<td class="px-4 py-3 text-center text-sm text-gray-500">' + fmtSeconds(a.avg_duration || 0) + '</td>' +
      '</tr>';
  }).join('');

  var scriptsList = scripts.map(function(s) {
    return '<div class="bg-gray-50 rounded-xl p-4 mb-3 border border-gray-100">' +
      '<div class="flex items-center justify-between mb-2">' +
      '<div><span class="font-bold text-gray-800 text-sm">' + s.name + '</span>' +
      '<span class="ml-2 px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs capitalize">' + (s.category || 'cold_call').replace('_', ' ') + '</span>' +
      (s.is_active ? '' : '<span class="ml-2 px-2 py-0.5 bg-red-100 text-red-600 rounded-full text-xs">Inactive</span>') +
      '</div>' +
      '<div class="flex gap-2">' +
      '<button onclick="toggleScript(' + s.id + ', ' + (s.is_active ? 0 : 1) + ')" class="text-xs ' + (s.is_active ? 'text-red-500' : 'text-green-500') + '">' + (s.is_active ? '<i class="fas fa-pause"></i>' : '<i class="fas fa-play"></i>') + '</button>' +
      '<button onclick="deleteScript(' + s.id + ')" class="text-xs text-gray-400 hover:text-red-500"><i class="fas fa-trash"></i></button>' +
      '</div></div>' +
      '<pre class="text-xs text-gray-600 whitespace-pre-wrap bg-white rounded-lg p-3 border max-h-40 overflow-y-auto">' + (s.script_body || '') + '</pre>' +
      (s.notes ? '<p class="text-xs text-gray-400 mt-2"><i class="fas fa-sticky-note mr-1"></i>' + s.notes + '</p>' : '') +
      '</div>';
  }).join('');

  return '<div class="mb-6"><h2 class="text-2xl font-black text-gray-900"><i class="fas fa-headset mr-2 text-cyan-500"></i>Call Center Management</h2><p class="text-sm text-gray-500 mt-1">Track all calls, agent performance, and manage sales scripts</p></div>' +
    '<div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">' +
    samc('Today Calls', today.total_calls || 0, 'fa-phone', 'cyan', 'Connected: ' + (today.connected || 0)) +
    samc('Hot Leads', today.hot_leads || 0, 'fa-fire', 'orange', 'Today') +
    samc('Week Calls', week.total_calls || 0, 'fa-chart-bar', 'blue', 'Connected: ' + (week.connected || 0)) +
    samc('Week Demos', week.demos || 0, 'fa-calendar-check', 'green', 'Converted: ' + (week.converted || 0)) +
    '</div>' +
    '<div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">' +
    '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">' +
    '<div class="p-4 border-b bg-gray-50 flex items-center justify-between"><h3 class="font-bold text-gray-800">Recent Calls</h3><button onclick="loadView(\'call-center-manage\')" class="text-xs text-blue-600"><i class="fas fa-sync mr-1"></i>Refresh</button></div>' +
    (recentCalls.length === 0 ? '<div class="p-6 text-center text-gray-400">No call logs yet</div>' :
    '<div class="overflow-x-auto max-h-96 overflow-y-auto"><table class="w-full"><thead class="sticky top-0 bg-gray-50"><tr class="text-xs text-gray-500 uppercase"><th class="px-3 py-2 text-left">Prospect</th><th class="px-3 py-2 text-left">Agent</th><th class="px-3 py-2 text-center">Outcome</th><th class="px-3 py-2 text-center">Duration</th><th class="px-3 py-2 text-left">Time</th></tr></thead><tbody>' + callRows + '</tbody></table></div>') +
    '</div>' +
    '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">' +
    '<div class="p-4 border-b bg-gray-50"><h3 class="font-bold text-gray-800">Agent Performance (7 Days)</h3></div>' +
    (agents.length === 0 ? '<div class="p-6 text-center text-gray-400">No agent data</div>' :
    '<div class="overflow-x-auto"><table class="w-full"><thead><tr class="bg-gray-50 text-xs text-gray-500 uppercase"><th class="px-4 py-3 text-left">Agent</th><th class="px-4 py-3 text-center">Calls</th><th class="px-4 py-3 text-center">Connects</th><th class="px-4 py-3 text-center">Demos</th><th class="px-4 py-3 text-center">Avg Duration</th></tr></thead><tbody>' + agentRows + '</tbody></table></div>') +
    '</div></div>' +
    '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">' +
    '<div class="flex items-center justify-between mb-4"><h3 class="font-bold text-gray-800 text-lg"><i class="fas fa-scroll mr-2 text-blue-500"></i>Sales Scripts</h3>' +
    '<button onclick="document.getElementById(\'new-script-form\').classList.toggle(\'hidden\')" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-medium"><i class="fas fa-plus mr-1"></i>New Script</button></div>' +
    '<div id="new-script-form" class="hidden bg-blue-50 rounded-xl p-4 mb-4 border border-blue-100">' +
    '<div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">' +
    '<div><label class="text-xs text-gray-500 font-medium block mb-1">Script Name *</label><input id="ns-name" class="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Cold Call - Intro Pitch"></div>' +
    '<div><label class="text-xs text-gray-500 font-medium block mb-1">Category</label><select id="ns-category" class="w-full border rounded-lg px-3 py-2 text-sm"><option value="cold_call">Cold Call</option><option value="follow_up">Follow Up</option><option value="demo">Demo</option><option value="close">Close</option><option value="objection_handler">Objection Handler</option></select></div>' +
    '</div>' +
    '<div class="mb-3"><label class="text-xs text-gray-500 font-medium block mb-1">Script Body *</label><textarea id="ns-body" class="w-full border rounded-lg px-3 py-2 text-sm h-32" placeholder="Hi [Name], this is [Agent] from Roof Manager..."></textarea></div>' +
    '<div class="mb-3"><label class="text-xs text-gray-500 font-medium block mb-1">Notes</label><input id="ns-notes" class="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Optional notes about when to use"></div>' +
    '<button onclick="createScript()" class="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-xl text-sm font-bold"><i class="fas fa-save mr-1"></i>Save Script</button>' +
    '</div>' +
    (scripts.length === 0 ? '<div class="text-center text-gray-400 py-6"><i class="fas fa-scroll text-3xl mb-3 opacity-30"></i><p>No sales scripts yet. Create one above.</p></div>' : scriptsList) +
    '</div>';
}

async function createScript() {
  var name = document.getElementById('ns-name').value;
  var body = document.getElementById('ns-body').value;
  if (!name || !body) { window.rmToast('Name and script body are required', 'warning'); return; }

  try {
    var res = await saFetch('/api/admin/superadmin/sales-scripts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name,
        category: document.getElementById('ns-category').value,
        script_body: body,
        notes: document.getElementById('ns-notes').value
      })
    });
    var data = await res.json();
    if (data.success) {
      loadView('call-center-manage');
    } else {
      window.rmToast(data.error || 'Failed to create script', 'info');
    }
  } catch(e) { window.rmToast('Error: ' + e.message, 'error'); }
}

async function toggleScript(id, active) {
  try {
    await saFetch('/api/admin/superadmin/sales-scripts/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: active })
    });
    loadView('call-center-manage');
  } catch(e) { window.rmToast('Error toggling script', 'error'); }
}

async function deleteScript(id) {
  if (!(await window.rmConfirm('Delete this sales script?'))) return
  try {
    await saFetch('/api/admin/superadmin/sales-scripts/' + id, { method: 'DELETE' });
    loadView('call-center-manage');
  } catch(e) { window.rmToast('Error deleting script', 'error'); }
}

// ============================================================
// LIVEKIT AGENTS — Full Management Dashboard with Tabs
// ============================================================
function renderLiveKitAgentsView() {
  var d = SA.data.livekit || {};
  if (!d.configured) {
    return saSection('LiveKit Agent Management', 'fa-robot',
      '<div class="text-center py-12">' +
        '<div class="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4"><i class="fas fa-exclamation-triangle text-2xl text-red-500"></i></div>' +
        '<h3 class="text-lg font-bold text-gray-800 mb-2">LiveKit Not Configured</h3>' +
        '<p class="text-gray-500 mb-6 max-w-md mx-auto">' + (d.error || 'Set LIVEKIT_API_KEY, LIVEKIT_API_SECRET, and LIVEKIT_URL as Cloudflare Pages secrets.') + '</p>' +
        '<div class="bg-gray-50 rounded-xl p-4 text-left max-w-lg mx-auto font-mono text-xs text-gray-600">' +
          '<p class="mb-1">npx wrangler pages secret put LIVEKIT_API_KEY --project-name roofing-measurement-tool</p>' +
          '<p class="mb-1">npx wrangler pages secret put LIVEKIT_API_SECRET --project-name roofing-measurement-tool</p>' +
          '<p>npx wrangler pages secret put LIVEKIT_URL --project-name roofing-measurement-tool</p>' +
        '</div>' +
      '</div>');
  }

  var tab = SA.lkTab || 'overview';
  var tabs = [
    { id: 'overview', label: 'System Overview', icon: 'fa-tachometer-alt' },
    { id: 'configs', label: 'Secretary Configs', icon: 'fa-users-cog' },
    { id: 'phone-pool', label: 'Phone Pool', icon: 'fa-phone-square-alt' },
    { id: 'deploy', label: 'Deploy Agent', icon: 'fa-rocket' },
  ];
  var tabsHtml = '<div class="flex flex-wrap gap-2 mb-6 border-b border-gray-200 pb-3">';
  tabs.forEach(function(t) {
    var active = t.id === tab;
    tabsHtml += '<button onclick="SA.lkTab=\'' + t.id + '\';renderContent()" class="px-4 py-2 rounded-lg text-sm font-semibold transition ' +
      (active ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-100 text-gray-600 hover:bg-gray-200') + '">' +
      '<i class="fas ' + t.icon + ' mr-1.5"></i>' + t.label + '</button>';
  });
  tabsHtml += '<button onclick="loadView(\'livekit-agents\')" class="ml-auto px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs font-semibold text-gray-600 transition"><i class="fas fa-sync-alt mr-1"></i>Refresh All</button></div>';

  var content = '';
  if (tab === 'overview') content = renderLKOverviewTab(d);
  else if (tab === 'configs') content = renderLKConfigsTab();
  else if (tab === 'phone-pool') content = renderLKPhonePoolTab();
  else if (tab === 'deploy') content = renderLKDeployTab();

  return tabsHtml + content + '<div id="lk-modal"></div>';
}

function renderLKOverviewTab(d) {
  var st = d.stats || {};
  var err = d.error ? '<div class="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800"><i class="fas fa-exclamation-triangle mr-2"></i>' + d.error + '</div>' : '';

  var header =
    '<div class="flex flex-wrap items-center gap-3 mb-6">' +
      '<div class="flex items-center gap-2 bg-teal-50 text-teal-700 px-3 py-1.5 rounded-full text-xs font-semibold"><i class="fas fa-plug"></i> ' + (d.livekit_url || 'N/A') + '</div>' +
      '<div class="flex items-center gap-2 bg-blue-50 text-blue-700 px-3 py-1.5 rounded-full text-xs font-semibold"><i class="fas fa-key"></i> ' + (d.api_key_preview || 'N/A') + '</div>' +
      (d.livekit_sip_uri ? '<div class="flex items-center gap-2 bg-purple-50 text-purple-700 px-3 py-1.5 rounded-full text-xs font-semibold"><i class="fas fa-phone-volume"></i> ' + d.livekit_sip_uri + '</div>' : '') +
    '</div>';

  var stats =
    '<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">' +
      lkStatCard('Active Rooms', d.active_rooms || 0, 'fa-door-open', d.active_rooms > 0 ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-gray-600') +
      lkStatCard('Inbound Trunks', st.inbound_trunk_count || 0, 'fa-phone-alt', 'bg-blue-50 text-blue-700') +
      lkStatCard('Dispatch Rules', st.dispatch_rule_count || 0, 'fa-route', 'bg-purple-50 text-purple-700') +
      lkStatCard('Active Secretaries', st.active_secretaries || 0, 'fa-headset', 'bg-teal-50 text-teal-700') +
      lkStatCard('Total Calls', st.total_calls_handled || 0, 'fa-chart-line', 'bg-indigo-50 text-indigo-700') +
      lkStatCard('Phone Numbers', st.phone_number_count || 0, 'fa-mobile-alt', 'bg-orange-50 text-orange-700') +
    '</div>';

  // Active Rooms
  var roomsHtml = '';
  var rooms = d.rooms || [];
  if (rooms.length === 0) {
    roomsHtml = '<p class="text-gray-400 text-sm py-4 text-center">No active rooms</p>';
  } else {
    roomsHtml = '<div class="space-y-2">';
    rooms.forEach(function(r) {
      roomsHtml += '<div class="flex items-center justify-between p-3 bg-green-50 rounded-lg">' +
        '<div><span class="font-semibold text-sm text-gray-800">' + r.name + '</span>' +
        '<span class="ml-2 text-xs text-gray-500">SID: ' + (r.sid || '').slice(0,12) + '...</span></div>' +
        '<div class="flex items-center gap-2">' +
          '<span class="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">' + (r.num_participants || 0) + ' participants</span>' +
          '<button onclick="lkDeleteRoom(\'' + r.name + '\')" class="text-xs text-red-500 hover:text-red-700"><i class="fas fa-trash"></i></button>' +
        '</div></div>';
    });
    roomsHtml += '</div>';
  }

  // Cloud Agents
  var agentsHtml = '';
  var agents = d.cloud_agents || [];
  if (agents.length === 0) {
    agentsHtml = '<div class="text-center py-6">' +
      '<p class="text-gray-400 text-sm mb-3">No Cloud agents detected</p>' +
      '<button onclick="SA.lkTab=\'deploy\';renderContent()" class="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-semibold hover:bg-blue-600"><i class="fas fa-rocket mr-1"></i>Go to Deploy Guide</button>' +
      '</div>';
  } else {
    agentsHtml = '<div class="space-y-2">';
    agents.forEach(function(a) {
      var id = a.agent_id || a.id || a.cloud_agent_id || 'unknown';
      var name = a.name || a.agent_name || id;
      var status = a.status || a.state || 'unknown';
      var statusColor = status === 'Running' || status === 'running' ? 'bg-green-100 text-green-700' :
                        status === 'Stopped' || status === 'stopped' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700';
      agentsHtml += '<div class="flex items-center justify-between p-3 bg-white border border-gray-100 rounded-lg">' +
        '<div>' +
          '<span class="font-semibold text-sm text-gray-800">' + name + '</span>' +
          '<span class="ml-2 text-xs text-gray-400">' + id + '</span>' +
        '</div>' +
        '<div class="flex items-center gap-2">' +
          '<span class="text-xs ' + statusColor + ' px-2 py-0.5 rounded-full">' + status + '</span>' +
          (a.version ? '<span class="text-xs text-gray-400">' + a.version + '</span>' : '') +
          (a.region ? '<span class="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">' + a.region + '</span>' : '') +
          '<button onclick="lkDeleteAgent(\'' + id + '\')" class="text-xs text-red-500 hover:text-red-700"><i class="fas fa-trash"></i></button>' +
        '</div></div>';
    });
    agentsHtml += '</div>';
  }

  // Inbound Trunks
  var trunksHtml = '';
  var trunks = d.inbound_trunks || [];
  if (trunks.length === 0) {
    trunksHtml = '<p class="text-gray-400 text-sm py-4 text-center">No inbound trunks</p>';
  } else {
    trunksHtml = '<div class="overflow-x-auto"><table class="w-full text-sm">' +
      '<thead><tr class="text-left text-xs text-gray-500 border-b"><th class="pb-2 pr-4">Name</th><th class="pb-2 pr-4">Numbers</th><th class="pb-2 pr-4">Trunk ID</th><th class="pb-2 pr-4">Krisp</th><th class="pb-2">Actions</th></tr></thead><tbody>';
    trunks.forEach(function(t) {
      var nums = (t.numbers || []).join(', ') || '-';
      trunksHtml += '<tr class="border-b border-gray-50">' +
        '<td class="py-2 pr-4 font-medium">' + (t.name || '-') + '</td>' +
        '<td class="py-2 pr-4 font-mono text-xs">' + nums + '</td>' +
        '<td class="py-2 pr-4 text-xs text-gray-400">' + (t.id || '-').slice(0, 16) + '</td>' +
        '<td class="py-2 pr-4">' + (t.krisp ? '<span class="text-green-500">OK</span>' : '<span class="text-gray-300">Off</span>') + '</td>' +
        '<td class="py-2"><button onclick="lkDeleteTrunk(\'' + t.id + '\')" class="text-xs text-red-500 hover:text-red-700"><i class="fas fa-trash"></i></button></td>' +
        '</tr>';
    });
    trunksHtml += '</tbody></table></div>';
  }

  // Dispatch Rules
  var rulesHtml = '';
  var rules = d.dispatch_rules || [];
  if (rules.length === 0) {
    rulesHtml = '<p class="text-gray-400 text-sm py-4 text-center">No dispatch rules</p>';
  } else {
    rulesHtml = '<div class="overflow-x-auto"><table class="w-full text-sm">' +
      '<thead><tr class="text-left text-xs text-gray-500 border-b"><th class="pb-2 pr-4">Name</th><th class="pb-2 pr-4">Type</th><th class="pb-2 pr-4">Room Pattern</th><th class="pb-2 pr-4">Trunks</th><th class="pb-2">Actions</th></tr></thead><tbody>';
    rules.forEach(function(r) {
      var pattern = r.room_prefix ? r.room_prefix + '*' : (r.room_name || '-');
      rulesHtml += '<tr class="border-b border-gray-50">' +
        '<td class="py-2 pr-4 font-medium">' + (r.name || '-') + '</td>' +
        '<td class="py-2 pr-4"><span class="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">' + (r.rule_type || '-') + '</span></td>' +
        '<td class="py-2 pr-4 font-mono text-xs">' + pattern + '</td>' +
        '<td class="py-2 pr-4 text-xs text-gray-400">' + (r.trunk_ids || []).length + ' trunk(s)</td>' +
        '<td class="py-2"><button onclick="lkDeleteDispatch(\'' + r.id + '\')" class="text-xs text-red-500 hover:text-red-700"><i class="fas fa-trash"></i></button></td>' +
        '</tr>';
    });
    rulesHtml += '</tbody></table></div>';
  }

  // Phone Numbers
  var phonesHtml = '';
  var phoneNums = d.phone_numbers || [];
  if (phoneNums.length === 0) {
    phonesHtml = '<p class="text-gray-400 text-sm py-4 text-center">No LiveKit phone numbers</p>';
  } else {
    phonesHtml = '<div class="space-y-2">';
    phoneNums.forEach(function(p) {
      phonesHtml += '<div class="flex items-center justify-between p-2 bg-gray-50 rounded-lg">' +
        '<span class="font-mono text-sm font-semibold">' + (p.number || '-') + '</span>' +
        '<span class="text-xs text-gray-500">' + (p.name || '') + '</span>' +
        '</div>';
    });
    phonesHtml += '</div>';
  }

  return err + header + stats +
    '<div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">' +
      saSection('Active Rooms (' + rooms.length + ')', 'fa-door-open', roomsHtml) +
      saSection('Cloud Agents (' + agents.length + ')', 'fa-robot', agentsHtml) +
    '</div>' +
    '<div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">' +
      saSection('Inbound SIP Trunks (' + trunks.length + ')', 'fa-phone-alt', trunksHtml,
        '<button onclick="lkShowCreateTrunk()" class="px-3 py-1.5 bg-teal-500 text-white rounded-lg text-xs font-semibold hover:bg-teal-600 transition"><i class="fas fa-plus mr-1"></i>Create Trunk</button>') +
      saSection('Dispatch Rules (' + rules.length + ')', 'fa-route', rulesHtml,
        '<button onclick="lkShowCreateDispatch()" class="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-semibold hover:bg-blue-600 transition"><i class="fas fa-plus mr-1"></i>Create Rule</button>') +
    '</div>' +
    '<div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">' +
      saSection('LiveKit Phone Numbers (' + phoneNums.length + ')', 'fa-mobile-alt', phonesHtml) +
      saSection('Agent Test', 'fa-vial',
        '<p class="text-sm text-gray-600 mb-3">Create a test room to verify your LiveKit agent is responding to dispatch events.</p>' +
        '<div class="flex gap-2">' +
          '<input id="lk-test-prefix" type="text" value="secretary-2-" placeholder="Room prefix" class="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono">' +
          '<button onclick="lkTestCall()" class="px-4 py-2 bg-green-500 text-white rounded-lg text-sm font-semibold hover:bg-green-600 transition"><i class="fas fa-phone mr-1"></i>Test Agent</button>' +
        '</div>' +
        '<div id="lk-test-result" class="mt-3"></div>') +
    '</div>';
}

// ── Secretary Configs Tab ──
function renderLKConfigsTab() {
  var configs = (SA.data.livekitConfigs || {}).configs || [];
  var activeCount = configs.filter(function(c) { return c.is_active === 1; }).length;

  var bulkHtml =
    '<div class="flex items-center gap-3 mb-4">' +
      '<span class="text-sm text-gray-600"><strong>' + activeCount + '</strong> of ' + configs.length + ' active</span>' +
      '<button onclick="lkBulkToggle(true)" class="px-3 py-1.5 bg-green-500 text-white rounded-lg text-xs font-semibold hover:bg-green-600"><i class="fas fa-power-off mr-1"></i>Activate All</button>' +
      '<button onclick="lkBulkToggle(false)" class="px-3 py-1.5 bg-red-500 text-white rounded-lg text-xs font-semibold hover:bg-red-600"><i class="fas fa-stop mr-1"></i>Deactivate All</button>' +
    '</div>';

  if (configs.length === 0) {
    return saSection('All Secretary Configurations', 'fa-users-cog',
      bulkHtml + '<p class="text-gray-400 text-sm py-6 text-center">No secretary configs found. Onboard customers first.</p>');
  }

  var tableHtml = '<div class="overflow-x-auto"><table class="w-full text-sm">' +
    '<thead><tr class="text-left text-xs text-gray-500 border-b">' +
      '<th class="pb-2 pr-3">Customer</th>' +
      '<th class="pb-2 pr-3">Mode</th>' +
      '<th class="pb-2 pr-3">Agent</th>' +
      '<th class="pb-2 pr-3">Business Phone</th>' +
      '<th class="pb-2 pr-3">AI Number</th>' +
      '<th class="pb-2 pr-3">Connection</th>' +
      '<th class="pb-2 pr-3">Calls (7d)</th>' +
      '<th class="pb-2 pr-3">Status</th>' +
      '<th class="pb-2">Actions</th>' +
    '</tr></thead><tbody>';

  configs.forEach(function(cfg) {
    var isActive = cfg.is_active === 1;
    var statusBg = isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500';
    var connColor = cfg.connection_status === 'connected' ? 'text-green-600' : cfg.connection_status === 'pending_forwarding' ? 'text-yellow-600' : 'text-red-500';
    tableHtml += '<tr class="border-b border-gray-50 hover:bg-gray-50">' +
      '<td class="py-2.5 pr-3"><div class="font-medium text-gray-800">' + (cfg.customer_name || 'Customer #' + cfg.customer_id) + '</div><div class="text-xs text-gray-400">' + (cfg.email || '') + '</div></td>' +
      '<td class="py-2.5 pr-3"><span class="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">' + (cfg.secretary_mode || 'directory') + '</span></td>' +
      '<td class="py-2.5 pr-3"><span class="text-sm">' + (cfg.agent_name || 'Sarah') + '</span><span class="text-xs text-gray-400 ml-1">(' + (cfg.agent_voice || 'alloy') + ')</span></td>' +
      '<td class="py-2.5 pr-3 font-mono text-xs">' + (cfg.business_phone || '-') + '</td>' +
      '<td class="py-2.5 pr-3 font-mono text-xs">' + (cfg.assigned_phone_number || '<span class="text-red-400">None</span>') + '</td>' +
      '<td class="py-2.5 pr-3"><span class="text-xs font-semibold ' + connColor + '">' + (cfg.connection_status || 'not_connected').replace(/_/g, ' ') + '</span></td>' +
      '<td class="py-2.5 pr-3 text-center"><span class="font-semibold">' + (cfg.calls_7d || 0) + '</span><span class="text-xs text-gray-400"> / ' + (cfg.total_calls || 0) + '</span></td>' +
      '<td class="py-2.5 pr-3"><span class="text-xs px-2 py-0.5 rounded-full font-semibold ' + statusBg + '">' + (isActive ? 'ACTIVE' : 'PAUSED') + '</span></td>' +
      '<td class="py-2.5">' +
        '<div class="flex items-center gap-1">' +
          '<button onclick="lkToggleConfig(' + cfg.customer_id + ')" class="px-2 py-1 ' + (isActive ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200' : 'bg-green-100 text-green-700 hover:bg-green-200') + ' rounded text-xs font-semibold"><i class="fas ' + (isActive ? 'fa-pause' : 'fa-play') + '"></i></button>' +
          '<button onclick="lkEditConfig(' + cfg.customer_id + ',' + JSON.stringify(JSON.stringify(cfg)).replace(/'/g, "\\'") + ')" class="px-2 py-1 bg-blue-100 text-blue-700 hover:bg-blue-200 rounded text-xs font-semibold"><i class="fas fa-edit"></i></button>' +
        '</div>' +
      '</td></tr>';
  });
  tableHtml += '</tbody></table></div>';

  return saSection('All Secretary Configurations (' + configs.length + ')', 'fa-users-cog', bulkHtml + tableHtml);
}

// ── Phone Pool Tab ──
function renderLKPhonePoolTab() {
  var poolData = SA.data.livekitPool || {};
  var numbers = poolData.numbers || [];
  var poolStats = poolData.stats || [];

  var statCards = '<div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">';
  var available = 0, assigned = 0, total = numbers.length;
  poolStats.forEach(function(s) {
    if (s.status === 'available') available = s.count;
    if (s.status === 'assigned') assigned = s.count;
  });
  statCards += lkStatCard('Total Numbers', total, 'fa-phone-square', 'bg-gray-50 text-gray-700');
  statCards += lkStatCard('Available', available, 'fa-check-circle', 'bg-green-50 text-green-700');
  statCards += lkStatCard('Assigned', assigned, 'fa-user-check', 'bg-blue-50 text-blue-700');
  statCards += lkStatCard('Other', total - available - assigned, 'fa-exclamation-circle', 'bg-yellow-50 text-yellow-700');
  statCards += '</div>';

  var addHtml =
    '<div class="flex gap-2 mb-4">' +
      '<input id="lk-pool-number" type="text" placeholder="+14031234567" class="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono">' +
      '<input id="lk-pool-region" type="text" placeholder="AB" value="AB" class="w-20 border border-gray-300 rounded-lg px-3 py-2 text-sm">' +
      '<button onclick="lkAddToPool()" class="px-4 py-2 bg-teal-500 text-white rounded-lg text-sm font-semibold hover:bg-teal-600"><i class="fas fa-plus mr-1"></i>Add Number</button>' +
    '</div>';

  if (numbers.length === 0) {
    return statCards + saSection('Phone Number Pool', 'fa-phone-square-alt',
      addHtml + '<p class="text-gray-400 text-sm py-6 text-center">No numbers in pool. Add Twilio numbers above or use the Phone Marketplace to purchase.</p>');
  }

  var tableHtml = '<div class="overflow-x-auto"><table class="w-full text-sm">' +
    '<thead><tr class="text-left text-xs text-gray-500 border-b">' +
      '<th class="pb-2 pr-3">Phone Number</th>' +
      '<th class="pb-2 pr-3">Status</th>' +
      '<th class="pb-2 pr-3">Assigned To</th>' +
      '<th class="pb-2 pr-3">Region</th>' +
      '<th class="pb-2 pr-3">SIP Trunk</th>' +
      '<th class="pb-2">Actions</th>' +
    '</tr></thead><tbody>';

  numbers.forEach(function(n) {
    var statusColor = n.status === 'available' ? 'bg-green-100 text-green-700' : n.status === 'assigned' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500';
    tableHtml += '<tr class="border-b border-gray-50 hover:bg-gray-50">' +
      '<td class="py-2.5 pr-3 font-mono font-semibold">' + n.phone_number + '</td>' +
      '<td class="py-2.5 pr-3"><span class="text-xs px-2 py-0.5 rounded-full font-semibold ' + statusColor + '">' + (n.status || 'unknown') + '</span></td>' +
      '<td class="py-2.5 pr-3">' + (n.assigned_name ? '<span class="text-sm">' + n.assigned_name + '</span><span class="text-xs text-gray-400 ml-1">(' + (n.assigned_email || '') + ')</span>' : '<span class="text-gray-400">-</span>') + '</td>' +
      '<td class="py-2.5 pr-3 text-xs">' + (n.region || '-') + '</td>' +
      '<td class="py-2.5 pr-3 text-xs text-gray-400 font-mono">' + (n.sip_trunk_id ? n.sip_trunk_id.slice(0,12) + '...' : '-') + '</td>' +
      '<td class="py-2.5">' +
        '<div class="flex items-center gap-1">' +
          (n.status === 'assigned' ? '<button onclick="lkReleaseNumber(\'' + n.phone_number + '\')" class="px-2 py-1 bg-yellow-100 text-yellow-700 hover:bg-yellow-200 rounded text-xs font-semibold" title="Release back to pool"><i class="fas fa-undo"></i></button>' : '') +
          '<button onclick="lkDeleteNumber(\'' + encodeURIComponent(n.phone_number) + '\')" class="px-2 py-1 bg-red-100 text-red-700 hover:bg-red-200 rounded text-xs font-semibold" title="Remove from pool"><i class="fas fa-trash"></i></button>' +
        '</div>' +
      '</td></tr>';
  });
  tableHtml += '</tbody></table></div>';

  return statCards + saSection('Phone Number Pool (' + numbers.length + ')', 'fa-phone-square-alt', addHtml + tableHtml);
}

// ── Deploy Agent Tab ──
function renderLKDeployTab() {
  return saSection('Deploy Sarah (Roofer Secretary Agent)', 'fa-rocket',
    '<div class="space-y-6">' +
      // Step 1: Prerequisites
      '<div class="bg-blue-50 rounded-xl p-5">' +
        '<h4 class="font-bold text-blue-800 mb-3"><i class="fas fa-clipboard-check mr-2"></i>Step 1: Prerequisites</h4>' +
        '<ul class="space-y-2 text-sm text-blue-700">' +
          '<li class="flex items-start gap-2"><i class="fas fa-check-circle mt-0.5 text-blue-400"></i>LiveKit Cloud project: <strong>roofreporterai</strong> (subdomain: roofreporterai-btkwkiwh)</li>' +
          '<li class="flex items-start gap-2"><i class="fas fa-check-circle mt-0.5 text-blue-400"></i>GitHub repo: <a href="https://github.com/ethan8585g/roofreporter-ai-good-copy" target="_blank" class="underline">roofreporter-ai-good-copy</a></li>' +
          '<li class="flex items-start gap-2"><i class="fas fa-check-circle mt-0.5 text-blue-400"></i>Agent code: <code class="font-mono bg-blue-100 px-1 rounded">livekit-agent/</code> directory</li>' +
          '<li class="flex items-start gap-2"><i class="fas fa-check-circle mt-0.5 text-blue-400"></i>Phone number: +1 (484) 964-9758 (LiveKit PSTN)</li>' +
        '</ul>' +
      '</div>' +
      // Step 2: Delete template agents
      '<div class="bg-yellow-50 rounded-xl p-5">' +
        '<h4 class="font-bold text-yellow-800 mb-3"><i class="fas fa-trash-alt mr-2"></i>Step 2: Delete Template Agents</h4>' +
        '<p class="text-sm text-yellow-700 mb-3">Before deploying Sarah, remove any default/template agents from your LiveKit Cloud project.</p>' +
        '<div class="bg-white rounded-lg p-3 font-mono text-xs text-gray-700 space-y-1">' +
          '<p>1. Go to <a href="https://cloud.livekit.io" target="_blank" class="text-blue-600 underline font-semibold">cloud.livekit.io</a></p>' +
          '<p>2. Select project <strong>roofreporterai</strong></p>' +
          '<p>3. Click <strong>Agents</strong> tab</p>' +
          '<p>4. Delete all existing agents (template/builder agents)</p>' +
        '</div>' +
        '<p class="text-xs text-yellow-600 mt-2"><i class="fas fa-info-circle mr-1"></i>Builder agents cannot be deleted via CLI. You must use the LiveKit Cloud dashboard.</p>' +
      '</div>' +
      // Step 3: Install CLI & Deploy
      '<div class="bg-green-50 rounded-xl p-5">' +
        '<h4 class="font-bold text-green-800 mb-3"><i class="fas fa-terminal mr-2"></i>Step 3: Deploy via LiveKit CLI</h4>' +
        '<p class="text-sm text-green-700 mb-3">Run these commands from your local machine (not the sandbox — DNS resolution for livekit.cloud is blocked in sandbox):</p>' +
        '<div class="bg-white rounded-lg p-4 font-mono text-xs text-gray-800 space-y-2 overflow-x-auto">' +
          '<p class="text-gray-400"># Install LiveKit CLI (if not already installed)</p>' +
          '<p>brew install livekit-cli</p>' +
          '<p class="text-gray-400 mt-3"># Authenticate with LiveKit Cloud</p>' +
          '<p>lk cloud auth</p>' +
          '<p class="text-gray-400 mt-3"># Set default project</p>' +
          '<p>lk project set-default "roofreporterai-btkwkiwh"</p>' +
          '<p class="text-gray-400 mt-3"># Navigate to the agent directory</p>' +
          '<p>cd roofreporter-ai-good-copy/livekit-agent</p>' +
          '<p class="text-gray-400 mt-3"># Deploy the agent (first time)</p>' +
          '<p>lk agent create --yes --region us-east .</p>' +
          '<p class="text-gray-400 mt-3"># Or update an existing deployment</p>' +
          '<p>lk agent deploy --yes .</p>' +
        '</div>' +
      '</div>' +
      // Step 4: Verify
      '<div class="bg-purple-50 rounded-xl p-5">' +
        '<h4 class="font-bold text-purple-800 mb-3"><i class="fas fa-check-double mr-2"></i>Step 4: Verify Agent is Running</h4>' +
        '<p class="text-sm text-purple-700 mb-3">After deployment, verify the agent is live:</p>' +
        '<div class="bg-white rounded-lg p-3 font-mono text-xs text-gray-800 space-y-1">' +
          '<p>lk agent list --project roofreporterai</p>' +
        '</div>' +
        '<p class="text-sm text-purple-700 mt-3">Then use the <strong>Agent Test</strong> panel on the System Overview tab to create a test room and verify the agent responds.</p>' +
        '<div class="mt-3"><button onclick="SA.lkTab=\'overview\';renderContent()" class="px-4 py-2 bg-purple-500 text-white rounded-lg text-sm font-semibold hover:bg-purple-600"><i class="fas fa-vial mr-1"></i>Go to Agent Test</button></div>' +
      '</div>' +
      // Step 5: Environment variables
      '<div class="bg-gray-50 rounded-xl p-5">' +
        '<h4 class="font-bold text-gray-800 mb-3"><i class="fas fa-cog mr-2"></i>Step 5: Environment Variables (Agent)</h4>' +
        '<p class="text-sm text-gray-600 mb-3">The agent uses these environment variables. LiveKit Cloud injects LIVEKIT_URL/KEY/SECRET automatically. The custom ones are set in livekit.toml:</p>' +
        '<div class="bg-white rounded-lg p-3 font-mono text-xs text-gray-700 space-y-1 overflow-x-auto">' +
          '<p>LIVEKIT_URL=wss://roofreporterai-btkwkiwh.livekit.cloud <span class="text-green-500"># auto-injected</span></p>' +
          '<p>LIVEKIT_API_KEY=APIsvVZsCCaboLY <span class="text-green-500"># auto-injected</span></p>' +
          '<p>LIVEKIT_API_SECRET=UwHeCz... <span class="text-green-500"># auto-injected</span></p>' +
          '<p>ROOFPORTER_API_URL=https://www.roofmanager.ca <span class="text-blue-500"># set in livekit.toml</span></p>' +
          '<p>DEFAULT_GREETING="Thank you for calling..." <span class="text-blue-500"># set in livekit.toml</span></p>' +
        '</div>' +
      '</div>' +
      // Quick Actions
      '<div class="bg-white border border-gray-200 rounded-xl p-5">' +
        '<h4 class="font-bold text-gray-800 mb-3"><i class="fas fa-bolt mr-2"></i>Quick Actions</h4>' +
        '<div class="flex flex-wrap gap-3">' +
          '<a href="https://cloud.livekit.io" target="_blank" class="px-4 py-2 bg-gray-800 text-white rounded-lg text-sm font-semibold hover:bg-gray-900"><i class="fas fa-external-link-alt mr-1"></i>LiveKit Dashboard</a>' +
          '<a href="https://github.com/ethan8585g/roofreporter-ai-good-copy" target="_blank" class="px-4 py-2 bg-gray-700 text-white rounded-lg text-sm font-semibold hover:bg-gray-800"><i class="fab fa-github mr-1"></i>GitHub Repo</a>' +
          '<button onclick="SA.lkTab=\'overview\';renderContent()" class="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-semibold hover:bg-blue-600"><i class="fas fa-tachometer-alt mr-1"></i>System Overview</button>' +
          '<button onclick="SA.lkTab=\'configs\';renderContent()" class="px-4 py-2 bg-teal-500 text-white rounded-lg text-sm font-semibold hover:bg-teal-600"><i class="fas fa-users-cog mr-1"></i>Secretary Configs</button>' +
        '</div>' +
      '</div>' +
    '</div>');
}

function lkStatCard(label, value, icon, color) {
  return '<div class="' + color + ' rounded-xl p-3 text-center">' +
    '<i class="fas ' + icon + ' text-lg mb-1 opacity-60"></i>' +
    '<div class="text-xl font-bold">' + value + '</div>' +
    '<div class="text-xs opacity-80">' + label + '</div>' +
  '</div>';
}

// LiveKit Action Functions
async function lkDeleteRoom(name) {
  if (!(await window.rmConfirm('Delete room "' + name + '"?'))) return
  try {
    await saFetch('/api/admin/superadmin/livekit/room/delete', { method: 'POST', body: JSON.stringify({ room_name: name }) });
    loadView('livekit-agents');
  } catch(e) { window.rmToast('Error: ' + e.message, 'error'); }
}

async function lkDeleteAgent(id) {
  if (!(await window.rmConfirm('Delete agent ' + id + '?\n\nNote: Builder/template agents can only be deleted from cloud.livekit.io dashboard.'))) return
  try {
    var res = await saFetch('/api/admin/superadmin/livekit/agent/delete', { method: 'POST', body: JSON.stringify({ agent_id: id }) });
    var data = await res.json();
    window.rmToast(data.message || 'Deletion requested', 'info');
    loadView('livekit-agents');
  } catch(e) { window.rmToast('Error: ' + e.message, 'error'); }
}

async function lkDeleteTrunk(id) {
  if (!(await window.rmConfirm('Delete SIP trunk ' + id + '?'))) return
  try {
    await saFetch('/api/admin/superadmin/livekit/trunk/delete', { method: 'POST', body: JSON.stringify({ trunk_id: id }) });
    loadView('livekit-agents');
  } catch(e) { window.rmToast('Error: ' + e.message, 'error'); }
}

async function lkDeleteDispatch(id) {
  if (!(await window.rmConfirm('Delete dispatch rule ' + id + '?'))) return
  try {
    await saFetch('/api/admin/superadmin/livekit/dispatch/delete', { method: 'POST', body: JSON.stringify({ dispatch_rule_id: id }) });
    loadView('livekit-agents');
  } catch(e) { window.rmToast('Error: ' + e.message, 'error'); }
}

function lkShowCreateTrunk() {
  document.getElementById('lk-modal').innerHTML =
    '<div class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onclick="if(event.target===this)this.remove()">' +
      '<div class="bg-white rounded-2xl p-6 max-w-lg w-full mx-4 shadow-2xl">' +
        '<h3 class="text-lg font-bold mb-4"><i class="fas fa-phone-alt mr-2 text-teal-500"></i>Create Inbound SIP Trunk</h3>' +
        '<div class="space-y-3">' +
          '<div><label class="text-xs font-semibold text-gray-600 block mb-1">Trunk Name</label><input id="lk-trunk-name" type="text" value="secretary-inbound" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"></div>' +
          '<div><label class="text-xs font-semibold text-gray-600 block mb-1">Phone Number (E.164)</label><input id="lk-trunk-phone" type="text" placeholder="+14849649758" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"></div>' +
          '<div class="flex items-center gap-2"><input id="lk-trunk-krisp" type="checkbox" checked><label class="text-sm">Enable Krisp noise cancellation</label></div>' +
        '</div>' +
        '<div class="flex justify-end gap-2 mt-6">' +
          '<button onclick="document.getElementById(\'lk-modal\').innerHTML=\'\'" class="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm font-semibold">Cancel</button>' +
          '<button onclick="lkCreateTrunk()" class="px-4 py-2 bg-teal-500 text-white rounded-lg text-sm font-semibold hover:bg-teal-600">Create Trunk</button>' +
        '</div>' +
      '</div></div>';
}

async function lkCreateTrunk() {
  var name = document.getElementById('lk-trunk-name').value;
  var phone = document.getElementById('lk-trunk-phone').value;
  var krisp = document.getElementById('lk-trunk-krisp').checked;
  if (!phone) { window.rmToast('Phone number required', 'warning'); return; }
  try {
    var res = await saFetch('/api/admin/superadmin/livekit/trunk/create', {
      method: 'POST', body: JSON.stringify({ type: 'inbound', name: name, phone_number: phone, krisp_enabled: krisp })
    });
    var data = await res.json();
    if (data.success) { window.rmToast('Trunk created: ' + data.trunk_id, 'success'); document.getElementById('lk-modal').innerHTML = ''; loadView('livekit-agents'); }
    else window.rmToast('Error: ' + (data.error || 'Unknown'), 'error');
  } catch(e) { window.rmToast('Error: ' + e.message, 'error'); }
}

function lkShowCreateDispatch() {
  document.getElementById('lk-modal').innerHTML =
    '<div class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onclick="if(event.target===this)this.remove()">' +
      '<div class="bg-white rounded-2xl p-6 max-w-lg w-full mx-4 shadow-2xl">' +
        '<h3 class="text-lg font-bold mb-4"><i class="fas fa-route mr-2 text-blue-500"></i>Create Dispatch Rule</h3>' +
        '<div class="space-y-3">' +
          '<div><label class="text-xs font-semibold text-gray-600 block mb-1">Rule Name</label><input id="lk-disp-name" type="text" value="secretary-dispatch" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"></div>' +
          '<div><label class="text-xs font-semibold text-gray-600 block mb-1">Room Prefix</label><input id="lk-disp-prefix" type="text" value="secretary-2-" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"></div>' +
          '<div><label class="text-xs font-semibold text-gray-600 block mb-1">Trunk IDs (comma-separated)</label><input id="lk-disp-trunks" type="text" placeholder="ST_abc123, ST_def456" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"></div>' +
          '<div><label class="text-xs font-semibold text-gray-600 block mb-1">Metadata (JSON)</label><input id="lk-disp-meta" type="text" value=\'{"customer_id":2}\' class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"></div>' +
        '</div>' +
        '<div class="flex justify-end gap-2 mt-6">' +
          '<button onclick="document.getElementById(\'lk-modal\').innerHTML=\'\'" class="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm font-semibold">Cancel</button>' +
          '<button onclick="lkCreateDispatch()" class="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-semibold hover:bg-blue-600">Create Rule</button>' +
        '</div>' +
      '</div></div>';
}

async function lkCreateDispatch() {
  var name = document.getElementById('lk-disp-name').value;
  var prefix = document.getElementById('lk-disp-prefix').value;
  var trunkStr = document.getElementById('lk-disp-trunks').value;
  var meta = document.getElementById('lk-disp-meta').value;
  var trunks = trunkStr ? trunkStr.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [];
  try {
    var res = await saFetch('/api/admin/superadmin/livekit/dispatch/create', {
      method: 'POST', body: JSON.stringify({ name: name, trunk_ids: trunks, room_prefix: prefix, metadata: meta })
    });
    var data = await res.json();
    if (data.success) { window.rmToast('Dispatch rule created: ' + data.dispatch_rule_id, 'success'); document.getElementById('lk-modal').innerHTML = ''; loadView('livekit-agents'); }
    else window.rmToast('Error: ' + (data.error || 'Unknown'), 'error');
  } catch(e) { window.rmToast('Error: ' + e.message, 'error'); }
}

async function lkTestCall() {
  var prefix = document.getElementById('lk-test-prefix').value || 'secretary-2-';
  var resultDiv = document.getElementById('lk-test-result');
  resultDiv.innerHTML = '<div class="flex items-center gap-2 text-sm text-blue-600"><div class="w-4 h-4 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin"></div>Creating test room...</div>';
  try {
    var res = await saFetch('/api/admin/superadmin/livekit/test-call', {
      method: 'POST', body: JSON.stringify({ room_prefix: prefix, customer_id: 2 })
    });
    var data = await res.json();
    if (data.success) {
      resultDiv.innerHTML =
        '<div class="p-3 bg-green-50 border border-green-200 rounded-lg text-sm">' +
          '<p class="font-semibold text-green-800 mb-1"><i class="fas fa-check-circle mr-1"></i>Test room created</p>' +
          '<p class="text-green-700">Room: <code class="font-mono">' + data.room_name + '</code></p>' +
          '<p class="text-green-700 text-xs mt-1">Dispatch ID: ' + (data.dispatch_id || 'N/A') + '</p>' +
          '<p class="text-green-600 text-xs mt-2">Waiting 10s for agent to join...</p>' +
        '</div>';
      // Check after delay
      setTimeout(async function() {
        try {
          var rr = await saFetch('/api/admin/superadmin/livekit/rooms');
          var rd = await rr.json();
          var found = (rd.rooms || []).find(function(r) { return r.name === data.room_name; });
          if (found && found.participants && found.participants.length > 0) {
            var agentParts = found.participants.filter(function(p) { return (p.identity || '').includes('agent'); });
            resultDiv.innerHTML =
              '<div class="p-3 bg-green-50 border border-green-200 rounded-lg text-sm">' +
                '<p class="font-bold text-green-800"><i class="fas fa-check-circle mr-1"></i>AGENT IS LIVE! (' + agentParts.length + ' agent(s) joined)</p>' +
                '<p class="text-green-700 text-xs mt-1">Room: ' + data.room_name + ' — ' + found.participants.length + ' total participants</p>' +
              '</div>';
          } else {
            resultDiv.innerHTML =
              '<div class="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm">' +
                '<p class="font-semibold text-yellow-800"><i class="fas fa-exclamation-triangle mr-1"></i>No agent joined within 10s</p>' +
                '<p class="text-yellow-700 text-xs mt-1">The roofer-secretary agent may not be deployed to LiveKit Cloud. Deploy it using the CLI or ensure it\'s running.</p>' +
              '</div>';
          }
          // Cleanup test room
          saFetch('/api/admin/superadmin/livekit/cleanup-test', { method: 'POST', body: JSON.stringify({ room_name: data.room_name }) }).catch(function(){});
        } catch(e) { resultDiv.innerHTML += '<p class="text-red-500 text-xs mt-1">Check error: ' + e.message + '</p>'; }
      }, 10000);
    } else {
      resultDiv.innerHTML = '<div class="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">' + (data.error || 'Failed') + '</div>';
    }
  } catch(e) {
    resultDiv.innerHTML = '<div class="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">' + e.message + '</div>';
  }
}

// ============================================================
// LIVEKIT CONFIG & POOL ACTION FUNCTIONS
// ============================================================

// Toggle individual secretary config on/off
async function lkToggleConfig(customerId) {
  try {
    var res = await saFetch('/api/admin/superadmin/livekit/secretary-config/toggle', {
      method: 'POST', body: JSON.stringify({ customer_id: customerId })
    });
    var data = await res.json();
    if (data.success) {
      loadView('livekit-agents');
    } else { window.rmToast('Error: ' + (data.error || 'Unknown'), 'error'); }
  } catch(e) { window.rmToast('Error: ' + e.message, 'error'); }
}

// Bulk toggle all secretaries
async function lkBulkToggle(activate) {
  var action = activate ? 'ACTIVATE' : 'DEACTIVATE';
  if (!(await window.rmConfirm(action + ' all secretary configurations? This affects all customers.'))) return
  try {
    var res = await saFetch('/api/admin/superadmin/livekit/secretary-config/bulk-toggle', {
      method: 'POST', body: JSON.stringify({ activate: activate })
    });
    var data = await res.json();
    if (data.success) {
      window.rmToast(data.message + ' (' + (data.rows_changed || 0) + ' rows changed)', 'info');
      loadView('livekit-agents');
    } else { window.rmToast('Error: ' + (data.error || 'Unknown'), 'error'); }
  } catch(e) { window.rmToast('Error: ' + e.message, 'error'); }
}

// Edit a customer secretary config (opens modal)
function lkEditConfig(customerId, cfgJson) {
  var cfg;
  try { cfg = JSON.parse(cfgJson); } catch { cfg = {}; }
  document.getElementById('lk-modal').innerHTML =
    '<div class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center overflow-y-auto py-8" onclick="if(event.target===this)this.remove()">' +
      '<div class="bg-white rounded-2xl p-6 max-w-lg w-full mx-4 shadow-2xl">' +
        '<h3 class="text-lg font-bold mb-4"><i class="fas fa-edit mr-2 text-blue-500"></i>Edit Secretary Config — Customer #' + customerId + '</h3>' +
        '<div class="space-y-3 max-h-96 overflow-y-auto">' +
          '<div><label class="text-xs font-semibold text-gray-600 block mb-1">Agent Name</label><input id="lk-cfg-agent-name" type="text" value="' + (cfg.agent_name || 'Sarah') + '" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"></div>' +
          '<div><label class="text-xs font-semibold text-gray-600 block mb-1">Agent Voice</label><select id="lk-cfg-agent-voice" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">' +
            '<option value="alloy"' + (cfg.agent_voice === 'alloy' ? ' selected' : '') + '>Alloy (female)</option>' +
            '<option value="shimmer"' + (cfg.agent_voice === 'shimmer' ? ' selected' : '') + '>Shimmer (female)</option>' +
            '<option value="nova"' + (cfg.agent_voice === 'nova' ? ' selected' : '') + '>Nova (female)</option>' +
            '<option value="echo"' + (cfg.agent_voice === 'echo' ? ' selected' : '') + '>Echo (male)</option>' +
            '<option value="onyx"' + (cfg.agent_voice === 'onyx' ? ' selected' : '') + '>Onyx (male)</option>' +
            '<option value="fable"' + (cfg.agent_voice === 'fable' ? ' selected' : '') + '>Fable (British)</option>' +
          '</select></div>' +
          '<div><label class="text-xs font-semibold text-gray-600 block mb-1">Secretary Mode</label><select id="lk-cfg-mode" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">' +
            '<option value="directory"' + (cfg.secretary_mode === 'directory' ? ' selected' : '') + '>Directory</option>' +
            '<option value="answering"' + (cfg.secretary_mode === 'answering' ? ' selected' : '') + '>Answering</option>' +
            '<option value="full"' + (cfg.secretary_mode === 'full' ? ' selected' : '') + '>Full Secretary</option>' +
          '</select></div>' +
          '<div><label class="text-xs font-semibold text-gray-600 block mb-1">Business Phone</label><input id="lk-cfg-biz-phone" type="text" value="' + (cfg.business_phone || '') + '" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"></div>' +
          '<div><label class="text-xs font-semibold text-gray-600 block mb-1">AI Number (assigned)</label><input id="lk-cfg-ai-number" type="text" value="' + (cfg.assigned_phone_number || '') + '" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"></div>' +
          '<div><label class="text-xs font-semibold text-gray-600 block mb-1">Connection Status</label><select id="lk-cfg-conn" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">' +
            '<option value="not_connected"' + (cfg.connection_status === 'not_connected' ? ' selected' : '') + '>Not Connected</option>' +
            '<option value="pending_forwarding"' + (cfg.connection_status === 'pending_forwarding' ? ' selected' : '') + '>Pending Forwarding</option>' +
            '<option value="connected"' + (cfg.connection_status === 'connected' ? ' selected' : '') + '>Connected</option>' +
            '<option value="failed"' + (cfg.connection_status === 'failed' ? ' selected' : '') + '>Failed</option>' +
          '</select></div>' +
          '<div><label class="text-xs font-semibold text-gray-600 block mb-1">Greeting Script</label><textarea id="lk-cfg-greeting" rows="3" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">' + (cfg.greeting_script || '') + '</textarea></div>' +
        '</div>' +
        '<div class="flex justify-end gap-2 mt-6">' +
          '<button onclick="document.getElementById(\'lk-modal\').innerHTML=\'\'" class="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm font-semibold">Cancel</button>' +
          '<button onclick="lkSaveConfig(' + customerId + ')" class="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-semibold hover:bg-blue-600">Save Changes</button>' +
        '</div>' +
      '</div></div>';
}

async function lkSaveConfig(customerId) {
  var payload = {
    agent_name: document.getElementById('lk-cfg-agent-name').value,
    agent_voice: document.getElementById('lk-cfg-agent-voice').value,
    secretary_mode: document.getElementById('lk-cfg-mode').value,
    business_phone: document.getElementById('lk-cfg-biz-phone').value,
    assigned_phone_number: document.getElementById('lk-cfg-ai-number').value,
    connection_status: document.getElementById('lk-cfg-conn').value,
    greeting_script: document.getElementById('lk-cfg-greeting').value,
  };
  try {
    var res = await saFetch('/api/admin/superadmin/livekit/secretary-config/' + customerId, {
      method: 'PUT', body: JSON.stringify(payload)
    });
    var data = await res.json();
    if (data.success) {
      document.getElementById('lk-modal').innerHTML = '';
      loadView('livekit-agents');
    } else { window.rmToast('Error: ' + (data.error || 'Unknown'), 'error'); }
  } catch(e) { window.rmToast('Error: ' + e.message, 'error'); }
}

// Phone pool actions
async function lkAddToPool() {
  var number = document.getElementById('lk-pool-number').value.trim();
  var region = document.getElementById('lk-pool-region').value.trim();
  if (!number) { window.rmToast('Phone number is required', 'warning'); return; }
  try {
    var res = await saFetch('/api/admin/superadmin/livekit/phone-pool/add', {
      method: 'POST', body: JSON.stringify({ phone_number: number, region: region || 'AB' })
    });
    var data = await res.json();
    if (data.success) {
      document.getElementById('lk-pool-number').value = '';
      loadView('livekit-agents');
    } else { window.rmToast('Error: ' + (data.error || 'Unknown'), 'error'); }
  } catch(e) { window.rmToast('Error: ' + e.message, 'error'); }
}

async function lkReleaseNumber(number) {
  if (!(await window.rmConfirm('Release ' + number + ' back to the available pool? This will disconnect it from the assigned customer.'))) return
  try {
    var res = await saFetch('/api/admin/superadmin/livekit/phone-pool/release', {
      method: 'POST', body: JSON.stringify({ phone_number: number })
    });
    var data = await res.json();
    if (data.success) { loadView('livekit-agents'); }
    else { window.rmToast('Error: ' + (data.error || 'Unknown'), 'error'); }
  } catch(e) { window.rmToast('Error: ' + e.message, 'error'); }
}

async function lkDeleteNumber(encodedNumber) {
  var number = decodeURIComponent(encodedNumber);
  if (!(await window.rmConfirm('Permanently remove ' + number + ' from the phone pool? This cannot be undone.'))) return
  try {
    var res = await saFetch('/api/admin/superadmin/livekit/phone-pool/' + encodedNumber, { method: 'DELETE' });
    var data = await res.json();
    if (data.success) { loadView('livekit-agents'); }
    else { window.rmToast('Error: ' + (data.error || 'Unknown'), 'error'); }
  } catch(e) { window.rmToast('Error: ' + e.message, 'error'); }
}

// ============================================================
// SECRETARY MANAGER — Full Customer Secretary AI Management Hub
// ============================================================

// State for secretary manager sub-views
SA.smView = 'list'; // list | detail | onboard
SA.smCustomerId = null;
SA.smDetail = null;

function renderSecretaryManagerView() {
  if (SA.smView === 'detail' && SA.smDetail) return renderSMDetailView();
  if (SA.smView === 'onboard') return renderSMOnboardView();
  return renderSMListView();
}

// ─── LIST VIEW — All customers with secretary configs ───
function renderSMListView() {
  var d = SA.data.sm_configs || {};
  var configs = d.configs || [];
  var poolData = SA.data.sm_pool || {};
  var pool = poolData.numbers || [];
  var poolStats = poolData.stats || [];
  var availableCount = 0;
  var assignedCount = 0;
  poolStats.forEach(function(s) { if (s.status === 'available') availableCount = s.count; if (s.status === 'assigned') assignedCount = s.count; });

  var activeCount = configs.filter(function(c) { return c.is_active === 1; }).length;
  var connectedCount = configs.filter(function(c) { return c.connection_status === 'connected'; }).length;
  var totalCalls = configs.reduce(function(sum, c) { return sum + (c.total_calls || 0); }, 0);

  var rows = configs.map(function(c) {
    var activeBadge = c.is_active === 1
      ? '<span class="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-800 rounded-full text-[11px] font-semibold"><span class="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>Active</span>'
      : '<span class="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full text-[11px] font-semibold">Inactive</span>';
    var connBadge = c.connection_status === 'connected'
      ? '<span class="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-[10px] font-bold">Connected</span>'
      : c.connection_status === 'pending_forwarding'
        ? '<span class="px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded-full text-[10px] font-bold">Pending</span>'
        : '<span class="px-2 py-0.5 bg-red-100 text-red-600 rounded-full text-[10px] font-bold">Disconnected</span>';
    var modeBadge = c.secretary_mode === 'full'
      ? '<span class="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-[10px] font-bold">Full</span>'
      : c.secretary_mode === 'answering'
        ? '<span class="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px] font-bold">Answering</span>'
        : c.secretary_mode === 'directory'
          ? '<span class="px-2 py-0.5 bg-sky-100 text-sky-700 rounded text-[10px] font-bold">Directory</span>'
          : '<span class="px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded text-[10px] font-bold">' + (c.secretary_mode || 'N/A') + '</span>';

    return '<tr class="border-b border-gray-100 hover:bg-blue-50/50 cursor-pointer transition-colors" onclick="smOpenDetail(' + c.customer_id + ')">' +
      '<td class="px-4 py-3.5"><div class="font-bold text-gray-800 text-sm">' + (c.customer_name || c.email || 'ID:' + c.customer_id) + '</div><div class="text-[11px] text-gray-400 mt-0.5">' + (c.email || '') + '</div></td>' +
      '<td class="px-4 py-3.5 text-center">' + activeBadge + '</td>' +
      '<td class="px-4 py-3.5 text-center">' + connBadge + '</td>' +
      '<td class="px-4 py-3.5 text-center">' + modeBadge + '</td>' +
      '<td class="px-4 py-3.5"><div class="font-mono text-xs text-gray-600">' + (c.assigned_phone_number || '<span class="text-gray-300">—</span>') + '</div></td>' +
      '<td class="px-4 py-3.5 text-sm text-gray-600">' + (c.agent_name || 'Sarah') + '</td>' +
      '<td class="px-4 py-3.5 text-center"><span class="text-sm font-bold text-gray-700">' + (c.total_calls || 0) + '</span><span class="text-[10px] text-gray-400 block">' + (c.calls_7d || 0) + ' this wk</span></td>' +
      '<td class="px-4 py-3.5">' +
        '<div class="flex items-center gap-1">' +
          '<button onclick="event.stopPropagation();smOpenDetail(' + c.customer_id + ')" class="p-1.5 rounded-lg hover:bg-blue-100 text-blue-500" title="Open Full Editor"><i class="fas fa-edit text-xs"></i></button>' +
          '<button onclick="event.stopPropagation();smQuickToggle(' + c.customer_id + ')" class="p-1.5 rounded-lg hover:bg-' + (c.is_active === 1 ? 'red' : 'green') + '-100 text-' + (c.is_active === 1 ? 'red' : 'green') + '-500" title="' + (c.is_active === 1 ? 'Deactivate' : 'Activate') + '"><i class="fas fa-power-off text-xs"></i></button>' +
        '</div>' +
      '</td>' +
    '</tr>';
  }).join('');

  return '<div class="space-y-6">' +
    // Header
    '<div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">' +
      '<div>' +
        '<h2 class="text-2xl font-black text-gray-900"><i class="fas fa-user-headset mr-2 text-teal-500"></i>Roofer Secretary Manager</h2>' +
        '<p class="text-sm text-gray-500 mt-1">Onboard customers, configure their AI secretary agents, manage phone numbers & LiveKit connections</p>' +
      '</div>' +
      '<div class="flex gap-2">' +
        '<button onclick="smShowOnboard()" class="px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-sm font-bold shadow-md hover:shadow-lg transition-all"><i class="fas fa-user-plus mr-2"></i>Onboard New Customer</button>' +
        '<button onclick="loadView(\'secretary-manager\')" class="px-4 py-2.5 bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 rounded-xl text-sm font-semibold"><i class="fas fa-sync mr-1"></i>Refresh</button>' +
      '</div>' +
    '</div>' +

    // KPI Cards
    '<div class="grid grid-cols-2 md:grid-cols-5 gap-3">' +
      samc('Total Customers', configs.length, 'fa-users', 'teal', '') +
      samc('Active Agents', activeCount, 'fa-robot', 'green', activeCount + '/' + configs.length + ' enabled') +
      samc('Connected', connectedCount, 'fa-link', 'blue', 'LiveKit telephony') +
      samc('Total Calls', totalCalls, 'fa-phone-alt', 'purple', 'all time') +
      samc('Phone Pool', availableCount + ' avail', 'fa-sim-card', 'amber', assignedCount + ' assigned') +
    '</div>' +

    // Customer Table
    '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">' +
      '<div class="p-4 border-b bg-gray-50 flex items-center justify-between">' +
        '<h3 class="font-bold text-gray-800"><i class="fas fa-list mr-2 text-gray-400"></i>All Secretary Customers</h3>' +
        '<div class="flex gap-2">' +
          '<button onclick="smBulkToggle(true)" class="text-[11px] px-3 py-1.5 bg-green-50 text-green-700 rounded-lg font-semibold hover:bg-green-100"><i class="fas fa-play mr-1"></i>Activate All</button>' +
          '<button onclick="smBulkToggle(false)" class="text-[11px] px-3 py-1.5 bg-red-50 text-red-600 rounded-lg font-semibold hover:bg-red-100"><i class="fas fa-stop mr-1"></i>Deactivate All</button>' +
        '</div>' +
      '</div>' +
      (configs.length === 0
        ? '<div class="p-12 text-center"><i class="fas fa-user-headset text-4xl text-gray-200 mb-4"></i><p class="text-gray-400 mb-4">No customers with Secretary AI configured yet</p><button onclick="smShowOnboard()" class="px-6 py-2.5 bg-teal-600 text-white rounded-xl text-sm font-bold"><i class="fas fa-user-plus mr-2"></i>Onboard First Customer</button></div>'
        : '<div class="overflow-x-auto"><table class="w-full"><thead><tr class="bg-gray-50/80 text-[11px] text-gray-500 uppercase tracking-wider"><th class="px-4 py-3 text-left">Customer</th><th class="px-4 py-3 text-center">Status</th><th class="px-4 py-3 text-center">Connection</th><th class="px-4 py-3 text-center">Mode</th><th class="px-4 py-3 text-left">AI Phone #</th><th class="px-4 py-3 text-left">Agent Name</th><th class="px-4 py-3 text-center">Calls</th><th class="px-4 py-3 text-left">Actions</th></tr></thead><tbody>' + rows + '</tbody></table></div>') +
    '</div>' +

    // Quick Actions
    '<div class="bg-gradient-to-r from-teal-50 to-cyan-50 border border-teal-200 rounded-2xl p-5">' +
      '<div class="flex items-center gap-3">' +
        '<div class="w-10 h-10 bg-teal-100 rounded-xl flex items-center justify-center"><i class="fas fa-rocket text-teal-600"></i></div>' +
        '<div>' +
          '<h4 class="font-bold text-teal-900">Quick Actions</h4>' +
          '<p class="text-xs text-teal-700">Manage your Roofer Secretary AI fleet from here</p>' +
        '</div>' +
      '</div>' +
      '<div class="flex flex-wrap gap-2 mt-4">' +
        '<button onclick="smShowOnboard()" class="px-4 py-2 bg-teal-600 text-white rounded-lg text-xs font-bold hover:bg-teal-700"><i class="fas fa-user-plus mr-1"></i>Onboard Customer</button>' +
        '<button onclick="saDashboardSetView(\'customer-onboarding\')" class="px-4 py-2 bg-white text-gray-700 border border-teal-200 rounded-lg text-xs font-semibold hover:bg-teal-50"><i class="fas fa-list-check mr-1"></i>Onboarding History</button>' +
        '<button onclick="saDashboardSetView(\'livekit-agents\')" class="px-4 py-2 bg-white text-gray-700 border border-teal-200 rounded-lg text-xs font-semibold hover:bg-teal-50"><i class="fas fa-server mr-1"></i>LiveKit Agents</button>' +
        '<button onclick="saDashboardSetView(\'phone-marketplace\')" class="px-4 py-2 bg-white text-gray-700 border border-teal-200 rounded-lg text-xs font-semibold hover:bg-teal-50"><i class="fas fa-sim-card mr-1"></i>Phone Numbers</button>' +
        '<button onclick="saDashboardSetView(\'secretary-admin\')" class="px-4 py-2 bg-white text-gray-700 border border-teal-200 rounded-lg text-xs font-semibold hover:bg-teal-50"><i class="fas fa-chart-bar mr-1"></i>Secretary Analytics</button>' +
      '</div>' +
    '</div>' +

  '</div>' + '<div id="sm-modal"></div>';
}

// ─── DETAIL VIEW — Full customer agent editor ───
function renderSMDetailView() {
  var d = SA.smDetail;
  if (!d) return '<div class="p-8 text-gray-400">Loading customer details...</div>';
  var cust = d.customer || {};
  var cfg = d.config || {};
  var dirs = d.directories || [];
  var sub = d.subscription || {};
  var stats = d.call_stats || {};

  // Build directory editor rows (up to 4)
  var dirRows = '';
  for (var i = 0; i < 4; i++) {
    var dir = dirs[i] || {};
    dirRows += '<div class="grid grid-cols-3 gap-2 items-center">' +
      '<input id="sm-dir-name-' + i + '" class="border border-gray-200 rounded-lg px-3 py-2 text-sm" value="' + (dir.name || '').replace(/"/g, '&quot;') + '" placeholder="e.g., Sales">' +
      '<input id="sm-dir-phone-' + i + '" class="border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono" value="' + (dir.phone_or_action || '').replace(/"/g, '&quot;') + '" placeholder="+1 403 555 1234">' +
      '<input id="sm-dir-notes-' + i + '" class="border border-gray-200 rounded-lg px-3 py-2 text-sm" value="' + (dir.special_notes || '').replace(/"/g, '&quot;') + '" placeholder="Special notes...">' +
    '</div>';
  }

  var voiceOptions = ['alloy', 'shimmer', 'nova', 'echo', 'onyx', 'fable', 'ash', 'coral', 'sage', 'ballad', 'verse'];
  var voiceSelect = voiceOptions.map(function(v) {
    return '<option value="' + v + '"' + (cfg.agent_voice === v ? ' selected' : '') + '>' + v.charAt(0).toUpperCase() + v.slice(1) + '</option>';
  }).join('');

  var modeOptions = [
    { val: 'full', label: 'Full Secretary — handles everything (booking, FAQ, email, callbacks)' },
    { val: 'answering', label: 'Answering Service — take messages, forward urgent calls' },
    { val: 'directory', label: 'Directory — route callers to departments' },
    { val: 'receptionist', label: 'Receptionist — general reception and routing' },
    { val: 'always_on', label: 'Always On — never sends to voicemail' }
  ];
  var modeSelect = modeOptions.map(function(m) {
    return '<option value="' + m.val + '"' + (cfg.secretary_mode === m.val ? ' selected' : '') + '>' + m.label + '</option>';
  }).join('');

  return '<div class="space-y-6">' +
    // Back button + header
    '<div class="flex items-center gap-3">' +
      '<button onclick="SA.smView=\'list\';SA.smDetail=null;loadView(\'secretary-manager\')" class="w-10 h-10 bg-gray-100 hover:bg-gray-200 rounded-xl flex items-center justify-center transition-colors"><i class="fas fa-arrow-left text-gray-500"></i></button>' +
      '<div class="flex-1">' +
        '<h2 class="text-2xl font-black text-gray-900"><i class="fas fa-user-edit mr-2 text-blue-500"></i>' + (cust.brand_business_name || cust.name || cust.email || 'Customer #' + cust.id) + '</h2>' +
        '<p class="text-sm text-gray-500">' + (cust.email || '') + ' · Customer ID: ' + cust.id + ' · Created: ' + fmtDate(cust.created_at) + '</p>' +
      '</div>' +
      '<div class="flex gap-2">' +
        '<button onclick="smSaveConfig(' + cust.id + ')" class="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold shadow-md"><i class="fas fa-save mr-2"></i>Save All Changes</button>' +
        '<button onclick="smSetupLiveKit(' + cust.id + ')" class="px-4 py-2.5 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-sm font-bold shadow-md" title="Create SIP trunk & dispatch rule"><i class="fas fa-phone-volume mr-2"></i>Setup LiveKit</button>' +
      '</div>' +
    '</div>' +

    // KPI row
    '<div class="grid grid-cols-2 md:grid-cols-4 gap-3">' +
      samc('Status', cfg.is_active === 1 ? 'Active' : 'Inactive', 'fa-power-off', cfg.is_active === 1 ? 'green' : 'red', '') +
      samc('Total Calls', stats.total || 0, 'fa-phone', 'blue', fmtSeconds(stats.total_seconds || 0) + ' total') +
      samc('Leads Captured', stats.leads || 0, 'fa-user-check', 'purple', '') +
      samc('Subscription', sub.status || 'none', 'fa-credit-card', sub.status === 'active' ? 'green' : 'yellow', sub.current_period_end ? 'Ends ' + fmtDate(sub.current_period_end) : '') +
    '</div>' +

    // ─── SECTION 1: Core Identity ───
    '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">' +
      '<h3 class="text-lg font-bold text-gray-800 mb-4"><i class="fas fa-id-card mr-2 text-blue-400"></i>Agent Identity & Voice</h3>' +
      '<div class="grid grid-cols-1 md:grid-cols-3 gap-4">' +
        '<div><label class="text-xs font-semibold text-gray-500 block mb-1.5">Agent Name</label><input id="sm-agent-name" class="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm font-semibold focus:border-blue-400 focus:ring-2 focus:ring-blue-100" value="' + (cfg.agent_name || 'Sarah').replace(/"/g, '&quot;') + '"></div>' +
        '<div><label class="text-xs font-semibold text-gray-500 block mb-1.5">Voice</label><select id="sm-agent-voice" class="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:border-blue-400">' + voiceSelect + '</select></div>' +
        '<div><label class="text-xs font-semibold text-gray-500 block mb-1.5">Secretary Mode</label><select id="sm-sec-mode" class="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:border-blue-400">' + modeSelect + '</select></div>' +
      '</div>' +
      '<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">' +
        '<div class="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">' +
          '<label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" id="sm-is-active" class="w-5 h-5 rounded" ' + (cfg.is_active === 1 ? 'checked' : '') + '><span class="text-sm font-semibold text-gray-700">Agent Active (accepting calls)</span></label>' +
        '</div>' +
        '<div class="p-3 bg-gray-50 rounded-xl">' +
          '<div class="text-xs font-semibold text-gray-500 mb-1">Connection Status</div>' +
          '<select id="sm-conn-status" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">' +
            '<option value="not_connected"' + (cfg.connection_status === 'not_connected' ? ' selected' : '') + '>Not Connected</option>' +
            '<option value="pending_forwarding"' + (cfg.connection_status === 'pending_forwarding' ? ' selected' : '') + '>Pending Forwarding</option>' +
            '<option value="connected"' + (cfg.connection_status === 'connected' ? ' selected' : '') + '>Connected</option>' +
            '<option value="failed"' + (cfg.connection_status === 'failed' ? ' selected' : '') + '>Failed</option>' +
          '</select>' +
        '</div>' +
      '</div>' +
    '</div>' +

    // ─── SECTION 2: Phone Configuration ───
    '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">' +
      '<h3 class="text-lg font-bold text-gray-800 mb-4"><i class="fas fa-phone-alt mr-2 text-green-400"></i>Phone Configuration</h3>' +
      '<div class="grid grid-cols-1 md:grid-cols-3 gap-4">' +
        '<div><label class="text-xs font-semibold text-gray-500 block mb-1.5">Business Phone (customer\'s cell)</label><input id="sm-biz-phone" class="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm font-mono focus:border-green-400" value="' + (cfg.business_phone || '').replace(/"/g, '&quot;') + '" placeholder="+1 403 555 1234"></div>' +
        '<div><label class="text-xs font-semibold text-gray-500 block mb-1.5">Assigned AI Number (SIP/LiveKit)</label><input id="sm-ai-number" class="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm font-mono focus:border-green-400" value="' + (cfg.assigned_phone_number || '').replace(/"/g, '&quot;') + '" placeholder="+1 484 964 9758"></div>' +
        '<div><label class="text-xs font-semibold text-gray-500 block mb-1.5">Carrier Name</label><input id="sm-carrier" class="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:border-green-400" value="' + (cfg.carrier_name || '').replace(/"/g, '&quot;') + '" placeholder="Telus, Rogers, Bell..."></div>' +
      '</div>' +
      '<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">' +
        '<div><label class="text-xs font-semibold text-gray-500 block mb-1.5">Forwarding Method</label><select id="sm-fwd-method" class="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm">' +
          '<option value="call_forwarding"' + (cfg.forwarding_method === 'call_forwarding' ? ' selected' : '') + '>Call Forwarding (*21*)</option>' +
          '<option value="busy_forwarding"' + (cfg.forwarding_method === 'busy_forwarding' ? ' selected' : '') + '>Busy Forwarding (*67*)</option>' +
          '<option value="no_answer_forwarding"' + (cfg.forwarding_method === 'no_answer_forwarding' ? ' selected' : '') + '>No-Answer Forwarding (*61*)</option>' +
          '<option value="manual"' + (cfg.forwarding_method === 'manual' ? ' selected' : '') + '>Manual Configuration</option>' +
        '</select></div>' +
        '<div><label class="text-xs font-semibold text-gray-500 block mb-1.5">Forward-To Number (answering mode)</label><input id="sm-fwd-number" class="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm font-mono" value="' + (cfg.answering_forward_number || '').replace(/"/g, '&quot;') + '" placeholder="+1 403 555 5678"></div>' +
      '</div>' +
      (cfg.livekit_inbound_trunk_id ? '<div class="mt-4 p-3 bg-violet-50 rounded-xl border border-violet-200"><p class="text-xs text-violet-700"><i class="fas fa-check-circle mr-1 text-violet-500"></i><strong>LiveKit configured:</strong> Trunk: <code class="font-mono">' + cfg.livekit_inbound_trunk_id + '</code> | Dispatch: <code class="font-mono">' + (cfg.livekit_dispatch_rule_id || 'N/A') + '</code></p></div>' : '<div class="mt-4 p-3 bg-amber-50 rounded-xl border border-amber-200"><p class="text-xs text-amber-700"><i class="fas fa-exclamation-triangle mr-1"></i>LiveKit SIP trunk not configured. Click <strong>Setup LiveKit</strong> above after assigning a phone number.</p></div>') +
    '</div>' +

    // ─── SECTION 3: Greeting & Conversation ───
    '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">' +
      '<h3 class="text-lg font-bold text-gray-800 mb-4"><i class="fas fa-comment-dots mr-2 text-purple-400"></i>Greeting & Conversation Script</h3>' +
      '<div><label class="text-xs font-semibold text-gray-500 block mb-1.5">Opening Greeting</label><textarea id="sm-greeting" rows="3" class="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-sm focus:border-purple-400 focus:ring-2 focus:ring-purple-100">' + (cfg.greeting_script || '').replace(/</g, '&lt;') + '</textarea></div>' +
      '<div class="mt-4"><label class="text-xs font-semibold text-gray-500 block mb-1.5">Common Q&A <span class="text-gray-400 font-normal">(one per line: Q: question | A: answer)</span></label><textarea id="sm-qa" rows="5" class="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-sm font-mono focus:border-purple-400">' + (cfg.common_qa || '').replace(/</g, '&lt;') + '</textarea></div>' +
      '<div class="mt-4"><label class="text-xs font-semibold text-gray-500 block mb-1.5">General Notes for Agent <span class="text-gray-400 font-normal">(business context, special instructions)</span></label><textarea id="sm-notes" rows="4" class="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-sm focus:border-purple-400">' + (cfg.general_notes || '').replace(/</g, '&lt;') + '</textarea></div>' +
    '</div>' +

    // ─── SECTION 4: Directories ───
    '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">' +
      '<h3 class="text-lg font-bold text-gray-800 mb-4"><i class="fas fa-sitemap mr-2 text-sky-400"></i>Call Routing Directories <span class="text-sm font-normal text-gray-400">(2-4 departments)</span></h3>' +
      '<div class="grid grid-cols-3 gap-2 mb-2 text-[11px] text-gray-500 font-semibold uppercase tracking-wider"><span>Department Name</span><span>Phone / Action</span><span>Special Notes</span></div>' +
      '<div class="space-y-2">' + dirRows + '</div>' +
    '</div>' +

    // ─── SECTION 5: Full Secretary Capabilities ───
    '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">' +
      '<h3 class="text-lg font-bold text-gray-800 mb-4"><i class="fas fa-cogs mr-2 text-amber-400"></i>Full Secretary Settings</h3>' +
      '<div class="grid grid-cols-1 md:grid-cols-2 gap-6">' +
        // Left column — toggles
        '<div class="space-y-3">' +
          '<label class="flex items-center gap-3 p-3 bg-gray-50 rounded-xl cursor-pointer hover:bg-gray-100"><input type="checkbox" id="sm-can-book" class="w-5 h-5 rounded" ' + (cfg.full_can_book_appointments ? 'checked' : '') + '><span class="text-sm font-medium text-gray-700">Can book appointments</span></label>' +
          '<label class="flex items-center gap-3 p-3 bg-gray-50 rounded-xl cursor-pointer hover:bg-gray-100"><input type="checkbox" id="sm-can-email" class="w-5 h-5 rounded" ' + (cfg.full_can_send_email ? 'checked' : '') + '><span class="text-sm font-medium text-gray-700">Can send email summaries</span></label>' +
          '<label class="flex items-center gap-3 p-3 bg-gray-50 rounded-xl cursor-pointer hover:bg-gray-100"><input type="checkbox" id="sm-can-callback" class="w-5 h-5 rounded" ' + (cfg.full_can_schedule_callback ? 'checked' : '') + '><span class="text-sm font-medium text-gray-700">Can schedule callbacks</span></label>' +
          '<label class="flex items-center gap-3 p-3 bg-gray-50 rounded-xl cursor-pointer hover:bg-gray-100"><input type="checkbox" id="sm-can-faq" class="w-5 h-5 rounded" ' + (cfg.full_can_answer_faq ? 'checked' : '') + '><span class="text-sm font-medium text-gray-700">Can answer FAQs</span></label>' +
          '<label class="flex items-center gap-3 p-3 bg-gray-50 rounded-xl cursor-pointer hover:bg-gray-100"><input type="checkbox" id="sm-can-payment" class="w-5 h-5 rounded" ' + (cfg.full_can_take_payment_info ? 'checked' : '') + '><span class="text-sm font-medium text-gray-700">Can take payment info</span></label>' +
        '</div>' +
        // Right column — text fields
        '<div class="space-y-4">' +
          '<div><label class="text-xs font-semibold text-gray-500 block mb-1">Booking Link</label><input id="sm-booking-link" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" value="' + (cfg.full_booking_link || '').replace(/"/g, '&quot;') + '" placeholder="https://calendly.com/..."></div>' +
          '<div><label class="text-xs font-semibold text-gray-500 block mb-1">Services Offered</label><textarea id="sm-services" rows="2" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">' + (cfg.full_services_offered || '').replace(/</g, '&lt;') + '</textarea></div>' +
          '<div><label class="text-xs font-semibold text-gray-500 block mb-1">Pricing Info</label><textarea id="sm-pricing" rows="2" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">' + (cfg.full_pricing_info || '').replace(/</g, '&lt;') + '</textarea></div>' +
          '<div><label class="text-xs font-semibold text-gray-500 block mb-1">Service Area</label><input id="sm-area" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" value="' + (cfg.full_service_area || '').replace(/"/g, '&quot;') + '" placeholder="Calgary, AB and surrounding areas"></div>' +
          '<div><label class="text-xs font-semibold text-gray-500 block mb-1">Business Hours</label><input id="sm-hours" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" value="' + (cfg.full_business_hours || '').replace(/"/g, '&quot;') + '" placeholder="Mon-Fri 8am-6pm, Sat 9am-3pm"></div>' +
        '</div>' +
      '</div>' +
    '</div>' +

    // ─── SECTION 6: Answering Service Config ───
    '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">' +
      '<h3 class="text-lg font-bold text-gray-800 mb-4"><i class="fas fa-phone-square mr-2 text-rose-400"></i>Answering Service Settings</h3>' +
      '<div class="grid grid-cols-1 md:grid-cols-3 gap-4">' +
        '<div><label class="text-xs font-semibold text-gray-500 block mb-1.5">Fallback Action</label><select id="sm-fallback" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">' +
          '<option value="voicemail"' + (cfg.answering_fallback_action === 'voicemail' ? ' selected' : '') + '>Voicemail</option>' +
          '<option value="forward"' + (cfg.answering_fallback_action === 'forward' ? ' selected' : '') + '>Forward to Number</option>' +
          '<option value="sms"' + (cfg.answering_fallback_action === 'sms' ? ' selected' : '') + '>Send SMS</option>' +
        '</select></div>' +
        '<div><label class="text-xs font-semibold text-gray-500 block mb-1.5">SMS Notifications</label><select id="sm-sms-notify" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">' +
          '<option value="1"' + (cfg.answering_sms_notify ? ' selected' : '') + '>Enabled</option><option value="0"' + (!cfg.answering_sms_notify ? ' selected' : '') + '>Disabled</option></select></div>' +
        '<div><label class="text-xs font-semibold text-gray-500 block mb-1.5">Email Notifications</label><select id="sm-email-notify" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">' +
          '<option value="1"' + (cfg.answering_email_notify ? ' selected' : '') + '>Enabled</option><option value="0"' + (!cfg.answering_email_notify ? ' selected' : '') + '>Disabled</option></select></div>' +
      '</div>' +
      '<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">' +
        '<div><label class="text-xs font-semibold text-gray-500 block mb-1.5">Notification Email Address</label><input id="sm-notify-email" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" value="' + (cfg.answering_notify_email || '').replace(/"/g, '&quot;') + '" placeholder="notifications@company.ca"></div>' +
        '<div><label class="text-xs font-semibold text-gray-500 block mb-1.5">Email From Name</label><input id="sm-email-from" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" value="' + (cfg.full_email_from_name || '').replace(/"/g, '&quot;') + '" placeholder="ABC Roofing"></div>' +
      '</div>' +
    '</div>' +

    // Save bar
    '<div class="flex justify-between items-center bg-white rounded-2xl shadow-sm border border-gray-100 p-4">' +
      '<button onclick="SA.smView=\'list\';SA.smDetail=null;loadView(\'secretary-manager\')" class="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-xl text-sm font-semibold"><i class="fas fa-arrow-left mr-2"></i>Back to List</button>' +
      '<div class="flex gap-2">' +
        '<button onclick="smSetupLiveKit(' + cust.id + ')" class="px-4 py-2.5 bg-violet-500 hover:bg-violet-600 text-white rounded-xl text-sm font-bold"><i class="fas fa-phone-volume mr-2"></i>Setup LiveKit Telephony</button>' +
        '<button onclick="smSaveConfig(' + cust.id + ')" class="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold shadow-lg"><i class="fas fa-save mr-2"></i>Save All Changes</button>' +
      '</div>' +
    '</div>' +
  '</div>';
}

// ─── ONBOARD VIEW — Create new customer with secretary ───
function renderSMOnboardView() {
  return '<div class="space-y-6">' +
    '<div class="flex items-center gap-3">' +
      '<button onclick="SA.smView=\'list\';loadView(\'secretary-manager\')" class="w-10 h-10 bg-gray-100 hover:bg-gray-200 rounded-xl flex items-center justify-center transition-colors"><i class="fas fa-arrow-left text-gray-500"></i></button>' +
      '<div><h2 class="text-2xl font-black text-gray-900"><i class="fas fa-user-plus mr-2 text-teal-500"></i>Onboard New Roofer Customer</h2><p class="text-sm text-gray-500">Create account, configure Secretary AI, assign phone number — all in one step</p></div>' +
    '</div>' +

    // Account Info
    '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">' +
      '<h3 class="font-bold text-gray-800 mb-4"><i class="fas fa-building mr-2 text-blue-400"></i>Business & Account Details</h3>' +
      '<div class="grid grid-cols-1 md:grid-cols-3 gap-4">' +
        '<div><label class="text-xs font-semibold text-gray-500 block mb-1.5">Business Name *</label><input id="smo-business" class="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:border-teal-400" placeholder="ABC Roofing Ltd"></div>' +
        '<div><label class="text-xs font-semibold text-gray-500 block mb-1.5">Contact Name *</label><input id="smo-name" class="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:border-teal-400" placeholder="John Smith"></div>' +
        '<div><label class="text-xs font-semibold text-gray-500 block mb-1.5">Email (becomes username) *</label><input id="smo-email" type="email" class="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:border-teal-400" placeholder="john@abcroofing.ca"></div>' +
      '</div>' +
      '<div class="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">' +
        '<div><label class="text-xs font-semibold text-gray-500 block mb-1.5">Password *</label><input id="smo-password" type="text" class="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:border-teal-400" placeholder="Secure password"></div>' +
        '<div><label class="text-xs font-semibold text-gray-500 block mb-1.5">Phone Number (business line)</label><input id="smo-phone" class="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm font-mono focus:border-teal-400" placeholder="+1 403 555 1234"></div>' +
        '<div><label class="text-xs font-semibold text-gray-500 block mb-1.5">Carrier</label><input id="smo-carrier" class="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:border-teal-400" placeholder="Telus, Rogers, Bell..."></div>' +
      '</div>' +
    '</div>' +

    // Secretary Config
    '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">' +
      '<div class="flex items-center justify-between mb-4">' +
        '<h3 class="font-bold text-gray-800"><i class="fas fa-robot mr-2 text-purple-400"></i>Secretary AI Configuration</h3>' +
        '<button onclick="geminiAutoGenerateConfig()" class="px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white rounded-xl text-xs font-bold shadow-md hover:shadow-lg transition-all"><i class="fas fa-magic mr-1.5"></i>AI Auto-Generate Config</button>' +
      '</div>' +
      '<div class="grid grid-cols-1 md:grid-cols-3 gap-4">' +
        '<div><label class="text-xs font-semibold text-gray-500 block mb-1.5">Agent Name</label><input id="smo-agent-name" class="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm" value="Sarah"></div>' +
        '<div><label class="text-xs font-semibold text-gray-500 block mb-1.5">Voice</label><select id="smo-voice" class="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm"><option value="alloy" selected>Alloy</option><option value="shimmer">Shimmer</option><option value="nova">Nova</option><option value="echo">Echo</option><option value="onyx">Onyx</option><option value="fable">Fable</option><option value="ash">Ash</option><option value="coral">Coral</option><option value="sage">Sage</option></select></div>' +
        '<div><label class="text-xs font-semibold text-gray-500 block mb-1.5">Mode</label><select id="smo-mode" class="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm"><option value="full">Full Secretary</option><option value="answering">Answering Service</option><option value="directory">Directory</option><option value="receptionist">Receptionist</option><option value="always_on">Always On</option></select></div>' +
      '</div>' +
      '<div class="mt-4"><div class="flex items-center justify-between mb-1.5"><label class="text-xs font-semibold text-gray-500">Greeting Script</label><button onclick="geminiGenerateGreeting()" class="text-xs text-purple-500 hover:text-purple-700 font-medium"><i class="fas fa-magic mr-1"></i>AI Generate</button></div><textarea id="smo-greeting" rows="3" class="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-sm" placeholder="Thank you for calling [Business Name]. Our AI receptionist is here to help. How may I direct your call?"></textarea></div>' +
      '<div class="mt-4"><div class="flex items-center justify-between mb-1.5"><label class="text-xs font-semibold text-gray-500">Common Q&A</label><button onclick="geminiGenerateQA()" class="text-xs text-purple-500 hover:text-purple-700 font-medium"><i class="fas fa-magic mr-1"></i>AI Generate</button></div><textarea id="smo-qa" rows="3" class="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-sm font-mono" placeholder="Q: What are your hours? | A: Monday to Friday, 8am to 6pm"></textarea></div>' +
      '<div class="mt-4"><label class="text-xs font-semibold text-gray-500 block mb-1.5">General Notes / Business Context</label><textarea id="smo-notes" rows="3" class="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-sm" placeholder="We specialize in residential re-roofing in the Calgary area..."></textarea></div>' +
    '</div>' +

    // Phone Numbers
    '<div class="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-2xl border border-blue-200 p-6">' +
      '<h3 class="font-bold text-blue-800 mb-4"><i class="fas fa-phone-alt mr-2"></i>Phone Number Assignment</h3>' +
      '<div class="grid grid-cols-1 md:grid-cols-2 gap-4">' +
        '<div><label class="text-xs font-bold text-blue-700 block mb-1.5"><span class="w-5 h-5 bg-blue-200 rounded-full inline-flex items-center justify-center text-[10px] mr-1">1</span>Customer\'s Personal Cell</label><input id="smo-personal-phone" class="w-full border-2 border-blue-200 rounded-xl px-4 py-2.5 text-sm font-mono focus:border-blue-500" placeholder="+1 403 555 1234"><p class="text-[10px] text-blue-600 mt-1">They forward FROM this # when unavailable</p></div>' +
        '<div><label class="text-xs font-bold text-purple-700 block mb-1.5"><span class="w-5 h-5 bg-purple-200 rounded-full inline-flex items-center justify-center text-[10px] mr-1">2</span>AI Agent Phone (SIP)</label><input id="smo-agent-phone" class="w-full border-2 border-purple-200 rounded-xl px-4 py-2.5 text-sm font-mono focus:border-purple-500" placeholder="+1 484 964 9758"><p class="text-[10px] text-purple-600 mt-1">Twilio/LiveKit # the AI uses for calls</p></div>' +
      '</div>' +
    '</div>' +

    // Directories
    '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">' +
      '<h3 class="font-bold text-gray-800 mb-4"><i class="fas fa-sitemap mr-2 text-sky-400"></i>Call Directories (optional, 2-4)</h3>' +
      '<div class="grid grid-cols-3 gap-2 mb-2 text-[11px] text-gray-500 font-semibold uppercase tracking-wider"><span>Department</span><span>Phone / Action</span><span>Notes</span></div>' +
      '<div class="space-y-2">' +
        '<div class="grid grid-cols-3 gap-2"><input id="smo-dir0-name" class="border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="Sales"><input id="smo-dir0-phone" class="border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono" placeholder="+1 403 555 1111"><input id="smo-dir0-notes" class="border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="Main sales line"></div>' +
        '<div class="grid grid-cols-3 gap-2"><input id="smo-dir1-name" class="border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="Service"><input id="smo-dir1-phone" class="border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono" placeholder="+1 403 555 2222"><input id="smo-dir1-notes" class="border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="Existing customer repairs"></div>' +
        '<div class="grid grid-cols-3 gap-2"><input id="smo-dir2-name" class="border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="Emergency"><input id="smo-dir2-phone" class="border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono" placeholder="+1 403 555 3333"><input id="smo-dir2-notes" class="border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="After hours urgent"></div>' +
        '<div class="grid grid-cols-3 gap-2"><input id="smo-dir3-name" class="border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="Billing"><input id="smo-dir3-phone" class="border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono" placeholder="+1 403 555 4444"><input id="smo-dir3-notes" class="border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="Payment inquiries"></div>' +
      '</div>' +
    '</div>' +

    // Submit
    '<div class="flex justify-between items-center">' +
      '<button onclick="SA.smView=\'list\';loadView(\'secretary-manager\')" class="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-xl text-sm font-semibold"><i class="fas fa-arrow-left mr-2"></i>Cancel</button>' +
      '<button onclick="smOnboardCustomer()" class="px-8 py-3 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-sm font-bold shadow-lg hover:shadow-xl transition-all"><i class="fas fa-rocket mr-2"></i>Create Account & Configure Secretary AI</button>' +
    '</div>' +
  '</div>';
}

// ─── SECRETARY MANAGER ACTION FUNCTIONS ───

function smShowOnboard() {
  SA.smView = 'onboard';
  SA.loading = false;
  renderContent();
}

async function smOpenDetail(customerId) {
  SA.smView = 'detail';
  SA.smCustomerId = customerId;
  SA.loading = true;
  renderContent();
  try {
    var res = await saFetch('/api/admin/superadmin/secretary-manager/customer/' + customerId);
    if (res) {
      SA.smDetail = await res.json();
    }
  } catch(e) {
    SA.smDetail = { customer: { id: customerId }, config: {}, directories: [], subscription: {}, call_stats: {} };
    console.error('Error loading customer detail:', e);
  }
  SA.loading = false;
  renderContent();
}

async function smSaveConfig(customerId) {
  // Gather directories
  var directories = [];
  for (var i = 0; i < 4; i++) {
    var nameEl = document.getElementById('sm-dir-name-' + i);
    var phoneEl = document.getElementById('sm-dir-phone-' + i);
    var notesEl = document.getElementById('sm-dir-notes-' + i);
    if (nameEl && nameEl.value.trim()) {
      directories.push({ name: nameEl.value.trim(), phone_or_action: phoneEl ? phoneEl.value : '', special_notes: notesEl ? notesEl.value : '' });
    }
  }

  var payload = {
    agent_name: document.getElementById('sm-agent-name').value,
    agent_voice: document.getElementById('sm-agent-voice').value,
    secretary_mode: document.getElementById('sm-sec-mode').value,
    is_active: document.getElementById('sm-is-active').checked ? 1 : 0,
    connection_status: document.getElementById('sm-conn-status').value,
    business_phone: document.getElementById('sm-biz-phone').value,
    assigned_phone_number: document.getElementById('sm-ai-number').value,
    carrier_name: document.getElementById('sm-carrier').value,
    forwarding_method: document.getElementById('sm-fwd-method').value,
    answering_forward_number: document.getElementById('sm-fwd-number').value,
    greeting_script: document.getElementById('sm-greeting').value,
    common_qa: document.getElementById('sm-qa').value,
    general_notes: document.getElementById('sm-notes').value,
    // Full secretary settings
    full_can_book_appointments: document.getElementById('sm-can-book').checked ? 1 : 0,
    full_can_send_email: document.getElementById('sm-can-email').checked ? 1 : 0,
    full_can_schedule_callback: document.getElementById('sm-can-callback').checked ? 1 : 0,
    full_can_answer_faq: document.getElementById('sm-can-faq').checked ? 1 : 0,
    full_can_take_payment_info: document.getElementById('sm-can-payment').checked ? 1 : 0,
    full_booking_link: document.getElementById('sm-booking-link').value,
    full_services_offered: document.getElementById('sm-services').value,
    full_pricing_info: document.getElementById('sm-pricing').value,
    full_service_area: document.getElementById('sm-area').value,
    full_business_hours: document.getElementById('sm-hours').value,
    // Answering settings
    answering_fallback_action: document.getElementById('sm-fallback').value,
    answering_sms_notify: document.getElementById('sm-sms-notify').value === '1' ? 1 : 0,
    answering_email_notify: document.getElementById('sm-email-notify').value === '1' ? 1 : 0,
    answering_notify_email: document.getElementById('sm-notify-email').value,
    full_email_from_name: document.getElementById('sm-email-from').value,
    directories: directories
  };

  try {
    var res = await saFetch('/api/admin/superadmin/secretary-manager/customer/' + customerId + '/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    var data = await res.json();
    if (data.success) {
      window.rmToast('Secretary AI configuration saved for customer #' + customerId, 'success');
      smOpenDetail(customerId);
    } else {
      window.rmToast('Error: ' + (data.error || 'Failed to save'), 'error');
    }
  } catch(e) {
    window.rmToast('Error saving config: ' + e.message, 'error');
  }
}

async function smQuickToggle(customerId) {
  try {
    var res = await saFetch('/api/admin/superadmin/livekit/secretary-config/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer_id: customerId })
    });
    var data = await res.json();
    if (data.success) {
      loadView('secretary-manager');
    } else { window.rmToast('Error: ' + (data.error || 'Unknown'), 'error'); }
  } catch(e) { window.rmToast('Error: ' + e.message, 'error'); }
}

async function smBulkToggle(activate) {
  var action = activate ? 'ACTIVATE' : 'DEACTIVATE';
  if (!(await window.rmConfirm(action + ' all secretary agents? This affects every customer.'))) return
  try {
    var res = await saFetch('/api/admin/superadmin/livekit/secretary-config/bulk-toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activate: activate })
    });
    var data = await res.json();
    if (data.success) {
      window.rmToast(data.message + ' (' + (data.rows_changed || 0) + ' customers affected)', 'info');
      loadView('secretary-manager');
    } else { window.rmToast('Error: ' + (data.error || 'Unknown'), 'error'); }
  } catch(e) { window.rmToast('Error: ' + e.message, 'error'); }
}

async function smSetupLiveKit(customerId) {
  if (!(await window.rmConfirm('Set up LiveKit SIP trunk and dispatch rule for customer #' + customerId + '?\n\nThis will create the telephony infrastructure for their AI secretary to receive calls.'))) return
  try {
    var res = await saFetch('/api/admin/superadmin/secretary-manager/setup-livekit/' + customerId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    var data = await res.json();
    if (data.success) {
      window.rmToast('LiveKit telephony configured!\n\nTrunk ID: ' + data.trunk_id + '\nDispatch Rule: ' + data.dispatch_rule_id + '\n\nThe customer\'s AI secretary will now receive calls on their assigned number.', 'info');
      smOpenDetail(customerId);
    } else if (data.already_configured) {
      window.rmToast('Already configured!\n\nTrunk: ' + data.trunk_id + '\nDispatch: ' + data.dispatch_rule_id, 'info');
    } else {
      window.rmToast('Error: ' + (data.error || 'Failed', 'error'));
    }
  } catch(e) { window.rmToast('Error: ' + e.message, 'error'); }
}

window.smOnboardCustomer = async function() {
  var email = (document.getElementById('smo-email') || {}).value || '';
  var password = (document.getElementById('smo-password') || {}).value || '';
  var contactName = (document.getElementById('smo-name') || {}).value || '';
  var businessName = (document.getElementById('smo-business') || {}).value || '';

  if (!email || !password || !contactName) {
    window.rmToast('Email, Password, and Contact Name are required.', 'warning');
    return;
  }

  var agentPhone = (document.getElementById('smo-agent-phone') || {}).value || '';
  var personalPhone = (document.getElementById('smo-phone') || {}).value || '';

  var payload = {
    business_name: businessName,
    contact_name: contactName,
    email: email,
    phone: personalPhone,
    personal_phone: personalPhone,
    password: password,
    secretary_mode: (document.getElementById('smo-mode') || {}).value || 'receptionist',
    agent_phone_number: agentPhone,
    secretary_phone_number: agentPhone,
    call_forwarding_number: personalPhone,
    phone_provider: 'twilio',
    enable_secretary: true,
    notes: (document.getElementById('smo-notes') || {}).value || ''
  };

  try {
    var res = await saFetch('/api/admin/superadmin/onboarding/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    var data = await res.json();
    if (data.success) {
      var msg = 'Customer onboarded successfully!\n\n';
      msg += 'Customer ID: ' + data.customer_id + '\n';
      msg += 'Email/Login: ' + email + '\n\n';
      msg += 'NEXT STEPS:\n';
      msg += '1. Open their profile (click OK, then their row in the list)\n';
      msg += '2. Click "Setup LiveKit" to create their SIP trunk\n';
      msg += '3. Customer forwards their cell to the AI number\n';
      window.rmToast(msg, 'info');
      SA.smView = 'list';
      loadView('secretary-manager');
    } else {
      window.rmToast('Error: ' + (data.error || 'Failed to create customer'), 'error');
    }
  } catch(e) {
    window.rmToast('Error creating customer: ' + e.message, 'error');
  }
};

// ============================================================
// GEMINI AI COMMAND TERMINAL
// Full-featured AI command center for platform management
// ============================================================

// Gemini conversation state
if (!SA.geminiMessages) SA.geminiMessages = [];
if (!SA.geminiLoading) SA.geminiLoading = false;

function renderGeminiCommandView() {
  const status = SA.data.gemini_status || {};
  const isConfigured = status.configured && status.status === 'ok';
  const aiBackend = status.backend || (status.model === 'openai-fallback' ? 'openai' : 'gemini');
  const aiModel = status.model || 'gemini-2.5-flash';

  return `
  <div class="slide-in">
    <!-- Header -->
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold text-slate-800 flex items-center gap-3">
          <div class="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
            <i class="fas fa-terminal text-white text-sm"></i>
          </div>
          Gemini AI Command Center
        </h1>
        <p class="text-slate-500 text-sm mt-1">Powered by Google Gemini 2.5 Flash — your AI co-pilot for platform management</p>
      </div>
      <div class="flex items-center gap-2">
        <span class="px-3 py-1.5 rounded-full text-xs font-bold ${isConfigured ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">
          <i class="fas ${isConfigured ? 'fa-check-circle' : 'fa-exclamation-triangle'} mr-1"></i>
          ${isConfigured ? 'Gemini Connected' : 'Not Configured'}
        </span>
        <button onclick="geminiClearHistory()" class="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-medium text-slate-600 transition-all">
          <i class="fas fa-trash mr-1"></i>Clear History
        </button>
      </div>
    </div>

    ${!isConfigured ? `
    <div class="sa-section mb-6">
      <div class="sa-section-body bg-amber-50 border border-amber-200 rounded-xl">
        <div class="flex items-start gap-3">
          <i class="fas fa-exclamation-triangle text-amber-500 text-xl mt-0.5"></i>
          <div>
            <h3 class="font-bold text-amber-800 text-sm">AI API Configuration</h3>
            <p class="text-amber-700 text-xs mt-1">${status.error || 'AI backend not responding.'}${aiBackend === 'openai' ? ' Using OpenAI as fallback.' : ''}</p>
            <p class="text-amber-600 text-[11px] mt-1">For best results, set <code class="bg-amber-100 px-1.5 py-0.5 rounded text-[11px]">GEMINI_API_KEY</code> in Cloudflare secrets. Get a free key at <a href="https://aistudio.google.com/apikey" target="_blank" class="underline">aistudio.google.com</a></p>
          </div>
        </div>
      </div>
    </div>` : ''}

    <!-- Quick Actions Grid -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      <button onclick="geminiQuickAction('summarize')" class="group bg-white border border-slate-200 hover:border-blue-300 hover:shadow-md rounded-xl p-4 text-left transition-all">
        <div class="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center mb-2 group-hover:bg-blue-200 transition-all"><i class="fas fa-chart-pie text-blue-600 text-sm"></i></div>
        <p class="text-xs font-bold text-slate-700">Platform Summary</p>
        <p class="text-[10px] text-slate-400 mt-0.5">Stats, health & KPIs</p>
      </button>
      <button onclick="geminiQuickAction('secretary-strategy')" class="group bg-white border border-slate-200 hover:border-purple-300 hover:shadow-md rounded-xl p-4 text-left transition-all">
        <div class="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center mb-2 group-hover:bg-purple-200 transition-all"><i class="fas fa-phone-volume text-purple-600 text-sm"></i></div>
        <p class="text-xs font-bold text-slate-700">Secretary Strategy</p>
        <p class="text-[10px] text-slate-400 mt-0.5">Growth & optimization</p>
      </button>
      <button onclick="geminiQuickAction('marketing-ideas')" class="group bg-white border border-slate-200 hover:border-green-300 hover:shadow-md rounded-xl p-4 text-left transition-all">
        <div class="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center mb-2 group-hover:bg-green-200 transition-all"><i class="fas fa-bullhorn text-green-600 text-sm"></i></div>
        <p class="text-xs font-bold text-slate-700">Marketing Ideas</p>
        <p class="text-[10px] text-slate-400 mt-0.5">Campaigns & copy</p>
      </button>
      <button onclick="geminiQuickAction('pricing-advice')" class="group bg-white border border-slate-200 hover:border-amber-300 hover:shadow-md rounded-xl p-4 text-left transition-all">
        <div class="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center mb-2 group-hover:bg-amber-200 transition-all"><i class="fas fa-dollar-sign text-amber-600 text-sm"></i></div>
        <p class="text-xs font-bold text-slate-700">Pricing Advice</p>
        <p class="text-[10px] text-slate-400 mt-0.5">Plans & packages</p>
      </button>
    </div>

    <!-- Quick Action Row 2 -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      <button onclick="geminiQuickAction('generate-config')" class="group bg-white border border-slate-200 hover:border-teal-300 hover:shadow-md rounded-xl p-4 text-left transition-all">
        <div class="w-8 h-8 bg-teal-100 rounded-lg flex items-center justify-center mb-2 group-hover:bg-teal-200 transition-all"><i class="fas fa-magic text-teal-600 text-sm"></i></div>
        <p class="text-xs font-bold text-slate-700">Generate Agent Config</p>
        <p class="text-[10px] text-slate-400 mt-0.5">AI secretary setup</p>
      </button>
      <button onclick="geminiQuickAction('blog-post')" class="group bg-white border border-slate-200 hover:border-indigo-300 hover:shadow-md rounded-xl p-4 text-left transition-all">
        <div class="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center mb-2 group-hover:bg-indigo-200 transition-all"><i class="fas fa-pen-nib text-indigo-600 text-sm"></i></div>
        <p class="text-xs font-bold text-slate-700">Write Blog Post</p>
        <p class="text-[10px] text-slate-400 mt-0.5">SEO content</p>
      </button>
      <button onclick="geminiQuickAction('analyze-calls')" class="group bg-white border border-slate-200 hover:border-rose-300 hover:shadow-md rounded-xl p-4 text-left transition-all">
        <div class="w-8 h-8 bg-rose-100 rounded-lg flex items-center justify-center mb-2 group-hover:bg-rose-200 transition-all"><i class="fas fa-chart-bar text-rose-600 text-sm"></i></div>
        <p class="text-xs font-bold text-slate-700">Call Analytics</p>
        <p class="text-[10px] text-slate-400 mt-0.5">Performance review</p>
      </button>
      <button onclick="geminiQuickAction('competitive')" class="group bg-white border border-slate-200 hover:border-cyan-300 hover:shadow-md rounded-xl p-4 text-left transition-all">
        <div class="w-8 h-8 bg-cyan-100 rounded-lg flex items-center justify-center mb-2 group-hover:bg-cyan-200 transition-all"><i class="fas fa-chess text-cyan-600 text-sm"></i></div>
        <p class="text-xs font-bold text-slate-700">Competitive Intel</p>
        <p class="text-[10px] text-slate-400 mt-0.5">Market positioning</p>
      </button>
    </div>

    <!-- Chat Terminal -->
    <div class="sa-section" style="border: 2px solid #e2e8f0;">
      <div class="sa-section-header bg-gradient-to-r from-slate-800 to-slate-900">
        <h3 class="text-white" style="color:white"><i class="fas fa-terminal mr-2" style="color:#60a5fa"></i>AI Terminal</h3>
        <div class="flex items-center gap-2">
          <span class="text-[10px] text-slate-400 font-mono">${aiModel}${aiBackend === 'openai' ? ' (OpenAI)' : ''}</span>
          <div class="w-2 h-2 rounded-full ${isConfigured ? 'bg-green-400 animate-pulse' : 'bg-red-400'}"></div>
        </div>
      </div>

      <!-- Message Area -->
      <div id="gemini-chat-area" class="bg-slate-900 overflow-y-auto" style="height:450px; padding:20px;">
        ${SA.geminiMessages.length === 0 ? `
        <div class="text-center py-12">
          <div class="w-16 h-16 bg-gradient-to-br from-blue-500/20 to-purple-500/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <i class="fas fa-robot text-blue-400 text-2xl"></i>
          </div>
          <h3 class="text-slate-300 font-bold text-lg mb-2">Gemini AI Command Center</h3>
          <p class="text-slate-500 text-sm max-w-md mx-auto mb-4">Ask anything about your platform, customers, agents, marketing strategy, or generate content. Use the quick actions above or type below.</p>
          <div class="flex flex-wrap justify-center gap-2">
            <button onclick="geminiSendFromSuggestion('How many active customers do I have and what is the revenue trend?')" class="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-lg text-xs transition-all border border-slate-700">Revenue trend</button>
            <button onclick="geminiSendFromSuggestion('Generate a cold email for roofing companies about our AI Secretary service')" class="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-lg text-xs transition-all border border-slate-700">Cold email</button>
            <button onclick="geminiSendFromSuggestion('What are the top 5 things I should do this week to grow Roof Manager?')" class="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-lg text-xs transition-all border border-slate-700">Weekly priorities</button>
            <button onclick="geminiSendFromSuggestion('Write a Google Ads headline and description for AI Roofer Secretary')" class="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-lg text-xs transition-all border border-slate-700">Google Ads copy</button>
          </div>
        </div>` : SA.geminiMessages.map(function(m, i) {
          return geminiRenderMessage(m);
        }).join('')}
        ${SA.geminiLoading ? `
        <div class="flex items-start gap-3 mt-4">
          <div class="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center flex-shrink-0">
            <i class="fas fa-robot text-white text-xs"></i>
          </div>
          <div class="bg-slate-800 rounded-xl px-4 py-3 max-w-[85%]">
            <div class="flex items-center gap-2">
              <div class="flex gap-1">
                <div class="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style="animation-delay:0ms"></div>
                <div class="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style="animation-delay:150ms"></div>
                <div class="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style="animation-delay:300ms"></div>
              </div>
              <span class="text-slate-500 text-xs">Gemini is thinking...</span>
            </div>
          </div>
        </div>` : ''}
      </div>

      <!-- Input Area -->
      <div class="bg-slate-800 border-t border-slate-700 p-4">
        <div class="flex gap-3">
          <div class="flex-1 relative">
            <textarea id="gemini-input" rows="2" class="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-slate-500" placeholder="Ask Gemini anything about your platform..." onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();geminiSend()}"></textarea>
          </div>
          <button onclick="geminiSend()" id="gemini-send-btn" class="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white px-5 rounded-xl font-bold text-sm transition-all hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed self-end" style="height:50px">
            <i class="fas fa-paper-plane"></i>
          </button>
        </div>
        <div class="flex items-center justify-between mt-2">
          <p class="text-[10px] text-slate-500"><i class="fas fa-bolt mr-1 text-amber-400"></i>Shift+Enter for new line. Enter to send.</p>
          <p class="text-[10px] text-slate-500 font-mono">${SA.geminiMessages.length} messages</p>
        </div>
      </div>
    </div>

    <!-- Capabilities Grid -->
    <div class="grid md:grid-cols-3 gap-4 mt-6">
      <div class="bg-white rounded-xl border border-slate-200 p-5">
        <h4 class="text-sm font-bold text-slate-700 mb-3"><i class="fas fa-database mr-2 text-blue-500"></i>Platform Intelligence</h4>
        <ul class="text-xs text-slate-500 space-y-1.5">
          <li><i class="fas fa-check text-green-500 mr-1.5"></i>Live customer, order & call data</li>
          <li><i class="fas fa-check text-green-500 mr-1.5"></i>Secretary agent performance review</li>
          <li><i class="fas fa-check text-green-500 mr-1.5"></i>Lead pipeline & conversion analysis</li>
          <li><i class="fas fa-check text-green-500 mr-1.5"></i>Strategic recommendations</li>
        </ul>
      </div>
      <div class="bg-white rounded-xl border border-slate-200 p-5">
        <h4 class="text-sm font-bold text-slate-700 mb-3"><i class="fas fa-pen-nib mr-2 text-purple-500"></i>Content Generation</h4>
        <ul class="text-xs text-slate-500 space-y-1.5">
          <li><i class="fas fa-check text-green-500 mr-1.5"></i>Blog posts & SEO content</li>
          <li><i class="fas fa-check text-green-500 mr-1.5"></i>Email campaigns & outreach</li>
          <li><i class="fas fa-check text-green-500 mr-1.5"></i>Google Ads / Meta ad copy</li>
          <li><i class="fas fa-check text-green-500 mr-1.5"></i>Secretary greetings & Q&A</li>
        </ul>
      </div>
      <div class="bg-white rounded-xl border border-slate-200 p-5">
        <h4 class="text-sm font-bold text-slate-700 mb-3"><i class="fas fa-info-circle mr-2 text-amber-500"></i>Limitations</h4>
        <ul class="text-xs text-slate-500 space-y-1.5">
          <li><i class="fas fa-eye text-blue-500 mr-1.5"></i>Read-only — sees live DB data</li>
          <li><i class="fas fa-times text-red-400 mr-1.5"></i>Cannot edit configs or toggle agents</li>
          <li><i class="fas fa-times text-red-400 mr-1.5"></i>Cannot create accounts or send email</li>
          <li><i class="fas fa-arrow-right text-slate-400 mr-1.5"></i>Will guide you to the right panel</li>
        </ul>
      </div>
    </div>
  </div>`;
}

function geminiRenderMessage(m) {
  if (m.role === 'user') {
    return '<div class="flex items-start gap-3 mb-4 justify-end">' +
      '<div class="bg-blue-600 rounded-xl px-4 py-3 max-w-[85%]">' +
        '<p class="text-white text-sm whitespace-pre-wrap">' + escapeHtml(m.content) + '</p>' +
      '</div>' +
      '<div class="w-8 h-8 bg-teal-600 rounded-lg flex items-center justify-center flex-shrink-0">' +
        '<i class="fas fa-user text-white text-xs"></i>' +
      '</div>' +
    '</div>';
  }
  // assistant
  return '<div class="flex items-start gap-3 mb-4">' +
    '<div class="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center flex-shrink-0">' +
      '<i class="fas fa-robot text-white text-xs"></i>' +
    '</div>' +
    '<div class="bg-slate-800 rounded-xl px-4 py-3 max-w-[85%] border border-slate-700">' +
      '<div class="text-slate-200 text-sm gemini-response">' + geminiFormatResponse(m.content) + '</div>' +
      (m.usage ? '<p class="text-[10px] text-slate-600 mt-2 font-mono">tokens: ' + (m.usage.totalTokenCount || '?') + '</p>' : '') +
    '</div>' +
    '<button onclick="geminiCopyMessage(this)" class="self-start mt-1 text-slate-600 hover:text-white text-xs transition-all" title="Copy"><i class="fas fa-copy"></i></button>' +
  '</div>';
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function geminiFormatResponse(text) {
  if (!text) return '';
  // Convert markdown-like formatting to HTML
  var html = escapeHtml(text);
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong class="text-white">$1</strong>');
  // Code blocks
  html = html.replace(/```([\s\S]*?)```/g, '<pre class="bg-slate-900 rounded-lg p-3 mt-2 mb-2 text-xs text-green-400 overflow-x-auto border border-slate-700"><code>$1</code></pre>');
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="bg-slate-900 px-1.5 py-0.5 rounded text-[11px] text-blue-300">$1</code>');
  // Bullet points
  html = html.replace(/^[\-\*] (.+)$/gm, '<div class="flex gap-2 my-0.5"><span class="text-blue-400 mt-0.5">&#8226;</span><span>$1</span></div>');
  // Numbered lists
  html = html.replace(/^(\d+)\. (.+)$/gm, '<div class="flex gap-2 my-0.5"><span class="text-blue-400 font-bold min-w-[20px]">$1.</span><span>$2</span></div>');
  // Headers
  html = html.replace(/^### (.+)$/gm, '<h4 class="text-white font-bold text-sm mt-3 mb-1">$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3 class="text-white font-bold mt-3 mb-1">$1</h3>');
  // Line breaks
  html = html.replace(/\n/g, '<br>');
  return html;
}

function geminiCopyMessage(btn) {
  var msgDiv = btn.previousElementSibling.querySelector('.gemini-response');
  if (msgDiv) {
    navigator.clipboard.writeText(msgDiv.innerText).then(function() {
      btn.innerHTML = '<i class="fas fa-check text-green-400"></i>';
      setTimeout(function() { btn.innerHTML = '<i class="fas fa-copy"></i>'; }, 1500);
    });
  }
}

async function geminiClearHistory() {
  if (!(await window.rmConfirm('Clear all Gemini conversation history?'))) return
  SA.geminiMessages = [];
  renderContent();
}

function geminiQuickAction(action) {
  var prompts = {
    'summarize': 'Give me a comprehensive platform status summary: active customers, total orders, revenue trends, active secretary agents, recent signups, and top 3 priorities for this week.',
    'secretary-strategy': 'Analyze our Roofer Secretary AI product. What is the growth strategy? How do we get more roofing companies to subscribe at $249/month? Give me 5 specific, actionable ideas with expected ROI.',
    'marketing-ideas': 'Generate 5 marketing campaign ideas for Roof Manager targeting roofing contractors in Alberta and Ontario. Include Google Ads headlines, Facebook ad concepts, and email subject lines.',
    'pricing-advice': 'Review our pricing structure: Express reports (1 credit), Standard reports (2 credits), Pro reports (3 credits). Secretary AI is $249/month. Credit packs range from $29 (5 credits) to $595 (100 credits). What adjustments would maximize revenue?',
    'generate-config': 'I need to onboard a new customer. Their business is "Maple Leaf Roofing" in Calgary, Alberta. They do residential re-roofing, siding, and gutter installation. Generate a complete AI secretary configuration including greeting, Q&A, directories, and agent settings.',
    'blog-post': 'Write a 600-word SEO blog post titled "Why Every Roofing Company Needs an AI Phone Secretary in 2026". Target keywords: AI roofing secretary, automated phone answering for roofers, roofing business automation. Include a compelling intro, 4 key benefits, and a call-to-action.',
    'analyze-calls': 'Analyze the overall performance of our AI secretary agents across all customers. What are the common call patterns? What improvements should we make to the greeting scripts, Q&A banks, and call routing? Provide specific optimization suggestions.',
    'competitive': 'Analyze the competitive landscape for AI phone answering services targeting roofing companies in Canada. Who are the main competitors? What is our unique advantage with the LiveKit + AI Secretary approach? How should we position against Smith.ai, Ruby Receptionist, and similar services?'
  };
  var prompt = prompts[action] || action;
  document.getElementById('gemini-input').value = prompt;
  geminiSend();
}

function geminiSendFromSuggestion(text) {
  document.getElementById('gemini-input').value = text;
  geminiSend();
}

async function geminiSend() {
  var input = document.getElementById('gemini-input');
  var prompt = (input.value || '').trim();
  if (!prompt) return;
  input.value = '';

  // Add user message
  SA.geminiMessages.push({ role: 'user', content: prompt });
  SA.geminiLoading = true;
  renderContent();
  scrollGeminiToBottom();

  try {
    // Always use /command for first message (DB-aware), /chat for follow-ups (multi-turn context)
    var useCommand = SA.geminiMessages.filter(function(m) { return m.role === 'user'; }).length <= 1;
    var body, url;

    if (useCommand) {
      url = '/api/gemini/command';
      body = JSON.stringify({ prompt: prompt });
    } else {
      url = '/api/gemini/chat';
      // Send last 20 messages for context
      var msgs = SA.geminiMessages.slice(-20).map(function(m) {
        return { role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content };
      });
      body = JSON.stringify({ messages: msgs });
    }

    var res = await fetch(url, {
      method: 'POST',
      headers: { ...saHeaders(), 'Content-Type': 'application/json' },
      body: body
    });
    var data = await res.json();
    var reply = data.reply || data.text || 'No response received.';

    SA.geminiMessages.push({
      role: 'assistant',
      content: reply,
      usage: data.usage || null
    });
  } catch(err) {
    SA.geminiMessages.push({
      role: 'assistant',
      content: 'Error: ' + err.message
    });
  }

  SA.geminiLoading = false;
  renderContent();
  scrollGeminiToBottom();
}

function scrollGeminiToBottom() {
  setTimeout(function() {
    var area = document.getElementById('gemini-chat-area');
    if (area) area.scrollTop = area.scrollHeight;
  }, 100);
}

// ============================================================
// GEMINI AI-ASSIST FOR SECRETARY MANAGER — Auto-generate config
// Called from the Onboard New Customer form
// ============================================================

window.geminiAutoGenerateConfig = async function() {
  var biz = document.getElementById('smo-business')?.value || '';
  var contact = document.getElementById('smo-name')?.value || '';
  if (!biz) { window.rmToast('Enter a business name first', 'info'); return; }

  var btn = event.target.closest('button');
  var origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>AI Generating...';

  try {
    var res = await fetch('/api/gemini/generate-config', {
      method: 'POST',
      headers: { ...saHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        business_name: biz,
        contact_name: contact,
        business_description: document.getElementById('smo-notes')?.value || '',
        service_area: 'Alberta, Canada'
      })
    });
    var data = await res.json();
    if (!data.success || !data.config) {
      window.rmToast('AI generation failed: ' + (data.error || 'No config returned', 'error'));
      btn.disabled = false; btn.innerHTML = origHtml;
      return;
    }

    var cfg = data.config;

    // Fill in the form fields from AI-generated config
    var nameField = document.getElementById('smo-agent-name');
    if (nameField && cfg.agent_name) nameField.value = cfg.agent_name;

    var voiceField = document.getElementById('smo-voice');
    if (voiceField && cfg.agent_voice) voiceField.value = cfg.agent_voice;

    var greetField = document.getElementById('smo-greeting');
    if (greetField && cfg.greeting_script) greetField.value = cfg.greeting_script;

    var qaField = document.getElementById('smo-qa');
    if (qaField && cfg.common_qa) qaField.value = cfg.common_qa;

    var notesField = document.getElementById('smo-notes');
    if (notesField && cfg.general_notes) notesField.value = cfg.general_notes;

    // Fill directories if generated
    if (cfg.directories && Array.isArray(cfg.directories)) {
      cfg.directories.forEach(function(dir, idx) {
        if (idx < 4) {
          var nameEl = document.getElementById('smo-dir' + idx + '-name');
          var phoneEl = document.getElementById('smo-dir' + idx + '-phone');
          var notesEl = document.getElementById('smo-dir' + idx + '-notes');
          if (nameEl) nameEl.value = dir.name || '';
          if (phoneEl) phoneEl.value = dir.phone_or_action || '';
          if (notesEl) notesEl.value = dir.special_notes || '';
        }
      });
    }

    btn.innerHTML = '<i class="fas fa-check text-green-400 mr-1"></i>Config Generated!';
    setTimeout(function() { btn.disabled = false; btn.innerHTML = origHtml; }, 2000);

  } catch(e) {
    window.rmToast('AI generation error: ' + e.message, 'error');
    btn.disabled = false; btn.innerHTML = origHtml;
  }
}

window.geminiGenerateGreeting = async function() {
  var biz = document.getElementById('smo-business')?.value || 'Roofing Company';
  var agentName = document.getElementById('smo-agent-name')?.value || 'Sarah';

  var btn = event.target.closest('button');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';

  try {
    var res = await fetch('/api/gemini/generate-greeting', {
      method: 'POST',
      headers: { ...saHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ business_name: biz, agent_name: agentName })
    });
    var data = await res.json();
    if (data.greetings) {
      var greetField = document.getElementById('smo-greeting');
      if (greetField) {
        // Extract the first option
        var lines = data.greetings.split('\n').filter(function(l) { return l.trim(); });
        var first = '';
        for (var i = 0; i < lines.length; i++) {
          if (lines[i].match(/\[Option 1\]/i)) {
            first = lines[i].replace(/\[Option 1\]/i, '').trim();
            if (!first && lines[i+1]) first = lines[i+1].trim();
            break;
          }
        }
        greetField.value = first || lines[0] || data.greetings.substring(0, 300);
      }
    }
  } catch(e) { console.warn('Greeting generation failed:', e); }

  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-magic mr-1"></i>AI Generate';
}

window.geminiGenerateQA = async function() {
  var biz = document.getElementById('smo-business')?.value || 'Roofing Company';
  var services = document.getElementById('smo-notes')?.value || '';

  var btn = event.target.closest('button');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';

  try {
    var res = await fetch('/api/gemini/generate-qa', {
      method: 'POST',
      headers: { ...saHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ business_name: biz, services: services })
    });
    var data = await res.json();
    if (data.qa) {
      var qaField = document.getElementById('smo-qa');
      if (qaField) qaField.value = data.qa;
    }
  } catch(e) { console.warn('Q&A generation failed:', e); }

  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-magic mr-1"></i>AI Generate';
}

// ============================================================
// SECRETARY AI MONITOR — Real-Time Agent Monitoring Dashboard
// Minutes tracking, per-customer analytics, IT help tools
// ============================================================

function renderSecretaryMonitorView() {
  var d = SA.data.secretary_monitor || {};
  var agents = d.agents || [];
  var global = d.global || {};
  var summary = d.summary || {};
  var recent = d.recent_calls || [];

  var agentRows = agents.map(function(a) {
    var s = a.stats || {};
    var isActive = a.is_active === 1;
    var isConnected = a.connection_status === 'connected';
    var mins30d = Math.round((s.seconds_30d || 0) / 60);
    var minsTotal = Math.round((s.total_seconds || 0) / 60);
    var statusDot = isActive && isConnected ? '<span class="w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse inline-block"></span>' :
                    isActive ? '<span class="w-2.5 h-2.5 bg-yellow-500 rounded-full inline-block"></span>' :
                    '<span class="w-2.5 h-2.5 bg-gray-300 rounded-full inline-block"></span>';
    var lastCallAgo = s.last_call_at ? smTimeAgo(s.last_call_at) : 'Never';

    return '<tr class="border-b border-gray-100 hover:bg-blue-50/40 transition-colors">' +
      '<td class="px-4 py-3"><div class="flex items-center gap-2.5">' + statusDot + '<div><div class="font-bold text-gray-800 text-sm">' + (a.brand_business_name || a.customer_name || a.customer_email) + '</div><div class="text-[10px] text-gray-400">' + (a.customer_email || '') + ' · ID: ' + a.customer_id + '</div></div></div></td>' +
      '<td class="px-3 py-3 text-center"><span class="text-sm font-semibold">' + (a.agent_name || 'Sarah') + '</span><br><span class="text-[10px] text-gray-400">' + (a.agent_voice || 'alloy') + '</span></td>' +
      '<td class="px-3 py-3 text-center"><div class="text-lg font-black text-blue-700">' + mins30d + '</div><div class="text-[10px] text-gray-400">' + minsTotal + ' total</div></td>' +
      '<td class="px-3 py-3 text-center"><span class="font-bold text-gray-700">' + (s.calls_30d || 0) + '</span><br><span class="text-[10px] text-gray-400">' + (s.calls_today || 0) + ' today</span></td>' +
      '<td class="px-3 py-3 text-center"><span class="font-bold text-purple-700">' + (s.total_leads || 0) + '</span></td>' +
      '<td class="px-3 py-3 text-center"><span class="text-xs text-gray-500">' + fmtSeconds(s.avg_duration || 0) + '</span></td>' +
      '<td class="px-3 py-3"><span class="text-xs text-gray-400">' + lastCallAgo + '</span></td>' +
      '<td class="px-3 py-3"><div class="flex items-center gap-1">' +
        '<button onclick="smMonitorCustomer(' + a.customer_id + ')" class="p-1.5 rounded-lg hover:bg-blue-100 text-blue-500" title="View Details"><i class="fas fa-chart-line text-xs"></i></button>' +
        '<button onclick="smITHelp(' + a.customer_id + ')" class="p-1.5 rounded-lg hover:bg-amber-100 text-amber-500" title="IT Help"><i class="fas fa-wrench text-xs"></i></button>' +
        '<button onclick="smOpenDetail(' + a.customer_id + ')" class="p-1.5 rounded-lg hover:bg-green-100 text-green-500" title="Edit Config"><i class="fas fa-edit text-xs"></i></button>' +
      '</div></td></tr>';
  }).join('');

  var activityFeed = recent.slice(0, 10).map(function(call) {
    var outcomeColor = call.call_outcome === 'answered' ? 'text-green-600 bg-green-50' : 'text-gray-600 bg-gray-50';
    return '<div class="flex items-center gap-3 py-2.5 border-b border-gray-100 last:border-0">' +
      '<div class="w-8 h-8 rounded-full flex items-center justify-center ' + (call.is_lead ? 'bg-amber-100' : 'bg-sky-100') + '"><i class="fas ' + (call.is_lead ? 'fa-fire text-amber-600' : 'fa-phone text-sky-600') + ' text-xs"></i></div>' +
      '<div class="flex-1 min-w-0"><div class="flex items-center gap-2"><span class="font-semibold text-gray-800 text-sm truncate">' + (call.caller_name || call.caller_phone || 'Unknown') + '</span><span class="text-[10px] text-gray-400">→</span><span class="text-[10px] text-blue-600 font-medium">' + (call.customer_name || '') + '</span></div><p class="text-[11px] text-gray-500 truncate">' + (call.call_summary || 'No summary') + '</p></div>' +
      '<div class="text-right flex-shrink-0"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold ' + outcomeColor + '">' + (call.call_outcome || '') + '</span><div class="text-[10px] text-gray-400 mt-0.5">' + smTimeAgo(call.created_at) + '</div></div></div>';
  }).join('');

  return '<div class="space-y-6">' +
    '<div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">' +
      '<div><h2 class="text-2xl font-black text-gray-900"><i class="fas fa-satellite-dish mr-2 text-teal-500"></i>Secretary AI — Live Monitor</h2><p class="text-sm text-gray-500 mt-1">Real-time agent status, minutes tracking, call analytics, and IT support tools</p></div>' +
      '<div class="flex gap-2"><button onclick="loadView(\'secretary-monitor\')" class="px-4 py-2.5 bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 rounded-xl text-sm font-semibold"><i class="fas fa-sync mr-1"></i>Refresh</button><button onclick="saDashboardSetView(\'secretary-manager\')" class="px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-sm font-bold shadow"><i class="fas fa-cog mr-2"></i>Manage Agents</button></div>' +
    '</div>' +
    '<div class="grid grid-cols-2 md:grid-cols-6 gap-3">' +
      samc('Active Agents', (summary.active_agents || 0) + '/' + (summary.total_agents || 0), 'fa-robot', 'green', (summary.connected_agents || 0) + ' connected') +
      samc('Min Today', summary.total_minutes_today || 0, 'fa-clock', 'blue', (global.today_calls || 0) + ' calls') +
      samc('Min (7d)', summary.total_minutes_7d || 0, 'fa-calendar-week', 'indigo', (global.week_calls || 0) + ' calls') +
      samc('Min (30d)', summary.total_minutes_30d || 0, 'fa-calendar', 'purple', (global.month_calls || 0) + ' calls') +
      samc('All-Time Min', summary.total_minutes_alltime || 0, 'fa-history', 'teal', (global.total_calls || 0) + ' calls') +
      samc('Leads', global.total_leads || 0, 'fa-fire', 'amber', 'Avg ' + fmtSeconds(global.avg_duration || 0)) +
    '</div>' +
    '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">' +
      '<div class="p-4 border-b bg-gray-50 flex items-center justify-between"><h3 class="font-bold text-gray-800"><i class="fas fa-users mr-2 text-gray-400"></i>Per-Customer Agent Status & Minutes</h3></div>' +
      (agents.length === 0 ? '<div class="p-12 text-center"><i class="fas fa-satellite-dish text-4xl text-gray-200 mb-4"></i><p class="text-gray-400 mb-4">No secretary agents configured.</p></div>'
        : '<div class="overflow-x-auto"><table class="w-full"><thead><tr class="bg-gray-50/80 text-[11px] text-gray-500 uppercase tracking-wider"><th class="px-4 py-3 text-left">Customer</th><th class="px-3 py-3 text-center">Agent</th><th class="px-3 py-3 text-center">Min (30d)</th><th class="px-3 py-3 text-center">Calls (30d)</th><th class="px-3 py-3 text-center">Leads</th><th class="px-3 py-3 text-center">Avg Dur</th><th class="px-3 py-3 text-left">Last Call</th><th class="px-3 py-3 text-left">Actions</th></tr></thead><tbody>' + agentRows + '</tbody></table></div>') +
    '</div>' +
    '<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">' +
      '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5"><h3 class="font-bold text-gray-800 mb-4"><i class="fas fa-stream mr-2 text-blue-400"></i>Recent Call Activity</h3>' +
        (recent.length === 0 ? '<div class="text-center py-8 text-gray-400"><i class="fas fa-phone-slash text-3xl block mb-2"></i>No calls yet</div>' : '<div>' + activityFeed + '</div>') + '</div>' +
      '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5"><h3 class="font-bold text-gray-800 mb-4"><i class="fas fa-headset mr-2 text-amber-400"></i>IT Help & Troubleshooting</h3>' +
        '<div class="space-y-3">' +
          '<div class="p-4 bg-amber-50 border border-amber-200 rounded-xl"><p class="font-semibold text-amber-800 text-sm mb-2"><i class="fas fa-user-cog mr-1"></i>Select customer</p>' +
            '<select id="itHelpCustomerSelect" class="w-full border border-amber-200 rounded-lg px-3 py-2 text-sm bg-white"><option value="">Choose...</option>' +
              agents.map(function(a) { return '<option value="' + a.customer_id + '">' + (a.brand_business_name || a.customer_name || a.customer_email) + '</option>'; }).join('') + '</select></div>' +
          '<div class="grid grid-cols-2 gap-2">' +
            '<button onclick="smITAction(\'check_status\')" class="px-3 py-2.5 bg-blue-50 text-blue-700 rounded-xl text-xs font-bold hover:bg-blue-100"><i class="fas fa-stethoscope mr-1"></i>Diagnostic</button>' +
            '<button onclick="smITAction(\'force_reconnect\')" class="px-3 py-2.5 bg-green-50 text-green-700 rounded-xl text-xs font-bold hover:bg-green-100"><i class="fas fa-plug mr-1"></i>Force Reconnect</button>' +
            '<button onclick="smITAction(\'force_disconnect\')" class="px-3 py-2.5 bg-red-50 text-red-600 rounded-xl text-xs font-bold hover:bg-red-100"><i class="fas fa-unlink mr-1"></i>Disconnect</button>' +
            '<button onclick="smITAction(\'reset_config\')" class="px-3 py-2.5 bg-amber-50 text-amber-700 rounded-xl text-xs font-bold hover:bg-amber-100"><i class="fas fa-redo mr-1"></i>Reset LiveKit</button>' +
            '<button onclick="smITAction(\'recent_logs\')" class="px-3 py-2.5 bg-purple-50 text-purple-700 rounded-xl text-xs font-bold hover:bg-purple-100 col-span-2"><i class="fas fa-file-alt mr-1"></i>Recent Logs</button></div>' +
          '<div id="itHelpResult" class="hidden mt-3"></div></div></div>' +
    '</div></div>';
}

window.smITAction = async function(action) {
  var sel = document.getElementById('itHelpCustomerSelect');
  var cid = sel ? sel.value : '';
  if (!cid) { window.rmToast('Select a customer first', 'info'); return; }
  var el = document.getElementById('itHelpResult');
  if (el) { el.classList.remove('hidden'); el.innerHTML = '<div class="text-center py-3"><i class="fas fa-spinner fa-spin text-blue-500"></i></div>'; }
  try {
    var res = await saFetch('/api/admin/superadmin/secretary/it-help', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customer_id: parseInt(cid), action: action }) });
    var data = await res.json();
    if (data.success) {
      if (action === 'check_status' && data.diagnostic) {
        var d = data.diagnostic; var issues = [];
        if (!d.agent_active) issues.push('Agent INACTIVE');
        if (d.connection_status !== 'connected') issues.push('Status: ' + d.connection_status);
        if (!d.has_trunk) issues.push('No SIP trunk'); if (!d.has_dispatch) issues.push('No dispatch rule');
        if (!d.has_phone) issues.push('No AI phone #'); if (!d.has_greeting) issues.push('Greeting missing');
        if (d.subscription !== 'active') issues.push('Sub: ' + d.subscription);
        el.innerHTML = '<div class="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm"><h4 class="font-bold text-blue-800 mb-2"><i class="fas fa-clipboard-check mr-1"></i>Diagnostic</h4><div class="grid grid-cols-2 gap-1 text-xs">' +
          '<span class="text-gray-600">Active:</span><span class="font-bold ' + (d.agent_active ? 'text-green-600' : 'text-red-600') + '">' + (d.agent_active ? 'YES' : 'NO') + '</span>' +
          '<span class="text-gray-600">Connection:</span><span class="font-bold">' + d.connection_status + '</span>' +
          '<span class="text-gray-600">Trunk:</span><span class="font-bold ' + (d.has_trunk ? 'text-green-600' : 'text-red-600') + '">' + (d.has_trunk ? 'OK' : 'MISSING') + '</span>' +
          '<span class="text-gray-600">Dispatch:</span><span class="font-bold ' + (d.has_dispatch ? 'text-green-600' : 'text-red-600') + '">' + (d.has_dispatch ? 'OK' : 'MISSING') + '</span>' +
          '<span class="text-gray-600">AI Phone:</span><span class="font-mono">' + (d.ai_phone || 'NONE') + '</span>' +
          '<span class="text-gray-600">Biz Phone:</span><span class="font-mono">' + (d.business_phone || 'NONE') + '</span>' +
          '<span class="text-gray-600">Carrier:</span><span>' + d.carrier + '</span>' +
          '<span class="text-gray-600">Sub:</span><span class="font-bold">' + d.subscription + '</span>' +
          '<span class="text-gray-600">Last Call:</span><span>' + (d.last_call ? smTimeAgo(d.last_call) : 'Never') + '</span>' +
          '<span class="text-gray-600">24h Calls:</span><span class="font-bold">' + d.calls_24h + '</span></div>' +
          (issues.length > 0 ? '<div class="mt-3 p-2 bg-red-50 border border-red-200 rounded-lg"><p class="text-xs font-bold text-red-700 mb-1"><i class="fas fa-exclamation-triangle mr-1"></i>Issues:</p>' + issues.map(function(i) { return '<p class="text-xs text-red-600">• ' + i + '</p>'; }).join('') + '</div>' : '<div class="mt-3 p-2 bg-green-50 border border-green-200 rounded-lg"><p class="text-xs font-bold text-green-700"><i class="fas fa-check-circle mr-1"></i>All checks passed</p></div>') + '</div>';
      } else if (action === 'recent_logs' && data.logs) {
        el.innerHTML = '<div class="bg-purple-50 border border-purple-200 rounded-xl p-4"><h4 class="font-bold text-purple-800 text-sm mb-2">Recent Logs (' + data.logs.length + ')</h4>' +
          (data.logs.length === 0 ? '<p class="text-xs text-gray-500">No calls</p>' :
            '<div class="space-y-1 max-h-48 overflow-y-auto">' + data.logs.map(function(l) { return '<div class="flex items-center justify-between text-xs py-1 border-b border-purple-100"><span class="font-semibold">' + (l.caller_name || l.caller_phone || '?') + '</span><span>' + fmtSeconds(l.call_duration_seconds) + '</span><span class="text-' + (l.call_outcome === 'answered' ? 'green' : 'gray') + '-600">' + l.call_outcome + '</span><span class="text-gray-400">' + smTimeAgo(l.created_at) + '</span></div>'; }).join('') + '</div>') + '</div>';
      } else {
        el.innerHTML = '<div class="bg-green-50 border border-green-200 rounded-xl p-3 text-sm text-green-700"><i class="fas fa-check-circle mr-1"></i>' + (data.message || 'Done') + '</div>';
        setTimeout(function() { loadView('secretary-monitor'); }, 1500);
      }
    } else { el.innerHTML = '<div class="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700"><i class="fas fa-times-circle mr-1"></i>' + (data.error || 'Failed') + '</div>'; }
  } catch(e) { if (el) el.innerHTML = '<div class="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">Error: ' + e.message + '</div>'; }
};

window.smMonitorCustomer = async function(cid) {
  try {
    var res = await saFetch('/api/admin/superadmin/secretary/customer/' + cid + '/minutes');
    if (!res) return; var data = await res.json();
    var ov = data.overall || {}; var daily = data.daily || [];
    var totalMins = Math.round((ov.total_seconds || 0) / 60);
    var modal = document.createElement('div'); modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm'; modal.id = 'monitorModal';
    modal.innerHTML = '<div class="bg-white rounded-2xl shadow-2xl max-w-2xl w-full mx-4 max-h-[85vh] overflow-hidden flex flex-col">' +
      '<div class="bg-gradient-to-r from-blue-600 to-indigo-700 px-6 py-4 flex items-center justify-between"><div><h3 class="text-white font-bold text-lg"><i class="fas fa-chart-line mr-2"></i>Minutes & Analytics</h3><p class="text-blue-200 text-xs">Customer #' + cid + '</p></div><button onclick="document.getElementById(\'monitorModal\').remove()" class="text-white/70 hover:text-white"><i class="fas fa-times text-lg"></i></button></div>' +
      '<div class="p-6 overflow-y-auto flex-1">' +
        '<div class="grid grid-cols-4 gap-3 mb-5">' + samc('Total Min', totalMins, 'fa-clock', 'blue', ov.total_calls + ' calls') + samc('Calls', ov.total_calls || 0, 'fa-phone', 'green', '') + samc('Leads', ov.total_leads || 0, 'fa-fire', 'amber', '') + samc('Avg', fmtSeconds(ov.avg_seconds || 0), 'fa-stopwatch', 'purple', '') + '</div>' +
        '<h4 class="font-bold text-gray-800 mb-3"><i class="fas fa-calendar mr-1 text-blue-400"></i>Daily (30d)</h4>' +
        (daily.length === 0 ? '<p class="text-gray-400 text-sm text-center py-4">No calls in 30 days</p>' :
          '<div class="overflow-x-auto max-h-64"><table class="w-full text-sm"><thead class="bg-gray-50 sticky top-0"><tr><th class="px-3 py-2 text-left text-xs text-gray-500">Date</th><th class="px-3 py-2 text-center text-xs text-gray-500">Calls</th><th class="px-3 py-2 text-center text-xs text-gray-500">Min</th><th class="px-3 py-2 text-center text-xs text-gray-500">Avg</th><th class="px-3 py-2 text-center text-xs text-gray-500">Leads</th></tr></thead><tbody>' +
          daily.map(function(dd) { return '<tr class="border-b border-gray-100"><td class="px-3 py-2">' + dd.call_date + '</td><td class="px-3 py-2 text-center font-bold">' + dd.call_count + '</td><td class="px-3 py-2 text-center font-bold text-blue-700">' + Math.round((dd.total_seconds || 0) / 60) + '</td><td class="px-3 py-2 text-center text-gray-500">' + fmtSeconds(dd.avg_seconds || 0) + '</td><td class="px-3 py-2 text-center text-amber-600 font-bold">' + (dd.leads || 0) + '</td></tr>'; }).join('') + '</tbody></table></div>') +
      '</div><div class="px-6 py-3 border-t bg-gray-50 flex justify-end"><button onclick="document.getElementById(\'monitorModal\').remove()" class="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg text-sm font-medium">Close</button></div></div>';
    document.body.appendChild(modal); modal.addEventListener('click', function(e) { if (e.target === modal) modal.remove(); });
  } catch(e) { window.rmToast('Error: ' + e.message, 'error'); }
};

window.smITHelp = function(cid) { var sel = document.getElementById('itHelpCustomerSelect'); if (sel) sel.value = String(cid); smITAction('check_status'); };

function smTimeAgo(dateStr) {
  if (!dateStr) return 'Never';
  var diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return 'just now'; if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago'; if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
  return fmtDate(dateStr);
}

// ── API Users View ────────────────────────────────────────────────────────────

function renderApiUsersView() {
  var d = (SA.data.apiUsers && SA.data.apiUsers.accounts) ? SA.data.apiUsers : { accounts: [] };
  var accounts = d.accounts || [];
  var totalAccounts = accounts.length;
  var activeJobs = accounts.reduce(function(s, a) { return s + (a.active_jobs || 0); }, 0);
  var jobsThisMonth = accounts.reduce(function(s, a) { return s + (a.jobs_this_month || 0); }, 0);
  var lowCredit = accounts.filter(function(a) { return (a.credit_balance || 0) < 5; }).length;

  var kpis = '<div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">' +
    samc('API Accounts', totalAccounts, 'fa-key', 'teal', 'registered') +
    samc('Active Jobs', activeJobs, 'fa-spinner', 'amber', 'in queue / tracing') +
    samc('Reports This Month', jobsThisMonth, 'fa-file-alt', 'blue', 'all accounts') +
    samc('Low Credit', lowCredit, 'fa-exclamation-triangle', 'red', '< 5 credits') +
  '</div>';

  if (accounts.length === 0) {
    return kpis + '<div class="bg-white rounded-2xl p-12 text-center text-gray-400"><i class="fas fa-key text-4xl mb-3 block opacity-30"></i><p class="font-medium">No API accounts yet</p><p class="text-sm mt-1">Accounts appear here once someone signs up via the Developer Portal</p></div>';
  }

  var rows = accounts.map(function(a) {
    var statusColor = a.status === 'active' ? 'green' : a.status === 'suspended' ? 'yellow' : 'red';
    var statusLabel = a.status || 'active';
    var balanceCls = (a.credit_balance || 0) < 5 ? 'font-bold text-red-600' : 'font-bold text-slate-800';
    var toggleLabel = a.status === 'active' ? 'Suspend' : 'Activate';
    var toggleAction = a.status === 'active' ? 'suspended' : 'active';
    var toggleCls = a.status === 'active' ? 'bg-yellow-50 text-yellow-700 border-yellow-200 hover:bg-yellow-100' : 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100';
    return '<tr class="border-b border-gray-100 hover:bg-slate-50 transition-colors">' +
      '<td class="px-4 py-3">' +
        '<div class="font-semibold text-slate-800 text-sm">' + esc(a.company_name || '') + '</div>' +
        '<div class="text-xs text-slate-400 mt-0.5">' + esc(a.contact_email || '') + '</div>' +
      '</td>' +
      '<td class="px-4 py-3 text-center">' +
        '<span class="px-2 py-0.5 bg-' + statusColor + '-100 text-' + statusColor + '-700 rounded-full text-xs font-medium capitalize">' + statusLabel + '</span>' +
      '</td>' +
      '<td class="px-4 py-3 text-center"><span class="' + balanceCls + '">' + (a.credit_balance || 0) + '</span></td>' +
      '<td class="px-4 py-3 text-center text-slate-600 text-sm">' + (a.total_jobs || 0) + '</td>' +
      '<td class="px-4 py-3 text-center text-slate-600 text-sm">' + (a.jobs_this_month || 0) + '</td>' +
      '<td class="px-4 py-3 text-center text-slate-500 text-xs">' + (a.last_purchase_at ? fmtDate(a.last_purchase_at) : '<span class="text-gray-300">—</span>') + '</td>' +
      '<td class="px-4 py-3 text-center text-slate-500 text-xs">' + smTimeAgo(a.last_job_at) + '</td>' +
      '<td class="px-4 py-3 text-center">' +
        '<span class="text-xs ' + (a.active_key_count > 0 ? 'text-teal-600 font-semibold' : 'text-gray-400') + '">' + (a.active_key_count || 0) + ' key' + ((a.active_key_count || 0) !== 1 ? 's' : '') + '</span>' +
      '</td>' +
      '<td class="px-4 py-3">' +
        '<div class="flex items-center gap-1.5 justify-end flex-wrap">' +
          '<button onclick="apiUserTopUp(\'' + a.id + '\', \'' + esc(a.company_name || '') + '\')" class="px-2.5 py-1 text-xs font-medium bg-teal-50 text-teal-700 border border-teal-200 rounded-lg hover:bg-teal-100 transition-colors"><i class="fas fa-plus mr-1"></i>Credits</button>' +
          '<button onclick="apiUserToggleStatus(\'' + a.id + '\', \'' + toggleAction + '\', this)" class="px-2.5 py-1 text-xs font-medium border rounded-lg transition-colors ' + toggleCls + '">' + toggleLabel + '</button>' +
          '<button onclick="apiUserLedger(\'' + a.id + '\', \'' + esc(a.company_name || '') + '\')" class="px-2.5 py-1 text-xs font-medium bg-slate-50 text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors"><i class="fas fa-list mr-1"></i>Ledger</button>' +
        '</div>' +
      '</td>' +
    '</tr>';
  }).join('');

  var table = '<div class="overflow-x-auto">' +
    '<table class="w-full text-sm">' +
      '<thead class="bg-slate-50 border-b border-slate-200">' +
        '<tr>' +
          '<th class="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Account</th>' +
          '<th class="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>' +
          '<th class="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide">Credits</th>' +
          '<th class="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide">Total Reports</th>' +
          '<th class="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide">This Month</th>' +
          '<th class="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide">Last Purchase</th>' +
          '<th class="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide">Last Job</th>' +
          '<th class="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide">Keys</th>' +
          '<th class="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Actions</th>' +
        '</tr>' +
      '</thead>' +
      '<tbody>' + rows + '</tbody>' +
    '</table>' +
  '</div>';

  var refreshBtn = '<button onclick="saSetView(\'api-users\', null)" class="px-3 py-1.5 text-xs font-medium bg-white border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors"><i class="fas fa-sync-alt mr-1"></i>Refresh</button>';

  return '<div class="p-6 space-y-6">' +
    kpis +
    saSection('API Users', 'fa-key', table, refreshBtn) +
  '</div>';
}

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

window.apiUserTopUp = async function(accountId, companyName) {
  var amtStr = prompt('Add credits to ' + companyName + ':\nHow many credits to add?', '10');
  if (!amtStr) return;
  var amt = parseInt(amtStr, 10);
  if (isNaN(amt) || amt < 1) { window.rmToast('Enter a valid number of credits', 'error'); return; }
  var res = await saFetch('/api/admin/api-accounts/' + accountId, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ add_credits: String(amt) }) });
  if (!res) return;
  if (res.ok) {
    window.rmToast('Added ' + amt + ' credits to ' + companyName, 'success');
    saSetView('api-users', null);
  } else {
    var err = await res.json().catch(function() { return {}; });
    window.rmToast('Error: ' + (err.error || res.status), 'error');
  }
};

window.apiUserToggleStatus = async function(accountId, newStatus, btn) {
  var label = newStatus === 'active' ? 'activate' : 'suspend';
  if (!confirm('Are you sure you want to ' + label + ' this account?')) return;
  var res = await saFetch('/api/admin/api-accounts/' + accountId, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: newStatus }) });
  if (!res) return;
  if (res.ok) {
    window.rmToast('Account ' + label + 'd', 'success');
    saSetView('api-users', null);
  } else {
    var err = await res.json().catch(function() { return {}; });
    window.rmToast('Error: ' + (err.error || res.status), 'error');
  }
};

window.apiUserLedger = async function(accountId, companyName) {
  var res = await saFetch('/api/admin/superadmin/api-accounts/' + accountId + '/ledger');
  if (!res) return;
  var data = await res.json().catch(function() { return { entries: [] }; });
  var entries = data.entries || [];
  var rows = entries.length === 0
    ? '<tr><td colspan="5" class="px-4 py-8 text-center text-gray-400 text-sm">No ledger entries</td></tr>'
    : entries.map(function(e) {
        var deltaColor = e.delta > 0 ? 'text-green-600' : 'text-red-600';
        var deltaSign = e.delta > 0 ? '+' : '';
        return '<tr class="border-b border-gray-100">' +
          '<td class="px-4 py-2 text-xs text-slate-500">' + fmtDateTime(e.created_at) + '</td>' +
          '<td class="px-4 py-2 text-xs capitalize">' + (e.reason || '') + '</td>' +
          '<td class="px-4 py-2 text-xs font-bold ' + deltaColor + '">' + deltaSign + e.delta + '</td>' +
          '<td class="px-4 py-2 text-xs text-slate-600 font-medium">' + (e.balance_after || 0) + '</td>' +
          '<td class="px-4 py-2 text-xs text-slate-400">' + esc(e.ref_id || '') + '</td>' +
        '</tr>';
      }).join('');

  var modal = document.createElement('div');
  modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm';
  modal.id = 'apiLedgerModal';
  modal.innerHTML = '<div class="bg-white rounded-2xl shadow-2xl max-w-2xl w-full mx-4 max-h-[85vh] overflow-hidden flex flex-col">' +
    '<div class="bg-gradient-to-r from-teal-600 to-cyan-700 px-6 py-4 flex items-center justify-between">' +
      '<div><h3 class="text-white font-bold text-lg"><i class="fas fa-list mr-2"></i>Credit Ledger</h3><p class="text-teal-200 text-xs">' + esc(companyName) + '</p></div>' +
      '<button onclick="document.getElementById(\'apiLedgerModal\').remove()" class="text-white/70 hover:text-white"><i class="fas fa-times text-lg"></i></button>' +
    '</div>' +
    '<div class="overflow-y-auto flex-1">' +
      '<table class="w-full text-sm">' +
        '<thead class="bg-gray-50 sticky top-0"><tr>' +
          '<th class="px-4 py-2 text-left text-xs text-gray-500">Date</th>' +
          '<th class="px-4 py-2 text-left text-xs text-gray-500">Reason</th>' +
          '<th class="px-4 py-2 text-left text-xs text-gray-500">Delta</th>' +
          '<th class="px-4 py-2 text-left text-xs text-gray-500">Balance After</th>' +
          '<th class="px-4 py-2 text-left text-xs text-gray-500">Ref</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' +
    '</div>' +
    '<div class="px-6 py-3 border-t bg-gray-50 flex justify-end"><button onclick="document.getElementById(\'apiLedgerModal\').remove()" class="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg text-sm font-medium">Close</button></div>' +
  '</div>';
  document.body.appendChild(modal);
  modal.addEventListener('click', function(e) { if (e.target === modal) modal.remove(); });
};

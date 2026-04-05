// ============================================================
// Roof Manager — Customer Cold Call Center Dashboard
// Prospect list management, AI outbound calling, call logs,
// leads tracking, appointments, and real-time notifications
// ============================================================

(function() {
  'use strict';

  var CC = {
    tab: 'overview',
    loading: false,
    dashboard: null,
    lists: [],
    prospects: [],
    callLogs: [],
    leads: [],
    config: null,
    selectedList: null,
    prospectPage: 1,
    callLogPage: 1,
    callLogFilter: '',
    prospectFilter: '',
    searchTerm: '',
    notifications: []
  };

  function getToken() { return localStorage.getItem('rc_customer_token') || ''; }
  function authHeaders() { return { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' }; }

  async function ccFetch(url, opts) {
    try {
      var res = await fetch(url, Object.assign({ headers: authHeaders() }, opts || {}));
      if (res.status === 401) { window.location.href = '/customer/login'; return null; }
      return await res.json();
    } catch (e) { console.error('CC fetch error:', e); return null; }
  }

  // ============================================================
  // INIT
  // ============================================================
  document.addEventListener('DOMContentLoaded', async function() {
    await loadDashboard();
    render();
  });

  async function loadDashboard() {
    CC.loading = true;
    var [dashRes, listsRes, configRes] = await Promise.all([
      ccFetch('/api/customer-calls/dashboard'),
      ccFetch('/api/customer-calls/lists'),
      ccFetch('/api/customer-calls/config')
    ]);
    if (dashRes) CC.dashboard = dashRes;
    if (listsRes) CC.lists = listsRes.lists || [];
    if (configRes) CC.config = configRes.config;
    CC.loading = false;
  }

  // ============================================================
  // RENDER — Main layout
  // ============================================================
  function render() {
    var root = document.getElementById('cold-call-root');
    if (!root) return;

    root.innerHTML =
      renderHeader() +
      renderTabs() +
      '<div id="cc-tab-content">' + renderTabContent() + '</div>' +
      renderNotificationPanel();
  }

  function renderHeader() {
    var d = CC.dashboard || {};
    var t = d.today || {};
    var totals = d.totals || {};
    var p = d.prospects || {};

    return '<div class="mb-6">' +
      // Stats Row
      '<div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">' +
        statCard('fa-phone-alt', 'Today\'s Calls', t.calls || 0, 'bg-gradient-to-br from-blue-500 to-blue-600') +
        statCard('fa-check-circle', 'Connected', t.connected || 0, 'bg-gradient-to-br from-green-500 to-green-600') +
        statCard('fa-fire', 'Hot Leads', totals.leads || 0, 'bg-gradient-to-br from-orange-500 to-red-500') +
        statCard('fa-calendar-check', 'Appointments', totals.appointments || 0, 'bg-gradient-to-br from-purple-500 to-purple-600') +
        statCard('fa-users', 'In Queue', p.pending || 0, 'bg-gradient-to-br from-cyan-500 to-teal-600') +
      '</div>' +

      // Notification alerts
      renderAlerts() +
    '</div>';
  }

  function statCard(icon, label, value, gradient) {
    return '<div class="' + gradient + ' rounded-xl p-4 text-white shadow-lg">' +
      '<div class="flex items-center justify-between">' +
        '<div>' +
          '<p class="text-white/70 text-xs font-medium">' + label + '</p>' +
          '<p class="text-2xl font-black mt-1">' + value + '</p>' +
        '</div>' +
        '<div class="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">' +
          '<i class="fas ' + icon + ' text-lg"></i>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function renderAlerts() {
    var d = CC.dashboard || {};
    var totals = d.totals || {};
    var html = '';

    if ((totals.leads || 0) > 0) {
      html += '<div class="bg-orange-50 border-l-4 border-orange-400 p-3 rounded-r-lg mb-3 flex items-center gap-3">' +
        '<div class="w-8 h-8 bg-orange-100 rounded-full flex items-center justify-center"><i class="fas fa-fire text-orange-500"></i></div>' +
        '<div class="flex-1"><p class="text-orange-800 font-semibold text-sm">' + totals.leads + ' Hot Lead' + (totals.leads > 1 ? 's' : '') + ' Detected!</p><p class="text-orange-600 text-xs">AI identified interested prospects — review leads tab now</p></div>' +
        '<button onclick="window.ccSetTab(\'leads\')" class="px-3 py-1.5 bg-orange-500 text-white rounded-lg text-xs font-bold hover:bg-orange-600">View Leads</button>' +
      '</div>';
    }

    if ((totals.callbacks || 0) > 0) {
      html += '<div class="bg-blue-50 border-l-4 border-blue-400 p-3 rounded-r-lg mb-3 flex items-center gap-3">' +
        '<div class="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center"><i class="fas fa-phone-alt text-blue-500"></i></div>' +
        '<div class="flex-1"><p class="text-blue-800 font-semibold text-sm">' + totals.callbacks + ' Callback' + (totals.callbacks > 1 ? 's' : '') + ' Pending</p><p class="text-blue-600 text-xs">Prospects requested a callback — schedule follow-ups</p></div>' +
        '<button onclick="window.ccSetTab(\'call-logs\');window.ccFilterLogs(\'callback\')" class="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-bold hover:bg-blue-600">View Callbacks</button>' +
      '</div>';
    }

    if ((totals.appointments || 0) > 0) {
      html += '<div class="bg-purple-50 border-l-4 border-purple-400 p-3 rounded-r-lg mb-3 flex items-center gap-3">' +
        '<div class="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center"><i class="fas fa-calendar-check text-purple-500"></i></div>' +
        '<div class="flex-1"><p class="text-purple-800 font-semibold text-sm">' + totals.appointments + ' Appointment' + (totals.appointments > 1 ? 's' : '') + ' Booked!</p><p class="text-purple-600 text-xs">AI successfully scheduled meetings with prospects</p></div>' +
        '<button onclick="window.ccSetTab(\'call-logs\');window.ccFilterLogs(\'appointment\')" class="px-3 py-1.5 bg-purple-500 text-white rounded-lg text-xs font-bold hover:bg-purple-600">View Appointments</button>' +
      '</div>';
    }

    return html;
  }

  // ============================================================
  // TABS
  // ============================================================
  function renderTabs() {
    var tabs = [
      { id: 'overview', icon: 'fa-chart-pie', label: 'Overview' },
      { id: 'lists', icon: 'fa-list-alt', label: 'Prospect Lists' },
      { id: 'prospects', icon: 'fa-user-friends', label: 'All Prospects' },
      { id: 'call-logs', icon: 'fa-history', label: 'Call Logs' },
      { id: 'leads', icon: 'fa-fire-alt', label: 'Leads' },
      { id: 'config', icon: 'fa-cog', label: 'Agent Settings' }
    ];

    return '<div class="flex gap-1 mb-6 bg-gray-100 rounded-xl p-1 overflow-x-auto">' +
      tabs.map(function(t) {
        var active = CC.tab === t.id;
        return '<button onclick="window.ccSetTab(\'' + t.id + '\')" class="flex-shrink-0 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ' +
          (active ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700') + '">' +
          '<i class="fas ' + t.icon + ' mr-1.5"></i>' + t.label +
        '</button>';
      }).join('') +
    '</div>';
  }

  window.ccSetTab = function(tab) {
    CC.tab = tab;
    render();
    // Load tab-specific data
    if (tab === 'call-logs') loadCallLogs();
    if (tab === 'leads') loadLeads();
    if (tab === 'prospects') loadProspects();
  };

  function renderTabContent() {
    switch (CC.tab) {
      case 'overview': return renderOverview();
      case 'lists': return renderLists();
      case 'prospects': return renderProspects();
      case 'call-logs': return renderCallLogs();
      case 'leads': return renderLeads();
      case 'config': return renderConfig();
      default: return '';
    }
  }

  // ============================================================
  // OVERVIEW TAB
  // ============================================================
  function renderOverview() {
    var d = CC.dashboard || {};
    var recent = d.recent_calls || [];
    var p = d.prospects || {};
    var totals = d.totals || {};

    return '<div class="grid grid-cols-1 lg:grid-cols-3 gap-6">' +
      // Left: Recent Calls
      '<div class="lg:col-span-2">' +
        '<div class="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">' +
          '<div class="px-5 py-4 border-b border-gray-100 flex items-center justify-between">' +
            '<h3 class="font-bold text-gray-800"><i class="fas fa-history text-orange-500 mr-2"></i>Recent Calls</h3>' +
            '<button onclick="window.ccSetTab(\'call-logs\')" class="text-xs text-orange-600 hover:text-orange-700 font-medium">View All <i class="fas fa-arrow-right ml-1"></i></button>' +
          '</div>' +
          '<div class="divide-y divide-gray-100 max-h-[500px] overflow-y-auto">' +
            (recent.length === 0 ?
              '<div class="p-8 text-center"><div class="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3"><i class="fas fa-phone-slash text-gray-400 text-2xl"></i></div><p class="text-gray-500 text-sm">No calls yet</p><p class="text-gray-400 text-xs mt-1">Upload a prospect list and start calling!</p></div>'
            : recent.map(function(call) { return renderCallRow(call); }).join('')) +
          '</div>' +
        '</div>' +
      '</div>' +

      // Right: Sidebar
      '<div class="space-y-4">' +
        // Prospect Funnel
        '<div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">' +
          '<h3 class="font-bold text-gray-800 text-sm mb-4"><i class="fas fa-funnel-dollar text-cyan-500 mr-2"></i>Prospect Funnel</h3>' +
          funnelRow('In Queue', p.pending || 0, 'bg-gray-200', 'text-gray-700') +
          funnelRow('Called', p.called || 0, 'bg-blue-200', 'text-blue-700') +
          funnelRow('Leads', totals.leads || 0, 'bg-orange-200', 'text-orange-700') +
          funnelRow('Appointments', totals.appointments || 0, 'bg-purple-200', 'text-purple-700') +
          funnelRow('Do Not Call', p.dnc || 0, 'bg-red-200', 'text-red-700') +
        '</div>' +

        // Quick Actions
        '<div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">' +
          '<h3 class="font-bold text-gray-800 text-sm mb-4"><i class="fas fa-bolt text-amber-500 mr-2"></i>Quick Actions</h3>' +
          '<div class="space-y-2">' +
            '<button onclick="window.ccSetTab(\'lists\')" class="w-full text-left px-3 py-2.5 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors flex items-center gap-3">' +
              '<div class="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center"><i class="fas fa-upload text-white text-xs"></i></div>' +
              '<div><p class="font-semibold text-gray-800 text-xs">Upload Prospect List</p><p class="text-[10px] text-gray-500">CSV from LinkedIn scrape</p></div>' +
            '</button>' +
            '<button onclick="window.ccSetTab(\'config\')" class="w-full text-left px-3 py-2.5 bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors flex items-center gap-3">' +
              '<div class="w-8 h-8 bg-purple-500 rounded-lg flex items-center justify-center"><i class="fas fa-robot text-white text-xs"></i></div>' +
              '<div><p class="font-semibold text-gray-800 text-xs">Configure AI Agent</p><p class="text-[10px] text-gray-500">Voice, script & persona</p></div>' +
            '</button>' +
          '</div>' +
        '</div>' +

        // Lists Summary
        '<div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">' +
          '<h3 class="font-bold text-gray-800 text-sm mb-3"><i class="fas fa-list-alt text-green-500 mr-2"></i>Your Lists (' + CC.lists.length + ')</h3>' +
          (CC.lists.length === 0 ?
            '<p class="text-xs text-gray-400">No lists yet — create one to start!</p>'
          : CC.lists.slice(0, 5).map(function(l) {
              return '<div class="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">' +
                '<div><p class="text-xs font-medium text-gray-700">' + esc(l.name) + '</p><p class="text-[10px] text-gray-400">' + (l.prospect_count || l.total_contacts || 0) + ' contacts</p></div>' +
                '<span class="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-[10px] font-bold">' + (l.leads_count || 0) + ' leads</span>' +
              '</div>';
            }).join('')) +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function funnelRow(label, count, bg, text) {
    var total = (CC.dashboard && CC.dashboard.prospects ? CC.dashboard.prospects.total : 0) || 1;
    var pct = Math.round((count / total) * 100) || 0;
    return '<div class="mb-3">' +
      '<div class="flex justify-between text-xs mb-1"><span class="text-gray-600">' + label + '</span><span class="font-bold ' + text + '">' + count + '</span></div>' +
      '<div class="w-full bg-gray-100 rounded-full h-2"><div class="' + bg + ' rounded-full h-2 transition-all" style="width:' + Math.max(pct, 2) + '%"></div></div>' +
    '</div>';
  }

  // ============================================================
  // PROSPECT LISTS TAB
  // ============================================================
  function renderLists() {
    return '<div class="space-y-4">' +
      // Create new list
      '<div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">' +
        '<div class="flex items-center justify-between mb-4">' +
          '<h3 class="font-bold text-gray-800"><i class="fas fa-list-alt text-green-500 mr-2"></i>Prospect Lists</h3>' +
          '<button onclick="window.ccShowCreateList()" class="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg text-sm font-bold transition-colors"><i class="fas fa-plus mr-1"></i>New List</button>' +
        '</div>' +

        // Create list form (hidden by default)
        '<div id="cc-create-list-form" class="hidden mb-4 p-4 bg-green-50 rounded-xl border border-green-200">' +
          '<div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">' +
            '<div><label class="text-xs font-medium text-gray-600 block mb-1">List Name *</label><input id="cc-list-name" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-400 focus:border-green-400" placeholder="e.g. LinkedIn Contractors Q1"></div>' +
            '<div><label class="text-xs font-medium text-gray-600 block mb-1">Source</label><input id="cc-list-source" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. LinkedIn, Google Maps, etc."></div>' +
          '</div>' +
          '<div class="mb-3"><label class="text-xs font-medium text-gray-600 block mb-1">Description</label><input id="cc-list-desc" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Optional description"></div>' +
          '<div class="flex gap-2">' +
            '<button onclick="window.ccCreateList()" class="px-4 py-2 bg-green-500 text-white rounded-lg text-sm font-bold hover:bg-green-600"><i class="fas fa-check mr-1"></i>Create</button>' +
            '<button onclick="document.getElementById(\'cc-create-list-form\').classList.add(\'hidden\')" class="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-300">Cancel</button>' +
          '</div>' +
        '</div>' +

        // Lists grid
        '<div class="space-y-3">' +
          (CC.lists.length === 0 ?
            '<div class="text-center py-8"><div class="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3"><i class="fas fa-clipboard-list text-gray-400 text-2xl"></i></div><p class="text-gray-500 text-sm mb-1">No prospect lists yet</p><p class="text-gray-400 text-xs">Create a list and upload your LinkedIn contacts or CSV files to start cold calling.</p></div>'
          : CC.lists.map(function(l) { return renderListCard(l); }).join('')) +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function renderListCard(l) {
    var count = l.prospect_count || l.total_contacts || 0;
    var called = l.called_count || 0;
    var leads = l.leads_count || 0;
    var pct = count > 0 ? Math.round((called / count) * 100) : 0;

    return '<div class="bg-gray-50 rounded-xl border border-gray-200 p-4 hover:border-orange-300 transition-colors">' +
      '<div class="flex items-start justify-between">' +
        '<div class="flex-1">' +
          '<div class="flex items-center gap-2 mb-1">' +
            '<h4 class="font-bold text-gray-800">' + esc(l.name) + '</h4>' +
            (l.source ? '<span class="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-[10px] font-bold">' + esc(l.source) + '</span>' : '') +
          '</div>' +
          (l.description ? '<p class="text-xs text-gray-500 mb-2">' + esc(l.description) + '</p>' : '') +
          '<div class="flex items-center gap-4 text-xs text-gray-500">' +
            '<span><i class="fas fa-users mr-1"></i>' + count + ' contacts</span>' +
            '<span><i class="fas fa-phone mr-1"></i>' + called + ' called</span>' +
            '<span class="text-orange-600 font-bold"><i class="fas fa-fire mr-1"></i>' + leads + ' leads</span>' +
          '</div>' +
          // Progress bar
          '<div class="mt-2 w-full bg-gray-200 rounded-full h-1.5">' +
            '<div class="bg-gradient-to-r from-blue-500 to-green-500 rounded-full h-1.5 transition-all" style="width:' + pct + '%"></div>' +
          '</div>' +
          '<p class="text-[10px] text-gray-400 mt-1">' + pct + '% called</p>' +
        '</div>' +
        '<div class="flex gap-2 ml-4">' +
          '<button onclick="window.ccShowImportCSV(' + l.id + ')" class="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-bold hover:bg-blue-600" title="Import CSV"><i class="fas fa-file-csv mr-1"></i>Import</button>' +
          '<button onclick="window.ccViewListProspects(' + l.id + ')" class="px-3 py-1.5 bg-gray-200 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-300" title="View Prospects"><i class="fas fa-eye mr-1"></i>View</button>' +
          '<button onclick="window.ccDeleteList(' + l.id + ')" class="px-2 py-1.5 bg-red-100 text-red-600 rounded-lg text-xs hover:bg-red-200" title="Delete"><i class="fas fa-trash"></i></button>' +
        '</div>' +
      '</div>' +
      // CSV Import area (hidden)
      '<div id="cc-import-' + l.id + '" class="hidden mt-4 p-4 bg-blue-50 rounded-xl border border-blue-200">' +
        '<label class="text-xs font-medium text-gray-700 block mb-2"><i class="fas fa-file-csv text-blue-500 mr-1"></i>Paste CSV Data (header row + data rows)</label>' +
        '<textarea id="cc-csv-' + l.id + '" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs font-mono h-32 focus:ring-2 focus:ring-blue-400" placeholder="contact_name,company_name,phone,email,city,job_title,linkedin_url\nJohn Smith,ABC Roofing,4035551234,john@abc.com,Calgary,Owner,https://linkedin.com/in/john"></textarea>' +
        '<div class="flex gap-2 mt-2">' +
          '<button onclick="window.ccImportCSV(' + l.id + ')" class="px-4 py-2 bg-blue-500 text-white rounded-lg text-xs font-bold hover:bg-blue-600"><i class="fas fa-upload mr-1"></i>Import</button>' +
          '<button onclick="document.getElementById(\'cc-import-' + l.id + '\').classList.add(\'hidden\')" class="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-300">Cancel</button>' +
        '</div>' +
        '<p class="text-[10px] text-gray-400 mt-2"><i class="fas fa-info-circle mr-1"></i>Supported columns: contact_name, company_name, phone, email, website, city, province_state, job_title, linkedin_url, notes, tags</p>' +
      '</div>' +
    '</div>';
  }

  // ============================================================
  // PROSPECTS TAB
  // ============================================================
  async function loadProspects() {
    var params = '?page=' + CC.prospectPage + '&limit=50';
    if (CC.selectedList) params += '&list_id=' + CC.selectedList;
    if (CC.prospectFilter) params += '&status=' + CC.prospectFilter;
    if (CC.searchTerm) params += '&search=' + encodeURIComponent(CC.searchTerm);
    var data = await ccFetch('/api/customer-calls/prospects' + params);
    if (data) CC.prospects = data.prospects || [];
    var content = document.getElementById('cc-tab-content');
    if (content && CC.tab === 'prospects') content.innerHTML = renderProspects();
  }

  function renderProspects() {
    var filters = ['all', 'pending', 'called', 'leads', 'callback', 'dnc', 'appointment'];

    return '<div class="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">' +
      '<div class="px-5 py-4 border-b border-gray-100">' +
        '<div class="flex flex-wrap items-center justify-between gap-3">' +
          '<h3 class="font-bold text-gray-800"><i class="fas fa-user-friends text-blue-500 mr-2"></i>All Prospects</h3>' +
          '<div class="flex items-center gap-2">' +
            '<div class="relative"><input type="text" id="cc-prospect-search" class="pl-8 pr-3 py-1.5 border border-gray-300 rounded-lg text-xs w-48 focus:ring-2 focus:ring-orange-400" placeholder="Search..." value="' + esc(CC.searchTerm) + '" onkeyup="if(event.key===\'Enter\')window.ccSearchProspects()"><i class="fas fa-search absolute left-2.5 top-2 text-gray-400 text-xs"></i></div>' +
            '<button onclick="window.ccShowAddProspect()" class="px-3 py-1.5 bg-green-500 text-white rounded-lg text-xs font-bold hover:bg-green-600"><i class="fas fa-plus mr-1"></i>Add</button>' +
          '</div>' +
        '</div>' +
        // Filters
        '<div class="flex gap-1 mt-3 flex-wrap">' +
          filters.map(function(f) {
            var active = (CC.prospectFilter || 'all') === f;
            return '<button onclick="window.ccFilterProspects(\'' + f + '\')" class="px-3 py-1 rounded-full text-xs font-medium transition-all ' +
              (active ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200') + '">' +
              (f === 'all' ? 'All' : f === 'pending' ? 'Pending' : f === 'called' ? 'Called' : f === 'leads' ? 'Leads' : f === 'callback' ? 'Callback' : f === 'dnc' ? 'Do Not Call' : 'Appointments') +
            '</button>';
          }).join('') +
        '</div>' +
      '</div>' +
      // Add prospect form (hidden)
      '<div id="cc-add-prospect-form" class="hidden px-5 py-4 bg-green-50 border-b border-green-200">' +
        '<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">' +
          '<input id="cc-p-name" class="px-3 py-2 border border-gray-300 rounded-lg text-xs" placeholder="Contact Name">' +
          '<input id="cc-p-company" class="px-3 py-2 border border-gray-300 rounded-lg text-xs" placeholder="Company">' +
          '<input id="cc-p-phone" class="px-3 py-2 border border-gray-300 rounded-lg text-xs" placeholder="Phone">' +
          '<input id="cc-p-email" class="px-3 py-2 border border-gray-300 rounded-lg text-xs" placeholder="Email">' +
        '</div>' +
        '<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">' +
          '<input id="cc-p-city" class="px-3 py-2 border border-gray-300 rounded-lg text-xs" placeholder="City">' +
          '<input id="cc-p-title" class="px-3 py-2 border border-gray-300 rounded-lg text-xs" placeholder="Job Title">' +
          '<input id="cc-p-linkedin" class="px-3 py-2 border border-gray-300 rounded-lg text-xs" placeholder="LinkedIn URL">' +
          '<select id="cc-p-list" class="px-3 py-2 border border-gray-300 rounded-lg text-xs"><option value="">No List</option>' + CC.lists.map(function(l) { return '<option value="' + l.id + '">' + esc(l.name) + '</option>'; }).join('') + '</select>' +
        '</div>' +
        '<div class="flex gap-2">' +
          '<button onclick="window.ccAddProspect()" class="px-4 py-2 bg-green-500 text-white rounded-lg text-xs font-bold hover:bg-green-600"><i class="fas fa-check mr-1"></i>Add Prospect</button>' +
          '<button onclick="document.getElementById(\'cc-add-prospect-form\').classList.add(\'hidden\')" class="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-300">Cancel</button>' +
        '</div>' +
      '</div>' +
      // Prospects table
      '<div class="divide-y divide-gray-100 max-h-[600px] overflow-y-auto">' +
        (CC.prospects.length === 0 ?
          '<div class="p-8 text-center"><i class="fas fa-user-slash text-gray-300 text-4xl mb-3"></i><p class="text-gray-500 text-sm">No prospects found</p></div>'
        : CC.prospects.map(function(p) { return renderProspectRow(p); }).join('')) +
      '</div>' +
    '</div>';
  }

  function renderProspectRow(p) {
    var statusColors = { pending: 'bg-gray-100 text-gray-600', called: 'bg-blue-100 text-blue-700', answered: 'bg-green-100 text-green-700', no_answer: 'bg-yellow-100 text-yellow-700', callback: 'bg-blue-100 text-blue-700', interested: 'bg-orange-100 text-orange-700', dnc: 'bg-red-100 text-red-700' };
    var statusClass = statusColors[p.call_status] || 'bg-gray-100 text-gray-600';

    return '<div class="px-5 py-3 hover:bg-gray-50 transition-colors flex items-center gap-4">' +
      '<div class="flex-1 min-w-0">' +
        '<div class="flex items-center gap-2">' +
          '<p class="font-semibold text-gray-800 text-sm truncate">' + esc(p.contact_name || 'Unknown') + '</p>' +
          '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold ' + statusClass + '">' + (p.call_status || 'pending') + '</span>' +
          (p.is_lead ? '<span class="px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full text-[10px] font-bold"><i class="fas fa-fire mr-0.5"></i>Lead</span>' : '') +
          (p.do_not_call ? '<span class="px-2 py-0.5 bg-red-100 text-red-600 rounded-full text-[10px] font-bold"><i class="fas fa-ban mr-0.5"></i>DNC</span>' : '') +
        '</div>' +
        '<div class="flex items-center gap-3 text-xs text-gray-500 mt-0.5">' +
          (p.company_name ? '<span><i class="fas fa-building mr-0.5"></i>' + esc(p.company_name) + '</span>' : '') +
          (p.phone ? '<span><i class="fas fa-phone mr-0.5"></i>' + esc(p.phone) + '</span>' : '') +
          (p.city ? '<span><i class="fas fa-map-marker-alt mr-0.5"></i>' + esc(p.city) + '</span>' : '') +
          (p.job_title ? '<span><i class="fas fa-briefcase mr-0.5"></i>' + esc(p.job_title) + '</span>' : '') +
        '</div>' +
        (p.last_call_summary ? '<p class="text-xs text-gray-400 mt-1 truncate"><i class="fas fa-robot mr-1"></i>' + esc(p.last_call_summary.substring(0, 120)) + '</p>' : '') +
      '</div>' +
      '<div class="flex gap-1.5 flex-shrink-0">' +
        (p.linkedin_url ? '<a href="' + esc(p.linkedin_url) + '" target="_blank" class="w-7 h-7 bg-blue-100 text-blue-600 rounded-lg flex items-center justify-center hover:bg-blue-200 text-xs"><i class="fab fa-linkedin"></i></a>' : '') +
        '<button onclick="window.ccToggleDNC(' + p.id + ',' + (p.do_not_call ? 0 : 1) + ')" class="w-7 h-7 ' + (p.do_not_call ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600') + ' rounded-lg flex items-center justify-center hover:opacity-80 text-xs" title="' + (p.do_not_call ? 'Allow calls' : 'Do not call') + '"><i class="fas fa-' + (p.do_not_call ? 'check' : 'ban') + '"></i></button>' +
        '<button onclick="window.ccDeleteProspect(' + p.id + ')" class="w-7 h-7 bg-gray-100 text-gray-500 rounded-lg flex items-center justify-center hover:bg-red-100 hover:text-red-600 text-xs"><i class="fas fa-trash"></i></button>' +
      '</div>' +
    '</div>';
  }

  // ============================================================
  // CALL LOGS TAB
  // ============================================================
  async function loadCallLogs() {
    var params = '?page=' + CC.callLogPage + '&limit=50';
    if (CC.callLogFilter) params += '&outcome=' + CC.callLogFilter;
    var data = await ccFetch('/api/customer-calls/call-logs' + params);
    if (data) CC.callLogs = data.call_logs || [];
    var content = document.getElementById('cc-tab-content');
    if (content && CC.tab === 'call-logs') content.innerHTML = renderCallLogs();
  }

  function renderCallLogs() {
    var filters = [
      { id: '', label: 'All Calls' },
      { id: 'answered', label: 'Answered' },
      { id: 'no_answer', label: 'No Answer' },
      { id: 'voicemail', label: 'Voicemail' },
      { id: 'interested', label: 'Interested' },
      { id: 'appointment', label: 'Appointment' },
      { id: 'callback', label: 'Callback' },
      { id: 'do_not_call', label: 'DNC' }
    ];

    return '<div class="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">' +
      '<div class="px-5 py-4 border-b border-gray-100">' +
        '<div class="flex items-center justify-between mb-3">' +
          '<h3 class="font-bold text-gray-800"><i class="fas fa-history text-indigo-500 mr-2"></i>Call Logs</h3>' +
          '<span class="text-xs text-gray-400">' + CC.callLogs.length + ' calls</span>' +
        '</div>' +
        '<div class="flex gap-1 flex-wrap">' +
          filters.map(function(f) {
            var active = CC.callLogFilter === f.id;
            return '<button onclick="window.ccFilterLogs(\'' + f.id + '\')" class="px-3 py-1 rounded-full text-xs font-medium transition-all ' +
              (active ? 'bg-indigo-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200') + '">' + f.label + '</button>';
          }).join('') +
        '</div>' +
      '</div>' +
      '<div class="divide-y divide-gray-100 max-h-[600px] overflow-y-auto">' +
        (CC.callLogs.length === 0 ?
          '<div class="p-8 text-center"><i class="fas fa-phone-slash text-gray-300 text-4xl mb-3"></i><p class="text-gray-500 text-sm">No calls matching this filter</p></div>'
        : CC.callLogs.map(function(cl) { return renderCallLogRow(cl); }).join('')) +
      '</div>' +
    '</div>';
  }

  function renderCallLogRow(cl) {
    return '<div class="px-5 py-4 hover:bg-gray-50 transition-colors cursor-pointer" onclick="window.ccViewCallDetail(' + cl.id + ')">' +
      '<div class="flex items-start justify-between">' +
        '<div class="flex-1 min-w-0">' +
          '<div class="flex items-center gap-2 mb-1">' +
            '<p class="font-semibold text-gray-800 text-sm">' + esc(cl.contact_name || cl.phone_dialed || 'Unknown') + '</p>' +
            outcomeBadge(cl.call_outcome) +
            (cl.is_lead ? '<span class="px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full text-[10px] font-bold animate-pulse"><i class="fas fa-fire mr-0.5"></i>LEAD</span>' : '') +
            (cl.appointment_booked ? '<span class="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-[10px] font-bold"><i class="fas fa-calendar-check mr-0.5"></i>Appt</span>' : '') +
            sentimentIcon(cl.sentiment) +
          '</div>' +
          '<div class="flex items-center gap-3 text-xs text-gray-500">' +
            (cl.company_name ? '<span><i class="fas fa-building mr-0.5"></i>' + esc(cl.company_name) + '</span>' : '') +
            '<span><i class="fas fa-clock mr-0.5"></i>' + formatDuration(cl.call_duration_seconds) + '</span>' +
            '<span><i class="fas fa-calendar mr-0.5"></i>' + formatTimeAgo(cl.started_at) + '</span>' +
          '</div>' +
          (cl.call_summary ? '<p class="text-xs text-gray-500 mt-1.5 line-clamp-2"><i class="fas fa-robot text-gray-400 mr-1"></i>' + esc(cl.call_summary.substring(0, 200)) + '</p>' : '') +
          (cl.conversation_highlights ? '<p class="text-xs text-amber-600 mt-1"><i class="fas fa-star text-amber-400 mr-1"></i>' + esc(cl.conversation_highlights.substring(0, 150)) + '</p>' : '') +
        '</div>' +
        '<div class="flex flex-col items-end gap-1 ml-4 flex-shrink-0">' +
          '<button onclick="event.stopPropagation();window.ccViewCallDetail(' + cl.id + ')" class="px-3 py-1 bg-indigo-100 text-indigo-700 rounded-lg text-xs font-medium hover:bg-indigo-200"><i class="fas fa-file-alt mr-1"></i>Transcript</button>' +
          (cl.follow_up_required ? '<span class="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-[10px] font-bold"><i class="fas fa-bell mr-0.5"></i>Follow Up</span>' : '') +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function renderCallRow(call) {
    return '<div class="px-5 py-3 hover:bg-gray-50 transition-colors cursor-pointer" onclick="window.ccViewCallDetail(' + call.id + ')">' +
      '<div class="flex items-center gap-3">' +
        '<div class="w-9 h-9 ' + (call.is_lead ? 'bg-orange-100' : call.call_outcome === 'no_answer' ? 'bg-yellow-100' : 'bg-blue-100') + ' rounded-full flex items-center justify-center flex-shrink-0">' +
          '<i class="fas ' + (call.is_lead ? 'fa-fire text-orange-500' : call.call_outcome === 'no_answer' ? 'fa-phone-slash text-yellow-500' : 'fa-phone text-blue-500') + ' text-sm"></i>' +
        '</div>' +
        '<div class="flex-1 min-w-0">' +
          '<p class="font-medium text-gray-800 text-sm truncate">' + esc(call.contact_name || call.phone_dialed || 'Unknown') + '</p>' +
          '<div class="flex items-center gap-2 text-xs text-gray-400">' +
            (call.company_name ? '<span>' + esc(call.company_name) + '</span><span>&middot;</span>' : '') +
            '<span>' + formatDuration(call.call_duration_seconds) + '</span><span>&middot;</span>' +
            '<span>' + formatTimeAgo(call.started_at) + '</span>' +
          '</div>' +
        '</div>' +
        outcomeBadge(call.call_outcome) +
      '</div>' +
    '</div>';
  }

  // ============================================================
  // CALL DETAIL MODAL — Full transcript view
  // ============================================================
  window.ccViewCallDetail = async function(callId) {
    var data = await ccFetch('/api/customer-calls/call-logs/' + callId);
    if (!data || !data.call) { showToast('Call not found', 'error'); return; }
    showCallDetailModal(data.call);
  };

  function showCallDetailModal(call) {
    var overlay = document.createElement('div');
    overlay.id = 'cc-call-modal';
    overlay.className = 'fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4';
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };

    var transcript = call.call_transcript || 'No transcript available.';
    var lines = transcript.split('\n').filter(function(l) { return l.trim(); });

    overlay.innerHTML =
      '<div class="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">' +
        // Header
        '<div class="bg-gradient-to-r from-indigo-500 to-purple-600 text-white px-6 py-4 flex items-center justify-between">' +
          '<div>' +
            '<h3 class="font-bold text-lg">' + esc(call.contact_name || call.phone_dialed || 'Unknown') + '</h3>' +
            '<div class="flex items-center gap-3 text-indigo-200 text-xs mt-1">' +
              (call.company_name ? '<span><i class="fas fa-building mr-1"></i>' + esc(call.company_name) + '</span>' : '') +
              '<span><i class="fas fa-clock mr-1"></i>' + formatDuration(call.call_duration_seconds) + '</span>' +
              '<span><i class="fas fa-calendar mr-1"></i>' + formatTimeAgo(call.started_at) + '</span>' +
            '</div>' +
          '</div>' +
          '<button onclick="document.getElementById(\'cc-call-modal\').remove()" class="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center hover:bg-white/30"><i class="fas fa-times"></i></button>' +
        '</div>' +

        // Status badges
        '<div class="px-6 py-3 border-b border-gray-100 flex flex-wrap gap-2">' +
          outcomeBadge(call.call_outcome) +
          (call.is_lead ? '<span class="px-2 py-1 bg-orange-100 text-orange-700 rounded-full text-xs font-bold"><i class="fas fa-fire mr-1"></i>Hot Lead</span>' : '') +
          (call.appointment_booked ? '<span class="px-2 py-1 bg-purple-100 text-purple-700 rounded-full text-xs font-bold"><i class="fas fa-calendar-check mr-1"></i>Appointment: ' + esc(call.appointment_date || 'TBD') + '</span>' : '') +
          sentimentIcon(call.sentiment) +
          (call.follow_up_required ? '<span class="px-2 py-1 bg-amber-100 text-amber-700 rounded-full text-xs font-bold"><i class="fas fa-bell mr-1"></i>Follow-Up Required</span>' : '') +
        '</div>' +

        // Body (scrollable)
        '<div class="flex-1 overflow-y-auto px-6 py-4 space-y-4">' +
          // Summary
          (call.call_summary ? '<div class="bg-blue-50 rounded-xl p-4"><h4 class="font-bold text-blue-800 text-sm mb-1"><i class="fas fa-robot mr-1"></i>AI Summary</h4><p class="text-blue-700 text-sm">' + esc(call.call_summary) + '</p></div>' : '') +

          // Highlights
          (call.conversation_highlights ? '<div class="bg-amber-50 rounded-xl p-4"><h4 class="font-bold text-amber-800 text-sm mb-1"><i class="fas fa-star mr-1"></i>Key Highlights</h4><p class="text-amber-700 text-sm">' + esc(call.conversation_highlights) + '</p></div>' : '') +

          // Follow-up notes
          (call.follow_up_notes ? '<div class="bg-rose-50 rounded-xl p-4"><h4 class="font-bold text-rose-800 text-sm mb-1"><i class="fas fa-sticky-note mr-1"></i>Follow-Up Notes</h4><p class="text-rose-700 text-sm">' + esc(call.follow_up_notes) + '</p></div>' : '') +

          // Full Transcript
          '<div class="bg-gray-50 rounded-xl p-4">' +
            '<h4 class="font-bold text-gray-800 text-sm mb-3"><i class="fas fa-file-alt mr-1"></i>Full Transcript</h4>' +
            '<div class="space-y-2 font-mono text-xs">' +
              (lines.length > 0 ? lines.map(function(line) {
                var isAgent = line.toLowerCase().startsWith('agent') || line.toLowerCase().startsWith('ai');
                return '<div class="flex gap-2 ' + (isAgent ? 'justify-start' : 'justify-end') + '">' +
                  '<div class="max-w-[80%] px-3 py-2 rounded-xl ' + (isAgent ? 'bg-indigo-100 text-indigo-800' : 'bg-gray-200 text-gray-800') + '">' +
                    '<p>' + esc(line) + '</p>' +
                  '</div>' +
                '</div>';
              }).join('') : '<p class="text-gray-400 italic">No transcript recorded for this call.</p>') +
            '</div>' +
          '</div>' +

          // Agent notes
          '<div class="bg-white rounded-xl border border-gray-200 p-4">' +
            '<h4 class="font-bold text-gray-800 text-sm mb-2"><i class="fas fa-edit mr-1"></i>Your Notes</h4>' +
            '<textarea id="cc-call-notes-' + call.id + '" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm h-20" placeholder="Add your notes...">' + esc(call.agent_notes || '') + '</textarea>' +
            '<button onclick="window.ccSaveCallNotes(' + call.id + ')" class="mt-2 px-4 py-1.5 bg-indigo-500 text-white rounded-lg text-xs font-bold hover:bg-indigo-600"><i class="fas fa-save mr-1"></i>Save Notes</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);
  }

  // ============================================================
  // LEADS TAB
  // ============================================================
  async function loadLeads() {
    var data = await ccFetch('/api/customer-calls/leads');
    if (data) CC.leads = data.leads || [];
    var content = document.getElementById('cc-tab-content');
    if (content && CC.tab === 'leads') content.innerHTML = renderLeads();
  }

  function renderLeads() {
    return '<div class="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">' +
      '<div class="px-5 py-4 border-b border-gray-100 flex items-center justify-between">' +
        '<h3 class="font-bold text-gray-800"><i class="fas fa-fire-alt text-orange-500 mr-2"></i>Hot Leads (' + CC.leads.length + ')</h3>' +
        '<span class="text-xs text-gray-400">AI-identified interested prospects</span>' +
      '</div>' +
      '<div class="divide-y divide-gray-100 max-h-[600px] overflow-y-auto">' +
        (CC.leads.length === 0 ?
          '<div class="p-8 text-center"><div class="w-16 h-16 bg-orange-50 rounded-full flex items-center justify-center mx-auto mb-3"><i class="fas fa-fire text-orange-300 text-2xl"></i></div><p class="text-gray-500 text-sm">No leads yet</p><p class="text-gray-400 text-xs mt-1">Leads appear here when the AI identifies interested prospects during calls.</p></div>'
        : CC.leads.map(function(lead) {
            return '<div class="px-5 py-4 hover:bg-orange-50/50 transition-colors">' +
              '<div class="flex items-start justify-between">' +
                '<div class="flex-1">' +
                  '<div class="flex items-center gap-2 mb-1">' +
                    '<p class="font-bold text-gray-800">' + esc(lead.contact_name || lead.phone_dialed) + '</p>' +
                    '<span class="px-2 py-0.5 bg-orange-500 text-white rounded-full text-[10px] font-bold animate-pulse"><i class="fas fa-fire mr-0.5"></i>LEAD</span>' +
                    (lead.lead_quality ? '<span class="text-amber-500 text-xs">' + renderStars(lead.lead_quality) + '</span>' : '') +
                    (lead.appointment_booked ? '<span class="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-[10px] font-bold"><i class="fas fa-calendar-check mr-0.5"></i>Appt Booked</span>' : '') +
                  '</div>' +
                  '<div class="flex items-center gap-3 text-xs text-gray-500">' +
                    (lead.company_name ? '<span><i class="fas fa-building mr-0.5"></i>' + esc(lead.company_name) + '</span>' : '') +
                    (lead.phone_dialed ? '<span><i class="fas fa-phone mr-0.5"></i>' + esc(lead.phone_dialed) + '</span>' : '') +
                    (lead.prospect_email ? '<span><i class="fas fa-envelope mr-0.5"></i>' + esc(lead.prospect_email) + '</span>' : '') +
                    '<span><i class="fas fa-clock mr-0.5"></i>' + formatTimeAgo(lead.started_at) + '</span>' +
                  '</div>' +
                  (lead.call_summary ? '<p class="text-sm text-gray-600 mt-2"><i class="fas fa-robot text-gray-400 mr-1"></i>' + esc(lead.call_summary) + '</p>' : '') +
                  (lead.conversation_highlights ? '<p class="text-xs text-amber-600 mt-1 bg-amber-50 rounded-lg px-3 py-1.5"><i class="fas fa-star text-amber-400 mr-1"></i>' + esc(lead.conversation_highlights) + '</p>' : '') +
                '</div>' +
                '<button onclick="window.ccViewCallDetail(' + lead.id + ')" class="px-4 py-2 bg-indigo-500 text-white rounded-lg text-xs font-bold hover:bg-indigo-600 ml-4"><i class="fas fa-file-alt mr-1"></i>Full Transcript</button>' +
              '</div>' +
            '</div>';
          }).join('')) +
      '</div>' +
    '</div>';
  }

  // ============================================================
  // CONFIG TAB — Agent settings
  // ============================================================
  function renderConfig() {
    var cfg = CC.config || {};
    var voices = [
      { id: 'alloy', name: 'Alloy', desc: 'Neutral professional' },
      { id: 'echo', name: 'Echo', desc: 'Male, authoritative' },
      { id: 'fable', name: 'Fable', desc: 'Male, warm storyteller' },
      { id: 'onyx', name: 'Onyx', desc: 'Male, deep & confident' },
      { id: 'nova', name: 'Nova', desc: 'Female, warm & friendly' },
      { id: 'shimmer', name: 'Shimmer', desc: 'Female, upbeat & energetic' }
    ];

    return '<div class="space-y-6">' +
      '<div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">' +
        '<h3 class="font-bold text-gray-800 text-lg mb-4"><i class="fas fa-robot text-purple-500 mr-2"></i>AI Cold Call Agent Settings</h3>' +

        // Agent Name & Voice
        '<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">' +
          '<div>' +
            '<label class="text-sm font-medium text-gray-700 block mb-1">Agent Name</label>' +
            '<input id="cc-cfg-name" class="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-400" placeholder="e.g. Alex, Sarah" value="' + esc(cfg.agent_name || 'AI Sales Agent') + '">' +
          '</div>' +
          '<div>' +
            '<label class="text-sm font-medium text-gray-700 block mb-1">Business Name</label>' +
            '<input id="cc-cfg-business" class="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm" placeholder="Your company name" value="' + esc(cfg.business_name || '') + '">' +
          '</div>' +
        '</div>' +

        // Voice Selection
        '<div class="mb-6">' +
          '<label class="text-sm font-medium text-gray-700 block mb-3">Agent Voice</label>' +
          '<div class="grid grid-cols-2 md:grid-cols-3 gap-3">' +
            voices.map(function(v) {
              var selected = (cfg.agent_voice || 'alloy') === v.id;
              return '<label class="relative cursor-pointer">' +
                '<input type="radio" name="cc-voice" value="' + v.id + '" ' + (selected ? 'checked' : '') + ' class="sr-only peer">' +
                '<div class="p-3 border-2 rounded-xl transition-all peer-checked:border-purple-500 peer-checked:bg-purple-50 border-gray-200 hover:border-gray-300">' +
                  '<div class="flex items-center gap-2">' +
                    '<div class="w-8 h-8 bg-gradient-to-br ' + (v.id === 'nova' || v.id === 'shimmer' ? 'from-pink-400 to-rose-500' : v.id === 'alloy' ? 'from-gray-400 to-gray-500' : 'from-blue-400 to-indigo-500') + ' rounded-full flex items-center justify-center text-white text-xs"><i class="fas fa-' + (v.id === 'nova' || v.id === 'shimmer' ? 'venus' : v.id === 'alloy' ? 'robot' : 'mars') + '"></i></div>' +
                    '<div><p class="font-bold text-sm text-gray-800">' + v.name + '</p><p class="text-[10px] text-gray-500">' + v.desc + '</p></div>' +
                  '</div>' +
                '</div>' +
              '</label>';
            }).join('') +
          '</div>' +
        '</div>' +

        // Script sections
        '<div class="space-y-4 mb-6">' +
          '<div>' +
            '<label class="text-sm font-medium text-gray-700 block mb-1"><i class="fas fa-play-circle text-green-500 mr-1"></i>Opening Script (Intro)</label>' +
            '<textarea id="cc-cfg-intro" class="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm h-20 focus:ring-2 focus:ring-purple-400" placeholder="Hi, this is [Agent Name] from [Business]. I\'m reaching out because...">' + esc(cfg.script_intro || '') + '</textarea>' +
          '</div>' +
          '<div>' +
            '<label class="text-sm font-medium text-gray-700 block mb-1"><i class="fas fa-bullhorn text-blue-500 mr-1"></i>Value Proposition / Pitch</label>' +
            '<textarea id="cc-cfg-pitch" class="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm h-20 focus:ring-2 focus:ring-purple-400" placeholder="We help roofing companies get instant roof measurements from satellite imagery...">' + esc(cfg.script_pitch || '') + '</textarea>' +
          '</div>' +
          '<div>' +
            '<label class="text-sm font-medium text-gray-700 block mb-1"><i class="fas fa-shield-alt text-amber-500 mr-1"></i>Common Objection Responses</label>' +
            '<textarea id="cc-cfg-objections" class="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm h-20 focus:ring-2 focus:ring-purple-400" placeholder="If they say \'not interested\': I understand, many of our best clients felt the same way at first...">' + esc(cfg.script_objections || '') + '</textarea>' +
          '</div>' +
          '<div>' +
            '<label class="text-sm font-medium text-gray-700 block mb-1"><i class="fas fa-flag-checkered text-red-500 mr-1"></i>Closing Script</label>' +
            '<textarea id="cc-cfg-closing" class="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm h-20 focus:ring-2 focus:ring-purple-400" placeholder="Great talking with you! I\'ll send over the details. What\'s the best email?">' + esc(cfg.script_closing || '') + '</textarea>' +
          '</div>' +
          '<div>' +
            '<label class="text-sm font-medium text-gray-700 block mb-1"><i class="fas fa-phone-alt text-green-500 mr-1"></i>Callback Number</label>' +
            '<input id="cc-cfg-callback" class="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm" placeholder="Number prospects can call back on" value="' + esc(cfg.callback_number || '') + '">' +
          '</div>' +
        '</div>' +

        '<button onclick="window.ccSaveConfig()" class="px-6 py-3 bg-purple-500 text-white rounded-xl font-bold hover:bg-purple-600 transition-colors"><i class="fas fa-save mr-2"></i>Save Agent Settings</button>' +
      '</div>' +
    '</div>';
  }

  // ============================================================
  // NOTIFICATION PANEL
  // ============================================================
  function renderNotificationPanel() {
    return ''; // Notifications are shown as alert banners above tabs
  }

  // ============================================================
  // ACTION HANDLERS
  // ============================================================

  window.ccShowCreateList = function() {
    document.getElementById('cc-create-list-form').classList.remove('hidden');
  };

  window.ccCreateList = async function() {
    var name = document.getElementById('cc-list-name').value.trim();
    var source = document.getElementById('cc-list-source').value.trim();
    var desc = document.getElementById('cc-list-desc').value.trim();
    if (!name) { showToast('List name is required', 'error'); return; }
    var res = await ccFetch('/api/customer-calls/lists', { method: 'POST', body: JSON.stringify({ name: name, source: source, description: desc }) });
    if (res && res.success) {
      showToast('List created!', 'success');
      await loadDashboard();
      render();
    } else { showToast('Failed to create list', 'error'); }
  };

  window.ccDeleteList = async function(id) {
    if (!confirm('Delete this list? Prospects will remain but be unlinked.')) return;
    var res = await ccFetch('/api/customer-calls/lists/' + id, { method: 'DELETE' });
    if (res && res.success) {
      showToast('List deleted', 'success');
      await loadDashboard();
      render();
    }
  };

  window.ccShowImportCSV = function(listId) {
    var el = document.getElementById('cc-import-' + listId);
    if (el) el.classList.toggle('hidden');
  };

  window.ccImportCSV = async function(listId) {
    var textarea = document.getElementById('cc-csv-' + listId);
    if (!textarea || !textarea.value.trim()) { showToast('Paste CSV data first', 'error'); return; }
    showToast('Importing...', 'info');
    var res = await ccFetch('/api/customer-calls/lists/' + listId + '/import', { method: 'POST', body: JSON.stringify({ csv_data: textarea.value }) });
    if (res && res.success) {
      showToast('Imported ' + res.imported + ' contacts! (' + (res.duplicates || 0) + ' duplicates, ' + res.skipped + ' skipped)', 'success');
      await loadDashboard();
      render();
    } else { showToast('Import failed: ' + (res ? res.error : 'Unknown error'), 'error'); }
  };

  window.ccViewListProspects = function(listId) {
    CC.selectedList = listId;
    CC.tab = 'prospects';
    render();
    loadProspects();
  };

  window.ccShowAddProspect = function() {
    document.getElementById('cc-add-prospect-form').classList.remove('hidden');
  };

  window.ccAddProspect = async function() {
    var data = {
      contact_name: document.getElementById('cc-p-name').value.trim(),
      company_name: document.getElementById('cc-p-company').value.trim(),
      phone: document.getElementById('cc-p-phone').value.trim(),
      email: document.getElementById('cc-p-email').value.trim(),
      city: document.getElementById('cc-p-city').value.trim(),
      job_title: document.getElementById('cc-p-title').value.trim(),
      linkedin_url: document.getElementById('cc-p-linkedin').value.trim(),
      list_id: document.getElementById('cc-p-list').value || null
    };
    if (!data.contact_name && !data.phone) { showToast('Name or phone required', 'error'); return; }
    var res = await ccFetch('/api/customer-calls/prospects', { method: 'POST', body: JSON.stringify(data) });
    if (res && res.success) {
      showToast('Prospect added!', 'success');
      document.getElementById('cc-add-prospect-form').classList.add('hidden');
      loadProspects();
    }
  };

  window.ccFilterProspects = function(filter) {
    CC.prospectFilter = filter === 'all' ? '' : filter;
    CC.prospectPage = 1;
    loadProspects();
  };

  window.ccSearchProspects = function() {
    CC.searchTerm = (document.getElementById('cc-prospect-search') || {}).value || '';
    CC.prospectPage = 1;
    loadProspects();
  };

  window.ccToggleDNC = async function(id, dnc) {
    await ccFetch('/api/customer-calls/prospects/' + id, { method: 'PUT', body: JSON.stringify({ do_not_call: dnc }) });
    showToast(dnc ? 'Marked Do Not Call' : 'Allowed calls', 'success');
    loadProspects();
  };

  window.ccDeleteProspect = async function(id) {
    if (!confirm('Delete this prospect?')) return;
    await ccFetch('/api/customer-calls/prospects/' + id, { method: 'DELETE' });
    showToast('Prospect deleted', 'success');
    loadProspects();
  };

  window.ccFilterLogs = function(outcome) {
    CC.callLogFilter = outcome;
    CC.callLogPage = 1;
    loadCallLogs();
  };

  window.ccSaveCallNotes = async function(callId) {
    var textarea = document.getElementById('cc-call-notes-' + callId);
    if (!textarea) return;
    var res = await ccFetch('/api/customer-calls/call-logs/' + callId, { method: 'PUT', body: JSON.stringify({ agent_notes: textarea.value }) });
    if (res && res.success) showToast('Notes saved!', 'success');
  };

  window.ccSaveConfig = async function() {
    var voice = 'alloy';
    var radios = document.querySelectorAll('input[name="cc-voice"]');
    radios.forEach(function(r) { if (r.checked) voice = r.value; });

    var data = {
      agent_name: (document.getElementById('cc-cfg-name') || {}).value || 'AI Sales Agent',
      agent_voice: voice,
      business_name: (document.getElementById('cc-cfg-business') || {}).value || '',
      script_intro: (document.getElementById('cc-cfg-intro') || {}).value || '',
      script_pitch: (document.getElementById('cc-cfg-pitch') || {}).value || '',
      script_objections: (document.getElementById('cc-cfg-objections') || {}).value || '',
      script_closing: (document.getElementById('cc-cfg-closing') || {}).value || '',
      callback_number: (document.getElementById('cc-cfg-callback') || {}).value || ''
    };

    var res = await ccFetch('/api/customer-calls/config', { method: 'POST', body: JSON.stringify(data) });
    if (res && res.success) {
      showToast('Agent settings saved!', 'success');
      CC.config = data;
    } else { showToast('Failed to save settings', 'error'); }
  };

  // ============================================================
  // HELPERS
  // ============================================================
  function esc(s) { if (!s) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  function formatDuration(sec) {
    if (!sec) return '0s';
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m > 0 ? m + 'm ' + s + 's' : s + 's';
  }

  function formatTimeAgo(dateStr) {
    if (!dateStr) return '';
    var diff = (Date.now() - new Date(dateStr + (dateStr.includes('Z') ? '' : 'Z')).getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  }

  function outcomeBadge(outcome) {
    var colors = {
      answered: 'bg-green-100 text-green-700', interested: 'bg-orange-100 text-orange-700',
      appointment: 'bg-purple-100 text-purple-700', callback: 'bg-blue-100 text-blue-700',
      no_answer: 'bg-yellow-100 text-yellow-700', voicemail: 'bg-yellow-100 text-yellow-700',
      do_not_call: 'bg-red-100 text-red-700', completed: 'bg-gray-100 text-gray-600',
      not_interested: 'bg-gray-100 text-gray-600'
    };
    var c = colors[outcome] || 'bg-gray-100 text-gray-600';
    return outcome ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold ' + c + '">' + (outcome || '').replace(/_/g, ' ') + '</span>' : '';
  }

  function sentimentIcon(sentiment) {
    if (!sentiment) return '';
    var icons = { positive: 'fa-smile text-green-500', neutral: 'fa-meh text-gray-400', negative: 'fa-frown text-red-400' };
    var icon = icons[sentiment] || icons.neutral;
    return '<i class="fas ' + icon + ' text-xs" title="Sentiment: ' + sentiment + '"></i>';
  }

  function renderStars(quality) {
    var q = quality === 'hot' ? 5 : quality === 'warm' ? 3 : quality === 'cold' ? 1 : 0;
    var html = '';
    for (var i = 0; i < 5; i++) html += '<i class="fas fa-star ' + (i < q ? '' : 'text-gray-300') + '"></i>';
    return html;
  }

  function showToast(msg, type) {
    var colors = { success: 'bg-green-500', error: 'bg-red-500', info: 'bg-blue-500' };
    var t = document.createElement('div');
    t.className = 'fixed top-4 right-4 z-50 px-5 py-3 rounded-xl text-white font-medium text-sm shadow-xl ' + (colors[type] || 'bg-gray-700');
    t.innerHTML = '<i class="fas fa-' + (type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle') + ' mr-2"></i>' + msg;
    document.body.appendChild(t);
    setTimeout(function() { t.style.opacity = '0'; t.style.transition = 'opacity 0.3s'; setTimeout(function() { t.remove(); }, 300); }, 3000);
  }

})();

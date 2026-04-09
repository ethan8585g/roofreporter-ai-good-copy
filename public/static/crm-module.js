// ============================================================
// CRM Module — Unified frontend for all CRM sub-pages
// Detects which module to render via data-module attribute
// ============================================================

(function() {
  'use strict';

  const root = document.getElementById('crm-root');
  if (!root) return;
  const MODULE = root.getAttribute('data-module') || 'reports';

  function getToken() { return localStorage.getItem('rc_customer_token') || ''; }
  function authHeaders() { return { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' }; }
  function authHeadersOnly() { return { 'Authorization': 'Bearer ' + getToken() }; }

  // Global unhandled promise rejection handler for CRM module
  window.addEventListener('unhandledrejection', function(event) {
    console.error('[CRM] Unhandled promise rejection:', event.reason);
    if (typeof toast === 'function') toast('An error occurred. Please try again.', 'error');
  });

  // ============================================================
  // ROUTER — Render the correct module
  // ============================================================
  const modules = {
    reports: { init: initReports, title: 'Roof Report History' },
    customers: { init: initCustomers, title: 'My Customers' },
    invoices: { init: initInvoices, title: 'Invoices' },
    proposals: { init: initProposals, title: 'Proposals & Estimates' },
    jobs: { init: initJobs, title: 'Job Management' },
    crew: { init: initCrewManager, title: 'Crew Manager' },
    pipeline: { init: initPipeline, title: 'Sales Pipeline' },
    d2d: { init: initD2D, title: 'D2D Manager' },
    'email-outreach': { init: initEmailOutreach, title: 'Email Outreach' },
    'suppliers': { init: initSuppliers, title: 'Supplier Management' },
    'catalog': { init: initCatalog, title: 'Material Catalog' },
    'referrals': { init: initReferrals, title: 'Referral Program' },
  };

  const mod = modules[MODULE];
  if (mod) { mod.init(); } else { root.innerHTML = '<p class="text-red-500">Unknown module: ' + MODULE + '</p>'; }

  // ============================================================
  // HELPER: Status badge
  // ============================================================
  function badge(status, map) {
    var m = map || { active: 'bg-emerald-500/15 text-emerald-400', inactive: 'bg-white/5 text-gray-500', lead: 'bg-blue-500/15 text-blue-400', draft: 'bg-white/10 text-gray-400', sent: 'bg-blue-500/15 text-blue-400', viewed: 'bg-blue-500/15 text-blue-400', paid: 'bg-emerald-500/15 text-emerald-400', overdue: 'bg-red-500/15 text-red-400', cancelled: 'bg-white/5 text-gray-500', accepted: 'bg-emerald-500/15 text-emerald-400', declined: 'bg-red-500/15 text-red-400', expired: 'bg-white/10 text-gray-400', scheduled: 'bg-blue-500/15 text-blue-400', in_progress: 'bg-blue-500/15 text-blue-400', completed: 'bg-emerald-500/15 text-emerald-400', postponed: 'bg-white/5 text-gray-500' };
    return '<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize ' + (m[status] || 'bg-white/5 text-gray-500') + '">' + (status || 'unknown').replace(/_/g, ' ') + '</span>';
  }

  function money(v) { return '$' + (parseFloat(v) || 0).toFixed(2); }
  function fmtDate(d) { return d ? new Date(d).toLocaleDateString() : '-'; }

  // ============================================================
  // MODAL HELPER
  // ============================================================
  function showModal(title, bodyHtml, onSave, saveLabel) {
    var overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4';
    overlay.id = 'crmModal';
    overlay.innerHTML = '<div class="bg-[#111111] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto mx-4 sm:mx-auto">' +
      '<div class="px-6 py-4 border-b border-white/5 flex items-center justify-between"><h3 style="font-weight:700;color:#ffffff">' + title + '</h3><button onclick="document.getElementById(\'crmModal\').remove()" class="text-gray-400 hover:text-gray-400 text-lg">&times;</button></div>' +
      '<div class="p-6" id="modalBody" style="color:#e5e7eb">' + bodyHtml + '</div>' +
      (onSave ? '<div class="px-6 py-4 border-t border-white/5 flex justify-end gap-2"><button onclick="document.getElementById(\'crmModal\').remove()" class="px-4 py-2 text-gray-400 hover:bg-[#111111]/10 rounded-lg text-sm">Cancel</button><button id="modalSaveBtn" class="px-6 py-2 bg-brand-600 text-white rounded-lg text-sm font-semibold hover:bg-brand-700">' + (saveLabel || 'Save') + '</button></div>' : '') +
      '</div>';
    document.body.appendChild(overlay);
    // Force readable text on all inputs/selects/textareas inside the modal
    var isLight = document.body.classList.contains('light-theme');
    overlay.querySelectorAll('input, select, textarea').forEach(function(el) {
      el.style.color = isLight ? '#0B0F12' : '#fff';
      el.style.backgroundColor = isLight ? '#ffffff' : '#0A0A0A';
    });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
    if (onSave) { document.getElementById('modalSaveBtn').addEventListener('click', function() { onSave(); }); }
    return overlay;
  }

  function closeModal() { var m = document.getElementById('crmModal'); if (m) m.remove(); }
  window.closeModal = closeModal;

  // ============================================================
  // TOAST HELPER
  // ============================================================
  function toast(msg, type) {
    var t = document.createElement('div');
    t.className = 'fixed bottom-4 right-4 z-[60] px-5 py-3 rounded-xl shadow-xl text-sm font-medium text-white ' + (type === 'error' ? 'bg-red-600' : 'bg-green-600');
    t.innerHTML = '<i class="fas ' + (type === 'error' ? 'fa-exclamation-circle' : 'fa-check-circle') + ' mr-2"></i>' + msg;
    document.body.appendChild(t);
    setTimeout(function() { t.remove(); }, 3000);
  }

  function _crmShareModal(title, message, url) {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center';
    overlay.innerHTML = '<div style="background:white;border-radius:16px;padding:32px;max-width:480px;width:90%;box-shadow:0 25px 50px rgba(0,0,0,0.25)">' +
      '<h3 style="font-size:18px;font-weight:700;color:#111;margin:0 0 8px">' + title + '</h3>' +
      '<p style="font-size:13px;color:#6b7280;margin:0 0 16px">' + message + '</p>' +
      '<div style="display:flex;gap:8px;margin-bottom:16px"><input type="text" readonly value="' + url.replace(/"/g, '&quot;') + '" style="flex:1;padding:10px 12px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;color:#374151;background:#f9fafb;outline:none" id="crm-share-url">' +
      '<button onclick="navigator.clipboard.writeText(document.getElementById(\'crm-share-url\').value).then(function(){this.innerHTML=\'<i class=\\\'fas fa-check\\\'></i>\';this.style.background=\'#16a34a\'}.bind(this)).catch(function(){})" style="padding:10px 16px;background:#0ea5e9;color:white;border:none;border-radius:8px;font-weight:600;font-size:13px;cursor:pointer;white-space:nowrap"><i class="fas fa-copy" style="margin-right:4px"></i>Copy</button></div>' +
      '<button onclick="this.closest(\'div\').parentElement.remove()" style="width:100%;padding:10px;background:#f3f4f6;border:none;border-radius:8px;font-weight:600;font-size:13px;color:#374151;cursor:pointer">Close</button></div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
  }

  // ============================================================
  // SELECT: Customer picker dropdown HTML
  // ============================================================
  function customerSelectHTML(customers, selectedId, fieldId) {
    var fid = fieldId || 'selCustomer';
    var html = '<div id="' + fid + 'Wrapper">';
    // Toggle tabs: Existing vs New
    html += '<div class="flex gap-1 mb-2 bg-white/5 rounded-lg p-0.5">' +
      '<button type="button" onclick="window._toggleCustMode(\'' + fid + '\', \'existing\')" id="' + fid + 'TabExisting" class="flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors bg-[#111111] shadow text-gray-100">Existing Customer</button>' +
      '<button type="button" onclick="window._toggleCustMode(\'' + fid + '\', \'new\')" id="' + fid + 'TabNew" class="flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors text-gray-500 hover:text-gray-300">+ New Customer</button>' +
      '</div>';
    // Existing customer dropdown
    html += '<div id="' + fid + 'Existing">';
    html += '<select id="' + fid + '" class="w-full px-3 py-2.5 border border-white/15 rounded-xl text-sm focus:ring-2 focus:ring-brand-500"><option value="">Select a customer...</option>';
    for (var i = 0; i < customers.length; i++) {
      var c = customers[i];
      html += '<option value="' + c.id + '"' + (c.id == selectedId ? ' selected' : '') + '>' + c.name + (c.email ? ' — ' + c.email : '') + (c.company ? ' (' + c.company + ')' : '') + '</option>';
    }
    html += '</select></div>';
    // New customer inline form
    html += '<div id="' + fid + 'New" style="display:none" class="space-y-2">' +
      '<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">' +
        '<input type="text" id="' + fid + 'NewName" class="w-full px-2.5 py-2 border border-white/15 rounded-lg text-sm" placeholder="Full Name *">' +
        '<input type="email" id="' + fid + 'NewEmail" class="w-full px-2.5 py-2 border border-white/15 rounded-lg text-sm" placeholder="Email">' +
      '</div>' +
      '<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">' +
        '<input type="tel" id="' + fid + 'NewPhone" class="w-full px-2.5 py-2 border border-white/15 rounded-lg text-sm" placeholder="Phone">' +
        '<input type="text" id="' + fid + 'NewCompany" class="w-full px-2.5 py-2 border border-white/15 rounded-lg text-sm" placeholder="Company (optional)">' +
      '</div>' +
      '<input type="text" id="' + fid + 'NewAddress" class="w-full px-2.5 py-2 border border-white/15 rounded-lg text-sm" placeholder="Address">' +
      '<div class="grid grid-cols-3 gap-2">' +
        '<input type="text" id="' + fid + 'NewCity" class="w-full px-2.5 py-2 border border-white/15 rounded-lg text-sm" placeholder="City">' +
        '<input type="text" id="' + fid + 'NewProvince" class="w-full px-2.5 py-2 border border-white/15 rounded-lg text-sm" placeholder="Province" value="AB">' +
        '<input type="text" id="' + fid + 'NewPostal" class="w-full px-2.5 py-2 border border-white/15 rounded-lg text-sm" placeholder="Postal Code">' +
      '</div>' +
    '</div>';
    html += '<input type="hidden" id="' + fid + 'Mode" value="existing">';
    html += '</div>';
    return html;
  }

  window._toggleCustMode = function(fid, mode) {
    document.getElementById(fid + 'Mode').value = mode;
    document.getElementById(fid + 'Existing').style.display = mode === 'existing' ? '' : 'none';
    document.getElementById(fid + 'New').style.display = mode === 'new' ? '' : 'none';
    var tabEx = document.getElementById(fid + 'TabExisting');
    var tabNew = document.getElementById(fid + 'TabNew');
    if (mode === 'existing') {
      tabEx.className = 'flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors bg-[#111111] shadow text-gray-100';
      tabNew.className = 'flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors text-gray-500 hover:text-gray-300';
    } else {
      tabNew.className = 'flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors bg-[#111111] shadow text-gray-100';
      tabEx.className = 'flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors text-gray-500 hover:text-gray-300';
      // Focus name field
      var nameField = document.getElementById(fid + 'NewName');
      if (nameField) setTimeout(function() { nameField.focus(); }, 50);
    }
  };

  // Helper: get customer ID or new customer data from the combined selector
  function getCustomerFromSelector(fid) {
    var mode = document.getElementById(fid + 'Mode').value;
    if (mode === 'existing') {
      var id = document.getElementById(fid).value;
      return id ? { crm_customer_id: parseInt(id) } : null;
    } else {
      var name = document.getElementById(fid + 'NewName').value.trim();
      if (!name) return null;
      return {
        new_customer: {
          name: name,
          email: document.getElementById(fid + 'NewEmail').value.trim() || null,
          phone: document.getElementById(fid + 'NewPhone').value.trim() || null,
          company: document.getElementById(fid + 'NewCompany').value.trim() || null,
          address: document.getElementById(fid + 'NewAddress').value.trim() || null,
          city: document.getElementById(fid + 'NewCity').value.trim() || null,
          province: document.getElementById(fid + 'NewProvince').value.trim() || null,
          postal_code: document.getElementById(fid + 'NewPostal').value.trim() || null
        }
      };
    }
  }

  // ============================================================
  // MODULE: REPORTS
  // ============================================================
  function initReports() {
    root.innerHTML = '<div class="text-center py-8"><div class="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-brand-500 mx-auto mb-3"></div><p class="text-gray-500 text-sm">Loading reports...</p></div>';
    fetch('/api/customer/orders', { headers: authHeadersOnly() })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var orders = data.orders || [];
        renderReports(orders);
      })
      .catch(function() { root.innerHTML = '<p class="text-red-500">Failed to load reports.</p>'; });
  }

  function renderReports(orders) {
    var custObj = {};
    try { custObj = JSON.parse(localStorage.getItem('rc_customer') || '{}'); } catch(e) {}
    var isSolar = custObj.company_type === 'solar';

    if (orders.length === 0) {
      root.innerHTML = '<div style="background:var(--bg-card);border:1px solid var(--border-color)" class="rounded-xl p-12 text-center"><div class="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-4"><i class="fas fa-file-alt text-gray-400 text-2xl"></i></div><h3 class="text-lg font-semibold mb-2" style="color:var(--text-secondary)">No Reports Yet</h3><p class="mb-6" style="color:var(--text-muted)">Order your first roof measurement to see reports here.</p><a href="/customer/order" class="inline-block bg-brand-600 hover:bg-brand-700 text-white font-bold py-3 px-8 rounded-xl"><i class="fas fa-plus mr-2"></i>Order a Report</a></div>';
      return;
    }
    var html = '<div class="flex items-center justify-between mb-4"><h2 class="text-lg font-bold" style="color:var(--text-primary)"><i class="fas fa-file-alt text-brand-500 mr-2"></i>Roof Report History (' + orders.length + ')</h2><a href="/customer/order" class="bg-brand-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-brand-700"><i class="fas fa-plus mr-1"></i>New Report</a></div><div class="space-y-3">';
    for (var i = 0; i < orders.length; i++) {
      var o = orders[i];
      var isCompleted = (o.report_status === 'completed' || o.status === 'completed');
      var isProcessing = (o.status === 'processing' || o.report_status === 'running');
      var buttons = '';
      if (isCompleted) {
        buttons = '<a href="/api/reports/' + o.id + '/html" target="_blank" class="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700"><i class="fas fa-file-alt mr-1"></i>View Report</a><a href="/api/reports/' + o.id + '/pdf" target="_blank" title="Opens print dialog in new tab" class="px-4 py-2 bg-white/5 text-gray-300 rounded-lg text-xs font-medium hover:bg-gray-200"><i class="fas fa-print mr-1"></i>Print PDF</a><button onclick="window._crmShareReport(' + o.id + ')" class="px-4 py-2 bg-sky-600 text-white rounded-lg text-xs font-medium hover:bg-sky-700"><i class="fas fa-share-alt mr-1"></i>Share</button><button onclick="window._crmCreateProposalFromReport(' + o.id + ')" class="px-4 py-2 bg-blue-500/15 text-white rounded-lg text-xs font-medium hover:bg-blue-500/15"><i class="fas fa-file-invoice mr-1"></i>Create Proposal</button>';
        if (isSolar) {
          buttons += '<a href="/customer/material-calculator?order_id=' + o.id + '" class="px-4 py-2 bg-white/10 text-white rounded-lg text-xs font-medium hover:bg-white/10"><i class="fas fa-calculator mr-1"></i>Material Calculator</a>';
        }
      } else if (isProcessing) {
        buttons = '<span class="px-4 py-2 bg-blue-50 text-blue-600 rounded-lg text-sm font-medium"><i class="fas fa-spinner fa-spin mr-1"></i>Generating...</span>';
      } else {
        buttons = '<span class="px-4 py-2 rounded-lg text-xs font-medium" style="background:var(--bg-elevated);color:var(--text-muted)">' + (o.status || 'pending') + '</span>';
      }
      html += '<div style="background:var(--bg-card);border:1px solid var(--border-color)" class="rounded-xl p-4 hover:shadow-md transition-shadow"><div class="flex items-start justify-between"><div class="min-w-0"><div class="flex items-center gap-2 mb-1"><span class="font-mono text-xs font-bold" style="color:var(--accent)">' + o.order_number + '</span>' + badge(o.status) + '</div><p class="font-medium text-sm" style="color:var(--text-secondary)"><i class="fas fa-map-marker-alt text-red-400 mr-1"></i>' + o.property_address + '</p><div class="flex items-center gap-3 mt-2 text-xs" style="color:var(--text-muted)"><span><i class="fas fa-calendar mr-1"></i>' + fmtDate(o.created_at) + '</span>' + (o.roof_area_sqft ? '<span><i class="fas fa-ruler-combined mr-1"></i>' + Math.round(o.roof_area_sqft) + ' sq ft</span>' : '') + '</div></div><div class="flex flex-col items-end gap-2 flex-shrink-0 ml-4">' + buttons + '</div></div></div>';
    }
    html += '</div>';
    root.innerHTML = html;
  }

  // ============================================================
  // MODULE: CUSTOMERS
  // ============================================================
  var customersData = [];
  function initCustomers() {
    root.innerHTML = '<div class="text-center py-8"><div class="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-brand-500 mx-auto mb-3"></div></div>';
    loadCustomers();
  }

  function loadCustomers(search) {
    var url = '/api/crm/customers';
    if (search) url += '?search=' + encodeURIComponent(search);
    fetch(url, { headers: authHeadersOnly() })
      .then(function(r) { return r.json(); })
      .then(function(data) { customersData = data.customers || []; renderCustomers(data); })
      .catch(function() { root.innerHTML = '<p class="text-red-500">Failed to load customers.</p>'; });
  }

  function renderCustomers(data) {
    var customers = data.customers || [];
    var stats = data.stats || {};
    var html = '<div class="flex items-center justify-between mb-5 flex-wrap gap-3"><div><h2 class="text-lg font-bold text-gray-100"><i class="fas fa-users text-blue-400 mr-2"></i>My Customers (' + (stats.total || 0) + ')</h2><p class="text-xs text-gray-500 mt-0.5">' + (stats.active_count || 0) + ' active</p></div><div class="flex items-center gap-2"><input type="text" id="custSearch" placeholder="Search customers..." class="px-3 py-2 border border-white/15 rounded-lg text-sm w-48 focus:ring-2 focus:ring-brand-500" onkeyup="if(event.key===\'Enter\')window._crmSearchCustomers()"><button onclick="window._crmAddCustomer()" class="bg-blue-500/15 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-500/15"><i class="fas fa-plus mr-1"></i>Add Customer</button></div></div>';

    if (customers.length === 0) {
      html += '<div class="bg-[#111111] rounded-xl border p-12 text-center"><div class="w-16 h-16 bg-blue-500/15 rounded-full flex items-center justify-center mx-auto mb-4"><i class="fas fa-users text-blue-400 text-2xl"></i></div><h3 class="text-lg font-semibold text-gray-300 mb-2">No Customers Yet</h3><p class="text-gray-500 mb-4">Add your first client to start managing leads & invoices.</p><button onclick="window._crmAddCustomer()" class="bg-blue-500/15 text-white px-6 py-2.5 rounded-xl font-semibold hover:bg-blue-500/15"><i class="fas fa-plus mr-2"></i>Add First Customer</button></div>';
    } else {
      html += '<div class="bg-[#111111] rounded-xl border overflow-hidden overflow-x-auto"><table class="w-full text-sm"><thead class="bg-[#0A0A0A]"><tr><th class="px-4 py-3 text-left text-xs font-semibold text-gray-500">Name</th><th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 hidden md:table-cell">Company</th><th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 hidden lg:table-cell">Phone</th><th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 hidden lg:table-cell">Email</th><th class="px-4 py-3 text-center text-xs font-semibold text-gray-500">Status</th><th class="px-4 py-3 text-right text-xs font-semibold text-gray-500">Revenue</th><th class="px-4 py-3"></th></tr></thead><tbody class="divide-y divide-gray-50">';
      for (var i = 0; i < customers.length; i++) {
        var c = customers[i];
        html += '<tr class="hover:bg-[#111111]/5 cursor-pointer" onclick="window._crmViewCustomer(' + c.id + ')"><td class="px-4 py-3 font-medium text-gray-100">' + c.name + '</td><td class="px-4 py-3 text-gray-500 hidden md:table-cell">' + (c.company || '-') + '</td><td class="px-4 py-3 text-gray-500 hidden lg:table-cell">' + (c.phone || '-') + '</td><td class="px-4 py-3 text-gray-500 hidden lg:table-cell">' + (c.email || '-') + '</td><td class="px-4 py-3 text-center">' + badge(c.status) + '</td><td class="px-4 py-3 text-right font-semibold text-gray-300">' + money(c.lifetime_value) + '</td><td class="px-4 py-3 text-right"><button onclick="event.stopPropagation();window._crmEditCustomer(' + c.id + ')" class="text-gray-400 hover:text-brand-600"><i class="fas fa-pencil-alt"></i></button></td></tr>';
      }
      html += '</tbody></table></div>';
    }
    root.innerHTML = html;
  }

  // Customer form HTML
  function customerFormHTML(c) {
    c = c || {};
    return '<div class="space-y-3">' +
      '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3"><div><label class="block text-xs font-medium text-gray-400 mb-1">Name *</label><input type="text" id="cfName" value="' + (c.name || '') + '" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm focus:ring-2 focus:ring-brand-500"></div><div><label class="block text-xs font-medium text-gray-400 mb-1">Company</label><input type="text" id="cfCompany" value="' + (c.company || '') + '" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm focus:ring-2 focus:ring-brand-500"></div></div>' +
      '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3"><div><label class="block text-xs font-medium text-gray-400 mb-1">Email</label><input type="email" id="cfEmail" value="' + (c.email || '') + '" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm focus:ring-2 focus:ring-brand-500"></div><div><label class="block text-xs font-medium text-gray-400 mb-1">Phone</label><input type="tel" id="cfPhone" value="' + (c.phone || '') + '" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm focus:ring-2 focus:ring-brand-500"></div></div>' +
      '<div><label class="block text-xs font-medium text-gray-400 mb-1">Address</label><input type="text" id="cfAddress" value="' + (c.address || '') + '" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm focus:ring-2 focus:ring-brand-500"></div>' +
      '<div class="grid grid-cols-3 gap-3"><div><label class="block text-xs font-medium text-gray-400 mb-1">City</label><input type="text" id="cfCity" value="' + (c.city || '') + '" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm"></div><div><label class="block text-xs font-medium text-gray-400 mb-1">Province</label><input type="text" id="cfProvince" value="' + (c.province || '') + '" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm"></div><div><label class="block text-xs font-medium text-gray-400 mb-1">Postal Code</label><input type="text" id="cfPostal" value="' + (c.postal_code || '') + '" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm"></div></div>' +
      '<div><label class="block text-xs font-medium text-gray-400 mb-1">Notes</label><textarea id="cfNotes" rows="2" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm">' + (c.notes || '') + '</textarea></div>' +
      '<div><label class="block text-xs font-medium text-gray-400 mb-1">Status</label><select id="cfStatus" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm"><option value="active"' + (c.status === 'active' ? ' selected' : '') + '>Active</option><option value="lead"' + (c.status === 'lead' ? ' selected' : '') + '>Lead</option><option value="inactive"' + (c.status === 'inactive' ? ' selected' : '') + '>Inactive</option></select></div>' +
      '</div>';
  }

  function getCustomerFormData() {
    return {
      name: document.getElementById('cfName').value.trim(),
      company: document.getElementById('cfCompany').value.trim(),
      email: document.getElementById('cfEmail').value.trim(),
      phone: document.getElementById('cfPhone').value.trim(),
      address: document.getElementById('cfAddress').value.trim(),
      city: document.getElementById('cfCity').value.trim(),
      province: document.getElementById('cfProvince').value.trim(),
      postal_code: document.getElementById('cfPostal').value.trim(),
      notes: document.getElementById('cfNotes').value.trim(),
      status: document.getElementById('cfStatus').value
    };
  }

  window._crmSearchCustomers = function() {
    var s = document.getElementById('custSearch');
    loadCustomers(s ? s.value.trim() : '');
  };

  window._crmAddCustomer = function() {
    showModal('Add New Customer', customerFormHTML(), function() {
      var data = getCustomerFormData();
      if (!data.name) { toast('Customer name is required.', 'error'); return; }
      var saveBtn = document.querySelector('.modal-confirm-btn') || document.querySelector('[onclick]');
      fetch('/api/crm/customers', { method: 'POST', headers: authHeaders(), body: JSON.stringify(data) })
        .then(function(r) {
          if (!r.ok) return r.json().then(function(e) { throw new Error(e.error || 'Server error (' + r.status + ')'); });
          return r.json();
        })
        .then(function(res) {
          if (res.success) {
            closeModal();
            toast('Customer saved successfully!' + (res.verified ? ' (Verified in database)' : ''), 'success');
            loadCustomers();
          } else {
            toast(res.error || 'Failed to save customer.', 'error');
          }
        })
        .catch(function(err) {
          toast('Save failed: ' + (err.message || 'Network error. Check your connection.'), 'error');
          console.error('[CRM] Customer save error:', err);
        });
    }, 'Add Customer');
  };

  window._crmEditCustomer = function(id) {
    fetch('/api/crm/customers/' + id, { headers: authHeadersOnly() })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var c = data.customer;
        showModal('Edit Customer', customerFormHTML(c), function() {
          var fd = getCustomerFormData();
          if (!fd.name) { toast('Name required', 'error'); return; }
          fetch('/api/crm/customers/' + id, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(fd) })
            .then(function(r) {
              if (!r.ok) return r.json().then(function(e) { throw new Error(e.error || 'Server error'); });
              return r.json();
            })
            .then(function(res) {
              if (res.success) {
                closeModal();
                toast('Customer updated successfully!', 'success');
                loadCustomers();
              } else {
                toast(res.error || 'Failed to update.', 'error');
              }
            })
            .catch(function(err) {
              toast('Update failed: ' + (err.message || 'Network error'), 'error');
              console.error('[CRM] Customer update error:', err);
            });
        }, 'Save Changes');
      })
      .catch(function(err) { toast('Failed to load customer details.', 'error'); });
  };

  window._crmViewCustomer = function(id) {
    fetch('/api/crm/customers/' + id, { headers: authHeadersOnly() })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var c = data.customer;
        var invs = data.invoices || [];
        var props = data.proposals || [];
        var jobs = data.jobs || [];
        var body = '<div class="space-y-4">' +
          '<div class="flex items-center gap-3 mb-2"><div class="w-12 h-12 bg-blue-500/15 rounded-full flex items-center justify-center"><i class="fas fa-user text-blue-400 text-lg"></i></div><div><h3 class="font-bold text-gray-100">' + c.name + '</h3><p class="text-xs text-gray-500">' + (c.company || '') + (c.email ? ' &middot; ' + c.email : '') + '</p></div></div>' +
          (c.phone ? '<p class="text-sm text-gray-400"><i class="fas fa-phone mr-2 text-gray-400"></i>' + c.phone + '</p>' : '') +
          (c.address ? '<p class="text-sm text-gray-400"><i class="fas fa-map-marker-alt mr-2 text-gray-400"></i>' + c.address + (c.city ? ', ' + c.city : '') + (c.province ? ', ' + c.province : '') + (c.postal_code ? ' ' + c.postal_code : '') + '</p>' : '') +
          (c.notes ? '<p class="text-sm text-gray-500 italic">' + c.notes + '</p>' : '');

        if (invs.length > 0) {
          body += '<div class="pt-3 border-t"><h4 class="text-xs font-bold text-gray-500 uppercase mb-2">Invoices (' + invs.length + ')</h4><div class="space-y-1">';
          for (var i = 0; i < Math.min(invs.length, 5); i++) {
            body += '<div class="flex items-center justify-between text-xs bg-[#0A0A0A] rounded-lg px-3 py-2"><span class="font-mono font-bold">' + invs[i].invoice_number + '</span><span>' + money(invs[i].total) + '</span>' + badge(invs[i].status) + '</div>';
          }
          body += '</div></div>';
        }
        if (props.length > 0) {
          body += '<div class="pt-3 border-t"><h4 class="text-xs font-bold text-gray-500 uppercase mb-2">Proposals (' + props.length + ')</h4><div class="space-y-1">';
          for (var j = 0; j < Math.min(props.length, 5); j++) {
            body += '<div class="flex items-center justify-between text-xs bg-[#0A0A0A] rounded-lg px-3 py-2"><span class="font-medium">' + props[j].title + '</span><span>' + money(props[j].total_amount) + '</span>' + badge(props[j].status) + '</div>';
          }
          body += '</div></div>';
        }
        body += '</div>';
        showModal(c.name, body);
      });
  };

  window._crmDeleteCustomer = async function(id) {
    if (!(await window.rmConfirm('Delete this customer?'))) return
    fetch('/api/crm/customers/' + id, { method: 'DELETE', headers: authHeadersOnly() })
      .then(function() { toast('Customer deleted'); loadCustomers(); })
      .catch(function(e) { toast('Failed to delete: ' + (e.message || 'Network error'), 'error'); });
  };

  // ============================================================
  // MODULE: INVOICES
  // ============================================================
  var invoicesData = [];
  function initInvoices() {
    root.innerHTML = '<div class="text-center py-8"><div class="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-brand-500 mx-auto mb-3"></div></div>';
    checkGmailStatus();
    loadInvoices();
  }

  function loadInvoices(statusFilter) {
    var url = '/api/crm/invoices';
    if (statusFilter) url += '?status=' + statusFilter;
    fetch(url, { headers: authHeadersOnly() })
      .then(function(r) { return r.json(); })
      .then(function(data) { invoicesData = data.invoices || []; renderInvoices(data); })
      .catch(function() { root.innerHTML = '<p class="text-red-500">Failed to load invoices.</p>'; });
  }

  function renderInvoices(data) {
    var invoices = data.invoices || [];
    var stats = data.stats || {};
    var html = '<div class="flex items-center justify-between mb-5 flex-wrap gap-3"><div><h2 class="text-lg font-bold" style="color:var(--text-primary)"><i class="fas fa-file-invoice-dollar text-emerald-500 mr-2"></i>Invoices</h2></div><button onclick="window._crmNewInvoice()" class="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-emerald-700"><i class="fas fa-plus mr-1"></i>New Invoice</button></div>';

    // Gmail connect banner
    if (!_gmailConnected) {
      html += '<div class="rounded-xl p-3 mb-4 flex items-center justify-between gap-3" style="background:var(--bg-elevated);border:1px solid var(--border-color)">' +
        '<div class="flex items-center gap-2"><i class="fas fa-envelope" style="color:var(--text-muted)"></i><span class="text-sm font-medium" style="color:var(--text-muted)">Connect Gmail to send invoices directly to customers.</span></div>' +
        '<button onclick="window._crmConnectGmail()" class="px-3 py-1.5 rounded-lg text-xs font-semibold shrink-0" style="background:var(--bg-card);border:1px solid var(--border-color);color:var(--text-primary)"><i class="fas fa-plug mr-1"></i>Connect Gmail</button>' +
        '</div>';
    }

    // Stats cards
    html += '<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">' +
      '<div class="rounded-xl border p-4 text-center" style="background:var(--bg-card);border-color:var(--border-color)"><p class="text-2xl font-black" style="color:var(--text-primary)">' + (stats.total || 0) + '</p><p class="text-[10px]" style="color:var(--text-muted)">Total</p></div>' +
      '<div class="rounded-xl border p-4 text-center" style="background:var(--bg-card);border-color:var(--border-color)"><p class="text-2xl font-black text-emerald-500">' + money(stats.total_paid) + '</p><p class="text-[10px]" style="color:var(--text-muted)">Collected</p></div>' +
      '<div class="rounded-xl border p-4 text-center" style="background:var(--bg-card);border-color:var(--border-color)"><p class="text-2xl font-black" style="color:var(--text-secondary)">' + money(stats.total_owing) + '</p><p class="text-[10px]" style="color:var(--text-muted)">Outstanding</p></div>' +
      '<div class="rounded-xl border p-4 text-center" style="background:var(--bg-card);border-color:var(--border-color)"><p class="text-2xl font-black text-red-500">' + money(stats.total_overdue) + '</p><p class="text-[10px]" style="color:var(--text-muted)">Overdue</p></div></div>';

    // Filter tabs
    html += '<div class="flex gap-1 mb-4 rounded-lg p-1 overflow-x-auto" style="background:var(--bg-elevated);border:1px solid var(--border-color)">';
    var filters = [['','All'],['owing','Owing'],['paid','Paid']];
    for (var f = 0; f < filters.length; f++) {
      var isActive = (!window._invFilter && !filters[f][0]) || window._invFilter === filters[f][0];
      html += '<button onclick="window._crmFilterInvoices(\'' + filters[f][0] + '\')" class="px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ' + (isActive ? 'bg-brand-600 text-white' : '') + '" style="' + (isActive ? '' : 'color:var(--text-muted)') + '">' + filters[f][1] + '</button>';
    }
    html += '</div>';

    if (invoices.length === 0) {
      html += '<div class="rounded-xl border p-12 text-center" style="background:var(--bg-card);border-color:var(--border-color)"><div class="w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-4"><i class="fas fa-file-invoice-dollar text-emerald-500 text-2xl"></i></div><h3 class="text-lg font-semibold mb-2" style="color:var(--text-primary)">No Invoices Yet</h3><p class="mb-4" style="color:var(--text-muted)">Create your first invoice to start tracking payments.</p><button onclick="window._crmNewInvoice()" class="bg-emerald-600 text-white px-6 py-2.5 rounded-xl font-semibold hover:bg-emerald-700"><i class="fas fa-plus mr-2"></i>Create Invoice</button></div>';
    } else {
      html += '<div class="rounded-xl border overflow-hidden overflow-x-auto" style="background:var(--bg-card);border-color:var(--border-color)"><table class="w-full text-sm"><thead style="background:var(--bg-elevated)"><tr><th class="px-4 py-3 text-left text-xs font-semibold" style="color:var(--text-muted)">Invoice #</th><th class="px-4 py-3 text-left text-xs font-semibold" style="color:var(--text-muted)">Customer</th><th class="px-4 py-3 text-left text-xs font-semibold hidden md:table-cell" style="color:var(--text-muted)">Date</th><th class="px-4 py-3 text-left text-xs font-semibold hidden md:table-cell" style="color:var(--text-muted)">Due</th><th class="px-4 py-3 text-center text-xs font-semibold" style="color:var(--text-muted)">Status</th><th class="px-4 py-3 text-right text-xs font-semibold" style="color:var(--text-muted)">Amount</th><th class="px-4 py-3"></th></tr></thead><tbody>';
      for (var i = 0; i < invoices.length; i++) {
        var inv = invoices[i];
        html += '<tr class="cursor-pointer" style="border-top:1px solid var(--border-color)" onmouseover="this.style.background=\'var(--bg-elevated)\'" onmouseout="this.style.background=\'\'" onclick="window._crmViewInvoice(' + inv.id + ')"><td class="px-4 py-3 font-mono text-xs font-bold" style="color:var(--text-primary)">' + inv.invoice_number + '</td><td class="px-4 py-3" style="color:var(--text-primary)">' + (inv.customer_name || 'N/A') + '</td><td class="px-4 py-3 text-xs hidden md:table-cell" style="color:var(--text-secondary)">' + fmtDate(inv.created_at) + '</td><td class="px-4 py-3 text-xs hidden md:table-cell" style="color:var(--text-secondary)">' + fmtDate(inv.due_date) + '</td><td class="px-4 py-3 text-center">' + badge(inv.status) + '</td><td class="px-4 py-3 text-right font-semibold" style="color:var(--text-primary)">' + money(inv.total) + '</td><td class="px-4 py-3 text-right" onclick="event.stopPropagation()"><div class="flex items-center gap-1 justify-end">';
        html += '<button onclick="window._crmViewInvoice(' + inv.id + ')" class="text-xs hover:underline font-medium" style="color:var(--text-primary)"><i class="fas fa-eye mr-0.5"></i>View</button>';
        if (inv.status === 'draft') html += '<button onclick="window._crmEditInvoice(' + inv.id + ')" class="text-xs hover:underline ml-2" style="color:var(--text-secondary)"><i class="fas fa-edit mr-0.5"></i>Edit</button>';
        if (inv.status === 'draft' || inv.status === 'sent') html += '<button onclick="window._crmSendInvoice(' + inv.id + ')" class="text-xs hover:underline ml-2 text-blue-500"><i class="fas fa-paper-plane mr-0.5"></i>Send</button>';
        if (inv.square_payment_link_url) {
          html += '<a href="' + inv.square_payment_link_url + '" target="_blank" class="text-xs px-2 py-0.5 rounded-full font-semibold ml-2" style="background:rgba(16,185,129,0.15);color:#10b981"><i class="fas fa-credit-card mr-0.5"></i>Pay Link</a>';
        } else if (inv.status !== 'paid' && inv.status !== 'cancelled') {
          html += '<button onclick="event.stopPropagation();window._crmGenPayLink(' + inv.id + ')" class="text-xs px-2 py-0.5 rounded-full font-semibold ml-2" style="background:rgba(16,185,129,0.15);color:#10b981"><i class="fas fa-credit-card mr-0.5"></i>+ Pay Link</button>';
        }
        if (inv.status !== 'paid' && inv.status !== 'cancelled') html += '<button onclick="window._crmMarkInvoice(' + inv.id + ',\'paid\')" class="text-xs hover:underline ml-2 text-emerald-500">Mark Paid</button>';
        html += '<button onclick="window._crmDeleteInvoice(' + inv.id + ')" class="ml-2" style="color:var(--text-muted)"><i class="fas fa-trash text-xs"></i></button>';
        html += '</div></td></tr>';
      }
      html += '</tbody></table></div>';
    }
    root.innerHTML = html;
  }

  window._invFilter = '';
  window._crmFilterInvoices = function(status) { window._invFilter = status; loadInvoices(status); };

  window._crmNewInvoice = function() {
    // First load customers for the dropdown
    fetch('/api/crm/customers', { headers: authHeadersOnly() })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var custs = data.customers || [];
        var body = '<div class="space-y-3">' +
          '<div><label class="block text-xs font-medium text-gray-400 mb-1">Customer *</label>' + customerSelectHTML(custs, '', 'invCustomer') + '</div>' +
          '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3"><div><label class="block text-xs font-medium text-gray-400 mb-1">Project Title</label><input type="text" id="invTitle" class="w-full px-2 py-2 border border-white/15 rounded-lg text-sm" placeholder="Roof Installation — 123 Main St"></div><div><label class="block text-xs font-medium text-gray-400 mb-1">Property Address</label><input type="text" id="invAddress" class="w-full px-2 py-2 border border-white/15 rounded-lg text-sm" placeholder="123 Main St, Calgary AB"></div></div>' +
          '<div id="invItems"><div class="invItemRow grid grid-cols-12 gap-2 items-end"><div class="col-span-6"><label class="block text-xs font-medium text-gray-400 mb-1">Description</label><input type="text" class="invDesc w-full px-2 py-2 border border-white/15 rounded-lg text-sm" placeholder="Roof installation"></div><div class="col-span-2"><label class="block text-xs font-medium text-gray-400 mb-1">Qty</label><input type="number" class="invQty w-full px-2 py-2 border border-white/15 rounded-lg text-sm" value="1"></div><div class="col-span-3"><label class="block text-xs font-medium text-gray-400 mb-1">Unit Price</label><input type="number" class="invPrice w-full px-2 py-2 border border-white/15 rounded-lg text-sm" step="0.01" placeholder="0.00"></div><div class="col-span-1"><button onclick="this.closest(\'.invItemRow\').remove()" class="text-red-400 hover:text-red-600 py-2"><i class="fas fa-times"></i></button></div></div></div>' +
          '<button onclick="window._crmAddInvItem()" class="text-brand-600 text-xs font-medium hover:underline"><i class="fas fa-plus mr-1"></i>Add Line Item</button>' +
          '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3"><div><label class="block text-xs font-medium text-gray-400 mb-1">Due Date</label><input type="date" id="invDue" class="w-full px-2 py-2 border border-white/15 rounded-lg text-sm"></div><div><label class="block text-xs font-medium text-gray-400 mb-1">Tax Rate (%)</label><input type="number" id="invTax" value="5" class="w-full px-2 py-2 border border-white/15 rounded-lg text-sm" step="0.1"></div></div>' +
          '<div><label class="block text-xs font-medium text-gray-400 mb-1">Notes</label><textarea id="invNotes" rows="2" class="w-full px-2 py-2 border border-white/15 rounded-lg text-sm" placeholder="Optional notes..."></textarea></div></div>';

        showModal('Create Invoice', body, function() {
          var custData = getCustomerFromSelector('invCustomer');
          if (!custData) { toast('Select or add a customer', 'error'); return; }
          var rows = document.querySelectorAll('.invItemRow');
          var items = [];
          rows.forEach(function(r) {
            var desc = r.querySelector('.invDesc').value.trim();
            var qty = parseFloat(r.querySelector('.invQty').value) || 1;
            var price = parseFloat(r.querySelector('.invPrice').value) || 0;
            if (desc && price > 0) items.push({ description: desc, quantity: qty, unit_price: price });
          });
          if (items.length === 0) { toast('Add at least one line item', 'error'); return; }
          var payload = Object.assign({}, custData, {
            title: document.getElementById('invTitle').value.trim() || null,
            property_address: document.getElementById('invAddress').value.trim() || null,
            items: items,
            due_date: document.getElementById('invDue').value || null,
            tax_rate: parseFloat(document.getElementById('invTax').value) || 5,
            notes: document.getElementById('invNotes').value.trim()
          });
          fetch('/api/crm/invoices', { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) })
            .then(function(r) { return r.json(); })
            .then(function(res) { if (res.success) { closeModal(); toast('Invoice created!'); loadInvoices(); } else { toast(res.error || 'Failed', 'error'); } })
            .catch(function(e) { toast('Failed to create invoice: ' + (e.message || 'Network error'), 'error'); });
        }, 'Create Invoice');
      });
  };

  window._crmAddInvItem = function() {
    var container = document.getElementById('invItems');
    if (!container) return;
    var row = document.createElement('div');
    row.className = 'invItemRow grid grid-cols-12 gap-2 items-end mt-2';
    row.innerHTML = '<div class="col-span-6"><input type="text" class="invDesc w-full px-2 py-2 border border-white/15 rounded-lg text-sm" placeholder="Description" style="color:#fff;background:#0A0A0A"></div><div class="col-span-2"><input type="number" class="invQty w-full px-2 py-2 border border-white/15 rounded-lg text-sm" value="1" style="color:#fff;background:#0A0A0A"></div><div class="col-span-3"><input type="number" class="invPrice w-full px-2 py-2 border border-white/15 rounded-lg text-sm" step="0.01" placeholder="0.00" style="color:#fff;background:#0A0A0A"></div><div class="col-span-1"><button onclick="this.closest(\'.invItemRow\').remove()" class="text-red-400 hover:text-red-600 py-2"><i class="fas fa-times"></i></button></div>';
    container.appendChild(row);
  };

  window._crmMarkInvoice = function(id, status) {
    fetch('/api/crm/invoices/' + id, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ status: status }) })
      .then(function(r) { return r.json(); })
      .then(function(res) {
        if (res.success) { toast('Invoice marked as ' + status); loadInvoices(window._invFilter); }
        else { toast(res.error || 'Failed to update invoice', 'error'); }
      })
      .catch(function(e) { toast('Network error: ' + (e.message || 'Unknown'), 'error'); });
  };

  window._crmDeleteInvoice = async function(id) {
    if (!(await window.rmConfirm('Delete this invoice?'))) return
    fetch('/api/crm/invoices/' + id, { method: 'DELETE', headers: authHeadersOnly() })
      .then(function() { toast('Invoice deleted'); loadInvoices(window._invFilter); })
      .catch(function(e) { toast('Failed to delete: ' + (e.message || 'Network error'), 'error'); });
  };

  // ---- View Invoice Detail ----
  window._crmViewInvoice = function(id) {
    fetch('/api/crm/invoices/' + id, { headers: authHeadersOnly() })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var inv = data.invoice;
        var items = data.items || [];
        if (!inv) { toast('Invoice not found', 'error'); return; }

        var body = '<div class="space-y-4">';
        // Header with invoice number and status
        body += '<div class="flex items-center justify-between">';
        body += '<div><span style="font-family:monospace;font-size:1.125rem;font-weight:700;color:#ffffff">' + inv.invoice_number + '</span></div>';
        body += '<div class="flex items-center gap-2">' + badge(inv.status);
        if (inv.status === 'draft') body += '<button onclick="closeModal();window._crmEditInvoice(' + id + ')" class="text-xs px-3 py-1 rounded-lg" style="background:var(--bg-elevated);border:1px solid var(--border-color);color:var(--text-secondary)"><i class="fas fa-edit mr-1"></i>Edit</button>';
        body += '</div></div>';

        // Customer info
        body += '<div class="rounded-xl p-4" style="background:var(--bg-elevated);border:1px solid var(--border-color)">';
        body += '<h4 class="text-xs font-semibold uppercase mb-2" style="color:var(--text-muted)"><i class="fas fa-user mr-1"></i>Bill To</h4>';
        body += '<p class="font-semibold" style="color:var(--text-primary)">' + (inv.customer_name || 'N/A') + '</p>';
        if (inv.customer_email) body += '<p class="text-sm" style="color:var(--text-secondary)"><i class="fas fa-envelope mr-1"></i>' + inv.customer_email + '</p>';
        if (inv.customer_phone) body += '<p class="text-sm" style="color:var(--text-secondary)"><i class="fas fa-phone mr-1"></i>' + inv.customer_phone + '</p>';
        var addr = [inv.customer_address, inv.customer_city, inv.customer_province, inv.customer_postal].filter(Boolean).join(', ');
        if (addr) body += '<p class="text-sm mt-1" style="color:var(--text-secondary)"><i class="fas fa-map-marker-alt mr-1"></i>' + addr + '</p>';
        body += '</div>';

        // Dates row
        body += '<div class="grid grid-cols-3 gap-3">';
        body += '<div class="rounded-xl p-3 text-center" style="background:var(--bg-elevated);border:1px solid var(--border-color)"><p class="text-xs mb-1" style="color:var(--text-muted)">Created</p><p class="text-sm font-semibold" style="color:var(--text-primary)">' + fmtDate(inv.created_at) + '</p></div>';
        body += '<div class="rounded-xl p-3 text-center" style="background:var(--bg-elevated);border:1px solid var(--border-color)"><p class="text-xs mb-1" style="color:var(--text-muted)">Due Date</p><p class="text-sm font-semibold" style="color:var(--text-primary)">' + fmtDate(inv.due_date) + '</p></div>';
        body += '<div class="rounded-xl p-3 text-center" style="background:var(--bg-elevated);border:1px solid var(--border-color)"><p class="text-xs mb-1" style="color:var(--text-muted)">Paid</p><p class="text-sm font-semibold" style="color:' + (inv.paid_date ? '#22c55e' : 'var(--text-muted)') + '">' + (inv.paid_date ? fmtDate(inv.paid_date) : '—') + '</p></div>';
        body += '</div>';

        // Line items table
        if (items.length > 0) {
          body += '<div class="rounded-xl overflow-hidden" style="border:1px solid var(--border-color)">';
          body += '<table class="w-full text-sm"><thead style="background:var(--bg-elevated)"><tr><th class="px-4 py-2.5 text-left text-xs font-semibold" style="color:var(--text-muted)">Description</th><th class="px-4 py-2.5 text-center text-xs font-semibold w-16" style="color:var(--text-muted)">Qty</th><th class="px-4 py-2.5 text-right text-xs font-semibold w-24" style="color:var(--text-muted)">Price</th><th class="px-4 py-2.5 text-right text-xs font-semibold w-24" style="color:var(--text-muted)">Amount</th></tr></thead><tbody>';
          for (var i = 0; i < items.length; i++) {
            body += '<tr style="border-top:1px solid var(--border-color)"><td class="px-4 py-2.5" style="color:var(--text-secondary)">' + items[i].description + '</td><td class="px-4 py-2.5 text-center" style="color:var(--text-muted)">' + items[i].quantity + '</td><td class="px-4 py-2.5 text-right" style="color:var(--text-muted)">' + money(items[i].unit_price) + '</td><td class="px-4 py-2.5 text-right font-medium" style="color:var(--text-primary)">' + money(items[i].amount) + '</td></tr>';
          }
          body += '</tbody></table></div>';
        }

        // Totals
        body += '<div class="rounded-xl p-4" style="background:var(--bg-elevated);border:1px solid var(--border-color)">';
        body += '<div class="flex justify-between text-sm mb-1" style="color:var(--text-muted)"><span>Subtotal</span><span>' + money(inv.subtotal) + '</span></div>';
        if (inv.tax_amount) body += '<div class="flex justify-between text-sm mb-1" style="color:var(--text-muted)"><span>Tax (' + (inv.tax_rate || 5) + '%)</span><span>' + money(inv.tax_amount) + '</span></div>';
        if (inv.discount_amount) body += '<div class="flex justify-between text-sm mb-1" style="color:var(--text-muted)"><span>Discount</span><span class="text-emerald-500">-' + money(inv.discount_amount) + '</span></div>';
        body += '<div class="flex justify-between text-lg font-bold pt-2 mt-2" style="color:var(--text-primary);border-top:1px solid var(--border-color)"><span>Total</span><span>' + money(inv.total) + ' CAD</span></div>';
        body += '</div>';

        // Notes & Terms
        if (inv.notes) body += '<div class="rounded-xl p-3" style="background:var(--bg-elevated);border:1px solid var(--border-color)"><h4 class="text-xs font-semibold uppercase mb-1" style="color:var(--text-muted)"><i class="fas fa-sticky-note mr-1"></i>Notes</h4><p class="text-sm" style="color:var(--text-secondary)">' + inv.notes + '</p></div>';
        if (inv.terms) body += '<div class="rounded-xl p-3" style="background:var(--bg-elevated);border:1px solid var(--border-color)"><h4 class="text-xs font-semibold uppercase mb-1" style="color:var(--text-muted)"><i class="fas fa-file-contract mr-1"></i>Terms</h4><p class="text-sm" style="color:var(--text-secondary)">' + inv.terms + '</p></div>';

        // Title + address (if present)
        if (inv.title) body += '<div class="rounded-xl p-3" style="background:var(--bg-elevated);border:1px solid var(--border-color)"><p class="text-xs font-semibold uppercase mb-1" style="color:var(--text-muted)"><i class="fas fa-tag mr-1"></i>Project</p><p class="text-sm font-semibold" style="color:var(--text-primary)">' + inv.title + '</p>' + (inv.property_address ? '<p class="text-xs mt-0.5" style="color:var(--text-muted)"><i class="fas fa-map-marker-alt mr-1"></i>' + inv.property_address + '</p>' : '') + '</div>';

        // Share link
        if (inv.share_token) body += '<div class="rounded-xl p-3 flex items-center justify-between gap-2" style="background:var(--bg-elevated);border:1px solid var(--border-color)"><div class="min-w-0"><p class="text-xs font-semibold mb-0.5" style="color:var(--text-muted)">Customer Link</p><p class="text-xs truncate font-mono" style="color:var(--text-secondary)">/invoice/view/' + inv.share_token + '</p></div><button onclick="navigator.clipboard.writeText(window.location.origin+\'/invoice/view/' + inv.share_token + '\').then(function(){toast(\'Link copied!\');})" class="shrink-0 text-xs px-2 py-1 rounded-lg" style="background:var(--bg-card);border:1px solid var(--border-color);color:var(--text-primary)"><i class="fas fa-copy mr-1"></i>Copy</button></div>';

        // Square payment link
        if (inv.square_payment_link_url) body += '<div class="rounded-xl p-3 flex items-center justify-between gap-2" style="background:var(--bg-elevated);border:1px solid var(--border-color)"><div><p class="text-xs font-semibold mb-0.5" style="color:var(--text-muted)"><i class="fas fa-credit-card mr-1"></i>Square Payment Link</p><p class="text-xs" style="color:var(--text-muted)">Ready to pay</p></div><div class="flex gap-2 shrink-0"><a href="' + inv.square_payment_link_url + '" target="_blank" class="text-xs bg-green-600 text-white px-2 py-1 rounded-lg">Open</a><button onclick="navigator.clipboard.writeText(\'' + inv.square_payment_link_url + '\').then(function(){toast(\'Link copied!\');})" class="text-xs px-2 py-1 rounded-lg" style="background:var(--bg-card);border:1px solid var(--border-color);color:var(--text-primary)">Copy</button></div></div>';

        // Action buttons
        body += '<div class="flex gap-2 pt-2 flex-wrap">';
        if (inv.share_token) {
          body += '<a href="/proposal/view/' + inv.share_token + '?print=1" target="_blank" class="flex-1 py-2.5 rounded-xl text-sm font-semibold text-center min-w-0" style="background:var(--bg-elevated);border:1px solid var(--border-color);color:var(--text-primary)"><i class="fas fa-file-pdf mr-1"></i>Download PDF</a>';
        }
        if (inv.status === 'draft') body += '<button onclick="closeModal();window._crmEditInvoice(' + id + ')" class="flex-1 py-2.5 rounded-xl text-sm font-semibold min-w-0" style="background:var(--bg-elevated);border:1px solid var(--border-color);color:var(--text-secondary)"><i class="fas fa-edit mr-1"></i>Edit</button>';
        if (inv.status !== 'cancelled') body += '<button onclick="closeModal();window._crmSendInvoice(' + id + ')" class="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 min-w-0"><i class="fas fa-paper-plane mr-1"></i>Send via Gmail</button>';
        if (inv.status !== 'paid' && inv.status !== 'cancelled') body += '<button onclick="closeModal();window._crmGenPayLink(' + id + ')" class="flex-1 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-700 min-w-0"><i class="fas fa-credit-card mr-1"></i>Square Pay Link</button>';
        if (inv.status !== 'paid' && inv.status !== 'cancelled') body += '<button onclick="closeModal();window._crmMarkInvoice(' + id + ',\'paid\')" class="flex-1 py-2.5 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 min-w-0"><i class="fas fa-check mr-1"></i>Mark Paid</button>';
        body += '</div>';
        body += '</div>';

        showModal('Invoice Details', body);
      })
      .catch(function(e) { toast('Failed to load invoice: ' + (e.message || 'Network error'), 'error'); });
  };

  // ---- Edit Invoice ----
  window._crmEditInvoice = function(id) {
    Promise.all([
      fetch('/api/crm/invoices/' + id, { headers: authHeadersOnly() }).then(function(r) { return r.json(); }),
      fetch('/api/crm/customers', { headers: authHeadersOnly() }).then(function(r) { return r.json(); })
    ]).then(function(results) {
      var invData = results[0];
      var custData = results[1];
      var inv = invData.invoice;
      var items = invData.items || [];
      var custs = custData.customers || [];
      if (!inv) { toast('Invoice not found', 'error'); return; }

      var body = '<div class="space-y-3">' +
        '<div><label class="block text-xs font-medium text-gray-400 mb-1">Customer *</label>' + customerSelectHTML(custs, inv.crm_customer_id, 'editInvCustomer') + '</div>' +
        '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3"><div><label class="block text-xs font-medium text-gray-400 mb-1">Project Title</label><input type="text" id="editInvTitle" class="w-full px-2 py-2 border border-white/15 rounded-lg text-sm" value="' + (inv.title || '') + '" placeholder="Roof Installation"></div><div><label class="block text-xs font-medium text-gray-400 mb-1">Property Address</label><input type="text" id="editInvAddress" class="w-full px-2 py-2 border border-white/15 rounded-lg text-sm" value="' + (inv.property_address || '') + '" placeholder="123 Main St"></div></div>' +
        '<div id="editInvItems">';
      // Populate existing items
      if (items.length > 0) {
        for (var i = 0; i < items.length; i++) {
          body += '<div class="invItemRow grid grid-cols-12 gap-2 items-end' + (i > 0 ? ' mt-2' : '') + '"><div class="col-span-6">' + (i === 0 ? '<label class="block text-xs font-medium text-gray-400 mb-1">Description</label>' : '') + '<input type="text" class="invDesc w-full px-2 py-2 border border-white/15 rounded-lg text-sm" value="' + (items[i].description || '').replace(/"/g, '&quot;') + '"></div><div class="col-span-2">' + (i === 0 ? '<label class="block text-xs font-medium text-gray-400 mb-1">Qty</label>' : '') + '<input type="number" class="invQty w-full px-2 py-2 border border-white/15 rounded-lg text-sm" value="' + (items[i].quantity || 1) + '"></div><div class="col-span-3">' + (i === 0 ? '<label class="block text-xs font-medium text-gray-400 mb-1">Unit Price</label>' : '') + '<input type="number" class="invPrice w-full px-2 py-2 border border-white/15 rounded-lg text-sm" step="0.01" value="' + (items[i].unit_price || 0) + '"></div><div class="col-span-1"><button onclick="this.closest(\'.invItemRow\').remove()" class="text-red-400 hover:text-red-600 py-2"><i class="fas fa-times"></i></button></div></div>';
        }
      } else {
        body += '<div class="invItemRow grid grid-cols-12 gap-2 items-end"><div class="col-span-6"><label class="block text-xs font-medium text-gray-400 mb-1">Description</label><input type="text" class="invDesc w-full px-2 py-2 border border-white/15 rounded-lg text-sm" placeholder="Roof installation"></div><div class="col-span-2"><label class="block text-xs font-medium text-gray-400 mb-1">Qty</label><input type="number" class="invQty w-full px-2 py-2 border border-white/15 rounded-lg text-sm" value="1"></div><div class="col-span-3"><label class="block text-xs font-medium text-gray-400 mb-1">Unit Price</label><input type="number" class="invPrice w-full px-2 py-2 border border-white/15 rounded-lg text-sm" step="0.01" placeholder="0.00"></div><div class="col-span-1"><button onclick="this.closest(\'.invItemRow\').remove()" class="text-red-400 hover:text-red-600 py-2"><i class="fas fa-times"></i></button></div></div>';
      }
      body += '</div>' +
        '<button onclick="window._crmAddEditInvItem()" class="text-brand-600 text-xs font-medium hover:underline"><i class="fas fa-plus mr-1"></i>Add Line Item</button>' +
        '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3"><div><label class="block text-xs font-medium text-gray-400 mb-1">Due Date</label><input type="date" id="editInvDue" class="w-full px-2 py-2 border border-white/15 rounded-lg text-sm" value="' + (inv.due_date || '') + '"></div><div><label class="block text-xs font-medium text-gray-400 mb-1">Tax Rate (%)</label><input type="number" id="editInvTax" value="' + (inv.tax_rate || 5) + '" class="w-full px-2 py-2 border border-white/15 rounded-lg text-sm" step="0.1"></div></div>' +
        '<div><label class="block text-xs font-medium text-gray-400 mb-1">Notes</label><textarea id="editInvNotes" rows="2" class="w-full px-2 py-2 border border-white/15 rounded-lg text-sm">' + (inv.notes || '') + '</textarea></div>' +
        '<div><label class="block text-xs font-medium text-gray-400 mb-1">Terms</label><textarea id="editInvTerms" rows="2" class="w-full px-2 py-2 border border-white/15 rounded-lg text-sm">' + (inv.terms || '') + '</textarea></div></div>';

      showModal('Edit Invoice — ' + inv.invoice_number, body, function() {
        var custInfo = getCustomerFromSelector('editInvCustomer');
        if (!custInfo) { toast('Select or add a customer', 'error'); return; }
        var rows = document.querySelectorAll('#editInvItems .invItemRow');
        var updItems = [];
        rows.forEach(function(r) {
          var desc = r.querySelector('.invDesc').value.trim();
          var qty = parseFloat(r.querySelector('.invQty').value) || 1;
          var price = parseFloat(r.querySelector('.invPrice').value) || 0;
          if (desc && price > 0) updItems.push({ description: desc, quantity: qty, unit_price: price });
        });
        if (updItems.length === 0) { toast('Add at least one line item', 'error'); return; }
        var payload = Object.assign({}, custInfo, {
          title: document.getElementById('editInvTitle').value.trim() || null,
          property_address: document.getElementById('editInvAddress').value.trim() || null,
          items: updItems,
          due_date: document.getElementById('editInvDue').value || null,
          tax_rate: parseFloat(document.getElementById('editInvTax').value) || 5,
          notes: document.getElementById('editInvNotes').value.trim(),
          terms: document.getElementById('editInvTerms').value.trim()
        });
        fetch('/api/crm/invoices/' + id, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(payload) })
          .then(function(r) { return r.json(); })
          .then(function(res) { if (res.success) { closeModal(); toast('Invoice updated!'); loadInvoices(window._invFilter); } else { toast(res.error || 'Failed', 'error'); } })
          .catch(function(e) { toast('Failed to update: ' + (e.message || 'Network error'), 'error'); });
      }, 'Save Changes');
    }).catch(function(e) { toast('Failed to load invoice: ' + (e.message || 'Network error'), 'error'); });
  };

  window._crmAddEditInvItem = function() {
    var container = document.getElementById('editInvItems');
    if (!container) return;
    var row = document.createElement('div');
    row.className = 'invItemRow grid grid-cols-12 gap-2 items-end mt-2';
    row.innerHTML = '<div class="col-span-6"><input type="text" class="invDesc w-full px-2 py-2 border border-white/15 rounded-lg text-sm" placeholder="Description"></div><div class="col-span-2"><input type="number" class="invQty w-full px-2 py-2 border border-white/15 rounded-lg text-sm" value="1"></div><div class="col-span-3"><input type="number" class="invPrice w-full px-2 py-2 border border-white/15 rounded-lg text-sm" step="0.01" placeholder="0.00"></div><div class="col-span-1"><button onclick="this.closest(\'.invItemRow\').remove()" class="text-red-400 hover:text-red-600 py-2"><i class="fas fa-times"></i></button></div>';
    container.appendChild(row);
  };

  // Send invoice via Gmail
  window._crmSendInvoice = function(id) {
    var btn = event && event.target;
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Sending...'; }
    fetch('/api/crm/invoices/' + id + '/send', { method: 'POST', headers: authHeaders() })
      .then(function(r) { return r.json(); })
      .then(function(res) {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane mr-0.5"></i>Send'; }
        if (res.email_sent) {
          toast('Invoice sent to ' + res.sent_to + '!', 'success');
        } else if (res.success && res.email_error) {
          toast('Marked sent, but email failed: ' + res.email_error, 'warning');
        } else {
          toast(res.error || 'Send failed', 'error');
        }
        loadInvoices(window._invFilter);
      })
      .catch(function(e) {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane mr-0.5"></i>Send'; }
        toast('Network error: ' + (e.message || 'Unknown'), 'error');
      });
  };

  // Generate Square payment link for invoice
  window._crmGenPayLink = async function(id) {
    if (!(await window.rmConfirm('Generate a Square payment link for this invoice? The link will be included in future emails.'))) return
    toast('Generating payment link...', 'info');
    fetch('/api/crm/invoices/' + id + '/payment-link', { method: 'POST', headers: authHeaders() })
      .then(function(r) { return r.json(); })
      .then(function(res) {
        if (res.success && res.checkout_url) {
          toast('Square payment link created!', 'success');
          navigator.clipboard.writeText(res.checkout_url).catch(function(){});
          loadInvoices(window._invFilter);
        } else {
          toast(res.error || 'Failed to generate payment link', 'error');
        }
      })
      .catch(function(e) { toast('Network error: ' + (e.message || 'Unknown'), 'error'); });
  };

  // Generate Square payment link for proposal
  window._crmGenProposalPayLink = async function(id) {
    if (!(await window.rmConfirm('Generate a Square payment link for this proposal? The customer will be able to pay online.'))) return
    toast('Generating payment link...', 'info');
    fetch('/api/crm/proposals/' + id + '/payment-link', { method: 'POST', headers: authHeaders() })
      .then(function(r) { return r.json(); })
      .then(function(res) {
        if (res.success && res.checkout_url) {
          toast('Square payment link created!', 'success');
          navigator.clipboard.writeText(res.checkout_url).catch(function(){});
          loadProposals(window._propFilter);
        } else {
          toast(res.error || 'Failed to generate payment link', 'error');
        }
      })
      .catch(function(e) { toast('Network error: ' + (e.message || 'Unknown'), 'error'); });
  };

  // Connect Gmail — open blank popup immediately (user click context), then redirect to auth URL
  window._crmConnectGmail = function() {
    var w = window.open('about:blank', 'gmailOAuth', 'width=600,height=700');
    fetch('/api/crm/gmail/connect', { headers: authHeadersOnly() })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.auth_url && w) {
          w.location.href = data.auth_url;
        } else if (data.auth_url) {
          window.open(data.auth_url, 'gmailOAuth', 'width=600,height=700');
        } else {
          if (w) w.close();
          toast(data.error || 'Gmail not configured', 'error');
        }
      })
      .catch(function() { if (w) w.close(); toast('Failed to start Gmail connection', 'error'); });
    var timer = setInterval(function() {
      if (w && w.closed) {
        clearInterval(timer);
        checkGmailStatus();
        setTimeout(function() { loadInvoices(window._invFilter); }, 800);
      }
    }, 800);
  };

  // ============================================================
  // MODULE: PROPOSALS
  // ============================================================
  // MODULE: PROPOSALS — Enhanced with line items, Gmail, tracking
  // ============================================================
  function initProposals() {
    root.innerHTML = '<div class="text-center py-8"><div class="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-brand-500 mx-auto mb-3"></div></div>';
    checkGmailStatus();
    loadProposals();
    // Check for material calculator data passed via localStorage
    var mcData = localStorage.getItem('mc_proposal_materials');
    if (mcData) {
      localStorage.removeItem('mc_proposal_materials');
      try { window._mcProposalData = JSON.parse(mcData); } catch(e) { window._mcProposalData = null; }
    }
  }

  var _gmailConnected = false;
  var _gmailEmail = '';

  function checkGmailStatus() {
    fetch('/api/crm/gmail/status', { headers: authHeadersOnly() })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        _gmailConnected = !!data.connected;
        _gmailEmail = data.email || '';
      }).catch(function() {});
  }

  // Listen for Gmail OAuth popup completion
  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'gmail_connected') {
      _gmailConnected = true;
      _gmailEmail = e.data.email || '';
      toast('Gmail connected: ' + _gmailEmail);
      loadProposals(window._propFilter);
    }
  });

  function loadProposals(statusFilter) {
    var url = '/api/crm/proposals';
    if (statusFilter) url += '?status=' + statusFilter;
    fetch(url, { headers: authHeadersOnly() })
      .then(function(r) { return r.json(); })
      .then(function(data) { renderProposals(data); })
      .catch(function() { root.innerHTML = '<p class="text-red-500">Failed to load proposals.</p>'; });
  }

  function renderProposals(data) {
    var proposals = data.proposals || [];
    var stats = data.stats || {};

    // Header with Gmail indicator
    var html = '<div class="flex items-center justify-between mb-5 flex-wrap gap-3">';
    html += '<div><h2 class="text-lg font-bold text-gray-100"><i class="fas fa-file-signature text-gray-400 mr-2"></i>Proposals & Estimates</h2></div>';
    html += '<div class="flex items-center gap-2">';
    // Gmail status indicator
    html += '<button onclick="window._crmGmailSettings()" class="px-3 py-2 rounded-lg text-xs font-medium border transition-colors ' + (_gmailConnected ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/15' : 'bg-[#0A0A0A] border-white/10 text-gray-400 hover:bg-[#111111]/10') + '">';
    html += '<i class="' + (_gmailConnected ? 'fas fa-check-circle text-green-500' : 'fab fa-google text-gray-400') + ' mr-1.5"></i>';
    html += _gmailConnected ? 'Gmail Connected' : 'Connect Gmail';
    html += '</button>';
    html += '<button onclick="window._crmNewProposal()" class="bg-white/10 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-white/10"><i class="fas fa-plus mr-1"></i>New Proposal</button>';
    html += '</div></div>';

    // Stats
    html += '<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">' +
      '<div class="bg-[#111111] rounded-xl border p-4 text-center"><p class="text-2xl font-black text-gray-100">' + (stats.total || 0) + '</p><p class="text-[10px] text-gray-500">Total</p></div>' +
      '<div class="bg-[#111111] rounded-xl border p-4 text-center"><p class="text-2xl font-black text-gray-400">' + (stats.open_count || 0) + '</p><p class="text-[10px] text-gray-500">Open</p></div>' +
      '<div class="bg-[#111111] rounded-xl border p-4 text-center"><p class="text-2xl font-black text-emerald-400">' + money(stats.sold_value) + '</p><p class="text-[10px] text-gray-500">Sold Value</p></div>' +
      '<div class="bg-[#111111] rounded-xl border p-4 text-center"><p class="text-2xl font-black text-blue-600">' + money(stats.open_value) + '</p><p class="text-[10px] text-gray-500">Open Value</p></div></div>';

    // Filter
    html += '<div class="flex gap-1 mb-4 bg-[#111111] rounded-lg border p-1 overflow-x-auto">';
    var filters = [['','All'],['open','Open'],['sold','Sold']];
    for (var f = 0; f < filters.length; f++) {
      html += '<button onclick="window._crmFilterProposals(\'' + filters[f][0] + '\')" class="px-4 py-1.5 rounded-lg text-xs font-medium transition-colors hover:bg-[#111111]/10 ' + (((!window._propFilter && !filters[f][0]) || window._propFilter === filters[f][0]) ? 'bg-brand-600 text-white' : 'text-gray-400') + '">' + filters[f][1] + '</button>';
    }
    html += '</div>';

    if (proposals.length === 0) {
      html += '<div class="bg-[#111111] rounded-xl border p-12 text-center"><div class="w-16 h-16 bg-white/10 rounded-full flex items-center justify-center mx-auto mb-4"><i class="fas fa-file-signature text-gray-400 text-2xl"></i></div><h3 class="text-lg font-semibold text-gray-300 mb-2">No Proposals Yet</h3><p class="text-gray-500 mb-4">Create your first roof estimate or proposal.</p><button onclick="window._crmNewProposal()" class="bg-white/10 text-white px-6 py-2.5 rounded-xl font-semibold hover:bg-white/10"><i class="fas fa-plus mr-2"></i>Create Proposal</button></div>';
    } else {
      html += '<div class="space-y-3">';
      for (var i = 0; i < proposals.length; i++) {
        var p = proposals[i];
        html += '<div class="bg-[#111111] rounded-xl border p-4 hover:shadow-md transition-shadow">';
        html += '<div class="flex items-start justify-between">';
        html += '<div class="min-w-0">';
        html += '<div class="flex items-center gap-2 mb-1 flex-wrap">';
        html += '<span class="font-mono text-xs font-bold text-gray-200">' + p.proposal_number + '</span>';
        html += badge(p.status);
        if (p.view_count > 0) {
          html += '<button onclick="window._crmViewTracking(' + p.id + ')" class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/15/15 text-blue-400 hover:bg-blue-500/15 cursor-pointer"><i class="fas fa-eye mr-1"></i>' + p.view_count + ' view' + (p.view_count !== 1 ? 's' : '') + '</button>';
        }
        if (p.customer_email) html += '<span class="text-[10px] text-gray-400"><i class="fas fa-envelope mr-0.5"></i>' + p.customer_email + '</span>';
        html += '</div>';
        html += '<p class="text-gray-100 font-medium text-sm">' + p.title + '</p>';
        html += '<p class="text-xs text-gray-300 mt-1"><i class="fas fa-user mr-1"></i>' + (p.customer_name || 'N/A') + (p.property_address ? ' &middot; <i class="fas fa-map-marker-alt mr-1"></i>' + p.property_address : '') + '</p>';
        html += '</div>';
        html += '<div class="flex flex-col items-end gap-1 flex-shrink-0 ml-4">';
        html += '<span class="text-lg font-black text-white">' + money(p.total_amount) + '</span>';
        html += '<div class="flex items-center gap-1.5 flex-wrap justify-end">';
        html += '<button onclick="window._crmViewProposal(' + p.id + ')" class="text-xs text-brand-600 hover:underline font-medium"><i class="fas fa-eye mr-0.5"></i>View</button>';
        html += '<button onclick="window._crmLinkReport(' + p.id + ')" class="text-xs text-purple-400 hover:underline" title="' + (p.source_report_id ? 'Report linked ✓' : 'Link roof report') + '"><i class="fas fa-' + (p.source_report_id ? 'link text-emerald-400' : 'file-medical') + ' mr-0.5"></i>' + (p.source_report_id ? '' : 'Link Report') + '</button>';
        if (p.status === 'draft') {
          html += '<button onclick="window._crmEditProposal(' + p.id + ')" class="text-xs text-gray-500 hover:text-gray-300"><i class="fas fa-edit"></i></button>';
          html += '<button onclick="window._crmSendProposal(' + p.id + ')" class="text-xs text-blue-600 hover:underline font-medium"><i class="fas fa-paper-plane mr-0.5"></i>Send</button>';
        }
        if (p.status !== 'draft' && p.status !== 'accepted' && p.status !== 'declined') {
          html += '<button onclick="window._crmMarkProposal(' + p.id + ',\'draft\')" class="text-xs text-gray-400 hover:text-gray-200" title="Revert to draft"><i class="fas fa-rotate-left mr-0.5"></i>Draft</button>';
        }
        if (p.status === 'sent' || p.status === 'viewed') {
          html += '<button onclick="window._crmCopyProposalLink(' + p.id + ')" class="text-xs text-blue-600 hover:underline"><i class="fas fa-link mr-0.5"></i>Link</button>';
          html += '<button onclick="window._crmSendProposal(' + p.id + ')" class="text-xs text-blue-600 hover:underline"><i class="fas fa-redo mr-0.5"></i>Resend</button>';
        }
        if (p.payment_link) {
          html += '<a href="' + p.payment_link + '" target="_blank" class="text-xs bg-emerald-500/15 text-emerald-400 px-2 py-0.5 rounded-full font-semibold hover:bg-green-200"><i class="fas fa-credit-card mr-0.5"></i>Pay Link</a>';
        } else if (p.status !== 'accepted' && p.status !== 'declined') {
          html += '<button onclick="event.stopPropagation();window._crmGenProposalPayLink(' + p.id + ')" class="text-xs bg-emerald-500/15 text-emerald-400 px-2 py-0.5 rounded-full font-semibold hover:bg-emerald-200"><i class="fas fa-credit-card mr-0.5"></i>+ Pay Link</button>';
        }
        if (p.status !== 'accepted' && p.status !== 'declined') html += '<button onclick="window._crmMarkProposal(' + p.id + ',\'accepted\')" class="text-xs text-emerald-400 hover:underline">Won</button>';
        html += '<button onclick="window._crmDeleteProposal(' + p.id + ')" class="text-gray-400 hover:text-red-500"><i class="fas fa-trash text-xs"></i></button>';
        html += '</div></div></div></div>';
      }
      html += '</div>';
    }
    root.innerHTML = html;
    // Auto-open New Proposal modal if material calculator data is pending
    if (window._mcProposalData) {
      setTimeout(function() { window._crmNewProposal(); }, 300);
    }
  }

  window._propFilter = '';
  window._crmFilterProposals = function(s) { window._propFilter = s; loadProposals(s); };

  // ---- Gmail Settings Modal ----
  window._crmGmailSettings = function() {
    var body = '<div class="space-y-4">';
    if (_gmailConnected) {
      body += '<div class="bg-green-50 border border-green-200 rounded-xl p-4 text-center">' +
        '<div class="w-12 h-12 bg-emerald-500/15 rounded-full flex items-center justify-center mx-auto mb-2"><i class="fas fa-check-circle text-emerald-400 text-xl"></i></div>' +
        '<p class="font-semibold text-green-800">Gmail Connected</p>' +
        '<p class="text-sm text-emerald-400">' + _gmailEmail + '</p></div>';
      body += '<p class="text-sm text-gray-400">Proposals will be emailed from your connected Gmail account when you click "Send".</p>';
      body += '<button onclick="window._crmDisconnectGmail()" class="w-full py-2 border border-red-200 text-red-600 rounded-lg text-sm hover:bg-red-50">Disconnect Gmail</button>';
    } else {
      body += '<div class="bg-[#0A0A0A] border border-white/10 rounded-xl p-4 text-center">' +
        '<div class="w-12 h-12 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-2"><i class="fab fa-google text-gray-400 text-xl"></i></div>' +
        '<p class="font-semibold text-gray-300">Connect Your Gmail</p>' +
        '<p class="text-sm text-gray-500 mt-1">Send proposals directly from your Gmail so customers receive them from your real email address.</p></div>';
      body += '<button onclick="window._crmConnectGmail()" class="w-full py-3 bg-brand-600 text-white rounded-xl text-sm font-semibold hover:bg-brand-700"><i class="fab fa-google mr-2"></i>Connect Gmail Account</button>';
      body += '<p class="text-xs text-gray-400 text-center">Without Gmail, proposals will only generate a shareable link.</p>';
    }
    body += '</div>';
    showModal('Gmail Integration', body);
  };

  // (Gmail connect defined above in invoices section — this override uses same popup-first pattern)
  window._crmConnectGmail = function() {
    closeModal();
    var w = window.open('about:blank', 'gmailOAuth', 'width=600,height=700');
    fetch('/api/crm/gmail/connect', { headers: authHeadersOnly() })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.auth_url && w) { w.location.href = data.auth_url; }
        else if (data.auth_url) { window.open(data.auth_url, 'gmailOAuth', 'width=600,height=700'); }
        else { if (w) w.close(); toast(data.error || 'Gmail not configured', 'error'); }
      }).catch(function(e) { if (w) w.close(); toast('Failed: ' + (e.message || 'Network error'), 'error'); });
    var timer = setInterval(function() { if (w && w.closed) { clearInterval(timer); checkGmailStatus(); loadProposals(window._propFilter); } }, 800);
  };

  window._crmDisconnectGmail = async function() {
    if (!(await window.rmConfirm('Disconnect Gmail? You won\'t be able to email proposals until you reconnect.'))) return
    fetch('/api/crm/gmail/disconnect', { method: 'POST', headers: authHeaders() })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.success) { _gmailConnected = false; _gmailEmail = ''; closeModal(); toast('Gmail disconnected'); loadProposals(window._propFilter); }
      }).catch(function(e) { toast('Failed: ' + (e.message || 'Network error'), 'error'); });
  };

  // ---- New Proposal with Line Items ----
  var _propLineItems = [];

  function propItemRowHTML(idx, item) {
    item = item || { description: '', quantity: 1, unit: 'each', unit_price: 0 };
    return '<tr data-idx="' + idx + '">' +
      '<td class="py-1 pr-1"><input type="text" class="w-full px-2 py-1.5 border border-white/15 rounded-lg text-sm prop-item-desc" value="' + (item.description || '') + '" placeholder="Description"></td>' +
      '<td class="py-1 pr-1 w-16"><input type="number" class="w-full px-2 py-1.5 border border-white/15 rounded-lg text-sm text-center prop-item-qty" value="' + (item.quantity || 1) + '" min="0" step="any"></td>' +
      '<td class="py-1 pr-1 w-16"><select class="w-full px-1 py-1.5 border border-white/15 rounded-lg text-xs prop-item-unit">' +
        '<option value="each"' + (item.unit === 'each' ? ' selected' : '') + '>each</option>' +
        '<option value="pcs"' + (item.unit === 'pcs' ? ' selected' : '') + '>pcs</option>' +
        '<option value="sq ft"' + (item.unit === 'sq ft' ? ' selected' : '') + '>sq ft</option>' +
        '<option value="m²"' + (item.unit === 'm²' ? ' selected' : '') + '>m²</option>' +
        '<option value="sq"' + (item.unit === 'sq' ? ' selected' : '') + '>sq</option>' +
        '<option value="LF"' + (item.unit === 'LF' ? ' selected' : '') + '>LF</option>' +
        '<option value="m"' + (item.unit === 'm' ? ' selected' : '') + '>m</option>' +
        '<option value="bundle"' + (item.unit === 'bundle' ? ' selected' : '') + '>bundle</option>' +
        '<option value="roll"' + (item.unit === 'roll' ? ' selected' : '') + '>roll</option>' +
        '<option value="box"' + (item.unit === 'box' ? ' selected' : '') + '>box</option>' +
        '<option value="hour"' + (item.unit === 'hour' ? ' selected' : '') + '>hour</option>' +
        '<option value="day"' + (item.unit === 'day' ? ' selected' : '') + '>day</option>' +
        '<option value="lot"' + (item.unit === 'lot' ? ' selected' : '') + '>lot</option>' +
      '</select></td>' +
      '<td class="py-1 pr-1 w-24"><input type="number" class="w-full px-2 py-1.5 border border-white/15 rounded-lg text-sm text-right prop-item-price" value="' + (item.unit_price || 0) + '" min="0" step="0.01"></td>' +
      '<td class="py-1 w-8 text-center"><button onclick="this.closest(\'tr\').remove();window._propRecalc()" class="text-gray-400 hover:text-red-500"><i class="fas fa-times"></i></button></td>' +
      '</tr>';
  }

  window._crmNewProposal = function() {
    _propLineItems = [];
    fetch('/api/crm/customers', { headers: authHeadersOnly() })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var custs = data.customers || [];
        var body = '<div class="space-y-3">' +
          '<div><label class="block text-xs font-medium text-gray-400 mb-1">Customer *</label>' + customerSelectHTML(custs, '', 'propCustomer') + '</div>' +
          '<div><label class="block text-xs font-medium text-gray-400 mb-1">Title *</label><input type="text" id="propTitle" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm" placeholder="e.g. Full Roof Replacement – 2,200 sq ft"></div>' +
          '<div style="background:#1e3a5f;border:2px solid #3b82f6;border-radius:10px;padding:12px">' +
            '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">' +
              '<div style="width:28px;height:28px;background:#3b82f6;border-radius:6px;display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="fas fa-satellite" style="color:#fff;font-size:13px"></i></div>' +
              '<div>' +
                '<div style="color:#93c5fd;font-size:12px;font-weight:700">Link Roof Report</div>' +
                '<div style="color:#60a5fa;font-size:10px;opacity:0.8">Measurements will appear in the customer preview</div>' +
              '</div>' +
            '</div>' +
            '<select id="propLinkedReport" style="width:100%;padding:9px 12px;border:1px solid #3b82f6;border-radius:8px;font-size:13px;background:#0f2744;color:#e2e8f0"><option value="">— Select a completed roof report —</option></select>' +
          '</div>' +
          '<div><label class="block text-xs font-medium text-gray-400 mb-1">Property Address</label><input type="text" id="propAddress" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm"></div>' +
          '<div><label class="block text-xs font-medium text-gray-400 mb-1">Scope of Work</label><textarea id="propScope" rows="3" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm" placeholder="Remove existing shingles, inspect decking, install new underlayment and architectural shingles..."></textarea></div>';

        // Populate the roof report dropdown
        fetch('/api/customer/orders', { headers: authHeadersOnly() })
          .then(function(r) { return r.json(); })
          .then(function(d) {
            var orders = (d.orders || []).filter(function(o) { return o.status === 'completed' || o.report_id; });
            var sel = document.getElementById('propLinkedReport');
            if (sel && orders.length > 0) {
              orders.forEach(function(o) {
                var opt = document.createElement('option');
                opt.value = o.id;
                opt.textContent = (o.address || 'Order #' + o.id) + (o.created_at ? ' — ' + o.created_at.substring(0, 10) : '');
                sel.appendChild(opt);
              });
            }
          }).catch(function() {});

        // Line items section
        body += '<div class="border border-white/10 rounded-xl p-3">' +
          '<div class="flex items-center justify-between mb-2"><label class="text-xs font-semibold text-gray-300 uppercase tracking-wider"><i class="fas fa-list mr-1"></i>Line Items</label>' +
          '<button onclick="window._propAddItem()" class="text-xs text-brand-600 hover:text-brand-700 font-medium"><i class="fas fa-plus mr-1"></i>Add Item</button></div>' +
          '<table class="w-full" id="propItemsTable"><thead><tr class="text-[10px] text-gray-500 uppercase">' +
          '<th class="text-left pb-1">Description</th><th class="text-center pb-1 w-16">Qty</th><th class="text-center pb-1 w-16">Unit</th><th class="text-right pb-1 w-24">Price</th><th class="w-8"></th>' +
          '</tr></thead><tbody id="propItemsBody">';
        // Start with one empty row
        body += propItemRowHTML(0);
        body += '</tbody></table></div>';

        // Tax & totals
        body += '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">' +
          '<div><label class="block text-xs font-medium text-gray-400 mb-1">Tax Rate (%)</label><input type="number" id="propTaxRate" class="w-full px-2 py-2 border border-white/15 rounded-lg text-sm" value="5" min="0" step="0.5"></div>' +
          '<div class="flex items-end"><div class="w-full bg-[#0A0A0A] rounded-lg border p-2 text-right"><p class="text-xs text-gray-500">Estimated Total</p><p class="text-lg font-black text-gray-100" id="propTotalDisplay">$0.00</p></div></div></div>';

        body += '<div><label class="block text-xs font-medium text-gray-400 mb-1">Valid Until</label><input type="date" id="propValid" class="w-full px-2 py-2 border border-white/15 rounded-lg text-sm"></div>' +
          '<div><label class="block text-xs font-medium text-gray-400 mb-1">Warranty Terms</label><textarea id="propWarranty" rows="2" class="w-full px-2 py-2 border border-white/15 rounded-lg text-sm" placeholder="e.g. 25-year manufacturer warranty, 5-year workmanship warranty"></textarea></div>' +
          '<div><label class="block text-xs font-medium text-gray-400 mb-1">Payment Terms</label><textarea id="propPayment" rows="2" class="w-full px-2 py-2 border border-white/15 rounded-lg text-sm" placeholder="e.g. 50% deposit upon acceptance, balance due upon completion"></textarea></div>' +
          '<div><label class="block text-xs font-medium text-gray-400 mb-1">Notes</label><textarea id="propNotes" rows="2" class="w-full px-2 py-2 border border-white/15 rounded-lg text-sm"></textarea></div></div>';

        // Two-button footer: Save Draft + Send Now
        body += '<div style="display:flex;gap:8px;margin-top:8px">' +
          '<button onclick="window._crmSubmitProposal(\'draft\')" style="flex:1;padding:10px 0;background:var(--bg-elevated);color:var(--text-primary);border:1px solid var(--border-color);border-radius:10px;font-size:13px;font-weight:600;cursor:pointer"><i class="fas fa-save mr-1.5"></i>Save Draft</button>' +
          '<button onclick="window._crmSubmitProposal(\'send\')" style="flex:1;padding:10px 0;background:#059669;color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer"><i class="fas fa-paper-plane mr-1.5"></i>Send Now</button>' +
        '</div>';

        window._crmSubmitProposal = function(action) {
          var custData = getCustomerFromSelector('propCustomer');
          var title = document.getElementById('propTitle').value.trim();
          if (!custData || !title) { toast('Customer and title required', 'error'); return; }
          var items = getProposalItems();
          var payload = Object.assign({}, custData, {
            title: title,
            property_address: document.getElementById('propAddress').value.trim(),
            scope_of_work: document.getElementById('propScope').value.trim(),
            items: items,
            tax_rate: parseFloat(document.getElementById('propTaxRate').value) || 5,
            valid_until: document.getElementById('propValid').value || null,
            warranty_terms: document.getElementById('propWarranty').value.trim() || null,
            payment_terms: document.getElementById('propPayment').value.trim() || null,
            notes: document.getElementById('propNotes').value.trim(),
            source_report_id: document.getElementById('propLinkedReport') && document.getElementById('propLinkedReport').value ? parseInt(document.getElementById('propLinkedReport').value) : null
          });
          fetch('/api/crm/proposals', { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) })
            .then(function(r) { return r.json(); })
            .then(function(res) {
              if (res.success) {
                closeModal();
                toast(action === 'draft' ? 'Draft saved!' : 'Proposal created!');
                if (action === 'send' && res.proposal_id) {
                  window._crmSendProposal(res.proposal_id);
                } else {
                  loadProposals();
                }
              } else { toast(res.error || 'Failed', 'error'); }
            })
            .catch(function(e) { toast('Network error: ' + (e.message || 'Unknown'), 'error'); });
        };

        showModal('Create Proposal', body);

        // Auto-recalc on input
        setTimeout(function() { window._propRecalc(); }, 100);

        // Pre-fill from material calculator data if available
        if (window._mcProposalData) {
          setTimeout(function() {
            var mc = window._mcProposalData;
            window._mcProposalData = null;
            // Pre-fill title
            var titleEl = document.getElementById('propTitle');
            if (titleEl && mc.address) titleEl.value = 'Material Estimate — ' + mc.address;
            // Pre-fill address
            var addrEl = document.getElementById('propAddress');
            if (addrEl && mc.address) addrEl.value = mc.address;
            // Pre-fill scope of work
            var scopeEl = document.getElementById('propScope');
            if (scopeEl) {
              var scopeParts = ['Material estimate based on roof measurement report.'];
              if (mc.total_area_sqft) scopeParts.push(mc.total_area_sqft + ' sq ft total area.');
              if (mc.pitch) scopeParts.push('Pitch: ' + mc.pitch + '.');
              if (mc.waste_pct) scopeParts.push(mc.waste_pct + '% waste factor included.');
              scopeEl.value = scopeParts.join(' ');
            }
            // Pre-fill linked report
            if (mc.source_report_id) {
              var repSel = document.getElementById('propLinkedReport');
              if (repSel) {
                // Try to select, may need a small delay for options to populate
                repSel.value = mc.source_report_id;
                if (!repSel.value) {
                  setTimeout(function() { repSel.value = mc.source_report_id; }, 500);
                }
              }
            }
            // Pre-fill line items
            if (mc.items && mc.items.length > 0) {
              var tbody = document.getElementById('propItemsBody');
              if (tbody) {
                tbody.innerHTML = '';
                for (var i = 0; i < mc.items.length; i++) {
                  var it = mc.items[i];
                  tbody.insertAdjacentHTML('beforeend', propItemRowHTML(i, {
                    description: it.description || '',
                    quantity: it.quantity || 1,
                    unit: 'ea',
                    unit_price: it.unit_price || 0
                  }));
                }
              }
              setTimeout(function() { window._propRecalc(); }, 150);
            }
          }, 200);
        }
      }).catch(function(e) { toast('Failed to load customers: ' + (e.message || 'Network error'), 'error'); });
  };

  function getProposalItems() {
    var items = [];
    var rows = document.querySelectorAll('#propItemsBody tr');
    rows.forEach(function(row) {
      var desc = row.querySelector('.prop-item-desc').value.trim();
      if (!desc) return;
      items.push({
        description: desc,
        quantity: parseFloat(row.querySelector('.prop-item-qty').value) || 1,
        unit: row.querySelector('.prop-item-unit').value,
        unit_price: parseFloat(row.querySelector('.prop-item-price').value) || 0
      });
    });
    return items;
  }

  window._propAddItem = function() {
    var tbody = document.getElementById('propItemsBody');
    if (!tbody) return;
    var idx = tbody.querySelectorAll('tr').length;
    var tr = document.createElement('tbody');
    tr.innerHTML = propItemRowHTML(idx);
    tbody.appendChild(tr.firstElementChild);
  };

  window._propRecalc = function() {
    var items = getProposalItems();
    var subtotal = 0;
    items.forEach(function(it) { subtotal += (it.quantity || 1) * (it.unit_price || 0); });
    var taxEl = document.getElementById('propTaxRate');
    var tax = taxEl ? parseFloat(taxEl.value) || 0 : 5;
    var taxAmt = subtotal * (tax / 100);
    var total = subtotal + taxAmt;
    var display = document.getElementById('propTotalDisplay');
    if (display) display.textContent = '$' + total.toFixed(2);
  };

  // Recalculate on input changes
  document.addEventListener('input', function(e) {
    if (e.target.classList.contains('prop-item-qty') || e.target.classList.contains('prop-item-price') || e.target.id === 'propTaxRate') {
      window._propRecalc();
    }
  });

  // ---- Edit Proposal ----
  window._crmEditProposal = function(id) {
    Promise.all([
      fetch('/api/crm/proposals/' + id, { headers: authHeadersOnly() }).then(function(r) { return r.json(); }),
      fetch('/api/crm/customers', { headers: authHeadersOnly() }).then(function(r) { return r.json(); })
    ]).then(function(results) {
      var propData = results[0];
      var custData = results[1];
      var p = propData.proposal;
      var items = propData.items || [];
      var custs = custData.customers || [];

      var body = '<div class="space-y-3">' +
        '<div><label class="block text-xs font-medium text-gray-400 mb-1">Customer *</label>' + customerSelectHTML(custs, p.crm_customer_id, 'propCustomer') + '</div>' +
        '<div><label class="block text-xs font-medium text-gray-400 mb-1">Title *</label><input type="text" id="propTitle" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm" value="' + (p.title || '') + '"></div>' +
        '<div><label class="block text-xs font-medium text-gray-400 mb-1">Property Address</label><input type="text" id="propAddress" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm" value="' + (p.property_address || '') + '"></div>' +
        '<div><label class="block text-xs font-medium text-gray-400 mb-1">Scope of Work</label><textarea id="propScope" rows="3" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm">' + (p.scope_of_work || '') + '</textarea></div>';

      // Line items
      body += '<div class="border border-white/10 rounded-xl p-3">' +
        '<div class="flex items-center justify-between mb-2"><label class="text-xs font-semibold text-gray-300 uppercase tracking-wider"><i class="fas fa-list mr-1"></i>Line Items</label>' +
        '<button onclick="window._propAddItem()" class="text-xs text-brand-600 hover:text-brand-700 font-medium"><i class="fas fa-plus mr-1"></i>Add Item</button></div>' +
        '<table class="w-full" id="propItemsTable"><thead><tr class="text-[10px] text-gray-500 uppercase">' +
        '<th class="text-left pb-1">Description</th><th class="text-center pb-1 w-16">Qty</th><th class="text-center pb-1 w-16">Unit</th><th class="text-right pb-1 w-24">Price</th><th class="w-8"></th>' +
        '</tr></thead><tbody id="propItemsBody">';
      if (items.length > 0) {
        for (var i = 0; i < items.length; i++) body += propItemRowHTML(i, items[i]);
      } else {
        body += propItemRowHTML(0);
      }
      body += '</tbody></table></div>';

      body += '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">' +
        '<div><label class="block text-xs font-medium text-gray-400 mb-1">Tax Rate (%)</label><input type="number" id="propTaxRate" class="w-full px-2 py-2 border border-white/15 rounded-lg text-sm" value="' + (p.tax_rate || 5) + '" min="0" step="0.5"></div>' +
        '<div class="flex items-end"><div class="w-full bg-[#0A0A0A] rounded-lg border p-2 text-right"><p class="text-xs text-gray-500">Estimated Total</p><p class="text-lg font-black text-gray-100" id="propTotalDisplay">$0.00</p></div></div></div>';

      body += '<div><label class="block text-xs font-medium text-gray-400 mb-1">Valid Until</label><input type="date" id="propValid" class="w-full px-2 py-2 border border-white/15 rounded-lg text-sm" value="' + (p.valid_until || '') + '"></div>' +
        '<div><label class="block text-xs font-medium text-gray-400 mb-1">Warranty Terms</label><textarea id="propWarranty" rows="2" class="w-full px-2 py-2 border border-white/15 rounded-lg text-sm">' + (p.warranty_terms || '') + '</textarea></div>' +
        '<div><label class="block text-xs font-medium text-gray-400 mb-1">Payment Terms</label><textarea id="propPayment" rows="2" class="w-full px-2 py-2 border border-white/15 rounded-lg text-sm">' + (p.payment_terms || '') + '</textarea></div>' +
        '<div><label class="block text-xs font-medium text-gray-400 mb-1">Notes</label><textarea id="propNotes" rows="2" class="w-full px-2 py-2 border border-white/15 rounded-lg text-sm">' + (p.notes || '') + '</textarea></div></div>';

      showModal('Edit Proposal', body, function() {
        var custData = getCustomerFromSelector('propCustomer');
        var title = document.getElementById('propTitle').value.trim();
        if (!custData || !title) { toast('Customer and title required', 'error'); return; }

        var updItems = getProposalItems();
        var payload = Object.assign({}, custData, {
          title: title,
          property_address: document.getElementById('propAddress').value.trim(),
          scope_of_work: document.getElementById('propScope').value.trim(),
          items: updItems,
          tax_rate: parseFloat(document.getElementById('propTaxRate').value) || 5,
          valid_until: document.getElementById('propValid').value || null,
          warranty_terms: document.getElementById('propWarranty').value.trim() || null,
          payment_terms: document.getElementById('propPayment').value.trim() || null,
          notes: document.getElementById('propNotes').value.trim(),
          status: p.status
        });
        fetch('/api/crm/proposals/' + id, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(payload) })
          .then(function(r) { return r.json(); })
          .then(function(res) { if (res.success) { closeModal(); toast('Proposal updated!'); loadProposals(window._propFilter); } else { toast(res.error || 'Failed', 'error'); } })
          .catch(function(e) { toast('Network error: ' + (e.message || 'Unknown'), 'error'); });
      }, 'Save Changes');

      setTimeout(function() { window._propRecalc(); }, 100);
    }).catch(function(e) { toast('Failed to load proposal: ' + (e.message || 'Network error'), 'error'); });
  };

  window._crmLinkReport = function(id) {
    fetch('/api/customer/orders', { headers: authHeadersOnly() })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var orders = (data.orders || []).filter(function(o) { return o.status === 'completed' || o.report_id; });
        var opts = '<option value="">— No report —</option>';
        orders.forEach(function(o) {
          opts += '<option value="' + o.id + '">' + (o.address || o.property_address || 'Order #' + o.id) + (o.created_at ? ' — ' + o.created_at.substring(0, 10) : '') + '</option>';
        });
        var body = '<div class="space-y-3">' +
          '<p class="text-sm" style="color:var(--text-muted)">Select the roof measurement report to include in this proposal\'s preview.</p>' +
          '<div><label class="block text-xs font-medium text-gray-400 mb-1"><i class="fas fa-file-alt mr-1 text-blue-400"></i>Roof Report</label>' +
          '<select id="linkReportSel" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm" style="background:var(--bg-elevated);color:var(--text-primary)">' + opts + '</select></div>' +
        '</div>';
        showModal('Link Roof Report', body, function() {
          var val = document.getElementById('linkReportSel').value;
          fetch('/api/crm/proposals/' + id, {
            method: 'PUT', headers: authHeaders(),
            body: JSON.stringify({ source_report_id: val ? parseInt(val) : null })
          })
          .then(function(r) { return r.json(); })
          .then(function(res) {
            if (res.success) { closeModal(); toast('Report linked! Preview will now show measurement data.', 'success'); loadProposals(window._propFilter); }
            else { toast(res.error || 'Failed', 'error'); }
          })
          .catch(function(e) { toast('Network error', 'error'); });
        }, 'Link Report');
      })
      .catch(function() { toast('Could not load reports', 'error'); });
  };

  window._crmMarkProposal = function(id, status) {
    fetch('/api/crm/proposals/' + id, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ status: status }) })
      .then(function(r) { return r.json(); })
      .then(function(res) {
        if (res.success) { toast('Proposal updated'); loadProposals(window._propFilter); }
        else { toast(res.error || 'Failed to update proposal', 'error'); }
      })
      .catch(function(e) { toast('Network error: ' + (e.message || 'Unknown'), 'error'); });
  };

  // ---- Send Proposal (via Gmail if connected) ----
  window._crmSendProposal = function(id) {
    var sendBtn = event.target;
    var origText = sendBtn.innerHTML;
    sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    sendBtn.disabled = true;

    fetch('/api/crm/proposals/' + id + '/send', { method: 'POST', headers: authHeaders() })
      .then(function(r) { return r.json(); })
      .then(function(res) {
        sendBtn.innerHTML = origText;
        sendBtn.disabled = false;

        if (res.success) {
          var linkHtml = '<div class="space-y-4">';
          
          // Email status
          if (res.email_sent) {
            linkHtml += '<div class="bg-green-50 border border-green-200 rounded-xl p-4 text-center">' +
              '<i class="fas fa-check-circle text-emerald-400 text-2xl mb-2"></i>' +
              '<p class="font-semibold text-green-800">Proposal Emailed!</p>' +
              '<p class="text-sm text-emerald-400">Sent to ' + res.sent_to + '</p></div>';
          } else if (res.email_error) {
            linkHtml += '<div class="bg-white/10 border border-white/15 rounded-xl p-3 text-sm text-gray-400">' +
              '<i class="fas fa-exclamation-triangle mr-1"></i>' + res.email_error + '</div>';
          }

          linkHtml += '<p class="text-sm text-gray-400">Share this trackable link — every time your customer opens it, the view count updates.</p>' +
            '<div class="bg-[#0A0A0A] border rounded-lg p-3 flex items-center gap-2">' +
              '<input type="text" id="proposalLink" value="' + res.public_link + '" class="flex-1 bg-transparent text-sm text-gray-100 font-mono border-0 outline-none" readonly>' +
              '<button onclick="navigator.clipboard.writeText(document.getElementById(\'proposalLink\').value);toast(\'Link copied!\')" class="px-3 py-1.5 bg-brand-600 text-white rounded-lg text-xs font-semibold hover:bg-brand-700"><i class="fas fa-copy"></i></button>' +
            '</div></div>';
          showModal(res.email_sent ? 'Proposal Sent!' : 'Proposal Ready', linkHtml);
          loadProposals(window._propFilter);
        } else {
          toast(res.error || 'Failed to send proposal', 'error');
        }
      })
      .catch(function() {
        sendBtn.innerHTML = origText;
        sendBtn.disabled = false;
        toast('Network error', 'error');
      });
  };

  window._crmCopyProposalLink = function(id) {
    fetch('/api/crm/proposals/' + id + '/views', { headers: authHeadersOnly() })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.share_token) {
          var link = window.location.origin + '/proposal/view/' + data.share_token;
          navigator.clipboard.writeText(link).then(function() {
            toast('Link copied! Views: ' + (data.view_count || 0));
          }).catch(function() {
            _crmShareModal('Share Proposal', 'Copy the link below:', link);
          });
        } else {
          toast('No shareable link — send the proposal first.', 'error');
        }
      }).catch(function(e) { toast('Failed: ' + (e.message || 'Network error'), 'error'); });
  };

  // ---- View Tracking Analytics Modal ----
  window._crmViewTracking = function(id) {
    fetch('/api/crm/proposals/' + id + '/views', { headers: authHeadersOnly() })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var body = '<div class="space-y-4">';
        body += '<div class="grid grid-cols-3 gap-3">' +
          '<div class="bg-blue-500/15 rounded-xl p-3 text-center"><p class="text-2xl font-black text-blue-400">' + (data.view_count || 0) + '</p><p class="text-[10px] text-blue-400">Total Views</p></div>' +
          '<div class="bg-blue-50 rounded-xl p-3 text-center"><p class="text-xs font-semibold text-blue-700">' + (data.sent_at ? fmtDate(data.sent_at) : 'Not sent') + '</p><p class="text-[10px] text-blue-500">Sent</p></div>' +
          '<div class="bg-blue-500/15 rounded-xl p-3 text-center"><p class="text-xs font-semibold text-blue-400">' + (data.last_viewed_at ? fmtDate(data.last_viewed_at) : 'Never') + '</p><p class="text-[10px] text-blue-400">Last Viewed</p></div></div>';

        if (data.view_log && data.view_log.length > 0) {
          body += '<div><h4 class="text-xs font-semibold text-gray-500 uppercase mb-2">View History</h4>' +
            '<div class="max-h-60 overflow-y-auto space-y-1.5">';
          for (var i = 0; i < data.view_log.length; i++) {
            var v = data.view_log[i];
            var viewDate = v.viewed_at ? new Date(v.viewed_at).toLocaleString() : '';
            var device = (v.user_agent || '').toLowerCase();
            var icon = device.indexOf('mobile') > -1 || device.indexOf('iphone') > -1 || device.indexOf('android') > -1 ? 'fa-mobile-alt' : 'fa-desktop';
            body += '<div class="flex items-center gap-3 bg-[#0A0A0A] rounded-lg p-2 text-xs">' +
              '<i class="fas ' + icon + ' text-gray-400"></i>' +
              '<div class="flex-1 min-w-0"><p class="text-gray-300 font-medium">' + viewDate + '</p>' +
              '<p class="text-gray-400 truncate">' + (v.ip_address || '') + '</p></div></div>';
          }
          body += '</div></div>';
        } else {
          body += '<p class="text-sm text-gray-400 text-center py-4">No views recorded yet.</p>';
        }
        body += '</div>';
        showModal('Proposal Views & Tracking', body);
      }).catch(function(e) { toast('Failed to load tracking data: ' + (e.message || 'Network error'), 'error'); });
  };

  // ---- View Proposal Detail ----
  window._crmViewProposal = function(id) {
    fetch('/api/crm/proposals/' + id, { headers: authHeadersOnly() })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var p = data.proposal;
        var items = data.items || [];
        if (!p) { toast('Proposal not found', 'error'); return; }

        var body = '<div class="space-y-4">';
        // Header
        body += '<div class="flex items-center justify-between flex-wrap gap-2">';
        body += '<div><span class="font-mono text-lg font-bold text-gray-400">' + p.proposal_number + '</span></div>';
        body += '<div class="flex items-center gap-2">' + badge(p.status);
        if (p.view_count > 0) body += '<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/15/15 text-blue-400"><i class="fas fa-eye mr-0.5"></i>' + p.view_count + ' views</span>';
        if (p.status === 'draft') body += '<button onclick="closeModal();window._crmEditProposal(' + id + ')" class="text-xs bg-white/5 text-gray-300 px-3 py-1 rounded-lg hover:bg-gray-200"><i class="fas fa-edit mr-1"></i>Edit</button>';
        body += '</div></div>';

        // Title & Customer
        body += '<div><h3 class="text-base font-bold text-gray-100">' + (p.title || '') + '</h3></div>';
        body += '<div class="bg-[#0A0A0A] rounded-xl p-4">';
        body += '<h4 class="text-xs font-semibold text-gray-500 uppercase mb-2"><i class="fas fa-user mr-1"></i>Customer</h4>';
        body += '<p class="font-semibold text-gray-100">' + (p.customer_name || 'N/A') + '</p>';
        if (p.customer_email) body += '<p class="text-sm text-gray-400"><i class="fas fa-envelope mr-1 text-gray-400"></i>' + p.customer_email + '</p>';
        if (p.customer_phone) body += '<p class="text-sm text-gray-400"><i class="fas fa-phone mr-1 text-gray-400"></i>' + p.customer_phone + '</p>';
        var propAddr = [p.property_address || p.customer_address, p.customer_city, p.customer_province].filter(Boolean).join(', ');
        if (propAddr) body += '<p class="text-sm text-gray-400 mt-1"><i class="fas fa-map-marker-alt mr-1 text-gray-400"></i>' + propAddr + '</p>';
        body += '</div>';

        // Scope of Work
        if (p.scope_of_work) {
          body += '<div class="bg-blue-50 rounded-xl p-4">';
          body += '<h4 class="text-xs font-semibold text-blue-600 uppercase mb-2"><i class="fas fa-clipboard-list mr-1"></i>Scope of Work</h4>';
          body += '<p class="text-sm text-blue-900 whitespace-pre-line">' + p.scope_of_work + '</p>';
          body += '</div>';
        }

        // Line Items
        if (items.length > 0) {
          body += '<div class="border border-white/10 rounded-xl overflow-hidden">';
          body += '<table class="w-full text-sm"><thead class="bg-[#0A0A0A]"><tr><th class="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Description</th><th class="px-4 py-2.5 text-center text-xs font-semibold text-gray-500 w-14">Qty</th><th class="px-4 py-2.5 text-center text-xs font-semibold text-gray-500 w-14">Unit</th><th class="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 w-24">Price</th><th class="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 w-24">Amount</th></tr></thead><tbody class="divide-y divide-white/5">';
          for (var i = 0; i < items.length; i++) {
            var it = items[i];
            body += '<tr><td class="px-4 py-2.5 text-gray-300">' + it.description + '</td><td class="px-4 py-2.5 text-center text-gray-400">' + it.quantity + '</td><td class="px-4 py-2.5 text-center text-gray-500 text-xs">' + (it.unit || 'ea') + '</td><td class="px-4 py-2.5 text-right text-gray-400">' + money(it.unit_price) + '</td><td class="px-4 py-2.5 text-right font-medium text-gray-100">' + money(it.amount) + '</td></tr>';
          }
          body += '</tbody></table></div>';
        }

        // Totals
        body += '<div class="bg-[#0A0A0A] rounded-xl p-4">';
        body += '<div class="flex justify-between text-sm text-gray-400 mb-1"><span>Subtotal</span><span>' + money(p.subtotal) + '</span></div>';
        if (p.tax_amount) body += '<div class="flex justify-between text-sm text-gray-400 mb-1"><span>Tax (' + (p.tax_rate || 5) + '%)</span><span>' + money(p.tax_amount) + '</span></div>';
        body += '<div class="flex justify-between text-lg font-bold text-gray-100 border-t border-white/10 pt-2 mt-2"><span>Total</span><span>' + money(p.total_amount) + ' CAD</span></div>';
        body += '</div>';

        // Dates row
        body += '<div class="grid grid-cols-3 gap-3">';
        body += '<div class="bg-blue-50 rounded-xl p-3 text-center"><p class="text-xs text-blue-500 mb-1">Created</p><p class="text-sm font-semibold text-blue-700">' + fmtDate(p.created_at) + '</p></div>';
        body += '<div class="bg-white/10 rounded-xl p-3 text-center"><p class="text-xs text-gray-400 mb-1">Valid Until</p><p class="text-sm font-semibold text-gray-400">' + (p.valid_until ? fmtDate(p.valid_until) : '—') + '</p></div>';
        body += '<div class="bg-green-50 rounded-xl p-3 text-center"><p class="text-xs text-green-500 mb-1">Sent</p><p class="text-sm font-semibold text-green-700">' + (p.sent_at ? fmtDate(p.sent_at) : '—') + '</p></div>';
        body += '</div>';

        // Warranty, Payment Terms, Notes
        if (p.warranty_terms) body += '<div class="bg-blue-500/15 rounded-xl p-3"><h4 class="text-xs font-semibold text-blue-400 uppercase mb-1"><i class="fas fa-shield-alt mr-1"></i>Warranty</h4><p class="text-sm text-blue-400">' + p.warranty_terms + '</p></div>';
        if (p.payment_terms) body += '<div class="bg-emerald-50 rounded-xl p-3"><h4 class="text-xs font-semibold text-emerald-600 uppercase mb-1"><i class="fas fa-credit-card mr-1"></i>Payment Terms</h4><p class="text-sm text-emerald-800">' + p.payment_terms + '</p></div>';
        if (p.notes) body += '<div class="bg-white/5 rounded-xl p-3"><h4 class="text-xs font-semibold text-gray-500 uppercase mb-1"><i class="fas fa-sticky-note mr-1"></i>Notes</h4><p class="text-sm text-gray-300">' + p.notes + '</p></div>';

        // Share link (if exists)
        if (p.share_token) {
          var publicLink = window.location.origin + '/proposal/view/' + p.share_token;
          body += '<div class="bg-brand-50 rounded-xl p-3"><h4 class="text-xs font-semibold text-brand-600 uppercase mb-2"><i class="fas fa-link mr-1"></i>Shareable Link</h4>';
          body += '<div class="flex items-center gap-2"><input type="text" id="propViewLink" value="' + publicLink + '" class="flex-1 bg-[#111111] border border-brand-200 rounded-lg px-3 py-1.5 text-xs font-mono text-gray-300" readonly>';
          body += '<button onclick="navigator.clipboard.writeText(document.getElementById(\'propViewLink\').value);toast(\'Link copied!\')" class="px-3 py-1.5 bg-brand-600 text-white rounded-lg text-xs font-semibold hover:bg-brand-700"><i class="fas fa-copy"></i></button></div></div>';
        }

        // Payment link
        if (p.payment_link) {
          body += '<div class="bg-green-50 rounded-xl p-3 flex items-center justify-between gap-2"><div><p class="text-xs font-semibold text-emerald-400 mb-0.5"><i class="fas fa-credit-card mr-1"></i>Square Payment Link</p><p class="text-xs text-green-700">Ready for customer payment</p></div><div class="flex gap-2 shrink-0"><a href="' + p.payment_link + '" target="_blank" class="text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 font-semibold">Pay Now</a><button onclick="navigator.clipboard.writeText(\'' + p.payment_link + '\').then(function(){toast(\'Link copied!\');})" class="text-xs bg-[#111111] border border-green-200 px-2 py-1.5 rounded-lg hover:bg-green-50">Copy</button></div></div>';
        }

        // Action buttons
        body += '<div class="flex gap-2 pt-2 flex-wrap">';
        // PDF download — open printable view in new tab
        if (p.share_token) {
          body += '<a href="/proposal/view/' + p.share_token + '?print=1" target="_blank" class="flex-1 py-2.5 bg-gray-800 text-white rounded-xl text-sm font-semibold hover:bg-gray-900 text-center"><i class="fas fa-file-pdf mr-1"></i>Download PDF</a>';
        }
        if (p.status === 'draft') {
          body += '<button onclick="closeModal();window._crmEditProposal(' + id + ')" class="flex-1 py-2.5 bg-white/5 text-gray-300 rounded-xl text-sm font-semibold hover:bg-gray-200"><i class="fas fa-edit mr-1"></i>Edit</button>';
          body += '<button onclick="closeModal();window._crmSendProposal(' + id + ')" class="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700"><i class="fas fa-paper-plane mr-1"></i>Send</button>';
        }
        if (p.status === 'sent' || p.status === 'viewed') {
          body += '<button onclick="closeModal();window._crmSendProposal(' + id + ')" class="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700"><i class="fas fa-redo mr-1"></i>Resend</button>';
        }
        // Payment link generation
        if (!p.payment_link && p.status !== 'accepted' && p.status !== 'declined') {
          body += '<button onclick="window._crmGenProposalPayLink(' + id + ')" class="flex-1 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-700"><i class="fas fa-credit-card mr-1"></i>Payment Link</button>';
        }
        if (p.status !== 'accepted' && p.status !== 'declined') body += '<button onclick="closeModal();window._crmMarkProposal(' + id + ',\'accepted\')" class="flex-1 py-2.5 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700"><i class="fas fa-check mr-1"></i>Mark Won</button>';
        body += '</div>';
        body += '</div>';

        showModal('Proposal Details', body);
      })
      .catch(function(e) { toast('Failed to load proposal: ' + (e.message || 'Network error'), 'error'); });
  };

  window._crmDeleteProposal = async function(id) {
    if (!(await window.rmConfirm('Delete this proposal?'))) return
    fetch('/api/crm/proposals/' + id, { method: 'DELETE', headers: authHeadersOnly() })
      .then(function() { toast('Proposal deleted'); loadProposals(window._propFilter); })
      .catch(function(e) { toast('Failed to delete: ' + (e.message || 'Network error'), 'error'); });
  };

  // ============================================================
  // MODULE: JOBS
  // ============================================================

  // Restore persisted calendar state from localStorage
  var _calView = localStorage.getItem('crm_cal_view') || 'month';
  var _calConnected = localStorage.getItem('crm_cal_connected') === '1';
  var _calEmail = localStorage.getItem('crm_cal_email') || '';
  var _calYear = new Date().getFullYear();
  var _calMonth = new Date().getMonth();
  var _calWeekStart = null;
  var _allJobs = [];
  var _allJobStats = {};
  var _googleCalEvents = [];

  function initJobs() {
    root.innerHTML = '<div class="text-center py-12"><div class="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-brand-500 mx-auto mb-3"></div></div>';
    checkCalendarStatus();
    loadJobsForMonth(_calYear, _calMonth);
  }

  function checkCalendarStatus() {
    fetch('/api/calendar/status', { headers: authHeadersOnly() })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        _calConnected = !!data.connected;
        _calEmail = data.email || '';
        // Persist connection state so it's available immediately on next load
        localStorage.setItem('crm_cal_connected', _calConnected ? '1' : '0');
        localStorage.setItem('crm_cal_email', _calEmail);
        // Re-render header to reflect confirmed connection state, then load events
        if (_calConnected) loadGoogleCalEvents();
        else renderJobsDashboard();
      }).catch(function() {
        _calConnected = false;
        localStorage.setItem('crm_cal_connected', '0');
        localStorage.setItem('crm_cal_email', '');
      });
  }

  function loadGoogleCalEvents() {
    fetch('/api/calendar/events?days=60', { headers: authHeadersOnly() })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        _googleCalEvents = data.events || [];
        renderJobsDashboard();
      }).catch(function() { _googleCalEvents = []; });
  }

  function loadJobsForMonth(year, month) {
    var mm = String(month + 1).padStart(2, '0');
    var monthStr = year + '-' + mm;
    // When a status filter is active, fetch ALL jobs with that status (no month restriction)
    var url = window._jobFilter
      ? '/api/crm/jobs?status=' + window._jobFilter
      : '/api/crm/jobs?month=' + monthStr;
    // Also fetch all jobs for stats (no month filter)
    Promise.all([
      fetch(url, { headers: authHeadersOnly() }).then(function(r) { return r.json(); }),
      fetch('/api/crm/jobs', { headers: authHeadersOnly() }).then(function(r) { return r.json(); })
    ]).then(function(results) {
      _allJobs = results[0].jobs || [];
      _allJobStats = results[1].stats || {};
      renderJobsDashboard();
    }).catch(function() { root.innerHTML = '<p class="text-red-500 p-4">Failed to load jobs.</p>'; });
  }

  function jobTypeColor(type) {
    if (type === 'install') return 'bg-blue-500/15 text-blue-400 border-blue-500/20';
    if (type === 'repair') return 'bg-blue-500/15/15 text-blue-400 border-blue-500/20';
    if (type === 'inspection') return 'bg-blue-500/15 text-blue-400 border-blue-500/20';
    if (type === 'maintenance') return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20';
    return 'bg-white/5 text-gray-300 border-white/10';
  }
  function jobTypeIcon(type) {
    if (type === 'install') return 'fa-home';
    if (type === 'repair') return 'fa-wrench';
    if (type === 'inspection') return 'fa-search';
    if (type === 'maintenance') return 'fa-tools';
    return 'fa-hard-hat';
  }

  var monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  function renderJobsDashboard() {
    var stats = _allJobStats;
    var html = '';

    // A. Header bar
    html += '<div class="flex items-center justify-between mb-5 flex-wrap gap-3">';
    html += '<div><h2 class="text-lg font-bold text-gray-100"><i class="fas fa-hard-hat text-emerald-400 mr-2"></i>Job Management</h2></div>';
    html += '<div class="flex items-center gap-2 flex-wrap">';
    // Google Calendar button
    if (_calConnected) {
      html += '<button onclick="window._crmCalendarSettings()" class="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-emerald-500/20 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/15"><i class="fab fa-google text-emerald-400"></i>Calendar Connected</button>';
      html += '<button onclick="window._crmSyncAllJobs()" class="px-3 py-2 rounded-lg text-xs font-medium border border-blue-500/20 bg-blue-500/10 text-blue-400 hover:bg-blue-500/15"><i class="fas fa-sync-alt mr-1"></i>Sync All</button>';
    } else {
      html += '<button onclick="window._crmCalendarSettings()" class="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-white/15 bg-[#111111] text-gray-400 hover:bg-[#111111]/5"><i class="fab fa-google text-gray-400"></i>Connect Calendar</button>';
    }
    html += '<button onclick="window._crmNewJob()" class="bg-emerald-500/15 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-emerald-500/15"><i class="fas fa-plus mr-1"></i>New Job</button>';
    html += '</div></div>';

    // B. Stats bar
    html += '<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">' +
      '<div class="bg-[#111111] rounded-xl border p-4 text-center"><p class="text-2xl font-black text-gray-100">' + (stats.total || 0) + '</p><p class="text-[10px] text-gray-500">Total Jobs</p></div>' +
      '<div class="bg-[#111111] rounded-xl border p-4 text-center"><p class="text-2xl font-black text-blue-600">' + (stats.scheduled || 0) + '</p><p class="text-[10px] text-gray-500">Scheduled</p></div>' +
      '<div class="bg-[#111111] rounded-xl border p-4 text-center"><p class="text-2xl font-black text-gray-400">' + (stats.in_progress || 0) + '</p><p class="text-[10px] text-gray-500">In Progress</p></div>' +
      '<div class="bg-[#111111] rounded-xl border p-4 text-center"><p class="text-2xl font-black text-emerald-400">' + (stats.completed || 0) + '</p><p class="text-[10px] text-gray-500">Completed</p></div></div>';

    // C. Calendar toolbar
    html += '<div class="flex items-center justify-between mb-4 flex-wrap gap-2">';
    // Left: filter tabs
    html += '<div class="flex gap-1 bg-[#111111] rounded-lg border p-1 overflow-x-auto">';
    var filters = [['','All'],['scheduled','Scheduled'],['in_progress','In Progress'],['completed','Completed']];
    for (var f = 0; f < filters.length; f++) {
      html += '<button onclick="window._crmFilterJobs(\'' + filters[f][0] + '\')" class="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:bg-[#111111]/10 ' + (((!window._jobFilter && !filters[f][0]) || window._jobFilter === filters[f][0]) ? 'bg-brand-600 text-white' : 'text-gray-400') + '">' + filters[f][1] + '</button>';
    }
    html += '</div>';
    // Right: view toggle + nav (hidden when a status filter is active)
    if (!window._jobFilter) {
      html += '<div class="flex items-center gap-2">';
      html += '<div class="flex bg-[#111111] rounded-lg border p-0.5">';
      html += '<button onclick="window._crmSetView(\'month\')" class="px-3 py-1.5 rounded-md text-xs font-medium ' + (_calView === 'month' ? 'bg-brand-600 text-white' : 'text-gray-400 hover:bg-[#111111]/10') + '">Month</button>';
      html += '<button onclick="window._crmSetView(\'week\')" class="px-3 py-1.5 rounded-md text-xs font-medium ' + (_calView === 'week' ? 'bg-brand-600 text-white' : 'text-gray-400 hover:bg-[#111111]/10') + '">Week</button>';
      html += '</div>';
      html += '<button onclick="window._crmPrevPeriod()" class="w-8 h-8 flex items-center justify-center rounded-lg border bg-[#111111] text-gray-400 hover:bg-[#111111]/5"><i class="fas fa-chevron-left text-xs"></i></button>';
      html += '<span class="text-sm font-semibold text-gray-100 min-w-[140px] text-center">' + monthNames[_calMonth] + ' ' + _calYear + '</span>';
      html += '<button onclick="window._crmNextPeriod()" class="w-8 h-8 flex items-center justify-center rounded-lg border bg-[#111111] text-gray-400 hover:bg-[#111111]/5"><i class="fas fa-chevron-right text-xs"></i></button>';
      html += '<button onclick="window._crmCalToday()" class="px-3 py-1.5 rounded-lg border bg-[#111111] text-xs font-medium text-gray-400 hover:bg-[#111111]/5">Today</button>';
      html += '</div>';
    }
    html += '</div>';

    // D/E. Calendar grid or filtered list
    if (window._jobFilter) {
      html += renderFilteredJobsList(_allJobs, window._jobFilter);
    } else if (_calView === 'month') {
      html += renderMonthView(_calYear, _calMonth, _allJobs);
    } else {
      html += renderWeekView();
    }

    root.innerHTML = html;
  }

  function renderFilteredJobsList(jobs, statusFilter) {
    var statusLabels = { scheduled: 'Scheduled', in_progress: 'In Progress', completed: 'Completed' };
    var label = statusLabels[statusFilter] || statusFilter;
    var html = '<div class="bg-[#111111] rounded-xl border overflow-hidden">';
    html += '<div class="px-5 py-3 border-b border-white/10 flex items-center justify-between">';
    html += '<p class="text-sm font-semibold text-gray-100"><i class="fas fa-filter text-brand-400 mr-2"></i>' + label + ' Jobs (' + jobs.length + ')</p>';
    html += '</div>';
    if (jobs.length === 0) {
      html += '<div class="text-center py-12"><i class="fas fa-hard-hat text-3xl text-gray-600 mb-3 block"></i><p class="text-sm text-gray-500">No ' + label.toLowerCase() + ' jobs</p></div>';
    } else {
      html += '<div class="divide-y divide-white/5">';
      for (var i = 0; i < jobs.length; i++) {
        var j = jobs[i];
        html += '<div class="flex items-start gap-4 px-5 py-4 hover:bg-white/5 cursor-pointer" onclick="window._crmViewJob(' + j.id + ')">';
        html += '<div class="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ' + jobTypeColor(j.job_type) + '"><i class="fas ' + jobTypeIcon(j.job_type) + ' text-sm"></i></div>';
        html += '<div class="flex-1 min-w-0">';
        html += '<p class="text-sm font-semibold text-gray-100 truncate">' + (j.title || 'Untitled') + '</p>';
        if (j.customer_name) html += '<p class="text-xs text-gray-400 mt-0.5"><i class="fas fa-user mr-1"></i>' + j.customer_name + '</p>';
        if (j.property_address) html += '<p class="text-xs text-gray-500 mt-0.5 truncate"><i class="fas fa-map-marker-alt mr-1"></i>' + j.property_address + '</p>';
        html += '</div>';
        html += '<div class="text-right flex-shrink-0">';
        if (j.scheduled_date) html += '<p class="text-xs text-gray-400">' + j.scheduled_date + '</p>';
        if (j.scheduled_time) html += '<p class="text-xs text-gray-500">' + j.scheduled_time.substring(0, 5) + '</p>';
        html += '</div>';
        html += '</div>';
      }
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  function renderMonthView(year, month, jobs) {
    var today = new Date();
    var todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    var firstDay = new Date(year, month, 1).getDay(); // 0=Sun
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;

    var html = '<div class="bg-[#111111] rounded-xl border overflow-hidden">';
    // Day headers
    html += '<div class="grid grid-cols-7 border-b bg-[#0A0A0A]">';
    for (var d = 0; d < 7; d++) {
      html += '<div class="text-center text-[10px] font-semibold text-gray-500 uppercase py-2 px-1">' + dayNames[d] + '</div>';
    }
    html += '</div>';
    // Day cells
    html += '<div class="grid grid-cols-7">';
    for (var c = 0; c < totalCells; c++) {
      var dayNum = c - firstDay + 1;
      var isCurrentMonth = dayNum >= 1 && dayNum <= daysInMonth;
      var dateStr = '';
      if (isCurrentMonth) {
        dateStr = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(dayNum).padStart(2, '0');
      }
      var isToday = dateStr === todayStr;
      var borderClass = isToday ? 'border border-brand-500 bg-brand-50/30' : 'border-r border-b border-white/5';

      html += '<div class="min-h-[110px] p-1.5 ' + borderClass + ' ' + (isCurrentMonth ? 'cursor-pointer hover:bg-blue-50/40' : 'bg-[#0A0A0A]/50') + '" onclick="' + (isCurrentMonth ? 'window._crmCalendarDayClick(\'' + dateStr + '\')' : '') + '">';

      if (isCurrentMonth) {
        html += '<div class="flex items-center justify-between mb-1"><span class="text-xs font-semibold ' + (isToday ? 'bg-brand-600 text-white w-6 h-6 flex items-center justify-center rounded-full' : 'text-gray-500') + '">' + dayNum + '</span></div>';

        // Jobs for this day
        var dayJobs = [];
        var dayDeliveries = [];
        for (var ji = 0; ji < jobs.length; ji++) {
          if (jobs[ji].scheduled_date === dateStr) dayJobs.push(jobs[ji]);
          if (jobs[ji].material_delivery_date === dateStr) dayDeliveries.push(jobs[ji]);
        }
        // Google Calendar events for this day
        var dayGCal = [];
        if (_calConnected && _googleCalEvents.length) {
          for (var gi = 0; gi < _googleCalEvents.length; gi++) {
            var evt = _googleCalEvents[gi];
            var evtDate = (evt.start_time || '').substring(0, 10);
            if (evtDate === dateStr && !evt.linked_entity_id) dayGCal.push(evt);
          }
        }

        var maxShow = 3;
        var shown = 0;
        html += '<div class="space-y-0.5">';
        for (var k = 0; k < dayJobs.length && shown < maxShow; k++) {
          var jb = dayJobs[k];
          var statusExtra = jb.status === 'completed' ? ' opacity-60 line-through' : jb.status === 'in_progress' ? ' border-l-2 border-white/15' : '';
          html += '<div class="text-[10px] leading-tight px-1.5 py-0.5 rounded border ' + jobTypeColor(jb.job_type) + statusExtra + ' truncate cursor-pointer" onclick="event.stopPropagation(); window._crmViewJob(' + jb.id + ')" title="' + (jb.title || '').replace(/"/g, '&quot;') + '">';
          html += '<i class="fas ' + jobTypeIcon(jb.job_type) + ' mr-0.5"></i>';
          if (jb.scheduled_time) html += '<span class="font-semibold">' + jb.scheduled_time.substring(0, 5) + '</span> ';
          html += (jb.title || 'Untitled').substring(0, 20);
          html += '</div>';
          shown++;
        }
        // Material deliveries for this day
        for (var dl = 0; dl < dayDeliveries.length && shown < maxShow; dl++) {
          var dj = dayDeliveries[dl];
          html += '<div class="text-[10px] leading-tight px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-400 border border-orange-500/20 truncate cursor-pointer" onclick="event.stopPropagation(); window._crmViewJob(' + dj.id + ')" title="Material Delivery: ' + (dj.title || '').replace(/"/g, '&quot;') + '">';
          html += '<i class="fas fa-truck mr-0.5"></i>';
          html += 'Delivery: ' + (dj.title || 'Job').substring(0, 16);
          html += '</div>';
          shown++;
        }
        // Google Calendar events
        for (var ge = 0; ge < dayGCal.length && shown < maxShow; ge++) {
          var gEvt = dayGCal[ge];
          var gTime = (gEvt.start_time || '').substring(11, 16);
          html += '<div class="text-[10px] leading-tight px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200 truncate" title="' + (gEvt.title || '').replace(/"/g, '&quot;') + '">';
          html += '<i class="fab fa-google mr-0.5 text-[8px]"></i>';
          if (gTime && gTime !== '00:00') html += '<span class="font-semibold">' + gTime + '</span> ';
          html += (gEvt.title || 'Event').substring(0, 20);
          html += '</div>';
          shown++;
        }
        var remaining = (dayJobs.length + dayDeliveries.length + dayGCal.length) - maxShow;
        if (remaining > 0) {
          html += '<div class="text-[9px] text-brand-600 font-medium px-1 cursor-pointer hover:underline" onclick="event.stopPropagation(); window._crmExpandDay(\'' + dateStr + '\')">+' + remaining + ' more</div>';
        }
        html += '</div>';
      } else {
        // Out-of-month cell
        var adjMonth = dayNum < 1 ? month - 1 : month + 1;
        var adjYear = year;
        if (adjMonth < 0) { adjMonth = 11; adjYear--; }
        if (adjMonth > 11) { adjMonth = 0; adjYear++; }
        var adjDay = dayNum < 1 ? new Date(adjYear, adjMonth + 1, 0).getDate() + dayNum : dayNum - daysInMonth;
        html += '<span class="text-xs text-gray-300">' + adjDay + '</span>';
      }
      html += '</div>';
    }
    html += '</div></div>';
    return html;
  }

  function renderWeekView() {
    var today = new Date();
    var todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    // Calculate week start (Sunday) for the current month view's first visible week, or use current week
    if (!_calWeekStart) {
      var d = new Date();
      d.setDate(d.getDate() - d.getDay());
      _calWeekStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }

    var html = '<div class="bg-[#111111] rounded-xl border overflow-hidden">';
    // Day headers with full date
    html += '<div class="grid grid-cols-7 border-b bg-[#0A0A0A]">';
    for (var d = 0; d < 7; d++) {
      var colDate = new Date(_calWeekStart);
      colDate.setDate(colDate.getDate() + d);
      var colStr = colDate.getFullYear() + '-' + String(colDate.getMonth() + 1).padStart(2, '0') + '-' + String(colDate.getDate()).padStart(2, '0');
      var isToday = colStr === todayStr;
      html += '<div class="text-center py-2 px-1 ' + (isToday ? 'bg-brand-50' : '') + '">';
      html += '<div class="text-[10px] font-semibold text-gray-500 uppercase">' + dayNames[d] + '</div>';
      html += '<div class="text-sm font-bold ' + (isToday ? 'text-brand-600' : 'text-gray-300') + '">' + colDate.getDate() + '</div>';
      html += '</div>';
    }
    html += '</div>';
    // Day columns
    html += '<div class="grid grid-cols-7">';
    for (var d = 0; d < 7; d++) {
      var colDate = new Date(_calWeekStart);
      colDate.setDate(colDate.getDate() + d);
      var colStr = colDate.getFullYear() + '-' + String(colDate.getMonth() + 1).padStart(2, '0') + '-' + String(colDate.getDate()).padStart(2, '0');
      var isToday = colStr === todayStr;

      html += '<div class="min-h-[250px] p-2 ' + (isToday ? 'bg-brand-50/20 border border-brand-200' : 'border-r border-b border-white/5') + ' cursor-pointer hover:bg-blue-50/30" onclick="window._crmCalendarDayClick(\'' + colStr + '\')">';

      // Jobs for this day
      var dayJobs = [];
      for (var ji = 0; ji < _allJobs.length; ji++) {
        if (_allJobs[ji].scheduled_date === colStr) dayJobs.push(_allJobs[ji]);
      }
      // Sort by time
      dayJobs.sort(function(a, b) { return (a.scheduled_time || '99:99').localeCompare(b.scheduled_time || '99:99'); });

      html += '<div class="space-y-1.5">';
      for (var k = 0; k < dayJobs.length; k++) {
        var jb = dayJobs[k];
        var statusExtra = jb.status === 'completed' ? ' opacity-60' : jb.status === 'in_progress' ? ' border-l-2 border-white/15' : '';
        html += '<div class="text-xs p-2 rounded-lg border ' + jobTypeColor(jb.job_type) + statusExtra + ' cursor-pointer hover:shadow-sm" onclick="event.stopPropagation(); window._crmViewJob(' + jb.id + ')">';
        html += '<div class="font-semibold text-[11px] truncate"><i class="fas ' + jobTypeIcon(jb.job_type) + ' mr-1"></i>' + (jb.title || 'Untitled') + '</div>';
        if (jb.scheduled_time) html += '<div class="text-[10px] mt-0.5 opacity-75"><i class="fas fa-clock mr-0.5"></i>' + jb.scheduled_time.substring(0, 5) + '</div>';
        if (jb.customer_name) html += '<div class="text-[10px] mt-0.5 opacity-75 truncate"><i class="fas fa-user mr-0.5"></i>' + jb.customer_name + '</div>';
        if (jb.property_address) html += '<div class="text-[10px] mt-0.5 opacity-75 truncate"><i class="fas fa-map-marker-alt mr-0.5"></i>' + jb.property_address + '</div>';
        if (jb.crew_size) html += '<div class="text-[10px] mt-0.5 opacity-75"><i class="fas fa-users mr-0.5"></i>' + jb.crew_size + ' crew</div>';
        html += '</div>';
      }
      // Google Cal events
      if (_calConnected && _googleCalEvents.length) {
        for (var gi = 0; gi < _googleCalEvents.length; gi++) {
          var evt = _googleCalEvents[gi];
          if ((evt.start_time || '').substring(0, 10) === colStr && !evt.linked_entity_id) {
            var gTime = (evt.start_time || '').substring(11, 16);
            html += '<div class="text-xs p-2 rounded-lg bg-red-50 text-red-700 border border-red-200">';
            html += '<div class="font-semibold text-[11px] truncate"><i class="fab fa-google mr-1 text-[9px]"></i>' + (evt.title || 'Event') + '</div>';
            if (gTime && gTime !== '00:00') html += '<div class="text-[10px] mt-0.5 opacity-75"><i class="fas fa-clock mr-0.5"></i>' + gTime + '</div>';
            if (evt.location) html += '<div class="text-[10px] mt-0.5 opacity-75 truncate"><i class="fas fa-map-marker-alt mr-0.5"></i>' + evt.location + '</div>';
            html += '</div>';
          }
        }
      }
      html += '</div></div>';
    }
    html += '</div></div>';
    return html;
  }

  // Calendar navigation
  window._crmPrevPeriod = function() {
    if (_calView === 'month') {
      _calMonth--;
      if (_calMonth < 0) { _calMonth = 11; _calYear--; }
      loadJobsForMonth(_calYear, _calMonth);
    } else {
      if (!_calWeekStart) { _calWeekStart = new Date(); _calWeekStart.setDate(_calWeekStart.getDate() - _calWeekStart.getDay()); }
      _calWeekStart.setDate(_calWeekStart.getDate() - 7);
      _calYear = _calWeekStart.getFullYear();
      _calMonth = _calWeekStart.getMonth();
      loadJobsForMonth(_calYear, _calMonth);
    }
  };
  window._crmNextPeriod = function() {
    if (_calView === 'month') {
      _calMonth++;
      if (_calMonth > 11) { _calMonth = 0; _calYear++; }
      loadJobsForMonth(_calYear, _calMonth);
    } else {
      if (!_calWeekStart) { _calWeekStart = new Date(); _calWeekStart.setDate(_calWeekStart.getDate() - _calWeekStart.getDay()); }
      _calWeekStart.setDate(_calWeekStart.getDate() + 7);
      _calYear = _calWeekStart.getFullYear();
      _calMonth = _calWeekStart.getMonth();
      loadJobsForMonth(_calYear, _calMonth);
    }
  };
  window._crmCalToday = function() {
    _calYear = new Date().getFullYear();
    _calMonth = new Date().getMonth();
    var d = new Date(); d.setDate(d.getDate() - d.getDay());
    _calWeekStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    loadJobsForMonth(_calYear, _calMonth);
  };
  window._crmSetView = function(mode) {
    _calView = mode;
    localStorage.setItem('crm_cal_view', mode);
    if (mode === 'week' && !_calWeekStart) {
      var d = new Date(); d.setDate(d.getDate() - d.getDay());
      _calWeekStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }
    renderJobsDashboard();
  };

  // Quick-add from calendar day click
  window._crmCalendarDayClick = function(dateStr) {
    window._prefillJobDate = dateStr;
    window._crmNewJob();
  };

  // Expand day — show all jobs for a day in a modal
  window._crmExpandDay = function(dateStr) {
    var dayJobs = [];
    for (var i = 0; i < _allJobs.length; i++) {
      if (_allJobs[i].scheduled_date === dateStr) dayJobs.push(_allJobs[i]);
    }
    var body = '<div class="space-y-2">';
    if (dayJobs.length === 0) {
      body += '<p class="text-gray-500 text-sm">No jobs for this day.</p>';
    }
    for (var k = 0; k < dayJobs.length; k++) {
      var jb = dayJobs[k];
      body += '<div class="flex items-center gap-3 p-3 rounded-lg border ' + jobTypeColor(jb.job_type) + ' cursor-pointer hover:shadow-sm" onclick="closeModal(); window._crmViewJob(' + jb.id + ')">';
      body += '<i class="fas ' + jobTypeIcon(jb.job_type) + '"></i>';
      body += '<div class="min-w-0 flex-1"><div class="font-semibold text-sm truncate">' + (jb.title || 'Untitled') + '</div>';
      body += '<div class="text-xs opacity-75">' + (jb.scheduled_time ? jb.scheduled_time.substring(0, 5) + ' ' : '') + (jb.customer_name || '') + '</div>';
      body += '</div>' + badge(jb.status) + '</div>';
    }
    body += '</div>';
    showModal('Jobs on ' + dateStr, body);
  };

  // Google Calendar settings modal
  window._crmCalendarSettings = function() {
    var body = '';
    if (_calConnected) {
      body += '<div class="bg-green-50 border border-green-200 rounded-xl p-4 mb-4 flex items-center gap-3">';
      body += '<i class="fab fa-google text-emerald-400 text-xl"></i>';
      body += '<div><p class="font-semibold text-green-800">Google Calendar Connected</p>';
      body += '<p class="text-xs text-emerald-400">' + _calEmail + '</p></div></div>';
      body += '<div class="space-y-3">';
      body += '<button onclick="window._crmSyncAllJobs(); closeModal();" class="w-full px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700"><i class="fas fa-sync-alt mr-2"></i>Sync All Jobs to Google Calendar</button>';
      body += '<p class="text-xs text-gray-500 text-center">This will create/update Google Calendar events for all scheduled and in-progress jobs.</p>';
      body += '<hr class="my-3">';
      body += '<button onclick="window._crmDisconnectCalendar()" class="w-full px-4 py-2 bg-[#111111] border border-red-300 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50"><i class="fas fa-unlink mr-2"></i>Disconnect Calendar</button>';
      body += '<p class="text-[10px] text-gray-400 text-center">Note: This will also disconnect Gmail email sending.</p>';
      body += '</div>';
    } else {
      body += '<div class="text-center py-4">';
      body += '<div class="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-4"><i class="fab fa-google text-gray-400 text-2xl"></i></div>';
      body += '<h3 class="text-lg font-semibold text-gray-300 mb-2">Connect Google Calendar</h3>';
      body += '<p class="text-sm text-gray-500 mb-4">Sync your CRM jobs with Google Calendar to see them alongside your other appointments.</p>';
      body += '<ul class="text-left text-xs text-gray-500 space-y-1.5 mb-5 max-w-xs mx-auto">';
      body += '<li><i class="fas fa-check text-green-500 mr-2"></i>See jobs on your Google Calendar</li>';
      body += '<li><i class="fas fa-check text-green-500 mr-2"></i>Get reminders before scheduled jobs</li>';
      body += '<li><i class="fas fa-check text-green-500 mr-2"></i>View Google Calendar events here</li>';
      body += '<li><i class="fas fa-check text-green-500 mr-2"></i>Automatic attendee invitations</li>';
      body += '</ul>';
      body += '<button onclick="window._crmConnectCalendar()" class="px-6 py-2.5 bg-brand-600 text-white rounded-xl font-semibold hover:bg-brand-700"><i class="fab fa-google mr-2"></i>Connect with Google</button>';
      body += '</div>';
    }
    showModal('Google Calendar', body);
  };

  window._crmConnectCalendar = function() {
    closeModal();
    var popup = window.open('about:blank', 'calOAuth', 'width=600,height=700');
    fetch('/api/crm/gmail/connect', { headers: authHeadersOnly() })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.auth_url && popup) { popup.location.href = data.auth_url; }
        else if (data.auth_url) { popup = window.open(data.auth_url, 'calOAuth', 'width=600,height=700'); }
        else { if (popup) popup.close(); toast(data.error || 'Not configured', 'error'); }
      }).catch(function() { if (popup) popup.close(); toast('Failed to connect', 'error'); });
    var poll = setInterval(function() {
      try {
        if (!popup || popup.closed) {
          clearInterval(poll);
          setTimeout(function() {
            checkCalendarStatus();
            loadJobsForMonth(_calYear, _calMonth);
          }, 1000);
        }
      } catch(e) {}
    }, 500);
  };

  window._crmDisconnectCalendar = async function() {
    if (!(await window.rmConfirm('Disconnect Google Calendar? This will also disconnect Gmail email sending.'))) return
    closeModal();
    fetch('/api/crm/gmail/disconnect', { method: 'POST', headers: authHeaders() })
      .then(function() {
        _calConnected = false;
        _calEmail = '';
        _googleCalEvents = [];
        localStorage.setItem('crm_cal_connected', '0');
        localStorage.setItem('crm_cal_email', '');
        toast('Google Calendar disconnected');
        renderJobsDashboard();
      }).catch(function() { toast('Failed to disconnect', 'error'); });
  };

  // Sync functions
  window._crmSyncJobToCalendar = function(jobId) {
    toast('Syncing to Google Calendar...');
    fetch('/api/calendar/sync-job/' + jobId, { method: 'POST', headers: authHeaders() })
      .then(function(r) { return r.json(); })
      .then(function(res) {
        if (res.success) toast('Job synced to Google Calendar!');
        else toast(res.error || 'Sync failed', 'error');
      }).catch(function() { toast('Sync failed', 'error'); });
  };

  window._crmSyncAllJobs = function() {
    toast('Syncing all jobs to Google Calendar...');
    fetch('/api/calendar/sync-all-jobs', { method: 'POST', headers: authHeaders() })
      .then(function(r) { return r.json(); })
      .then(function(res) {
        if (res.success) toast((res.synced || 0) + ' jobs synced to Google Calendar!');
        else toast(res.error || 'Sync failed', 'error');
      }).catch(function() { toast('Sync failed', 'error'); });
  };

  window._jobFilter = '';
  window._crmFilterJobs = function(s) { window._jobFilter = s; loadJobsForMonth(_calYear, _calMonth); };

  window._crmNewJob = function() {
    fetch('/api/crm/customers', { headers: authHeadersOnly() })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var custs = data.customers || [];
        var body = '<div class="space-y-3">' +
          '<div><label class="block text-xs font-medium text-gray-400 mb-1">Customer</label>' + customerSelectHTML(custs, '', 'jobCustomer') + '</div>' +
          '<div><label class="block text-xs font-medium text-gray-400 mb-1">Job Title *</label><input type="text" id="jobTitle" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm" placeholder="e.g. Roof Replacement - 123 Main St"></div>' +
          '<div><label class="block text-xs font-medium text-gray-400 mb-1">Property Address</label><input type="text" id="jobAddress" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm"></div>' +
          '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3"><div><label class="block text-xs font-medium text-gray-400 mb-1">Scheduled Date *</label><input type="date" id="jobDate" class="w-full px-2 py-2 border border-white/15 rounded-lg text-sm"></div><div><label class="block text-xs font-medium text-gray-400 mb-1">Time</label><input type="time" id="jobTime" class="w-full px-2 py-2 border border-white/15 rounded-lg text-sm"></div></div>' +
          '<div class="grid grid-cols-3 gap-3"><div><label class="block text-xs font-medium text-gray-400 mb-1">Job Type</label><select id="jobType" class="w-full px-2 py-2 border border-white/15 rounded-lg text-sm"><option value="install">Install</option><option value="repair">Repair</option><option value="inspection">Inspection</option><option value="maintenance">Maintenance</option></select></div><div><label class="block text-xs font-medium text-gray-400 mb-1">Duration</label><input type="text" id="jobDuration" class="w-full px-2 py-2 border border-white/15 rounded-lg text-sm" placeholder="e.g. 2 days"></div><div><label class="block text-xs font-medium text-gray-400 mb-1">Crew Size</label><input type="number" id="jobCrew" class="w-full px-2 py-2 border border-white/15 rounded-lg text-sm" value="4"></div></div>' +
          '<div><label class="block text-xs font-medium text-gray-400 mb-1">Notes</label><textarea id="jobNotes" rows="2" class="w-full px-2 py-2 border border-white/15 rounded-lg text-sm"></textarea></div>' +
          '<div class="bg-[#0A0A0A] rounded-xl p-3 border border-white/10">' +
            '<div class="flex items-center justify-between">' +
              '<div class="flex items-center gap-2"><i class="fas fa-truck text-orange-400"></i><span class="text-sm font-medium text-gray-200">Material Delivery Day</span></div>' +
              '<label class="relative inline-flex items-center cursor-pointer"><input type="checkbox" id="jobMaterialToggle" class="sr-only peer" onchange="var s=document.getElementById(\'jobMaterialSection\');s.className=this.checked?\'mt-3\':\'mt-3 hidden\'"><div class="w-9 h-5 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[\'\'] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-400 after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-orange-500"></div></label>' +
            '</div>' +
            '<div id="jobMaterialSection" class="mt-3 hidden">' +
              '<label class="block text-xs font-medium text-gray-400 mb-1">Delivery Date</label>' +
              '<input type="date" id="jobMaterialDate" class="w-full px-2 py-2 border border-white/15 rounded-lg text-sm bg-[#111111]">' +
              '<p class="text-[10px] text-gray-500 mt-1">This will appear on your calendar as a separate delivery event</p>' +
            '</div>' +
          '</div></div>';

        showModal('Schedule New Job', body, function() {
          var title = document.getElementById('jobTitle').value.trim();
          var date = document.getElementById('jobDate').value;
          if (!title || !date) { toast('Title and date required', 'error'); return; }
          var custData = getCustomerFromSelector('jobCustomer');
          var materialDate = document.getElementById('jobMaterialToggle').checked ? (document.getElementById('jobMaterialDate').value || null) : null;
          var payload = Object.assign({}, custData || {}, {
            title: title, property_address: document.getElementById('jobAddress').value.trim(),
            scheduled_date: date, scheduled_time: document.getElementById('jobTime').value || null,
            job_type: document.getElementById('jobType').value,
            estimated_duration: document.getElementById('jobDuration').value.trim() || null,
            crew_size: parseInt(document.getElementById('jobCrew').value) || null,
            notes: document.getElementById('jobNotes').value.trim(),
            material_delivery_date: materialDate
          });
          fetch('/api/crm/jobs', { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) })
            .then(function(r) { return r.json(); })
            .then(function(res) { if (res.success) { closeModal(); toast('Job scheduled!'); loadJobsForMonth(_calYear, _calMonth); } else { toast(res.error || 'Failed', 'error'); } })
            .catch(function(e) { toast('Failed to create job: ' + (e.message || 'Network error'), 'error'); });
        }, 'Schedule Job');

        // Pre-fill date if clicked from calendar
        if (window._prefillJobDate) {
          setTimeout(function() {
            var dateInput = document.getElementById('jobDate');
            if (dateInput) dateInput.value = window._prefillJobDate;
            window._prefillJobDate = null;
          }, 50);
        }
      });
  };

  window._crmMarkJob = function(id, status) {
    fetch('/api/crm/jobs/' + id, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ status: status }) })
      .then(function(r) { return r.json(); })
      .then(function(res) { if (res.success) { toast('Job updated'); loadJobsForMonth(_calYear, _calMonth); } })
      .catch(function(e) { toast('Failed to update job: ' + (e.message || 'Network error'), 'error'); });
  };

  window._crmViewJob = function(id) {
    fetch('/api/crm/jobs/' + id, { headers: authHeadersOnly() })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var j = data.job;
        var checklist = data.checklist || [];
        var body = '<div class="space-y-4">' +
          '<div class="flex items-center gap-2 mb-2"><span class="font-mono text-xs font-bold text-emerald-400">' + j.job_number + '</span>' + badge(j.status) + '</div>' +
          '<h3 class="text-lg font-bold text-gray-100">' + j.title + '</h3>' +
          '<div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-gray-400">' +
          '<div><i class="fas fa-calendar mr-2 text-gray-400"></i>' + fmtDate(j.scheduled_date) + (j.scheduled_time ? ' ' + j.scheduled_time : '') + '</div>' +
          (j.customer_name ? '<div><i class="fas fa-user mr-2 text-gray-400"></i>' + j.customer_name + '</div>' : '') +
          (j.property_address ? '<div><i class="fas fa-map-marker-alt mr-2 text-gray-400"></i>' + j.property_address + '</div>' : '') +
          (j.crew_size ? '<div><i class="fas fa-users mr-2 text-gray-400"></i>' + j.crew_size + ' crew</div>' : '') +
          (j.job_type ? '<div><i class="fas ' + jobTypeIcon(j.job_type) + ' mr-2 text-gray-400"></i>' + (j.job_type || '').charAt(0).toUpperCase() + (j.job_type || '').slice(1) + '</div>' : '') +
          (j.estimated_duration ? '<div><i class="fas fa-hourglass-half mr-2 text-gray-400"></i>' + j.estimated_duration + '</div>' : '') +
          (j.material_delivery_date ? '<div><i class="fas fa-truck mr-2 text-orange-400"></i>Material Delivery: ' + fmtDate(j.material_delivery_date) + '</div>' : '') +
          '</div>';

        // Action buttons
        body += '<div class="flex flex-wrap gap-2 pt-2">';
        if (j.status === 'scheduled') body += '<button onclick="window._crmMarkJob(' + j.id + ',\'in_progress\'); closeModal();" class="px-3 py-1.5 bg-blue-500/15/15 text-blue-400 rounded-lg text-xs font-medium hover:bg-white/10"><i class="fas fa-play mr-1"></i>Start Job</button>';
        if (j.status === 'in_progress') body += '<button onclick="window._crmMarkJob(' + j.id + ',\'completed\'); closeModal();" class="px-3 py-1.5 bg-emerald-500/15 text-emerald-400 rounded-lg text-xs font-medium hover:bg-green-200"><i class="fas fa-check mr-1"></i>Complete</button>';
        if (_calConnected) body += '<button onclick="window._crmSyncJobToCalendar(' + j.id + ')" class="px-3 py-1.5 bg-[#111111] border border-white/15 text-gray-300 rounded-lg text-xs font-medium hover:bg-[#111111]/5"><i class="fab fa-google mr-1 text-blue-500"></i>Sync to Calendar</button>';
        body += '<button onclick="window._crmDeleteJob(' + j.id + '); closeModal();" class="px-3 py-1.5 bg-[#111111] border border-red-200 text-red-600 rounded-lg text-xs font-medium hover:bg-red-50"><i class="fas fa-trash mr-1"></i>Delete</button>';
        body += '</div>';

        // Checklist section
        body += '<div class="pt-3 border-t"><h4 class="text-xs font-bold text-gray-500 uppercase mb-2">Checklist</h4><div id="checklistItems" class="space-y-2">';
        if (checklist.length > 0) {
          for (var k = 0; k < checklist.length; k++) {
            var item = checklist[k];
            body += '<div class="flex items-center gap-3 bg-[#0A0A0A] rounded-lg px-3 py-2" id="clItem' + item.id + '"><input type="checkbox" ' + (item.is_completed ? 'checked' : '') + ' onchange="window._crmToggleChecklist(' + j.id + ',' + item.id + ',this.checked)" class="w-4 h-4 text-brand-600 rounded border-white/15"><span class="text-sm flex-1 ' + (item.is_completed ? 'line-through text-gray-400' : 'text-gray-300') + '">' + item.label + '</span><button onclick="window._crmDeleteChecklistItem(' + j.id + ',' + item.id + ')" class="text-gray-400 hover:text-red-500 ml-1 flex-shrink-0" title="Remove item"><i class="fas fa-times text-xs"></i></button></div>';
          }
        } else {
          body += '<p class="text-xs text-gray-400 italic" id="noChecklistMsg">No checklist items yet.</p>';
        }
        body += '</div>';
        body += '<div class="mt-3 flex items-center gap-2"><input type="text" id="newChecklistLabel" placeholder="Add checklist item..." class="flex-1 px-3 py-2 border border-white/15 rounded-lg text-sm focus:ring-2 focus:ring-brand-500" onkeydown="if(event.key===\'Enter\')window._crmAddChecklistItem(' + j.id + ')"><button onclick="window._crmAddChecklistItem(' + j.id + ')" class="px-3 py-2 bg-emerald-500/15 text-white rounded-lg text-sm font-semibold hover:bg-emerald-500/15 flex-shrink-0"><i class="fas fa-plus mr-1"></i>Add</button></div>';
        body += '</div>';

        if (j.notes) body += '<div class="pt-3 border-t"><p class="text-sm text-gray-500 italic">' + j.notes + '</p></div>';

        // Crew & Progress sections
        body += '<div class="pt-3 border-t flex gap-2">';
        body += '<button onclick="window._crewAssignJob(' + j.id + ')" class="flex-1 py-2 bg-emerald-500/15 text-emerald-400 rounded-lg text-xs font-semibold hover:bg-emerald-500/15"><i class="fas fa-hard-hat mr-1"></i>Manage Crew</button>';
        body += '<button onclick="window._crewAddProgress(' + j.id + ')" class="flex-1 py-2 bg-blue-500/15 text-blue-400 rounded-lg text-xs font-semibold hover:bg-blue-200"><i class="fas fa-camera mr-1"></i>Add Progress</button>';
        body += '</div>';

        body += '</div>';
        showModal(j.title, body);

        // Load crew + progress asynchronously and inject
        Promise.all([
          fetch('/api/crm/jobs/' + j.id + '/crew', { headers: authHeadersOnly() }).then(function(r) { return r.json(); }),
          fetch('/api/crm/jobs/' + j.id + '/progress', { headers: authHeadersOnly() }).then(function(r) { return r.json(); })
        ]).then(function(results) {
          var crewList = results[0].crew || [];
          var progress = results[1].updates || [];
          var extra = '';
          if (crewList.length > 0) {
            extra += '<div class="pt-3 border-t mt-3"><h4 class="text-xs font-bold text-gray-500 uppercase mb-2"><i class="fas fa-hard-hat mr-1"></i>Assigned Crew</h4><div class="flex flex-wrap gap-2">';
            crewList.forEach(function(c) {
              extra += '<span class="px-2.5 py-1 bg-emerald-500/15 border border-emerald-200 rounded-lg text-xs font-medium text-emerald-400"><i class="fas fa-user mr-1"></i>' + (c.name || 'Crew') + '<span class="ml-1 text-[9px] text-emerald-400 capitalize">' + (c.role || '') + '</span></span>';
            });
            extra += '</div></div>';
          }
          if (progress.length > 0) {
            extra += '<div class="pt-3 border-t mt-3"><h4 class="text-xs font-bold text-gray-500 uppercase mb-2"><i class="fas fa-stream mr-1"></i>Progress (' + progress.length + ')</h4><div class="space-y-2 max-h-48 overflow-y-auto">';
            progress.forEach(function(p) {
              extra += '<div class="bg-[#0A0A0A] rounded-lg p-2.5"><div class="flex items-center justify-between mb-1"><span class="text-xs font-semibold text-gray-300">' + (p.author_name || 'Unknown') + '</span><span class="text-[10px] text-gray-400">' + fmtDate(p.created_at) + '</span></div>';
              if (p.update_type === 'walkaround') {
                extra += '<div class="flex items-center gap-1.5 mb-1.5"><i class="fas fa-microphone text-orange-400 text-[10px]"></i><span class="text-[10px] font-bold text-orange-400 uppercase">Voice Walkaround</span></div>';
                if (p.audio_data) extra += '<audio controls class="w-full h-8 mb-2" style="min-height:32px"><source src="' + p.audio_data + '" type="audio/webm">Audio not supported</audio>';
                if (p.content) extra += '<div class="text-xs text-gray-300 whitespace-pre-wrap">' + (p.content || '').replace(/\*\*([^*]+)\*\*/g, '<strong class="text-white">$1</strong>') + '</div>';
                if (p.transcription) extra += '<details class="mt-1.5"><summary class="text-[10px] text-gray-500 cursor-pointer">Raw transcript</summary><p class="text-[10px] text-gray-500 mt-1">' + p.transcription + '</p></details>';
              } else {
                if (p.content) extra += '<p class="text-xs text-gray-400">' + p.content + '</p>';
                if (p.photo_data) extra += '<img src="' + p.photo_data + '" class="mt-1.5 rounded-lg max-h-32 object-cover border" alt="' + (p.photo_caption || 'Progress photo') + '">';
                if (p.photo_caption) extra += '<p class="text-[10px] text-gray-400 mt-0.5">' + p.photo_caption + '</p>';
              }
              extra += '</div>';
            });
            extra += '</div></div>';
          }
          if (extra) {
            var modalBody = document.getElementById('modalBody');
            if (modalBody) modalBody.insertAdjacentHTML('beforeend', extra);
          }
        }).catch(function() {});
      })
      .catch(function(e) { toast('Failed to load job details', 'error'); });
  };

  window._crmToggleChecklist = function(jobId, itemId, checked) {
    fetch('/api/crm/jobs/' + jobId + '/checklist/' + itemId, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ is_completed: checked }) })
      .catch(function(e) { toast('Failed to update checklist', 'error'); });
  };

  window._crmAddChecklistItem = function(jobId) {
    var input = document.getElementById('newChecklistLabel');
    if (!input) return;
    var label = input.value.trim();
    if (!label) { toast('Enter a checklist item name', 'error'); return; }
    fetch('/api/crm/jobs/' + jobId + '/checklist', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ label: label, item_type: 'custom' }) })
      .then(function(r) { return r.json(); })
      .then(function(res) {
        if (res.success) {
          var noMsg = document.getElementById('noChecklistMsg');
          if (noMsg) noMsg.remove();
          var container = document.getElementById('checklistItems');
          if (container) {
            var div = document.createElement('div');
            div.className = 'flex items-center gap-3 bg-[#0A0A0A] rounded-lg px-3 py-2';
            div.id = 'clItem' + res.id;
            div.innerHTML = '<input type="checkbox" onchange="window._crmToggleChecklist(' + jobId + ',' + res.id + ',this.checked)" class="w-4 h-4 text-brand-600 rounded border-white/15"><span class="text-sm flex-1 text-gray-300">' + label + '</span><button onclick="window._crmDeleteChecklistItem(' + jobId + ',' + res.id + ')" class="text-gray-400 hover:text-red-500 ml-1 flex-shrink-0" title="Remove item"><i class="fas fa-times text-xs"></i></button>';
            container.appendChild(div);
          }
          input.value = '';
          toast('Item added!');
        } else {
          toast(res.error || 'Failed to add item', 'error');
        }
      })
      .catch(function() { toast('Network error', 'error'); });
  };

  window._crmDeleteChecklistItem = async function(jobId, itemId) {
    if (!(await window.rmConfirm('Remove this checklist item?'))) return
    fetch('/api/crm/jobs/' + jobId + '/checklist/' + itemId, { method: 'DELETE', headers: authHeadersOnly() })
      .then(function(r) { return r.json(); })
      .then(function(res) {
        if (res.success) {
          var el = document.getElementById('clItem' + itemId);
          if (el) el.remove();
          toast('Item removed');
        }
      })
      .catch(function() { toast('Network error', 'error'); });
  };

  window._crmDeleteJob = async function(id) {
    if (!(await window.rmConfirm('Delete this job?'))) return
    fetch('/api/crm/jobs/' + id, { method: 'DELETE', headers: authHeadersOnly() })
      .then(function() { toast('Job deleted'); loadJobsForMonth(_calYear, _calMonth); })
      .catch(function(e) { toast('Failed to delete: ' + (e.message || 'Network error'), 'error'); });
  };

  // ============================================================
  // MODULE: SUPPLIER MANAGEMENT
  // ============================================================
  function initSuppliers() {
    var suppliers = [];
    var orders = [];

    async function loadData() {
      try {
        var [supRes, ordRes] = await Promise.all([
          fetch('/api/crm/suppliers', { headers: authHeaders() }),
          fetch('/api/crm/supplier-orders', { headers: authHeaders() })
        ]);
        if (supRes.ok) { var d = await supRes.json(); suppliers = d.suppliers || []; }
        if (ordRes.ok) { var d2 = await ordRes.json(); orders = d2.orders || []; }
      } catch(e) {}
      renderSuppliers();
    }

    function renderSuppliers() {
      root.innerHTML =
        '<div class="mb-6 flex items-center justify-between">' +
          '<div><h2 class="text-xl font-bold text-white"><i class="fas fa-store text-emerald-400 mr-2"></i>Supplier Management</h2>' +
          '<p class="text-gray-400 text-sm mt-1">Manage your material suppliers and track orders</p></div>' +
          '<button onclick="window._supAdd()" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold"><i class="fas fa-plus mr-1.5"></i>Add Supplier</button>' +
        '</div>' +

        // Suppliers list
        '<div class="mb-8">' +
          '<h3 class="text-white font-semibold text-sm mb-3">Your Suppliers</h3>' +
          (suppliers.length === 0 ?
            '<div class="bg-[#111111] rounded-xl border border-white/10 p-8 text-center">' +
              '<i class="fas fa-store text-gray-600 text-4xl mb-3"></i>' +
              '<p class="text-gray-400 font-medium">No suppliers set up yet</p>' +
              '<p class="text-gray-500 text-sm mt-1">Add a supplier to start creating material orders</p>' +
              '<button onclick="window._supAdd()" class="mt-4 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold">Add Your First Supplier</button>' +
            '</div>'
          :
            '<div class="grid gap-4">' +
              suppliers.map(function(s) {
                return '<div class="bg-[#111111] rounded-xl border border-white/10 p-5">' +
                  '<div class="flex items-start justify-between mb-3">' +
                    '<div class="flex items-center gap-3">' +
                      '<div class="w-10 h-10 bg-emerald-500/15 rounded-lg flex items-center justify-center"><i class="fas fa-store text-emerald-400"></i></div>' +
                      '<div>' +
                        '<div class="text-white font-bold">' + (s.name || 'Unnamed') + '</div>' +
                        (s.branch_name ? '<div class="text-gray-400 text-xs">' + s.branch_name + '</div>' : '') +
                      '</div>' +
                    '</div>' +
                    '<div class="flex gap-2">' +
                      '<button onclick="window._supEdit(' + s.id + ')" class="text-blue-400 hover:text-blue-300 text-xs"><i class="fas fa-edit"></i></button>' +
                    '</div>' +
                  '</div>' +
                  '<div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">' +
                    (s.account_number ? '<div><span class="text-gray-500">Account #:</span> <span class="text-gray-300">' + s.account_number + '</span></div>' : '') +
                    (s.phone ? '<div><span class="text-gray-500">Phone:</span> <span class="text-gray-300">' + s.phone + '</span></div>' : '') +
                    (s.email ? '<div><span class="text-gray-500">Email:</span> <span class="text-gray-300">' + s.email + '</span></div>' : '') +
                    (s.address ? '<div><span class="text-gray-500">Address:</span> <span class="text-gray-300">' + s.address + (s.city ? ', ' + s.city : '') + '</span></div>' : '') +
                    (s.rep_name ? '<div><span class="text-gray-500">Rep:</span> <span class="text-gray-300">' + s.rep_name + '</span></div>' : '') +
                    (s.rep_phone ? '<div><span class="text-gray-500">Rep Phone:</span> <span class="text-gray-300">' + s.rep_phone + '</span></div>' : '') +
                    (s.rep_email ? '<div><span class="text-gray-500">Rep Email:</span> <span class="text-gray-300">' + s.rep_email + '</span></div>' : '') +
                  '</div>' +
                '</div>';
              }).join('') +
            '</div>'
          ) +
        '</div>' +

        // Supplier Orders
        '<div>' +
          '<h3 class="text-white font-semibold text-sm mb-3">Material Orders (' + orders.length + ')</h3>' +
          (orders.length === 0 ?
            '<div class="bg-[#111111] rounded-xl border border-white/10 p-6 text-center">' +
              '<p class="text-gray-500 text-sm">No material orders yet. Orders are created from the Proposals module.</p>' +
            '</div>'
          :
            '<div class="bg-[#111111] rounded-xl border border-white/10 overflow-hidden">' +
              '<table class="w-full text-sm">' +
                '<thead><tr class="border-b border-white/5">' +
                  '<th class="text-left px-4 py-3 text-xs text-gray-500 font-semibold">Order #</th>' +
                  '<th class="text-left px-4 py-3 text-xs text-gray-500 font-semibold">Supplier</th>' +
                  '<th class="text-left px-4 py-3 text-xs text-gray-500 font-semibold">Job Address</th>' +
                  '<th class="text-right px-4 py-3 text-xs text-gray-500 font-semibold">Total</th>' +
                  '<th class="text-left px-4 py-3 text-xs text-gray-500 font-semibold">Date</th>' +
                  '<th class="text-right px-4 py-3 text-xs text-gray-500 font-semibold">Actions</th>' +
                '</tr></thead>' +
                '<tbody>' +
                  orders.map(function(o) {
                    return '<tr class="border-b border-white/5 hover:bg-white/5">' +
                      '<td class="px-4 py-3 text-white font-medium">' + (o.order_number || '—') + '</td>' +
                      '<td class="px-4 py-3 text-gray-300">' + (o.supplier_name || '—') + '</td>' +
                      '<td class="px-4 py-3 text-gray-400 text-xs">' + (o.job_address || '—') + '</td>' +
                      '<td class="px-4 py-3 text-right text-white font-semibold">$' + Number(o.total_amount || 0).toFixed(2) + '</td>' +
                      '<td class="px-4 py-3 text-gray-500 text-xs">' + (o.created_at || '').slice(0, 10) + '</td>' +
                      '<td class="px-4 py-3 text-right"><button onclick="window.open(\'/api/crm/supplier-orders/' + o.id + '/print\',\'_blank\')" class="px-3 py-1 bg-blue-500/15 text-blue-400 rounded text-xs font-semibold hover:bg-blue-500/25"><i class="fas fa-print mr-1"></i>Print/PDF</button></td>' +
                    '</tr>';
                  }).join('') +
                '</tbody>' +
              '</table>' +
            '</div>'
          ) +
        '</div>';
    }

    window._supAdd = function() {
      showModal('Add Supplier',
        '<div class="space-y-3">' +
          '<div class="grid grid-cols-2 gap-3">' +
            '<div><label class="block text-xs font-semibold text-gray-400 mb-1">Supplier Name *</label><input id="sup-m-name" class="w-full bg-[#0A0A0A] border border-white/10 rounded-lg px-3 py-2 text-sm text-white" placeholder="e.g. Roof Mart"></div>' +
            '<div><label class="block text-xs font-semibold text-gray-400 mb-1">Branch Name</label><input id="sup-m-branch" class="w-full bg-[#0A0A0A] border border-white/10 rounded-lg px-3 py-2 text-sm text-white" placeholder="e.g. South Edmonton"></div>' +
          '</div>' +
          '<div class="grid grid-cols-2 gap-3">' +
            '<div><label class="block text-xs font-semibold text-gray-400 mb-1">Account #</label><input id="sup-m-account" class="w-full bg-[#0A0A0A] border border-white/10 rounded-lg px-3 py-2 text-sm text-white" placeholder="Your account number"></div>' +
            '<div><label class="block text-xs font-semibold text-gray-400 mb-1">Phone</label><input id="sup-m-phone" class="w-full bg-[#0A0A0A] border border-white/10 rounded-lg px-3 py-2 text-sm text-white" placeholder="780-555-1234"></div>' +
          '</div>' +
          '<div class="grid grid-cols-2 gap-3">' +
            '<div><label class="block text-xs font-semibold text-gray-400 mb-1">Email</label><input id="sup-m-email" class="w-full bg-[#0A0A0A] border border-white/10 rounded-lg px-3 py-2 text-sm text-white" placeholder="orders@supplier.ca"></div>' +
            '<div><label class="block text-xs font-semibold text-gray-400 mb-1">Address</label><input id="sup-m-address" class="w-full bg-[#0A0A0A] border border-white/10 rounded-lg px-3 py-2 text-sm text-white" placeholder="123 Supply Dr"></div>' +
          '</div>' +
          '<div class="grid grid-cols-2 gap-3">' +
            '<div><label class="block text-xs font-semibold text-gray-400 mb-1">City</label><input id="sup-m-city" class="w-full bg-[#0A0A0A] border border-white/10 rounded-lg px-3 py-2 text-sm text-white" placeholder="Edmonton"></div>' +
            '<div><label class="block text-xs font-semibold text-gray-400 mb-1">Province</label><input id="sup-m-province" class="w-full bg-[#0A0A0A] border border-white/10 rounded-lg px-3 py-2 text-sm text-white" placeholder="Alberta"></div>' +
          '</div>' +
          '<h4 class="text-white font-semibold text-sm pt-2">Store Representative</h4>' +
          '<div class="grid grid-cols-3 gap-3">' +
            '<div><label class="block text-xs font-semibold text-gray-400 mb-1">Rep Name</label><input id="sup-m-rep-name" class="w-full bg-[#0A0A0A] border border-white/10 rounded-lg px-3 py-2 text-sm text-white" placeholder="John Smith"></div>' +
            '<div><label class="block text-xs font-semibold text-gray-400 mb-1">Rep Phone</label><input id="sup-m-rep-phone" class="w-full bg-[#0A0A0A] border border-white/10 rounded-lg px-3 py-2 text-sm text-white" placeholder="780-555-0000"></div>' +
            '<div><label class="block text-xs font-semibold text-gray-400 mb-1">Rep Email</label><input id="sup-m-rep-email" class="w-full bg-[#0A0A0A] border border-white/10 rounded-lg px-3 py-2 text-sm text-white" placeholder="john@supplier.ca"></div>' +
          '</div>' +
        '</div>',
        function() {
          var body = {
            name: document.getElementById('sup-m-name')?.value?.trim(),
            branch_name: document.getElementById('sup-m-branch')?.value?.trim(),
            account_number: document.getElementById('sup-m-account')?.value?.trim(),
            phone: document.getElementById('sup-m-phone')?.value?.trim(),
            email: document.getElementById('sup-m-email')?.value?.trim(),
            address: document.getElementById('sup-m-address')?.value?.trim(),
            city: document.getElementById('sup-m-city')?.value?.trim(),
            province: document.getElementById('sup-m-province')?.value?.trim(),
            rep_name: document.getElementById('sup-m-rep-name')?.value?.trim(),
            rep_phone: document.getElementById('sup-m-rep-phone')?.value?.trim(),
            rep_email: document.getElementById('sup-m-rep-email')?.value?.trim(),
            preferred: true
          };
          if (!body.name) { toast('Supplier name is required', 'error'); return; }
          fetch('/api/crm/suppliers', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) })
            .then(function(r) { return r.json(); })
            .then(function(res) { if (res.success) { closeModal(); toast('Supplier added!'); loadData(); } else { toast(res.error || 'Failed', 'error'); } })
            .catch(function() { toast('Network error', 'error'); });
        },
        'Add Supplier'
      );
    };

    window._supEdit = function(id) {
      var s = suppliers.find(function(x) { return x.id === id; });
      if (!s) return;
      showModal('Edit Supplier',
        '<div class="space-y-3">' +
          '<div class="grid grid-cols-2 gap-3">' +
            '<div><label class="block text-xs font-semibold text-gray-400 mb-1">Supplier Name *</label><input id="sup-e-name" value="' + (s.name||'') + '" class="w-full bg-[#0A0A0A] border border-white/10 rounded-lg px-3 py-2 text-sm text-white"></div>' +
            '<div><label class="block text-xs font-semibold text-gray-400 mb-1">Branch Name</label><input id="sup-e-branch" value="' + (s.branch_name||'') + '" class="w-full bg-[#0A0A0A] border border-white/10 rounded-lg px-3 py-2 text-sm text-white"></div>' +
          '</div>' +
          '<div class="grid grid-cols-2 gap-3">' +
            '<div><label class="block text-xs font-semibold text-gray-400 mb-1">Account #</label><input id="sup-e-account" value="' + (s.account_number||'') + '" class="w-full bg-[#0A0A0A] border border-white/10 rounded-lg px-3 py-2 text-sm text-white"></div>' +
            '<div><label class="block text-xs font-semibold text-gray-400 mb-1">Phone</label><input id="sup-e-phone" value="' + (s.phone||'') + '" class="w-full bg-[#0A0A0A] border border-white/10 rounded-lg px-3 py-2 text-sm text-white"></div>' +
          '</div>' +
          '<div class="grid grid-cols-2 gap-3">' +
            '<div><label class="block text-xs font-semibold text-gray-400 mb-1">Email</label><input id="sup-e-email" value="' + (s.email||'') + '" class="w-full bg-[#0A0A0A] border border-white/10 rounded-lg px-3 py-2 text-sm text-white"></div>' +
            '<div><label class="block text-xs font-semibold text-gray-400 mb-1">Address</label><input id="sup-e-address" value="' + (s.address||'') + '" class="w-full bg-[#0A0A0A] border border-white/10 rounded-lg px-3 py-2 text-sm text-white"></div>' +
          '</div>' +
          '<div class="grid grid-cols-2 gap-3">' +
            '<div><label class="block text-xs font-semibold text-gray-400 mb-1">City</label><input id="sup-e-city" value="' + (s.city||'') + '" class="w-full bg-[#0A0A0A] border border-white/10 rounded-lg px-3 py-2 text-sm text-white"></div>' +
            '<div><label class="block text-xs font-semibold text-gray-400 mb-1">Province</label><input id="sup-e-province" value="' + (s.province||'') + '" class="w-full bg-[#0A0A0A] border border-white/10 rounded-lg px-3 py-2 text-sm text-white"></div>' +
          '</div>' +
          '<h4 class="text-white font-semibold text-sm pt-2">Store Representative</h4>' +
          '<div class="grid grid-cols-3 gap-3">' +
            '<div><label class="block text-xs font-semibold text-gray-400 mb-1">Rep Name</label><input id="sup-e-rep-name" value="' + (s.rep_name||'') + '" class="w-full bg-[#0A0A0A] border border-white/10 rounded-lg px-3 py-2 text-sm text-white"></div>' +
            '<div><label class="block text-xs font-semibold text-gray-400 mb-1">Rep Phone</label><input id="sup-e-rep-phone" value="' + (s.rep_phone||'') + '" class="w-full bg-[#0A0A0A] border border-white/10 rounded-lg px-3 py-2 text-sm text-white"></div>' +
            '<div><label class="block text-xs font-semibold text-gray-400 mb-1">Rep Email</label><input id="sup-e-rep-email" value="' + (s.rep_email||'') + '" class="w-full bg-[#0A0A0A] border border-white/10 rounded-lg px-3 py-2 text-sm text-white"></div>' +
          '</div>' +
        '</div>',
        function() {
          var body = {
            name: document.getElementById('sup-e-name')?.value?.trim(),
            branch_name: document.getElementById('sup-e-branch')?.value?.trim(),
            account_number: document.getElementById('sup-e-account')?.value?.trim(),
            phone: document.getElementById('sup-e-phone')?.value?.trim(),
            email: document.getElementById('sup-e-email')?.value?.trim(),
            address: document.getElementById('sup-e-address')?.value?.trim(),
            city: document.getElementById('sup-e-city')?.value?.trim(),
            province: document.getElementById('sup-e-province')?.value?.trim(),
            rep_name: document.getElementById('sup-e-rep-name')?.value?.trim(),
            rep_phone: document.getElementById('sup-e-rep-phone')?.value?.trim(),
            rep_email: document.getElementById('sup-e-rep-email')?.value?.trim(),
            preferred: true
          };
          if (!body.name) { toast('Supplier name is required', 'error'); return; }
          fetch('/api/crm/suppliers/' + id, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) })
            .then(function(r) { return r.json(); })
            .then(function(res) { if (res.success) { closeModal(); toast('Supplier updated!'); loadData(); } else { toast(res.error || 'Failed', 'error'); } })
            .catch(function() { toast('Network error', 'error'); });
        },
        'Update Supplier'
      );
    };

    loadData();
  }

  // ============================================================
  // MODULE: CREW MANAGER
  // ============================================================
  var _dispatchWeekOffset = 0;
  var _crewMyId = null;

  function getWeekDates(offset) {
    var now = new Date();
    var day = now.getDay();
    var monday = new Date(now);
    monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1) + (offset * 7));
    var dates = [];
    for (var i = 0; i < 7; i++) {
      var d = new Date(monday);
      d.setDate(monday.getDate() + i);
      dates.push(d.toISOString().substring(0, 10));
    }
    return dates;
  }

  function fmtWeekDay(dateStr) {
    var d = new Date(dateStr + 'T12:00:00');
    var days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    return days[d.getDay()] + ' ' + (d.getMonth()+1) + '/' + d.getDate();
  }

  function initCrewManager() {
    root.innerHTML = '<div class="text-center py-8"><div class="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-emerald-500 mx-auto mb-3"></div><p class="text-sm text-gray-500">Loading Crew Manager...</p></div>';

    // Check if user is a crew member — show mobile view
    fetch('/api/crm/my-jobs', { headers: authHeadersOnly() })
      .then(function(r) { return r.json(); })
      .then(function(myData) {
        if (myData.is_crew_member && myData.jobs) {
          _crewMyId = myData.my_id || null;
          // Cache for offline
          try { localStorage.setItem('crew_cached_jobs', JSON.stringify({ jobs: myData.jobs, active_clock_in: myData.active_clock_in, my_id: myData.my_id, cached_at: new Date().toISOString() })); } catch(e) {}
          renderMyJobs(myData.jobs, myData.active_clock_in, myData.my_id);
        } else {
          // Owner/admin — dispatch dashboard
          loadDispatchData();
        }
      }).catch(function() {
        // Offline fallback for crew
        try {
          var cached = JSON.parse(localStorage.getItem('crew_cached_jobs') || 'null');
          if (cached && cached.jobs) {
            _crewMyId = cached.my_id || null;
            renderMyJobs(cached.jobs, cached.active_clock_in, cached.my_id);
            return;
          }
        } catch(e) {}
        // Fallback to admin
        loadDispatchData();
      });
  }

  function loadDispatchData() {
    Promise.all([
      fetch('/api/crm/crew', { headers: authHeadersOnly() }).then(function(r) { return r.json(); }),
      fetch('/api/crm/jobs?status=in_progress', { headers: authHeadersOnly() }).then(function(r) { return r.json(); }),
      fetch('/api/crm/jobs?status=scheduled', { headers: authHeadersOnly() }).then(function(r) { return r.json(); }),
      fetch('/api/crm/jobs', { headers: authHeadersOnly() }).then(function(r) { return r.json(); })
    ]).then(function(results) {
      renderCrewManager(results[0], results[1].jobs || [], results[2].jobs || [], results[3].jobs || []);
    }).catch(function() { root.innerHTML = '<p class="text-red-500 p-4">Failed to load crew data.</p>'; });
  }

  // ── CREW MEMBER MOBILE VIEW ──────────────────────────────

  function renderMyJobs(jobs, activeClockIn, myId) {
    _crewMyId = myId || _crewMyId;
    var today = new Date().toISOString().substring(0, 10);
    var todayJobs = jobs.filter(function(j) { return j.scheduled_date === today; });
    var upcomingJobs = jobs.filter(function(j) { return j.scheduled_date > today && (j.status === 'scheduled' || j.status === 'in_progress'); });
    var pastJobs = jobs.filter(function(j) { return j.scheduled_date < today || j.status === 'completed'; });

    var html = '';

    // Offline banner
    if (!navigator.onLine) {
      html += '<div class="bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-4 py-3 mb-4 flex items-center gap-2">' +
        '<i class="fas fa-wifi text-yellow-400"></i>' +
        '<span class="text-sm text-yellow-300 font-medium">Offline Mode — Actions will sync when reconnected</span></div>';
    }

    // Offline queue count
    try {
      var queue = JSON.parse(localStorage.getItem('crew_offline_queue') || '[]');
      if (queue.length > 0) {
        html += '<div class="bg-blue-500/10 border border-blue-500/30 rounded-xl px-4 py-2 mb-4 text-center">' +
          '<span class="text-xs text-blue-300">' + queue.length + ' action(s) queued for sync</span></div>';
      }
    } catch(e) {}

    html += '<div class="mb-5"><h2 class="text-xl font-bold text-gray-100"><i class="fas fa-hard-hat text-emerald-400 mr-2"></i>My Jobs</h2>' +
      '<p class="text-xs text-gray-500 mt-0.5">' + new Date().toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' }) + '</p></div>';

    // Active clock-in banner
    if (activeClockIn) {
      var clockInTime = new Date(activeClockIn.clock_in + 'Z');
      html += '<div class="bg-emerald-500/15 border border-emerald-500/30 rounded-2xl p-5 mb-5">' +
        '<div class="flex items-center gap-2 mb-2"><div class="w-3 h-3 bg-emerald-400 rounded-full animate-pulse"></div><span class="text-sm font-bold text-emerald-400">CLOCKED IN</span></div>' +
        '<p class="text-lg font-bold text-white">' + (activeClockIn.job_title || 'Job') + '</p>' +
        '<p class="text-xs text-gray-400 mb-1">' + (activeClockIn.property_address || '') + '</p>' +
        '<p class="text-sm text-emerald-300 mb-3" id="clockElapsed">Since ' + clockInTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '</p>' +
        '<button onclick="window._crewCheckOut(' + activeClockIn.job_id + ')" class="w-full py-4 bg-red-600 hover:bg-red-700 text-white rounded-xl text-lg font-bold transition-colors">' +
        '<i class="fas fa-sign-out-alt mr-2"></i>Clock Out</button></div>';
    }

    // Today's jobs
    html += '<div class="mb-5">';
    html += '<h3 class="font-bold text-emerald-400 text-sm mb-3"><i class="fas fa-calendar-day mr-2"></i>Today (' + todayJobs.length + ' job' + (todayJobs.length !== 1 ? 's' : '') + ')</h3>';
    if (todayJobs.length === 0) {
      html += '<div class="bg-[#111111] rounded-2xl border border-white/10 p-8 text-center"><i class="fas fa-coffee text-3xl text-gray-600 mb-3 block"></i><p class="text-sm text-gray-400">No jobs scheduled for today.</p></div>';
    } else {
      html += '<div class="space-y-3">';
      for (var i = 0; i < todayJobs.length; i++) {
        var j = todayJobs[i];
        var isCheckedIn = activeClockIn && activeClockIn.job_id === j.id;
        html += '<div class="bg-[#111111] rounded-2xl p-5 border border-white/10">';
        html += '<div class="flex items-center justify-between mb-2"><span class="font-mono text-xs font-bold text-emerald-400">' + (j.job_number || '') + '</span>' + badge(j.status) + '</div>';
        html += '<p class="font-bold text-base text-gray-100 mb-1">' + (j.title || '') + '</p>';
        if (j.property_address) html += '<p class="text-sm text-gray-400 mb-1"><i class="fas fa-map-marker-alt mr-1 text-emerald-400"></i>' + j.property_address + '</p>';
        if (j.scheduled_time) html += '<p class="text-sm text-gray-400"><i class="fas fa-clock mr-1 text-blue-400"></i>' + j.scheduled_time + (j.estimated_duration ? ' (' + j.estimated_duration + ')' : '') + '</p>';
        if (j.customer_name) html += '<p class="text-sm text-gray-400"><i class="fas fa-user mr-1 text-gray-500"></i>' + j.customer_name + (j.customer_phone ? ' &middot; ' + j.customer_phone : '') + '</p>';
        if (j.crew_names) html += '<p class="text-xs text-gray-500 mt-1"><i class="fas fa-users mr-1"></i>' + j.crew_names + '</p>';

        // Action buttons — large touch targets
        html += '<div class="mt-4 space-y-2">';
        if (!isCheckedIn && !activeClockIn) {
          html += '<button onclick="event.stopPropagation();window._crewCheckIn(' + j.id + ')" class="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-base font-bold transition-colors"><i class="fas fa-sign-in-alt mr-2"></i>Check In</button>';
        } else if (isCheckedIn) {
          html += '<button onclick="event.stopPropagation();window._crewCheckOut(' + j.id + ')" class="w-full py-4 bg-red-600 hover:bg-red-700 text-white rounded-xl text-base font-bold transition-colors"><i class="fas fa-sign-out-alt mr-2"></i>Clock Out</button>';
        }
        html += '<div class="grid grid-cols-4 gap-2">';
        html += '<button onclick="event.stopPropagation();window._crewStartWalkaround(' + j.id + ')" class="py-3 bg-orange-500/15 hover:bg-orange-500/25 text-orange-400 rounded-xl text-center transition-colors"><i class="fas fa-microphone text-lg block mb-0.5"></i><span class="text-[10px] font-semibold">Walkaround</span></button>';
        html += '<button onclick="event.stopPropagation();window._crewPhotoUpload(' + j.id + ')" class="py-3 bg-blue-500/15 hover:bg-blue-500/25 text-blue-400 rounded-xl text-center transition-colors"><i class="fas fa-camera text-lg block mb-0.5"></i><span class="text-[10px] font-semibold">Photo</span></button>';
        html += '<button onclick="event.stopPropagation();window._crewOpenChat(' + j.id + ')" class="py-3 bg-purple-500/15 hover:bg-purple-500/25 text-purple-400 rounded-xl text-center transition-colors"><i class="fas fa-comment text-lg block mb-0.5"></i><span class="text-[10px] font-semibold">Message</span></button>';
        html += '<button onclick="event.stopPropagation();window._crewDirections(\'' + (j.property_address || '').replace(/'/g, "\\'") + '\')" class="py-3 bg-gray-500/15 hover:bg-gray-500/25 text-gray-400 rounded-xl text-center transition-colors"><i class="fas fa-directions text-lg block mb-0.5"></i><span class="text-[10px] font-semibold">Navigate</span></button>';
        html += '</div></div>';
        html += '</div>';
      }
      html += '</div>';
    }
    html += '</div>';

    // Upcoming jobs
    if (upcomingJobs.length > 0) {
      html += '<div class="bg-[#111111] rounded-2xl border border-white/10 mb-5 overflow-hidden">';
      html += '<div class="px-5 py-4 border-b border-white/5"><h3 class="font-bold text-gray-100 text-sm"><i class="fas fa-calendar text-blue-400 mr-2"></i>Upcoming (' + upcomingJobs.length + ')</h3></div>';
      html += '<div class="divide-y divide-white/5">';
      for (var u = 0; u < upcomingJobs.length; u++) {
        var uj = upcomingJobs[u];
        html += '<div class="px-5 py-4">';
        html += '<div class="flex items-center justify-between mb-1"><p class="font-semibold text-sm text-gray-100">' + (uj.title || '') + '</p>' + badge(uj.status) + '</div>';
        html += '<p class="text-xs text-gray-400"><i class="fas fa-calendar mr-1"></i>' + fmtDate(uj.scheduled_date) + (uj.scheduled_time ? ' at ' + uj.scheduled_time : '') + '</p>';
        if (uj.property_address) html += '<p class="text-xs text-gray-500"><i class="fas fa-map-marker-alt mr-1"></i>' + uj.property_address + '</p>';
        html += '</div>';
      }
      html += '</div></div>';
    }

    // Completed jobs
    if (pastJobs.length > 0) {
      html += '<div class="bg-[#111111] rounded-2xl border border-white/10 overflow-hidden">';
      html += '<div class="px-5 py-4 border-b border-white/5"><h3 class="font-bold text-gray-100 text-sm"><i class="fas fa-check-circle text-green-400 mr-2"></i>Completed (' + pastJobs.length + ')</h3></div>';
      html += '<div class="divide-y divide-white/5">';
      for (var p = 0; p < Math.min(pastJobs.length, 10); p++) {
        var pj = pastJobs[p];
        html += '<div class="px-5 py-3 opacity-60"><p class="text-sm text-gray-300">' + (pj.title || '') + '</p><p class="text-xs text-gray-500">' + fmtDate(pj.scheduled_date) + '</p></div>';
      }
      html += '</div></div>';
    }

    root.innerHTML = html;
  }

  // Check-in with GPS
  window._crewCheckIn = function(jobId) {
    var btn = event.target.closest('button');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Getting location...';

    function doCheckIn(lat, lng) {
      fetch('/api/crm/jobs/' + jobId + '/check-in', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ lat: lat, lng: lng })
      }).then(function(r) { return r.json(); })
      .then(function(res) {
        if (res.success) { toast('Checked in!'); initCrewManager(); }
        else { toast(res.error || 'Check-in failed', 'error'); btn.disabled = false; btn.innerHTML = '<i class="fas fa-sign-in-alt mr-2"></i>Check In'; }
      }).catch(function() {
        // Queue for offline
        queueOfflineAction({ type: 'check-in', jobId: jobId, lat: lat, lng: lng });
        btn.disabled = false; btn.innerHTML = '<i class="fas fa-sign-in-alt mr-2"></i>Check In';
      });
    }

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        function(pos) { doCheckIn(pos.coords.latitude, pos.coords.longitude); },
        function() {
          // GPS failed — check in without location
          doCheckIn(null, null);
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    } else {
      doCheckIn(null, null);
    }
  };

  // Check-out
  window._crewCheckOut = function(jobId) {
    var btn = event.target.closest('button');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Clocking out...';

    fetch('/api/crm/jobs/' + jobId + '/check-out', {
      method: 'POST', headers: authHeaders(), body: '{}'
    }).then(function(r) { return r.json(); })
    .then(function(res) {
      if (res.success) {
        var hrs = Math.floor(res.duration_minutes / 60);
        var mins = res.duration_minutes % 60;
        toast('Clocked out! Duration: ' + (hrs > 0 ? hrs + 'h ' : '') + mins + 'm');
        initCrewManager();
      } else { toast(res.error || 'Clock-out failed', 'error'); btn.disabled = false; btn.innerHTML = '<i class="fas fa-sign-out-alt mr-2"></i>Clock Out'; }
    }).catch(function() {
      queueOfflineAction({ type: 'check-out', jobId: jobId });
      btn.disabled = false; btn.innerHTML = '<i class="fas fa-sign-out-alt mr-2"></i>Clock Out';
    });
  };

  // Photo upload (mobile camera)
  window._crewPhotoUpload = function(jobId) {
    var body = '<div class="space-y-3">' +
      '<div><label class="block text-xs font-medium text-gray-400 mb-1">Take Photo or Choose from Gallery</label>' +
      '<input type="file" id="crewPhoto" accept="image/*" capture="environment" class="w-full px-3 py-3 border border-white/15 rounded-xl text-sm bg-[#0A0A0A]"></div>' +
      '<div><label class="block text-xs font-medium text-gray-400 mb-1">Caption (optional)</label>' +
      '<input type="text" id="crewPhotoCaption" class="w-full px-3 py-3 border border-white/15 rounded-xl text-sm bg-[#0A0A0A]" placeholder="Describe the photo..."></div>' +
      '</div>';
    showModal('Upload Photo', body, function() {
      var fileInput = document.getElementById('crewPhoto');
      var caption = (document.getElementById('crewPhotoCaption')?.value || '').trim();
      if (!fileInput || !fileInput.files[0]) { toast('Select a photo first', 'error'); return; }
      var reader = new FileReader();
      reader.onload = function(e) {
        fetch('/api/crm/jobs/' + jobId + '/progress', {
          method: 'POST', headers: authHeaders(),
          body: JSON.stringify({ update_type: 'photo', content: caption || 'Photo upload', photo_data: e.target.result, photo_caption: caption })
        }).then(function(r) { return r.json(); })
        .then(function(res) {
          if (res.success) { closeModal(); toast('Photo uploaded!'); }
          else toast(res.error || 'Upload failed', 'error');
        }).catch(function() {
          queueOfflineAction({ type: 'progress', jobId: jobId, payload: { update_type: 'photo', content: caption || 'Photo upload', photo_data: e.target.result, photo_caption: caption } });
          closeModal();
        });
      };
      reader.readAsDataURL(fileInput.files[0]);
    }, 'Upload');
  };

  // Messaging drawer
  window._crewOpenChat = function(jobId) {
    var existing = document.getElementById('chatDrawer');
    if (existing) existing.remove();
    if (window._chatPollInterval) clearInterval(window._chatPollInterval);

    var drawer = document.createElement('div');
    drawer.id = 'chatDrawer';
    drawer.className = 'fixed inset-0 z-50 flex flex-col';
    drawer.innerHTML =
      '<div class="flex-1 bg-black/60" onclick="document.getElementById(\'chatDrawer\').remove();clearInterval(window._chatPollInterval)"></div>' +
      '<div class="bg-[#111111] border-t border-white/10 rounded-t-2xl flex flex-col" style="max-height:75vh">' +
        '<div class="px-4 py-3 border-b border-white/10 flex items-center justify-between flex-shrink-0">' +
          '<h3 class="font-bold text-gray-100 text-sm"><i class="fas fa-comment text-purple-400 mr-2"></i>Job Chat</h3>' +
          '<button onclick="document.getElementById(\'chatDrawer\').remove();clearInterval(window._chatPollInterval)" class="text-gray-400 hover:text-white text-xl">&times;</button>' +
        '</div>' +
        '<div id="chatMessages" class="flex-1 overflow-y-auto p-4 space-y-3" style="min-height:200px"></div>' +
        '<div class="p-3 border-t border-white/10 flex gap-2 flex-shrink-0">' +
          '<input id="chatInput" type="text" class="flex-1 px-4 py-3 bg-[#0A0A0A] border border-white/15 rounded-xl text-sm text-white" placeholder="Type a message..." onkeydown="if(event.key===\'Enter\')window._crewSendMsg(' + jobId + ')">' +
          '<button onclick="window._crewSendMsg(' + jobId + ')" class="px-5 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold transition-colors"><i class="fas fa-paper-plane"></i></button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(drawer);

    window._crewLoadMessages(jobId);
    window._chatPollInterval = setInterval(function() { window._crewLoadMessages(jobId); }, 15000);
  };

  window._crewLoadMessages = function(jobId) {
    fetch('/api/crm/jobs/' + jobId + '/messages', { headers: authHeadersOnly() })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var container = document.getElementById('chatMessages');
        if (!container) { clearInterval(window._chatPollInterval); return; }
        var msgs = data.messages || [];
        var myId = data.my_id || _crewMyId;
        if (msgs.length === 0) {
          container.innerHTML = '<p class="text-center text-gray-500 text-sm py-8">No messages yet. Start the conversation!</p>';
          return;
        }
        var html = '';
        for (var i = 0; i < msgs.length; i++) {
          var m = msgs[i];
          var isMine = m.author_id === myId;
          html += '<div class="' + (isMine ? 'text-right' : '') + '">' +
            '<p class="text-[10px] text-gray-500 mb-0.5">' + (m.author_name || 'Unknown') + '</p>' +
            '<div class="inline-block px-4 py-2 rounded-2xl text-sm max-w-[80%] ' +
            (isMine ? 'bg-emerald-600 text-white rounded-br-md' : 'bg-white/10 text-gray-200 rounded-bl-md') + '">' +
            m.content.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</div>' +
            '<p class="text-[9px] text-gray-600 mt-0.5">' + new Date(m.created_at + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '</p></div>';
        }
        container.innerHTML = html;
        container.scrollTop = container.scrollHeight;
      }).catch(function() {});
  };

  window._crewSendMsg = function(jobId) {
    var input = document.getElementById('chatInput');
    if (!input) return;
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    fetch('/api/crm/jobs/' + jobId + '/messages', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ content: text })
    }).then(function() { window._crewLoadMessages(jobId); })
    .catch(function() {
      queueOfflineAction({ type: 'message', jobId: jobId, content: text });
    });
  };

  // Navigate to property address
  window._crewDirections = function(address) {
    if (!address) { toast('No address available', 'error'); return; }
    var encoded = encodeURIComponent(address);
    var url = /iPad|iPhone|iPod/.test(navigator.userAgent)
      ? 'maps://maps.apple.com/?daddr=' + encoded
      : 'https://www.google.com/maps/dir/?api=1&destination=' + encoded;
    window.open(url, '_blank');
  };

  // Voice Walkaround — record audio, transcribe, AI-organize notes
  var _walkaroundRecorder = null;
  var _walkaroundChunks = [];
  var _walkaroundTimer = null;
  var _walkaroundSeconds = 0;

  window._crewStartWalkaround = function(jobId) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast('Audio recording not supported on this device', 'error');
      return;
    }

    // Create recording overlay
    var overlay = document.createElement('div');
    overlay.id = 'walkaroundOverlay';
    overlay.className = 'fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#0a0a0a]/95';
    overlay.innerHTML =
      '<div class="text-center px-6 max-w-sm w-full">' +
        '<div id="walkaroundRecording">' +
          '<div class="w-24 h-24 mx-auto mb-6 rounded-full bg-red-500/20 flex items-center justify-center" style="animation:pulse 1.5s ease-in-out infinite">' +
            '<div class="w-16 h-16 rounded-full bg-red-500/40 flex items-center justify-center">' +
              '<i class="fas fa-microphone text-red-400 text-3xl"></i>' +
            '</div>' +
          '</div>' +
          '<h2 class="text-xl font-bold text-white mb-2">Recording Walkaround</h2>' +
          '<p class="text-gray-400 text-sm mb-1">Walk around the site and describe what you see</p>' +
          '<p id="walkaroundTime" class="text-3xl font-mono font-bold text-red-400 mb-8">0:00</p>' +
          '<button onclick="window._crewStopWalkaround(' + jobId + ')" class="w-full py-5 bg-red-600 hover:bg-red-700 text-white rounded-2xl text-lg font-bold transition-colors mb-3">' +
            '<i class="fas fa-stop mr-2"></i>Stop Recording' +
          '</button>' +
          '<button onclick="window._crewCancelWalkaround()" class="w-full py-3 bg-white/5 hover:bg-white/10 text-gray-400 rounded-xl text-sm transition-colors">' +
            'Cancel' +
          '</button>' +
        '</div>' +
        '<div id="walkaroundProcessing" class="hidden">' +
          '<div class="w-20 h-20 mx-auto mb-6 rounded-full bg-orange-500/20 flex items-center justify-center">' +
            '<i class="fas fa-spinner fa-spin text-orange-400 text-3xl"></i>' +
          '</div>' +
          '<h2 class="text-xl font-bold text-white mb-2" id="walkaroundStatus">Transcribing audio...</h2>' +
          '<p class="text-gray-400 text-sm">This may take a few seconds</p>' +
        '</div>' +
        '<div id="walkaroundResult" class="hidden text-left">' +
          '<div class="flex items-center gap-2 mb-4"><div class="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center"><i class="fas fa-check text-emerald-400"></i></div><h2 class="text-lg font-bold text-white">Notes Organized!</h2></div>' +
          '<div id="walkaroundNotes" class="bg-[#111111] rounded-xl border border-white/10 p-4 mb-4 text-sm text-gray-300 max-h-[300px] overflow-y-auto whitespace-pre-wrap"></div>' +
          '<details class="mb-4"><summary class="text-xs text-gray-500 cursor-pointer hover:text-gray-300">Raw Transcript</summary><p id="walkaroundTranscript" class="text-xs text-gray-500 mt-2 bg-[#0A0A0A] rounded-lg p-3"></p></details>' +
          '<button onclick="window._crewCloseWalkaround()" class="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-base font-bold transition-colors">' +
            '<i class="fas fa-check mr-2"></i>Done' +
          '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    // Start recording
    _walkaroundChunks = [];
    _walkaroundSeconds = 0;
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(function(stream) {
        var options = { mimeType: 'audio/webm;codecs=opus' };
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
          options = { mimeType: 'audio/webm' };
          if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            options = {};
          }
        }
        _walkaroundRecorder = new MediaRecorder(stream, options);
        _walkaroundRecorder.ondataavailable = function(e) {
          if (e.data.size > 0) _walkaroundChunks.push(e.data);
        };
        _walkaroundRecorder.start(1000); // collect chunks every second

        // Timer
        _walkaroundTimer = setInterval(function() {
          _walkaroundSeconds++;
          var mins = Math.floor(_walkaroundSeconds / 60);
          var secs = _walkaroundSeconds % 60;
          var el = document.getElementById('walkaroundTime');
          if (el) el.textContent = mins + ':' + String(secs).padStart(2, '0');
        }, 1000);
      })
      .catch(function(err) {
        toast('Microphone access denied', 'error');
        var ol = document.getElementById('walkaroundOverlay');
        if (ol) ol.remove();
      });
  };

  window._crewStopWalkaround = function(jobId) {
    if (!_walkaroundRecorder) return;
    clearInterval(_walkaroundTimer);

    // Show processing state
    var recDiv = document.getElementById('walkaroundRecording');
    var procDiv = document.getElementById('walkaroundProcessing');
    if (recDiv) recDiv.className = 'hidden';
    if (procDiv) procDiv.className = '';

    _walkaroundRecorder.onstop = function() {
      // Stop all tracks
      _walkaroundRecorder.stream.getTracks().forEach(function(t) { t.stop(); });

      // Convert chunks to base64
      var blob = new Blob(_walkaroundChunks, { type: _walkaroundRecorder.mimeType || 'audio/webm' });
      var reader = new FileReader();
      reader.onload = function() {
        var base64 = reader.result;
        var statusEl = document.getElementById('walkaroundStatus');
        if (statusEl) statusEl.textContent = 'AI is organizing your notes...';

        // Send to backend
        fetch('/api/crm/jobs/' + jobId + '/walkaround', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ audio_data: base64 })
        })
        .then(function(r) { return r.json(); })
        .then(function(res) {
          if (res.success) {
            // Show result
            if (procDiv) procDiv.className = 'hidden';
            var resultDiv = document.getElementById('walkaroundResult');
            if (resultDiv) resultDiv.className = 'text-left';
            var notesEl = document.getElementById('walkaroundNotes');
            if (notesEl) notesEl.innerHTML = (res.content || '').replace(/\*\*([^*]+)\*\*/g, '<strong class="text-white">$1</strong>');
            var transcriptEl = document.getElementById('walkaroundTranscript');
            if (transcriptEl) transcriptEl.textContent = res.transcription || '';
          } else {
            toast(res.error || 'Failed to process walkaround', 'error');
            var ol = document.getElementById('walkaroundOverlay');
            if (ol) ol.remove();
          }
        })
        .catch(function() {
          toast('Network error — try again', 'error');
          var ol = document.getElementById('walkaroundOverlay');
          if (ol) ol.remove();
        });
      };
      reader.readAsDataURL(blob);
    };

    _walkaroundRecorder.stop();
  };

  window._crewCancelWalkaround = function() {
    clearInterval(_walkaroundTimer);
    if (_walkaroundRecorder && _walkaroundRecorder.state !== 'inactive') {
      _walkaroundRecorder.stream.getTracks().forEach(function(t) { t.stop(); });
      _walkaroundRecorder.stop();
    }
    _walkaroundRecorder = null;
    _walkaroundChunks = [];
    var ol = document.getElementById('walkaroundOverlay');
    if (ol) ol.remove();
  };

  window._crewCloseWalkaround = function() {
    var ol = document.getElementById('walkaroundOverlay');
    if (ol) ol.remove();
    initCrewManager(); // refresh to show new progress
  };

  // Offline queue helpers
  function queueOfflineAction(action) {
    try {
      var queue = JSON.parse(localStorage.getItem('crew_offline_queue') || '[]');
      queue.push(Object.assign({}, action, { queued_at: new Date().toISOString() }));
      localStorage.setItem('crew_offline_queue', JSON.stringify(queue));
      toast('Action queued — will sync when online', 'error');
    } catch(e) {}
  }

  window.addEventListener('online', function() {
    try {
      var queue = JSON.parse(localStorage.getItem('crew_offline_queue') || '[]');
      if (queue.length === 0) return;
      toast('Syncing ' + queue.length + ' queued action(s)...');
      var promises = queue.map(function(action) {
        if (action.type === 'check-in') {
          return fetch('/api/crm/jobs/' + action.jobId + '/check-in', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ lat: action.lat, lng: action.lng }) });
        }
        if (action.type === 'check-out') {
          return fetch('/api/crm/jobs/' + action.jobId + '/check-out', { method: 'POST', headers: authHeaders(), body: '{}' });
        }
        if (action.type === 'message') {
          return fetch('/api/crm/jobs/' + action.jobId + '/messages', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ content: action.content }) });
        }
        if (action.type === 'progress') {
          return fetch('/api/crm/jobs/' + action.jobId + '/progress', { method: 'POST', headers: authHeaders(), body: JSON.stringify(action.payload) });
        }
        return Promise.resolve();
      });
      Promise.all(promises).then(function() {
        localStorage.removeItem('crew_offline_queue');
        toast('All actions synced!');
        if (typeof initCrewManager === 'function') initCrewManager();
      }).catch(function() { toast('Some actions failed to sync', 'error'); });
    } catch(e) {}
  });

  // ── OWNER DISPATCH DASHBOARD ─────────────────────────────

  function renderCrewManager(crewData, activeJobs, scheduledJobs, allJobs) {
    var crew = crewData.crew || [];
    var owner = crewData.owner || {};
    var busyJobs = activeJobs.concat(scheduledJobs);

    // Determine unscheduled: no scheduled_date or no crew assigned
    var scheduledJobIds = {};
    busyJobs.forEach(function(j) { scheduledJobIds[j.id] = true; });
    var unscheduledJobs = (allJobs || []).filter(function(j) {
      return !j.scheduled_date && j.status !== 'completed' && j.status !== 'cancelled';
    });

    var html = '<div class="flex items-center justify-between mb-5 flex-wrap gap-3">';
    html += '<div><h2 class="text-xl font-bold text-gray-100"><i class="fas fa-users text-emerald-400 mr-2"></i>Crew Manager</h2><p class="text-xs text-gray-500 mt-0.5">Dispatch your crew and track job progress</p></div>';
    html += '<div class="flex gap-2"><a href="/customer/team" class="bg-emerald-500/15 text-emerald-400 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-emerald-500/25 transition-colors"><i class="fas fa-user-plus mr-1"></i>Invite Crew</a>' +
      '<a href="/customer/jobs" class="bg-blue-500/15 text-blue-400 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-500/25 transition-colors"><i class="fas fa-plus mr-1"></i>New Job</a></div>';
    html += '</div>';

    // Stats row
    html += '<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">';
    html += '<div class="bg-[#111111] rounded-xl border border-white/10 p-4 text-center"><p class="text-2xl font-black text-gray-100">' + crew.length + '</p><p class="text-[10px] text-gray-500 uppercase tracking-wide">Crew Members</p></div>';
    html += '<div class="bg-[#111111] rounded-xl border border-white/10 p-4 text-center"><p class="text-2xl font-black text-blue-400">' + activeJobs.length + '</p><p class="text-[10px] text-gray-500 uppercase tracking-wide">In Progress</p></div>';
    html += '<div class="bg-[#111111] rounded-xl border border-white/10 p-4 text-center"><p class="text-2xl font-black text-cyan-400">' + scheduledJobs.length + '</p><p class="text-[10px] text-gray-500 uppercase tracking-wide">Scheduled</p></div>';
    html += '<div class="bg-[#111111] rounded-xl border border-white/10 p-4 text-center"><p class="text-2xl font-black text-yellow-400">' + unscheduledJobs.length + '</p><p class="text-[10px] text-gray-500 uppercase tracking-wide">Unscheduled</p></div>';
    html += '</div>';

    // ── DISPATCH BOARD: Split screen ──
    html += '<div class="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-5">';

    // LEFT: Unscheduled jobs (1 col)
    html += '<div class="lg:col-span-1">';
    html += '<div class="bg-[#111111] rounded-2xl border border-white/10 overflow-hidden">';
    html += '<div class="px-4 py-3 border-b border-white/5 bg-yellow-500/5"><h3 class="font-bold text-yellow-400 text-sm"><i class="fas fa-inbox mr-2"></i>Unscheduled (' + unscheduledJobs.length + ')</h3></div>';
    html += '<div class="p-3 space-y-2 max-h-[500px] overflow-y-auto" id="unscheduledList">';
    if (unscheduledJobs.length === 0) {
      html += '<p class="text-xs text-gray-500 text-center py-4">All jobs are scheduled!</p>';
    }
    for (var ui = 0; ui < unscheduledJobs.length; ui++) {
      var uj = unscheduledJobs[ui];
      html += '<div class="bg-[#0A0A0A] rounded-xl p-3 border border-white/10 cursor-grab hover:border-emerald-500/30 transition-colors" draggable="true" data-job-id="' + uj.id + '" data-job-title="' + (uj.title || '').replace(/"/g, '&quot;') + '">';
      html += '<div class="flex items-center justify-between mb-1"><span class="font-mono text-[10px] font-bold text-emerald-400">' + (uj.job_number || '') + '</span>' + badge(uj.status) + '</div>';
      html += '<p class="text-sm font-semibold text-gray-100 truncate">' + (uj.title || 'Untitled') + '</p>';
      if (uj.property_address) html += '<p class="text-[11px] text-gray-500 truncate"><i class="fas fa-map-marker-alt mr-1"></i>' + uj.property_address + '</p>';
      if (uj.customer_name) html += '<p class="text-[11px] text-gray-500"><i class="fas fa-user mr-1"></i>' + uj.customer_name + '</p>';
      html += '</div>';
    }
    html += '</div></div></div>';

    // RIGHT: Weekly calendar grid (3 cols)
    var weekDates = getWeekDates(_dispatchWeekOffset);
    var weekLabel = fmtWeekDay(weekDates[0]) + ' — ' + fmtWeekDay(weekDates[6]);

    html += '<div class="lg:col-span-3">';
    html += '<div class="bg-[#111111] rounded-2xl border border-white/10 overflow-hidden">';
    // Week nav header
    html += '<div class="px-4 py-3 border-b border-white/5 flex items-center justify-between">';
    html += '<button onclick="window._crewWeekNav(-1)" class="px-3 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 text-sm"><i class="fas fa-chevron-left"></i></button>';
    html += '<h3 class="font-bold text-gray-100 text-sm"><i class="fas fa-calendar-week text-cyan-400 mr-2"></i>' + weekLabel + '</h3>';
    html += '<div class="flex gap-1"><button onclick="window._crewWeekNav(0)" class="px-3 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 text-xs font-medium">Today</button>';
    html += '<button onclick="window._crewWeekNav(1)" class="px-3 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 text-sm"><i class="fas fa-chevron-right"></i></button></div>';
    html += '</div>';

    // Calendar grid
    html += '<div class="overflow-x-auto"><table class="w-full min-w-[700px]">';
    // Header row: days of week
    var todayStr = new Date().toISOString().substring(0, 10);
    html += '<thead><tr><th class="text-left px-3 py-2 text-xs text-gray-500 font-medium w-[120px] border-b border-white/5">Crew</th>';
    for (var di = 0; di < 7; di++) {
      var isToday = weekDates[di] === todayStr;
      html += '<th class="px-2 py-2 text-xs font-medium border-b border-white/5 ' + (isToday ? 'text-emerald-400 bg-emerald-500/5' : 'text-gray-500') + '">' + fmtWeekDay(weekDates[di]) + '</th>';
    }
    html += '</tr></thead><tbody>';

    // One row per crew member + owner
    var allCrew = [{ member_customer_id: owner.id, name: owner.name || 'Owner', isOwner: true }].concat(crew.map(function(m) { return { member_customer_id: m.member_customer_id, name: m.name || 'Unknown' }; }));

    for (var ci = 0; ci < allCrew.length; ci++) {
      var cm = allCrew[ci];
      var initials = (cm.name || 'U').split(' ').map(function(w) { return w[0]; }).join('').substring(0, 2).toUpperCase();
      html += '<tr class="border-b border-white/5">';
      html += '<td class="px-3 py-2"><div class="flex items-center gap-2"><div class="w-7 h-7 bg-emerald-500/15 rounded-full flex items-center justify-center text-emerald-400 font-bold text-[10px]">' + initials + '</div><span class="text-xs text-gray-300 truncate max-w-[80px]">' + cm.name + '</span></div></td>';

      for (var dj = 0; dj < 7; dj++) {
        var cellDate = weekDates[dj];
        var isToday2 = cellDate === todayStr;
        // Find jobs for this crew member on this date
        var cellJobs = busyJobs.filter(function(j) {
          return j.scheduled_date === cellDate;
        });
        // We show all scheduled jobs in the cell — proper crew-specific filtering would need assignment data per job
        // For simplicity, show jobs that have this crew member assigned (we'll match by checking assignments later)
        html += '<td class="px-1 py-1 align-top min-w-[90px] border-l border-white/5 ' + (isToday2 ? 'bg-emerald-500/5' : '') + '" data-crew-id="' + cm.member_customer_id + '" data-date="' + cellDate + '" ondragover="event.preventDefault();this.classList.add(\'bg-emerald-500/10\')" ondragleave="this.classList.remove(\'bg-emerald-500/10\')" ondrop="window._crewDropJob(event,this)">';

        // Render jobs in this cell
        var matchingJobs = busyJobs.filter(function(bj) { return bj.scheduled_date === cellDate; });
        for (var mji = 0; mji < matchingJobs.length; mji++) {
          var mj = matchingJobs[mji];
          var bgColor = mj.status === 'in_progress' ? 'bg-blue-500/20 border-blue-500/30' : 'bg-cyan-500/10 border-cyan-500/20';
          html += '<div class="text-[10px] rounded-lg px-1.5 py-1 mb-1 border ' + bgColor + ' truncate cursor-pointer" onclick="window._crmViewJob(' + mj.id + ')" title="' + (mj.title || '').replace(/"/g, '&quot;') + '">';
          html += '<span class="font-bold">' + (mj.job_number || '') + '</span> ' + (mj.title || '').substring(0, 15);
          html += '</div>';
        }
        // Render material deliveries in this cell
        var cellDeliveries = (allJobs || []).filter(function(dj) { return dj.material_delivery_date === cellDate; });
        for (var cdi = 0; cdi < cellDeliveries.length; cdi++) {
          var cd = cellDeliveries[cdi];
          html += '<div class="text-[10px] rounded-lg px-1.5 py-1 mb-1 border bg-orange-500/15 border-orange-500/20 text-orange-400 truncate cursor-pointer" onclick="window._crmViewJob(' + cd.id + ')" title="Material Delivery: ' + (cd.title || '').replace(/"/g, '&quot;') + '">';
          html += '<i class="fas fa-truck mr-0.5 text-[8px]"></i>' + (cd.title || '').substring(0, 12);
          html += '</div>';
        }
        html += '</td>';
      }
      html += '</tr>';
    }

    html += '</tbody></table></div></div></div>';
    html += '</div>'; // end grid

    // Crew roster
    html += '<div class="bg-[#111111] rounded-2xl border border-white/10 overflow-hidden">';
    html += '<div class="px-5 py-4 border-b border-white/5"><h3 class="font-bold text-gray-100 text-sm"><i class="fas fa-users text-emerald-400 mr-2"></i>Crew Roster (' + crew.length + ')</h3></div>';
    if (crew.length === 0) {
      html += '<div class="p-8 text-center text-gray-400"><i class="fas fa-hard-hat text-3xl mb-3 opacity-30 block"></i><p class="text-sm">No crew members yet.</p><a href="/customer/team" class="inline-block mt-3 text-sm text-emerald-400 hover:underline font-semibold"><i class="fas fa-user-plus mr-1"></i>Invite Team Member</a></div>';
    } else {
      html += '<div class="grid md:grid-cols-2 lg:grid-cols-3 gap-4 p-4">';
      for (var ri = 0; ri < crew.length; ri++) {
        var rm = crew[ri];
        var rInitials = (rm.name || 'U').split(' ').map(function(w) { return w[0]; }).join('').substring(0, 2).toUpperCase();
        html += '<div class="bg-[#0A0A0A] rounded-xl p-4 border border-white/10 hover:border-emerald-500/20 transition-colors">';
        html += '<div class="flex items-center gap-3 mb-3"><div class="w-10 h-10 bg-emerald-500/15 rounded-full flex items-center justify-center text-emerald-400 font-bold text-sm">' + rInitials + '</div>';
        html += '<div class="min-w-0"><p class="font-semibold text-sm text-gray-100 truncate">' + (rm.name || 'Unknown') + '</p>';
        html += '<p class="text-xs text-gray-500">' + (rm.role === 'admin' ? 'Admin' : 'Crew Member') + '</p></div></div>';
        if (rm.phone) html += '<p class="text-xs text-gray-500 mb-1"><i class="fas fa-phone mr-1.5 text-gray-400"></i>' + rm.phone + '</p>';
        if (rm.email) html += '<p class="text-xs text-gray-500 mb-2"><i class="fas fa-envelope mr-1.5 text-gray-400"></i>' + rm.email + '</p>';
        html += '<div class="flex items-center gap-2 mt-2"><span class="px-2 py-0.5 bg-blue-500/15 text-blue-400 rounded-full text-[10px] font-bold">' + (rm.total_assignments || 0) + ' jobs</span>';
        if (rm.active_jobs > 0) html += '<span class="px-2 py-0.5 bg-emerald-500/15 text-emerald-400 rounded-full text-[10px] font-bold">' + rm.active_jobs + ' active</span>';
        html += '</div></div>';
      }
      html += '</div>';
    }
    html += '</div>';

    root.innerHTML = html;

    // Attach drag events to unscheduled job cards
    setTimeout(function() {
      var cards = document.querySelectorAll('[draggable="true"][data-job-id]');
      for (var k = 0; k < cards.length; k++) {
        cards[k].addEventListener('dragstart', function(e) {
          e.dataTransfer.setData('text/plain', this.getAttribute('data-job-id'));
          e.dataTransfer.effectAllowed = 'move';
          this.style.opacity = '0.5';
        });
        cards[k].addEventListener('dragend', function() {
          this.style.opacity = '1';
        });
      }
    }, 50);
  }

  // Drop handler — schedule job to crew on date
  window._crewDropJob = function(event, cell) {
    event.preventDefault();
    cell.classList.remove('bg-emerald-500/10');
    var jobId = parseInt(event.dataTransfer.getData('text/plain'));
    var crewId = parseInt(cell.getAttribute('data-crew-id'));
    var date = cell.getAttribute('data-date');
    if (!jobId || !date) return;

    cell.innerHTML += '<div class="text-[10px] text-emerald-400 py-1"><i class="fas fa-spinner fa-spin mr-1"></i>Scheduling...</div>';

    fetch('/api/crm/jobs/schedule', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ jobId: jobId, crewMemberId: crewId, scheduledDate: date })
    }).then(function(r) { return r.json(); })
    .then(function(res) {
      if (res.success) { toast('Job scheduled!'); initCrewManager(); }
      else { toast(res.error || 'Scheduling failed', 'error'); initCrewManager(); }
    }).catch(function() { toast('Network error', 'error'); });
  };

  // Week navigation
  window._crewWeekNav = function(dir) {
    if (dir === 0) { _dispatchWeekOffset = 0; }
    else { _dispatchWeekOffset += dir; }
    loadDispatchData();
  };

  // Assign crew to job modal (kept from existing)
  window._crewAssignJob = function(jobId) {
    Promise.all([
      fetch('/api/crm/crew', { headers: authHeadersOnly() }).then(function(r) { return r.json(); }),
      fetch('/api/crm/jobs/' + jobId + '/crew', { headers: authHeadersOnly() }).then(function(r) { return r.json(); })
    ]).then(function(results) {
      var available = results[0].crew || [];
      var assigned = results[1].crew || [];
      var assignedIds = assigned.map(function(a) { return a.crew_member_id; });

      var body = '<div class="space-y-3">';
      if (assigned.length > 0) {
        body += '<div><h4 class="text-xs font-bold text-gray-500 uppercase mb-2">Currently Assigned</h4><div class="space-y-1.5">';
        for (var i = 0; i < assigned.length; i++) {
          var a = assigned[i];
          body += '<div class="flex items-center justify-between bg-emerald-500/10 rounded-lg px-3 py-2"><div class="flex items-center gap-2"><i class="fas fa-user-check text-emerald-400"></i><span class="text-sm font-medium text-gray-100">' + (a.name || 'Unknown') + '</span><span class="px-1.5 py-0.5 bg-emerald-500/15 text-emerald-400 rounded text-[9px] font-bold capitalize">' + (a.role || 'crew') + '</span></div><button onclick="window._crewRemoveFromJob(' + jobId + ',' + a.crew_member_id + ')" class="text-red-400 hover:text-red-600"><i class="fas fa-times"></i></button></div>';
        }
        body += '</div></div>';
      }
      var unassigned = available.filter(function(m) { return assignedIds.indexOf(m.member_customer_id) === -1; });
      if (unassigned.length > 0) {
        body += '<div><h4 class="text-xs font-bold text-gray-500 uppercase mb-2">Available Crew</h4><div class="space-y-1.5">';
        for (var j = 0; j < unassigned.length; j++) {
          var u = unassigned[j];
          body += '<div class="flex items-center justify-between bg-[#0A0A0A] rounded-lg px-3 py-2"><div class="flex items-center gap-2"><i class="fas fa-user text-gray-400"></i><span class="text-sm font-medium text-gray-100">' + (u.name || 'Unknown') + '</span>' + (u.phone ? '<span class="text-xs text-gray-400">' + u.phone + '</span>' : '') + '</div>';
          body += '<button onclick="window._crewAddToJob(' + jobId + ',' + u.member_customer_id + ')" class="px-3 py-1 bg-emerald-600 text-white rounded-lg text-xs font-semibold hover:bg-emerald-700"><i class="fas fa-plus mr-0.5"></i>Assign</button></div>';
        }
        body += '</div></div>';
      } else if (assigned.length === 0) {
        body += '<p class="text-sm text-gray-400 text-center py-4">No crew members available. <a href="/customer/team" class="text-emerald-400 hover:underline">Invite team members</a> first.</p>';
      }
      body += '</div>';
      showModal('Assign Crew to Job', body);
    });
  };

  window._crewAddToJob = function(jobId, memberId) {
    fetch('/api/crm/jobs/' + jobId + '/crew', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ crew_member_id: memberId }) })
      .then(function(r) { return r.json(); })
      .then(function(res) { if (res.success) { toast('Crew assigned!'); closeModal(); initCrewManager(); } else { toast(res.error || 'Failed', 'error'); } })
      .catch(function() { toast('Network error', 'error'); });
  };

  window._crewRemoveFromJob = function(jobId, memberId) {
    fetch('/api/crm/jobs/' + jobId + '/crew/' + memberId, { method: 'DELETE', headers: authHeadersOnly() })
      .then(function(r) { return r.json(); })
      .then(function(res) { if (res.success) { toast('Crew removed'); closeModal(); initCrewManager(); } })
      .catch(function() { toast('Network error', 'error'); });
  };

  // Job progress — add note or photo (enhanced with mobile camera support)
  window._crewAddProgress = function(jobId) {
    var body = '<div class="space-y-3">' +
      '<div><label class="block text-xs font-medium text-gray-400 mb-1">Update Type</label><select id="progType" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm bg-[#0A0A0A]"><option value="note">Note</option><option value="photo">Photo</option><option value="status_change">Status Update</option></select></div>' +
      '<div><label class="block text-xs font-medium text-gray-400 mb-1">Note / Details</label><textarea id="progContent" rows="3" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm bg-[#0A0A0A]" placeholder="What\'s the update?"></textarea></div>' +
      '<div id="progPhotoSection" class="hidden"><label class="block text-xs font-medium text-gray-400 mb-1">Photo</label><input type="file" id="progPhoto" accept="image/*" capture="environment" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm bg-[#0A0A0A]"><input type="text" id="progCaption" placeholder="Photo caption (optional)" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm bg-[#0A0A0A] mt-2"></div>' +
      '</div>';
    showModal('Add Progress Update', body, function() {
      var type = document.getElementById('progType').value;
      var content = document.getElementById('progContent').value.trim();
      var fileInput = document.getElementById('progPhoto');
      var caption = document.getElementById('progCaption')?.value?.trim() || '';

      function sendProgress(photoData) {
        fetch('/api/crm/jobs/' + jobId + '/progress', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ update_type: type, content: content, photo_data: photoData || null, photo_caption: caption }) })
          .then(function(r) { return r.json(); })
          .then(function(res) { if (res.success) { closeModal(); toast('Progress added!'); } else { toast(res.error || 'Failed', 'error'); } })
          .catch(function() { toast('Network error', 'error'); });
      }

      if (type === 'photo' && fileInput && fileInput.files[0]) {
        var reader = new FileReader();
        reader.onload = function(e) { sendProgress(e.target.result); };
        reader.readAsDataURL(fileInput.files[0]);
      } else {
        if (!content) { toast('Enter a note or select a photo', 'error'); return; }
        sendProgress(null);
      }
    }, 'Post Update');

    setTimeout(function() {
      var sel = document.getElementById('progType');
      if (sel) sel.addEventListener('change', function() {
        var ps = document.getElementById('progPhotoSection');
        if (ps) ps.className = sel.value === 'photo' ? '' : 'hidden';
      });
    }, 100);
  };

  // ============================================================
  // MODULE: REFERRAL PROGRAM
  // ============================================================
  function initReferrals() {
    root.innerHTML = '<div class="text-center py-8"><div class="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-brand-500 mx-auto mb-3"></div></div>';
    fetch('/api/customer/referrals', { headers: authHeadersOnly() })
      .then(function(r) { return r.json(); })
      .then(function(data) { renderReferrals(data); })
      .catch(function() { root.innerHTML = '<p class="text-red-500 p-4">Failed to load referral data.</p>'; });
  }

  function renderReferrals(data) {
    var refCode = data.referral_code || '';
    var shareUrl = data.share_url || '';
    var referred = data.referred_users || [];
    var earnings = data.earnings || [];
    var totalEarned = data.total_earned || 0;
    var totalPending = data.total_pending || 0;
    var totalReferred = data.total_referred || 0;

    var html = '<div class="flex items-center justify-between mb-5 flex-wrap gap-3">';
    html += '<div><h2 class="text-lg font-bold text-gray-100"><i class="fas fa-gift text-blue-400 mr-2"></i>Referral Program</h2><p class="text-xs text-gray-500 mt-0.5">Earn 10% commission on every report your referrals purchase</p></div>';
    html += '</div>';

    // Stats
    html += '<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">';
    html += '<div class="bg-[#111111] rounded-xl border border-white/10 p-4 text-center"><p class="text-2xl font-black text-gray-100">' + totalReferred + '</p><p class="text-[10px] text-gray-400">Referred Users</p></div>';
    html += '<div class="bg-[#111111] rounded-xl border border-white/10 p-4 text-center"><p class="text-2xl font-black text-emerald-400">$' + totalEarned.toFixed(2) + '</p><p class="text-[10px] text-gray-400">Total Earned</p></div>';
    html += '<div class="bg-[#111111] rounded-xl border border-white/10 p-4 text-center"><p class="text-2xl font-black text-gray-300">$' + totalPending.toFixed(2) + '</p><p class="text-[10px] text-gray-400">Pending</p></div>';
    html += '<div class="bg-[#111111] rounded-xl border border-white/10 p-4 text-center"><p class="text-2xl font-black text-blue-400">10%</p><p class="text-[10px] text-gray-400">Commission Rate</p></div>';
    html += '</div>';

    // Share link card
    html += '<div class="bg-gradient-to-r from-blue-600 to-blue-700 rounded-2xl p-6 mb-5 text-white">';
    html += '<h3 class="font-bold text-lg mb-1"><i class="fas fa-share-alt mr-2"></i>Your Referral Link</h3>';
    html += '<p class="text-blue-100 text-sm mb-4">Share this link with other roofing contractors. When they sign up and buy reports, you earn 10% of every purchase.</p>';
    html += '<div class="flex gap-2 mb-3">';
    html += '<input type="text" id="refLinkInput" value="' + shareUrl + '" readonly class="flex-1 bg-[#111111]/20 border border-white/30 rounded-xl px-4 py-3 text-sm font-mono text-white placeholder-white/50">';
    html += '<button onclick="navigator.clipboard.writeText(document.getElementById(\'refLinkInput\').value);toast(\'Link copied!\')" class="px-5 py-3 bg-white/10 text-white rounded-xl font-bold text-sm hover:bg-white/20 flex-shrink-0"><i class="fas fa-copy mr-1"></i>Copy</button>';
    html += '</div>';
    html += '<div class="flex gap-2">';
    html += '<div class="bg-white/10 rounded-lg px-3 py-2"><p class="text-[10px] text-blue-100">Your Code</p><p class="font-mono font-bold text-sm text-white">' + refCode + '</p></div>';
    html += '<button onclick="window._refShareEmail()" class="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm font-medium text-white border border-white/20"><i class="fas fa-envelope mr-1"></i>Email to a Friend</button>';
    html += '</div>';
    html += '</div>';

    // How it works
    html += '<div class="bg-[#111111] rounded-2xl border border-white/10 shadow-sm p-6 mb-5">';
    html += '<h3 class="font-bold text-gray-100 text-sm mb-4"><i class="fas fa-question-circle text-blue-400 mr-2"></i>How It Works</h3>';
    html += '<div class="grid md:grid-cols-3 gap-4">';
    html += '<div class="text-center"><div class="w-10 h-10 bg-blue-500/15 rounded-full flex items-center justify-center mx-auto mb-2"><span class="font-bold text-blue-400">1</span></div><p class="text-sm font-semibold text-gray-100">Share Your Link</p><p class="text-xs text-gray-400 mt-1">Send your unique referral link to other roofing contractors</p></div>';
    html += '<div class="text-center"><div class="w-10 h-10 bg-blue-500/15 rounded-full flex items-center justify-center mx-auto mb-2"><span class="font-bold text-blue-400">2</span></div><p class="text-sm font-semibold text-gray-100">They Sign Up</p><p class="text-xs text-gray-400 mt-1">When they create an account through your link, they\'re linked to you</p></div>';
    html += '<div class="text-center"><div class="w-10 h-10 bg-blue-500/15 rounded-full flex items-center justify-center mx-auto mb-2"><span class="font-bold text-blue-400">3</span></div><p class="text-sm font-semibold text-gray-100">You Earn 10%</p><p class="text-xs text-gray-400 mt-1">Every time they buy reports or credit packs, you earn 10% commission</p></div>';
    html += '</div></div>';

    // Referred users
    html += '<div class="bg-[#111111] rounded-2xl border border-white/10 shadow-sm overflow-hidden mb-5">';
    html += '<div class="px-5 py-4 border-b border-white/10"><h3 class="font-bold text-gray-100 text-sm"><i class="fas fa-users text-blue-400 mr-2"></i>Your Referrals (' + totalReferred + ')</h3></div>';
    if (referred.length === 0) {
      html += '<div class="p-8 text-center text-gray-400"><i class="fas fa-user-friends text-3xl mb-3 opacity-30 block"></i><p class="text-sm">No referrals yet. Share your link to start earning!</p></div>';
    } else {
      html += '<div class="overflow-x-auto"><table class="w-full"><thead><tr class="bg-[#0A0A0A] text-xs text-gray-400 uppercase"><th class="px-4 py-3 text-left">User</th><th class="px-4 py-3 text-left">Company</th><th class="px-4 py-3 text-center">Reports</th><th class="px-4 py-3 text-left">Joined</th></tr></thead><tbody>';
      for (var i = 0; i < referred.length; i++) {
        var u = referred[i];
        html += '<tr class="border-b border-white/5 hover:bg-white/5"><td class="px-4 py-3 text-sm font-medium text-gray-100">' + (u.name || 'User') + '</td><td class="px-4 py-3 text-sm text-gray-400">' + (u.company_name || '-') + '</td><td class="px-4 py-3 text-center text-sm font-bold text-gray-100">' + (u.reports_ordered || 0) + '</td><td class="px-4 py-3 text-xs text-gray-400">' + fmtDate(u.created_at) + '</td></tr>';
      }
      html += '</tbody></table></div>';
    }
    html += '</div>';

    // Earnings history
    if (earnings.length > 0) {
      html += '<div class="bg-[#111111] rounded-2xl border border-white/10 shadow-sm overflow-hidden">';
      html += '<div class="px-5 py-4 border-b border-white/10"><h3 class="font-bold text-gray-100 text-sm"><i class="fas fa-dollar-sign text-green-400 mr-2"></i>Commission History</h3></div>';
      html += '<div class="overflow-x-auto"><table class="w-full"><thead><tr class="bg-[#0A0A0A] text-xs text-gray-400 uppercase"><th class="px-4 py-3 text-left">From</th><th class="px-4 py-3 text-right">Payment</th><th class="px-4 py-3 text-right">Commission</th><th class="px-4 py-3 text-center">Status</th><th class="px-4 py-3 text-left">Date</th></tr></thead><tbody>';
      for (var j = 0; j < earnings.length; j++) {
        var e = earnings[j];
        var statusBg = e.status === 'pending' ? 'bg-yellow-500/15 text-yellow-400' : e.status === 'credited' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-blue-500/15 text-blue-400';
        html += '<tr class="border-b border-white/5"><td class="px-4 py-3 text-sm text-gray-100">' + (e.referred_name || e.referred_company || 'User') + '</td><td class="px-4 py-3 text-right text-sm text-gray-400">$' + (e.amount_paid || 0).toFixed(2) + '</td><td class="px-4 py-3 text-right text-sm font-bold text-emerald-400">$' + (e.commission_earned || 0).toFixed(2) + '</td><td class="px-4 py-3 text-center"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold ' + statusBg + ' capitalize">' + (e.status || 'pending') + '</span></td><td class="px-4 py-3 text-xs text-gray-400">' + fmtDate(e.created_at) + '</td></tr>';
      }
      html += '</tbody></table></div></div>';
    }

    root.innerHTML = html;
  }

  window._refShareEmail = function() {
    var refData = null;
    fetch('/api/customer/referrals', { headers: authHeadersOnly() }).then(function(r) { return r.json(); }).then(function(d) {
      var subject = encodeURIComponent('Try Roof Manager — Get 3 Free Roof Reports');
      var body = encodeURIComponent('Hey! I\'ve been using Roof Manager for satellite roof measurements and it\'s been a game changer. You get 3 free reports to try it out.\n\nSign up here: ' + (d.share_url || '') + '\n\nIt does roof area, pitch, edges, material takeoff — all in 60 seconds from satellite. Plus full CRM, invoicing, and proposals.');
      window.open('mailto:?subject=' + subject + '&body=' + body);
    });
  };

  // ============================================================
  // MODULE: MATERIAL CATALOG
  // ============================================================
  var _catalogProducts = [];
  var _catalogCategories = {
    shingles: { label: 'Shingles', icon: 'fa-home', color: 'blue' },
    underlayment: { label: 'Underlayment', icon: 'fa-layer-group', color: 'sky' },
    ice_shield: { label: 'Ice & Water Shield', icon: 'fa-snowflake', color: 'blue' },
    starter_strip: { label: 'Starter Strip', icon: 'fa-grip-lines', color: 'blue' },
    ridge_cap: { label: 'Ridge/Hip Cap', icon: 'fa-mountain', color: 'blue' },
    drip_edge: { label: 'Drip Edge', icon: 'fa-ruler', color: 'gray' },
    valley_metal: { label: 'Valley Flashing', icon: 'fa-arrows-alt-v', color: 'emerald' },
    nails: { label: 'Nails / Fasteners', icon: 'fa-thumbtack', color: 'gray' },
    ventilation: { label: 'Ventilation', icon: 'fa-wind', color: 'green' },
    custom: { label: 'Other / Custom', icon: 'fa-box', color: 'gray' }
  };

  function initCatalog() {
    root.innerHTML = '<div class="text-center py-8"><div class="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-brand-500 mx-auto mb-3"></div></div>';
    fetch('/api/crm/catalog', { headers: authHeadersOnly() })
      .then(function(r) { return r.json(); })
      .then(function(data) { _catalogProducts = data.products || []; renderCatalog(); })
      .catch(function() { root.innerHTML = '<p class="text-red-500 p-4">Failed to load catalog.</p>'; });
  }

  function renderCatalog() {
    var html = '<div class="flex items-center justify-between mb-5 flex-wrap gap-3">';
    html += '<div><h2 class="text-lg font-bold text-gray-100"><i class="fas fa-box-open text-blue-500 mr-2"></i>Material Catalog</h2><p class="text-xs text-gray-500 mt-0.5">' + _catalogProducts.length + ' products · Prices used in Material Calculator</p></div>';
    html += '<div class="flex gap-2">';
    html += '<button onclick="window._catAddProduct()" class="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700"><i class="fas fa-plus mr-1"></i>Add Product</button>';
    if (_catalogProducts.length === 0) {
      html += '<button onclick="window._catSeedDefaults()" class="bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-gray-900"><i class="fas fa-magic mr-1"></i>Load Defaults</button>';
    }
    html += '</div></div>';

    // Stats
    var totalValue = 0; _catalogProducts.forEach(function(p) { totalValue += p.unit_price || 0; });
    var cats = {}; _catalogProducts.forEach(function(p) { cats[p.category] = (cats[p.category] || 0) + 1; });
    html += '<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">';
    html += '<div class="bg-[#111111] rounded-xl border p-4 text-center"><p class="text-2xl font-black text-gray-100">' + _catalogProducts.length + '</p><p class="text-[10px] text-gray-500">Total Products</p></div>';
    html += '<div class="bg-[#111111] rounded-xl border p-4 text-center"><p class="text-2xl font-black text-blue-600">' + Object.keys(cats).length + '</p><p class="text-[10px] text-gray-500">Categories</p></div>';
    html += '<div class="bg-[#111111] rounded-xl border p-4 text-center"><p class="text-2xl font-black text-emerald-400">' + _catalogProducts.filter(function(p) { return p.is_default; }).length + '</p><p class="text-[10px] text-gray-500">Default Items</p></div>';
    html += '<div class="bg-[#111111] rounded-xl border p-4 text-center"><p class="text-2xl font-black text-gray-400">$' + totalValue.toFixed(0) + '</p><p class="text-[10px] text-gray-500">Avg Unit Value</p></div>';
    html += '</div>';

    if (_catalogProducts.length === 0) {
      html += '<div class="bg-[#111111] rounded-xl border p-12 text-center"><div class="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4"><i class="fas fa-box-open text-blue-400 text-2xl"></i></div><h3 class="text-lg font-semibold text-gray-300 mb-2">No Products Yet</h3><p class="text-gray-500 mb-4">Add your materials and pricing so the Material Calculator uses your custom prices.</p><button onclick="window._catSeedDefaults()" class="bg-gray-800 text-white px-6 py-2.5 rounded-xl font-semibold hover:bg-gray-900 mr-2"><i class="fas fa-magic mr-2"></i>Load Standard Roofing Products</button><button onclick="window._catAddProduct()" class="bg-blue-600 text-white px-6 py-2.5 rounded-xl font-semibold hover:bg-blue-700"><i class="fas fa-plus mr-2"></i>Add Custom Product</button></div>';
    } else {
      // Group by category
      var grouped = {};
      _catalogProducts.forEach(function(p) {
        if (!grouped[p.category]) grouped[p.category] = [];
        grouped[p.category].push(p);
      });
      var _catColorMap = { blue: 'rgba(59,130,246,0.12)', sky: 'rgba(14,165,233,0.12)', gray: 'rgba(107,114,128,0.1)', emerald: 'rgba(16,185,129,0.12)', green: 'rgba(34,197,94,0.12)' };
      var catOrder = ['shingles', 'underlayment', 'ice_shield', 'starter_strip', 'ridge_cap', 'drip_edge', 'valley_metal', 'nails', 'ventilation', 'custom'];
      for (var ci = 0; ci < catOrder.length; ci++) {
        var catKey = catOrder[ci];
        var catItems = grouped[catKey];
        if (!catItems || catItems.length === 0) continue;
        var catInfo = _catalogCategories[catKey] || { label: catKey, icon: 'fa-box', color: 'gray' };
        html += '<div class="bg-[#111111] rounded-xl border shadow-sm mb-4 overflow-hidden">';
        html += '<div class="px-5 py-3 border-b border-white/5 flex items-center justify-between" style="background:' + (_catColorMap[catInfo.color] || 'rgba(255,255,255,0.05)') + '">';
        html += '<h3 class="font-bold text-gray-100 text-sm"><i class="fas ' + catInfo.icon + ' text-' + catInfo.color + '-500 mr-2"></i>' + catInfo.label + ' <span class="text-xs font-normal text-gray-400">(' + catItems.length + ')</span></h3>';
        html += '</div>';
        html += '<div class="divide-y divide-white/5">';
        for (var pi = 0; pi < catItems.length; pi++) {
          var p = catItems[pi];
          html += '<div class="px-5 py-3 flex items-center justify-between hover:bg-[#111111]/5">';
          html += '<div class="min-w-0 flex-1">';
          html += '<div class="flex items-center gap-2"><p class="font-medium text-sm text-gray-100">' + p.name + '</p>';
          if (p.is_default) html += '<span class="px-1.5 py-0.5 bg-blue-500/15 text-blue-400 rounded text-[9px] font-bold">DEFAULT</span>';
          if (p.sku) html += '<span class="text-[10px] text-gray-400 font-mono">' + p.sku + '</span>';
          html += '</div>';
          html += '<div class="flex items-center gap-3 mt-0.5 text-xs text-gray-500">';
          if (p.coverage_per_unit) html += '<span><i class="fas fa-ruler-combined mr-0.5"></i>' + p.coverage_per_unit + '</span>';
          if (p.supplier) html += '<span><i class="fas fa-truck mr-0.5"></i>' + p.supplier + '</span>';
          html += '</div></div>';
          html += '<div class="flex items-center gap-3 flex-shrink-0 ml-4">';
          html += '<div class="text-right"><p class="text-lg font-black text-gray-100">$' + p.unit_price.toFixed(2) + '</p><p class="text-[10px] text-gray-400">per ' + p.unit + '</p></div>';
          html += '<div class="flex gap-1">';
          html += '<button onclick="window._catEditProduct(' + p.id + ')" class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[#111111]/10 text-gray-400 hover:text-blue-600"><i class="fas fa-edit text-xs"></i></button>';
          html += '<button onclick="window._catDeleteProduct(' + p.id + ')" class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[#111111]/10 text-gray-400 hover:text-red-600"><i class="fas fa-trash text-xs"></i></button>';
          html += '</div></div></div>';
        }
        html += '</div></div>';
      }
    }
    root.innerHTML = html;
  }

  window._catSeedDefaults = async function() {
    if (!(await window.rmConfirm('Load standard roofing products with current Canadian market pricing?'))) return
    fetch('/api/crm/catalog/seed-defaults', { method: 'POST', headers: authHeaders() })
      .then(function(r) { return r.json(); })
      .then(function(res) { if (res.success) { toast(res.seeded + ' products added!'); initCatalog(); } else { toast(res.error || 'Failed', 'error'); } })
      .catch(function() { toast('Network error', 'error'); });
  };

  window._catAddProduct = function() {
    var catOpts = Object.keys(_catalogCategories).map(function(k) { return '<option value="' + k + '">' + _catalogCategories[k].label + '</option>'; }).join('');
    var body = '<div class="space-y-3">' +
      '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3"><div><label class="block text-xs font-medium text-gray-400 mb-1">Category *</label><select id="catNewCategory" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm">' + catOpts + '</select></div><div><label class="block text-xs font-medium text-gray-400 mb-1">Unit *</label><select id="catNewUnit" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm"><option value="bundles">Bundles</option><option value="rolls">Rolls</option><option value="pieces">Pieces</option><option value="boxes">Boxes</option><option value="tubes">Tubes</option><option value="sq ft">Sq Ft</option><option value="lin ft">Lin Ft</option></select></div></div>' +
      '<div><label class="block text-xs font-medium text-gray-400 mb-1">Product Name *</label><input type="text" id="catNewName" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm" placeholder="e.g. GAF Timberline HDZ Charcoal"></div>' +
      '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3"><div><label class="block text-xs font-medium text-gray-400 mb-1">Unit Price (CAD) *</label><input type="number" id="catNewPrice" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm" step="0.01" min="0" placeholder="42.00"></div><div><label class="block text-xs font-medium text-gray-400 mb-1">SKU</label><input type="text" id="catNewSku" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm" placeholder="Optional"></div></div>' +
      '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3"><div><label class="block text-xs font-medium text-gray-400 mb-1">Coverage per Unit</label><input type="text" id="catNewCoverage" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm" placeholder="e.g. 33 sq ft per bundle"></div><div><label class="block text-xs font-medium text-gray-400 mb-1">Supplier</label><input type="text" id="catNewSupplier" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm" placeholder="e.g. ABC Supply"></div></div>' +
      '<div><label class="block text-xs font-medium text-gray-400 mb-1">Description</label><input type="text" id="catNewDesc" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm" placeholder="Optional notes, color, warranty..."></div>' +
      '<label class="flex items-center gap-2 text-sm"><input type="checkbox" id="catNewDefault" class="rounded"> Include by default in Material Calculator</label>' +
      '</div>';
    showModal('Add Product to Catalog', body, function() {
      var name = document.getElementById('catNewName').value.trim();
      var price = parseFloat(document.getElementById('catNewPrice').value);
      if (!name || isNaN(price)) { toast('Name and price required', 'error'); return; }
      fetch('/api/crm/catalog', { method: 'POST', headers: authHeaders(), body: JSON.stringify({
        category: document.getElementById('catNewCategory').value,
        name: name,
        description: document.getElementById('catNewDesc').value.trim(),
        sku: document.getElementById('catNewSku').value.trim(),
        unit: document.getElementById('catNewUnit').value,
        unit_price: price,
        coverage_per_unit: document.getElementById('catNewCoverage').value.trim(),
        supplier: document.getElementById('catNewSupplier').value.trim(),
        is_default: document.getElementById('catNewDefault').checked ? 1 : 0
      })})
        .then(function(r) { return r.json(); })
        .then(function(res) { if (res.success) { closeModal(); toast('Product added!'); initCatalog(); } else { toast(res.error || 'Failed', 'error'); } })
        .catch(function() { toast('Network error', 'error'); });
    }, 'Add Product');
  };

  window._catEditProduct = function(id) {
    var p = _catalogProducts.find(function(x) { return x.id === id; });
    if (!p) return;
    var catOpts = Object.keys(_catalogCategories).map(function(k) { return '<option value="' + k + '"' + (k === p.category ? ' selected' : '') + '>' + _catalogCategories[k].label + '</option>'; }).join('');
    var unitOpts = ['bundles','rolls','pieces','boxes','tubes','sq ft','lin ft'].map(function(u) { return '<option value="' + u + '"' + (u === p.unit ? ' selected' : '') + '>' + u + '</option>'; }).join('');
    var body = '<div class="space-y-3">' +
      '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3"><div><label class="block text-xs font-medium text-gray-400 mb-1">Category</label><select id="catEditCategory" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm">' + catOpts + '</select></div><div><label class="block text-xs font-medium text-gray-400 mb-1">Unit</label><select id="catEditUnit" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm">' + unitOpts + '</select></div></div>' +
      '<div><label class="block text-xs font-medium text-gray-400 mb-1">Product Name</label><input type="text" id="catEditName" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm" value="' + (p.name || '').replace(/"/g, '&quot;') + '"></div>' +
      '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3"><div><label class="block text-xs font-medium text-gray-400 mb-1">Unit Price (CAD)</label><input type="number" id="catEditPrice" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm" step="0.01" value="' + p.unit_price + '"></div><div><label class="block text-xs font-medium text-gray-400 mb-1">SKU</label><input type="text" id="catEditSku" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm" value="' + (p.sku || '') + '"></div></div>' +
      '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3"><div><label class="block text-xs font-medium text-gray-400 mb-1">Coverage</label><input type="text" id="catEditCoverage" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm" value="' + (p.coverage_per_unit || '') + '"></div><div><label class="block text-xs font-medium text-gray-400 mb-1">Supplier</label><input type="text" id="catEditSupplier" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm" value="' + (p.supplier || '') + '"></div></div>' +
      '<div><label class="block text-xs font-medium text-gray-400 mb-1">Description</label><input type="text" id="catEditDesc" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm" value="' + (p.description || '').replace(/"/g, '&quot;') + '"></div>' +
      '<label class="flex items-center gap-2 text-sm"><input type="checkbox" id="catEditDefault" class="rounded"' + (p.is_default ? ' checked' : '') + '> Include by default in Material Calculator</label>' +
      '</div>';
    showModal('Edit Product', body, function() {
      fetch('/api/crm/catalog/' + id, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({
        category: document.getElementById('catEditCategory').value,
        name: document.getElementById('catEditName').value.trim(),
        description: document.getElementById('catEditDesc').value.trim(),
        sku: document.getElementById('catEditSku').value.trim(),
        unit: document.getElementById('catEditUnit').value,
        unit_price: parseFloat(document.getElementById('catEditPrice').value) || 0,
        coverage_per_unit: document.getElementById('catEditCoverage').value.trim(),
        supplier: document.getElementById('catEditSupplier').value.trim(),
        is_default: document.getElementById('catEditDefault').checked ? 1 : 0
      })})
        .then(function(r) { return r.json(); })
        .then(function(res) { if (res.success) { closeModal(); toast('Product updated!'); initCatalog(); } else { toast(res.error || 'Failed', 'error'); } })
        .catch(function() { toast('Network error', 'error'); });
    }, 'Save Changes');
  };

  window._catDeleteProduct = async function(id) {
    if (!(await window.rmConfirm('Remove this product from your catalog?'))) return
    fetch('/api/crm/catalog/' + id, { method: 'DELETE', headers: authHeadersOnly() })
      .then(function(r) { return r.json(); })
      .then(function(res) { if (res.success) { toast('Product removed'); initCatalog(); } else { toast(res.error || 'Failed', 'error'); } })
      .catch(function() { toast('Network error', 'error'); });
  };

  // ============================================================
  // MODULE: EMAIL OUTREACH
  // ============================================================
  function initEmailOutreach() {
    root.innerHTML = '<div class="text-center py-8"><div class="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-brand-500 mx-auto mb-3"></div></div>';
    Promise.all([
      fetch('/api/email-outreach/lists', { headers: authHeadersOnly() }).then(function(r) { return r.json(); }),
      fetch('/api/email-outreach/contacts?limit=50', { headers: authHeadersOnly() }).then(function(r) { return r.json(); }),
      fetch('/api/auth/gmail/status', { headers: authHeadersOnly() }).then(function(r) { return r.json(); }).catch(function() { return {}; })
    ]).then(function(results) {
      var lists = results[0].lists || [];
      var contacts = results[1].contacts || [];
      var totalContacts = results[1].total || contacts.length;
      var gmailStatus = (results[2] && results[2].gmail_oauth2) || null;
      renderEmailOutreach(lists, contacts, totalContacts, gmailStatus);
    }).catch(function() { root.innerHTML = '<p class="text-red-500 p-4">Failed to load email outreach data.</p>'; });
  }

  function renderEmailOutreach(lists, contacts, totalContacts, gmailStatus) {
    var g = gmailStatus;
    var gmailHtml = '';
    if (g) {
      if (g.ready) {
        gmailHtml = '<div class="flex items-center justify-between bg-emerald-950/40 border border-emerald-800/50 rounded-xl px-4 py-3 mb-4">' +
          '<div class="flex items-center gap-3"><div class="w-8 h-8 bg-emerald-900/60 rounded-lg flex items-center justify-center flex-shrink-0"><i class="fab fa-google text-emerald-400 text-sm"></i></div>' +
          '<div><p class="text-sm font-medium text-emerald-300">Gmail Connected</p><p class="text-xs text-emerald-600 mt-0.5">Sending from <span class="font-medium">' + (g.sender_email || 'your Gmail account') + '</span></p></div></div>' +
          '<span class="px-2.5 py-1 bg-emerald-900/60 text-emerald-400 text-xs font-semibold rounded-full">Active</span></div>';
      } else {
        var actionBtn = '';
        if (g.needs_setup === 'authorize' && g.authorize_url) {
          actionBtn = '<a href="' + g.authorize_url + '" class="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap inline-flex items-center gap-1"><i class="fab fa-google"></i>Connect Gmail</a>';
        } else {
          actionBtn = '<button onclick="window.rmToast && window.rmToast(\'Contact your account admin to configure Gmail in Email Setup.\', \'info\')" class="px-3 py-1.5 bg-amber-500/80 text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1"><i class="fas fa-cog"></i>Setup Required</button>';
        }
        var setupMsg = g.needs_setup === 'client_secret' ? 'Gmail credentials not yet configured.' : 'Gmail authorization needed to send emails.';
        gmailHtml = '<div class="flex items-center justify-between bg-amber-950/40 border border-amber-800/50 rounded-xl px-4 py-3 mb-4">' +
          '<div class="flex items-center gap-3"><div class="w-8 h-8 bg-amber-900/60 rounded-lg flex items-center justify-center flex-shrink-0"><i class="fab fa-google text-amber-400 text-sm"></i></div>' +
          '<div><p class="text-sm font-medium text-amber-300">Gmail Not Connected</p><p class="text-xs text-amber-600 mt-0.5">' + setupMsg + '</p></div></div>' +
          actionBtn + '</div>';
      }
    }

    var html = '<div class="flex items-center justify-between mb-5 flex-wrap gap-3">';
    html += '<div><h2 class="text-lg font-bold text-gray-100"><i class="fas fa-envelope-open-text text-blue-500 mr-2"></i>Email Outreach</h2><p class="text-xs text-gray-500 mt-0.5">' + totalContacts + ' contacts across ' + lists.length + ' lists</p></div>';
    html += '<div class="flex gap-2">';
    html += '<button onclick="window._eoNewList()" class="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700"><i class="fas fa-plus mr-1"></i>New List</button>';
    html += '<button onclick="window._eoImportContacts()" class="bg-white/5 text-gray-300 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-200"><i class="fas fa-file-csv mr-1"></i>Import CSV</button>';
    html += '</div></div>';

    // Gmail integration banner
    html += gmailHtml;

    // Stats
    html += '<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">';
    html += '<div class="bg-[#111111] rounded-xl border p-4 text-center"><p class="text-2xl font-bold text-gray-100">' + lists.length + '</p><p class="text-[10px] text-gray-500">Lists</p></div>';
    html += '<div class="bg-[#111111] rounded-xl border p-4 text-center"><p class="text-2xl font-bold text-blue-500">' + totalContacts + '</p><p class="text-[10px] text-gray-500">Total Contacts</p></div>';
    html += '<div class="bg-[#111111] rounded-xl border p-4 text-center"><p class="text-2xl font-bold text-emerald-400">0</p><p class="text-[10px] text-gray-500">Campaigns Sent</p></div>';
    html += '<div class="bg-[#111111] rounded-xl border p-4 text-center"><p class="text-2xl font-bold text-gray-400">0%</p><p class="text-[10px] text-gray-500">Open Rate</p></div>';
    html += '</div>';

    // Lists
    html += '<div class="bg-[#111111] rounded-xl border shadow-sm mb-5 overflow-hidden">';
    html += '<div class="px-5 py-4 border-b border-white/5 flex items-center justify-between"><h3 class="font-bold text-gray-100 text-sm"><i class="fas fa-list text-blue-500 mr-2"></i>Email Lists</h3></div>';
    if (lists.length === 0) {
      html += '<div class="p-8 text-center text-gray-400"><p>No email lists yet. Create one to start building your outreach.</p></div>';
    } else {
      html += '<div class="divide-y divide-gray-100">';
      for (var i = 0; i < lists.length; i++) {
        var l = lists[i];
        html += '<div class="px-5 py-3 flex items-center justify-between hover:bg-[#111111]/5">';
        html += '<div><p class="font-medium text-sm text-gray-100">' + (l.name || 'Untitled List') + '</p><p class="text-xs text-gray-500">' + (l.contact_count || 0) + ' contacts · ' + (l.source || 'manual') + '</p></div>';
        html += '<div class="flex gap-2"><button onclick="window._eoViewList(' + l.id + ')" class="text-xs text-blue-600 hover:underline">View</button><button onclick="window._eoDeleteList(' + l.id + ')" class="text-xs text-red-500 hover:underline">Delete</button></div>';
        html += '</div>';
      }
      html += '</div>';
    }
    html += '</div>';

    // Recent Contacts
    html += '<div class="bg-[#111111] rounded-xl border shadow-sm overflow-hidden">';
    html += '<div class="px-5 py-4 border-b border-white/5"><h3 class="font-bold text-gray-100 text-sm"><i class="fas fa-users text-blue-500 mr-2"></i>Recent Contacts</h3></div>';
    if (contacts.length === 0) {
      html += '<div class="p-8 text-center text-gray-400"><p>No contacts yet. Import a CSV or add contacts manually.</p></div>';
    } else {
      html += '<div class="overflow-x-auto"><table class="w-full"><thead><tr class="bg-[#0A0A0A] text-xs text-gray-500 uppercase"><th class="px-4 py-3 text-left">Name</th><th class="px-4 py-3 text-left">Email</th><th class="px-4 py-3 text-left">Company</th><th class="px-4 py-3 text-center">Status</th></tr></thead><tbody>';
      for (var j = 0; j < contacts.length; j++) {
        var ct = contacts[j];
        html += '<tr class="border-b border-white/5 hover:bg-[#111111]/5"><td class="px-4 py-3 text-sm font-medium text-gray-100">' + (ct.name || '-') + '</td><td class="px-4 py-3 text-sm text-gray-400">' + (ct.email || '-') + '</td><td class="px-4 py-3 text-sm text-gray-500">' + (ct.company || '-') + '</td><td class="px-4 py-3 text-center">' + badge(ct.status || 'active') + '</td></tr>';
      }
      html += '</tbody></table></div>';
    }
    html += '</div>';
    root.innerHTML = html;
  }

  window._eoNewList = function() {
    var body = '<div class="space-y-3"><div><label class="block text-xs font-medium text-gray-400 mb-1">List Name *</label><input type="text" id="eoListName" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm" placeholder="e.g. Homeowners - Edmonton"></div><div><label class="block text-xs font-medium text-gray-400 mb-1">Description</label><input type="text" id="eoListDesc" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm" placeholder="Optional description"></div></div>';
    showModal('Create Email List', body, function() {
      var name = document.getElementById('eoListName').value.trim();
      if (!name) { toast('List name required', 'error'); return; }
      fetch('/api/email-outreach/lists', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ name: name, description: document.getElementById('eoListDesc').value.trim() }) })
        .then(function(r) { return r.json(); })
        .then(function(res) { if (res.success || res.list) { closeModal(); toast('List created!'); initEmailOutreach(); } else { toast(res.error || 'Failed', 'error'); } })
        .catch(function() { toast('Network error', 'error'); });
    }, 'Create List');
  };

  window._eoImportContacts = function() {
    var body = '<div class="space-y-3"><div><label class="block text-xs font-medium text-gray-400 mb-1">Select List</label><select id="eoImportList" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm"><option value="">Loading...</option></select></div><div><label class="block text-xs font-medium text-gray-400 mb-1">CSV File</label><input type="file" id="eoImportFile" accept=".csv" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm"></div><p class="text-xs text-gray-400">CSV should have columns: name, email, phone, company</p></div>';
    showModal('Import Contacts', body, function() {
      var listId = document.getElementById('eoImportList').value;
      var file = document.getElementById('eoImportFile').files[0];
      if (!listId || !file) { toast('Select a list and file', 'error'); return; }
      var reader = new FileReader();
      reader.onload = function(e) {
        var lines = e.target.result.split('\n').filter(function(l) { return l.trim(); });
        var headers = lines[0].split(',').map(function(h) { return h.trim().toLowerCase(); });
        var contacts = [];
        for (var i = 1; i < lines.length; i++) {
          var cols = lines[i].split(',');
          var c = {};
          headers.forEach(function(h, idx) { c[h] = (cols[idx] || '').trim().replace(/^"|"$/g, ''); });
          if (c.email) contacts.push(c);
        }
        fetch('/api/email-outreach/contacts/import', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ list_id: parseInt(listId), contacts: contacts }) })
          .then(function(r) { return r.json(); })
          .then(function(res) { closeModal(); toast((res.imported || 0) + ' contacts imported!'); initEmailOutreach(); })
          .catch(function() { toast('Import failed', 'error'); });
      };
      reader.readAsText(file);
    }, 'Import');
    // Load lists for dropdown
    fetch('/api/email-outreach/lists', { headers: authHeadersOnly() }).then(function(r) { return r.json(); }).then(function(data) {
      var sel = document.getElementById('eoImportList');
      if (sel) { sel.innerHTML = '<option value="">Select list...</option>'; (data.lists || []).forEach(function(l) { sel.innerHTML += '<option value="' + l.id + '">' + l.name + '</option>'; }); }
    });
  };

  window._eoViewList = function(id) { toast('List details coming soon'); };
  window._eoDeleteList = async function(id) {
    if (!(await window.rmConfirm('Delete this list and all its contacts?'))) return
    fetch('/api/email-outreach/lists/' + id, { method: 'DELETE', headers: authHeadersOnly() })
      .then(function() { toast('List deleted'); initEmailOutreach(); })
      .catch(function() { toast('Failed to delete', 'error'); });
  };

  // ============================================================
  // MODULE: PIPELINE
  // ============================================================
  function renderPipeCard(item, type) {
    var html = '<div class="pipe-card bg-[#111111] rounded-xl border border-white/10 p-3 shadow-sm hover:shadow-md transition-shadow cursor-grab active:cursor-grabbing"';
    html += ' data-id="' + item.id + '" data-type="' + type + '">';
    if (type === 'customer') {
      html += '<p class="font-semibold text-sm text-gray-100 truncate">' + (item.name || 'Unknown') + '</p>';
      if (item.company) html += '<p class="text-xs text-gray-500 truncate"><i class="fas fa-building mr-1"></i>' + item.company + '</p>';
      if (item.phone) html += '<p class="text-xs text-gray-500"><i class="fas fa-phone mr-1"></i>' + item.phone + '</p>';
      if (item.address) html += '<p class="text-xs text-gray-400 truncate"><i class="fas fa-map-marker-alt mr-1"></i>' + item.address + '</p>';
      if (item.lifetime_value > 0) html += '<p class="text-xs font-semibold text-green-700 mt-1">' + money(item.lifetime_value) + ' lifetime</p>';
    } else {
      html += '<p class="font-semibold text-sm text-gray-100 truncate">' + (item.title || item.proposal_number || 'Proposal') + '</p>';
      if (item.customer_name) html += '<p class="text-xs text-gray-500 truncate"><i class="fas fa-user mr-1"></i>' + item.customer_name + '</p>';
      if (item.property_address) html += '<p class="text-xs text-gray-400 truncate"><i class="fas fa-map-marker-alt mr-1"></i>' + item.property_address + '</p>';
      if (item.total_amount) html += '<p class="text-xs font-semibold text-brand-700 mt-1">' + money(item.total_amount) + '</p>';
    }
    html += '<div class="mt-1.5 flex items-center gap-2">' + badge(item.status) + '<span class="text-[10px] text-gray-400">' + fmtDate(item.updated_at || item.created_at) + '</span></div>';
    html += '</div>';
    return html;
  }

  function renderPipeline(customers, proposals) {
    window._pipelineCustomers = customers;
    window._pipelineProposals = proposals;

    var cols = [
      { id: 'leads', title: 'Lead Capture', icon: 'fa-bullseye', bgClass: 'bg-blue-500', lightClass: 'bg-blue-50', borderClass: 'border-blue-200', ringClass: 'ring-blue-300', textClass: 'text-blue-700', items: customers.filter(function(c) { return c.status === 'lead'; }), type: 'customer', dropStatus: 'lead' },
      { id: 'contacted', title: 'Contact Made', icon: 'fa-phone-alt', bgClass: 'bg-white/10', lightClass: 'bg-white/10', borderClass: 'border-white/15', ringClass: 'ring-gray-300', textClass: 'text-gray-400', items: customers.filter(function(c) { return c.status === 'active'; }), type: 'customer', dropStatus: 'active' },
      { id: 'proposals', title: 'Proposal Sent', icon: 'fa-file-signature', bgClass: 'bg-blue-500/15', lightClass: 'bg-blue-500/15', borderClass: 'border-blue-500/20', ringClass: 'ring-blue-400', textClass: 'text-blue-400', items: proposals.filter(function(p) { return p.status === 'draft' || p.status === 'sent' || p.status === 'viewed'; }), type: 'proposal', dropStatus: 'sent' },
      { id: 'won', title: 'Won / Closed', icon: 'fa-handshake', bgClass: 'bg-green-500', lightClass: 'bg-green-50', borderClass: 'border-green-200', ringClass: 'ring-green-300', textClass: 'text-green-700', items: proposals.filter(function(p) { return p.status === 'accepted'; }), type: 'proposal', dropStatus: 'accepted' }
    ];

    var openValue = cols[2].items.reduce(function(s, p) { return s + (parseFloat(p.total_amount) || 0); }, 0);
    var wonValue = cols[3].items.reduce(function(s, p) { return s + (parseFloat(p.total_amount) || 0); }, 0);

    var html = '<div class="mb-5 flex items-center justify-between flex-wrap gap-3">' +
      '<div><h2 class="text-lg font-bold text-gray-100"><i class="fas fa-funnel-dollar text-brand-500 mr-2"></i>Sales Pipeline</h2>' +
      '<p class="text-xs text-gray-500 mt-0.5">Drag cards between stages to update status</p></div>' +
      '<button onclick="window._crmAddLead()" class="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700"><i class="fas fa-user-plus mr-1"></i>Add Lead</button></div>';

    html += '<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">' +
      '<div class="bg-[#111111] rounded-xl border p-4 text-center"><p class="text-2xl font-black text-blue-600">' + (cols[0].items.length + cols[1].items.length) + '</p><p class="text-[10px] text-gray-500">Active Leads</p></div>' +
      '<div class="bg-[#111111] rounded-xl border p-4 text-center"><p class="text-2xl font-black text-blue-400">' + cols[2].items.length + '</p><p class="text-[10px] text-gray-500">Open Proposals</p></div>' +
      '<div class="bg-[#111111] rounded-xl border p-4 text-center"><p class="text-2xl font-black text-gray-300">' + money(openValue) + '</p><p class="text-[10px] text-gray-500">Pipeline Value</p></div>' +
      '<div class="bg-[#111111] rounded-xl border p-4 text-center"><p class="text-2xl font-black text-emerald-400">' + money(wonValue) + '</p><p class="text-[10px] text-gray-500">Won Value</p></div></div>';

    html += '<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">';
    cols.forEach(function(col) {
      var colValue = col.type === 'proposal' ? col.items.reduce(function(s, p) { return s + (parseFloat(p.total_amount) || 0); }, 0) : 0;
      html += '<div class="flex flex-col">';
      html += '<div class="' + col.bgClass + ' text-white rounded-t-xl px-4 py-3 flex items-center justify-between">' +
        '<div class="flex items-center gap-2"><i class="fas ' + col.icon + '"></i><span class="font-semibold text-sm">' + col.title + '</span></div>' +
        '<span class="bg-[#111111]/20 text-white text-xs font-bold px-2 py-0.5 rounded-full">' + col.items.length + '</span></div>';
      if (colValue > 0) {
        html += '<div class="' + col.lightClass + ' border-x ' + col.borderClass + ' px-4 py-1 text-xs font-semibold ' + col.textClass + '">' + money(colValue) + ' value</div>';
      }
      html += '<div id="pipe-col-' + col.id + '" data-col-type="' + col.type + '" data-col-status="' + col.dropStatus + '"';
      html += ' class="flex-1 ' + col.lightClass + ' border border-t-0 ' + col.borderClass + ' rounded-b-xl p-3 space-y-2 min-h-[200px]"';
      html += ' ondragover="event.preventDefault(); this.classList.add(\'ring-2\', \'' + col.ringClass + '\')"';
      html += ' ondragleave="this.classList.remove(\'ring-2\', \'' + col.ringClass + '\')"';
      html += ' ondrop="window._pipeDrop(event, \'' + col.id + '\', \'' + col.type + '\', \'' + col.dropStatus + '\')">';
      if (col.items.length === 0) {
        html += '<div class="text-center py-8 text-gray-300"><i class="fas ' + col.icon + ' text-2xl mb-2 block"></i><p class="text-xs">No items yet</p></div>';
      } else {
        col.items.forEach(function(item) { html += renderPipeCard(item, col.type); });
      }
      html += '</div></div>';
    });
    html += '</div>';

    root.innerHTML = html;

    document.querySelectorAll('.pipe-card').forEach(function(card) {
      card.setAttribute('draggable', 'true');
      card.addEventListener('dragstart', function(e) {
        e.dataTransfer.setData('text/plain', card.getAttribute('data-id') + '|' + card.getAttribute('data-type'));
        card.classList.add('opacity-50');
      });
      card.addEventListener('dragend', function() { card.classList.remove('opacity-50'); });
    });
  }

  function initPipeline() {
    root.innerHTML = '<div class="text-center py-8"><div class="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-brand-500 mx-auto mb-3"></div><p class="text-sm text-gray-500">Loading pipeline...</p></div>';
    Promise.all([
      fetch('/api/crm/customers', { headers: authHeadersOnly() }).then(function(r) { return r.json(); }),
      fetch('/api/crm/proposals', { headers: authHeadersOnly() }).then(function(r) { return r.json(); })
    ]).then(function(results) {
      renderPipeline(results[0].customers || [], results[1].proposals || []);
    }).catch(function() {
      root.innerHTML = '<p class="text-red-500 text-center py-8">Failed to load pipeline data.</p>';
    });
  }

  window._pipeDrop = function(event, colId, colType, newStatus) {
    event.preventDefault();
    var col = document.getElementById('pipe-col-' + colId);
    if (col) col.classList.remove('ring-2');
    var dragData = event.dataTransfer.getData('text/plain');
    if (!dragData) return;
    var parts = dragData.split('|');
    var itemId = parts[0];
    var itemType = parts[1];
    if (itemType !== colType) { toast('Cannot drop here — wrong card type', 'error'); return; }
    if (itemType === 'customer') {
      var cust = (window._pipelineCustomers || []).find(function(c) { return String(c.id) === String(itemId); });
      if (!cust) return;
      var payload = { name: cust.name, email: cust.email || null, phone: cust.phone || null, company: cust.company || null, address: cust.address || null, city: cust.city || null, province: cust.province || null, postal_code: cust.postal_code || null, notes: cust.notes || null, tags: cust.tags || null, status: newStatus };
      fetch('/api/crm/customers/' + itemId, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(payload) })
        .then(function(r) { return r.json(); })
        .then(function(res) { if (res.success) { toast('Moved to ' + newStatus); initPipeline(); } else toast(res.error || 'Update failed', 'error'); })
        .catch(function() { toast('Network error', 'error'); });
    } else {
      fetch('/api/crm/proposals/' + itemId, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ status: newStatus }) })
        .then(function(r) { return r.json(); })
        .then(function(res) { if (res.success) { toast('Status updated'); initPipeline(); } else toast(res.error || 'Update failed', 'error'); })
        .catch(function() { toast('Network error', 'error'); });
    }
  };

  window._crmAddLead = function() {
    var body = '<div class="space-y-3">' +
      '<div><label class="block text-xs font-medium text-gray-400 mb-1">Full Name *</label><input type="text" id="leadName" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm" placeholder="Jane Smith"></div>' +
      '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3"><div><label class="block text-xs font-medium text-gray-400 mb-1">Phone</label><input type="tel" id="leadPhone" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm"></div>' +
      '<div><label class="block text-xs font-medium text-gray-400 mb-1">Email</label><input type="email" id="leadEmail" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm"></div></div>' +
      '<div><label class="block text-xs font-medium text-gray-400 mb-1">Property Address</label><input type="text" id="leadAddress" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm"></div>' +
      '<div><label class="block text-xs font-medium text-gray-400 mb-1">Notes</label><textarea id="leadNotes" rows="2" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm" placeholder="How did they find you? What are they looking for?"></textarea></div>' +
    '</div>';
    showModal('Add New Lead', body, function() {
      var name = document.getElementById('leadName').value.trim();
      if (!name) { toast('Name is required', 'error'); return; }
      var payload = { name: name, phone: document.getElementById('leadPhone').value.trim() || null, email: document.getElementById('leadEmail').value.trim() || null, address: document.getElementById('leadAddress').value.trim() || null, notes: document.getElementById('leadNotes').value.trim() || null, status: 'lead' };
      fetch('/api/crm/customers', { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) })
        .then(function(r) { return r.json(); })
        .then(function(res) { if (res.success) { closeModal(); toast('Lead added!'); initPipeline(); } else toast(res.error || 'Failed to add lead', 'error'); })
        .catch(function() { toast('Network error', 'error'); });
    }, 'Add Lead');
  };

  // ---- Share Report (public link for homeowners) ----
  window._crmShareReport = function(orderId) {
    fetch('/api/reports/' + orderId + '/share', { method: 'POST', headers: authHeaders(), body: JSON.stringify({}) })
      .then(function(r) { return r.json(); })
      .then(function(res) {
        if (!res.share_url) { toast(res.error || 'Failed to generate share link', 'error'); return; }
        var shareUrl = res.share_url;
        var body = '<div class="space-y-4">' +
          '<div class="bg-sky-50 border border-sky-200 rounded-xl p-4"><p class="text-xs font-semibold text-sky-700 mb-2"><i class="fas fa-link mr-1"></i>Shareable Report Link</p>' +
          '<div class="flex gap-2"><input type="text" id="shareUrlInput" value="' + shareUrl + '" readonly class="flex-1 px-3 py-2 border border-white/15 rounded-lg text-sm bg-[#111111] text-gray-300 select-all">' +
          '<button onclick="navigator.clipboard.writeText(\'' + shareUrl + '\').then(function(){window._shareToastCopy()})" class="px-4 py-2 bg-sky-600 text-white rounded-lg text-sm font-semibold hover:bg-sky-700 whitespace-nowrap"><i class="fas fa-copy mr-1"></i>Copy</button></div>' +
          '<p class="text-xs text-sky-600 mt-1">Anyone with this link can view the full report — no login required.</p></div>' +
          '<div>' +
          '<p class="text-xs font-semibold text-gray-400 mb-2"><i class="fas fa-envelope mr-1 text-gray-400"></i>Email to Homeowner <span class="font-normal text-gray-400">(optional)</span></p>' +
          '<div class="flex gap-2"><input type="email" id="shareEmailInput" placeholder="homeowner@email.com" class="flex-1 px-3 py-2 border border-white/15 rounded-lg text-sm">' +
          '<button onclick="window._crmSendShareEmail(' + orderId + ', \'' + shareUrl + '\')" class="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 whitespace-nowrap"><i class="fas fa-paper-plane mr-1"></i>Send</button></div>' +
          '</div>' +
        '</div>';
        showModal('Share Report', body);
        window._shareToastCopy = function() { toast('Link copied to clipboard!'); };
      })
      .catch(function() { toast('Failed to generate share link', 'error'); });
  };

  window._crmSendShareEmail = function(orderId, shareUrl) {
    var email = document.getElementById('shareEmailInput').value.trim();
    if (!email) { toast('Please enter an email address', 'error'); return; }
    fetch('/api/reports/' + orderId + '/share', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ email: email }) })
      .then(function(r) { return r.json(); })
      .then(function(res) {
        if (res.success) { toast('Report link sent to ' + email + '!'); closeModal(); }
        else toast(res.error || 'Failed to send email', 'error');
      })
      .catch(function() { toast('Network error', 'error'); });
  };

  // ---- Create Proposal from Report ----
  window._crmCreateProposalFromReport = function(orderId) {
    Promise.all([
      fetch('/api/reports/' + orderId, { headers: authHeadersOnly() }).then(function(r) { return r.json(); }),
      fetch('/api/crm/customers', { headers: authHeadersOnly() }).then(function(r) { return r.json(); })
    ]).then(function(results) {
      var reportRow = results[0];
      var custs = results[1].customers || [];
      var report = null;
      try { report = JSON.parse(reportRow.api_response_raw || 'null'); } catch(e) {}

      var address = reportRow.property_address || (report && report.property && report.property.address) || '';
      var area = Math.round(reportRow.roof_area_sqft || (report && report.total_true_area_sqft) || 0);
      var pitch = (report && report.roof_pitch_ratio) || '';
      var complexity = (report && report.materials && report.materials.complexity_class) || '';

      var bomLines = [];
      if (report && report.materials && report.materials.line_items) {
        report.materials.line_items.forEach(function(item) {
          if (item.order_quantity && item.description) {
            bomLines.push(item.order_quantity + ' ' + (item.order_unit || 'ea') + '  ' + (item.description || item.category));
          }
        });
      }

      var scopeOfWork = 'Complete roof replacement at ' + (address || 'the property') + '.\n' +
        'Roof area: ' + area + ' sq ft' + (pitch ? ' | Pitch: ' + pitch : '') + (complexity ? ' | Complexity: ' + complexity : '') + '.\n' +
        'Remove existing roofing materials, inspect and repair decking as needed, install new underlayment and roofing materials per specifications.';

      var body = '<div class="space-y-3">' +
        '<div class="bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm text-blue-700"><i class="fas fa-file-alt mr-1"></i>Pre-filled from report: <strong>' + (address || 'Order #' + orderId) + '</strong></div>' +
        '<div><label class="block text-xs font-medium text-gray-400 mb-1">Customer *</label>' + customerSelectHTML(custs, '', 'propFromReportCustomer') + '</div>' +
        '<div><label class="block text-xs font-medium text-gray-400 mb-1">Proposal Title *</label><input type="text" id="propFromReportTitle" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm" value="Roofing Proposal \u2014 ' + address.replace(/"/g, '&quot;') + '"></div>' +
        '<div><label class="block text-xs font-medium text-gray-400 mb-1">Property Address</label><input type="text" id="propFromReportAddress" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm" value="' + address.replace(/"/g, '&quot;') + '"></div>' +
        '<div><label class="block text-xs font-medium text-gray-400 mb-1">Scope of Work</label><textarea id="propFromReportScope" rows="4" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm">' + scopeOfWork + '</textarea></div>' +
        (bomLines.length ? '<div><label class="block text-xs font-medium text-gray-400 mb-1">Materials Summary</label><textarea id="propFromReportMaterials" rows="5" class="w-full px-3 py-2 border border-white/15 rounded-lg text-sm font-mono text-xs">' + bomLines.join('\n') + '</textarea></div>' : '') +
        '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">' +
          '<div><label class="block text-xs font-medium text-gray-400 mb-1">Tax Rate (%)</label><input type="number" id="propFromReportTax" class="w-full px-2 py-2 border border-white/15 rounded-lg text-sm" value="5" min="0" step="0.5"></div>' +
          '<div><label class="block text-xs font-medium text-gray-400 mb-1">Valid Until</label><input type="date" id="propFromReportValid" class="w-full px-2 py-2 border border-white/15 rounded-lg text-sm"></div>' +
        '</div>' +
      '</div>';

      showModal('Create Proposal from Report', body, function() {
        var custData = getCustomerFromSelector('propFromReportCustomer');
        var title = document.getElementById('propFromReportTitle').value.trim();
        if (!custData) { toast('Please select a customer', 'error'); return; }
        if (!title) { toast('Title is required', 'error'); return; }
        var matEl = document.getElementById('propFromReportMaterials');
        var payload = Object.assign({}, custData, {
          title: title,
          property_address: document.getElementById('propFromReportAddress').value.trim() || null,
          scope_of_work: document.getElementById('propFromReportScope').value.trim() || null,
          materials_detail: matEl ? matEl.value.trim() || null : null,
          source_report_id: orderId,
          tax_rate: parseFloat(document.getElementById('propFromReportTax').value) || 5,
          valid_until: document.getElementById('propFromReportValid').value || null
        });
        fetch('/api/crm/proposals', { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) })
          .then(function(r) { return r.json(); })
          .then(function(res) {
            if (res.success) { closeModal(); toast('Proposal created!'); setTimeout(function() { window.location.href = '/customer/proposals'; }, 1200); }
            else toast(res.error || 'Failed to create proposal', 'error');
          })
          .catch(function(e) { toast('Network error: ' + (e.message || 'Unknown'), 'error'); });
      }, 'Create Proposal');
    }).catch(function() { toast('Failed to load report data', 'error'); });
  };

  // ============================================================
  // MODULE: D2D (Door-to-Door)
  // ============================================================
  function initD2D() {
    // Redirect to dedicated D2D page with Google Maps
    window.location.href = '/customer/d2d';
  }

})();

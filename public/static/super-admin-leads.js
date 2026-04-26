// ============================================================
// SUPER ADMIN — LEADS INBOX
// Rendered in the super-admin dashboard when SA.view === 'leads-inbox'.
// Exposes window.renderSuperAdminLeadsView() and manages its own state,
// polling, keyboard shortcuts, and compose modal.
// ============================================================
(function() {
  'use strict';

  if (window.__saLeadsInit) return;
  window.__saLeadsInit = true;

  var SAL = {
    leads: [],
    total: 0,
    counts: { new: 0, contacted: 0, report_sent: 0, converted: 0, closed_lost: 0 },
    filterStatus: '',
    filterLeadType: '',
    filterPriority: '',
    search: '',
    selectedId: null,
    lastFetchedAt: null,
    pollTimer: null,
    loading: true,
    selectedIndex: -1
  };

  function token() { return localStorage.getItem('rc_token') || ''; }
  function authHeaders() { return { 'Authorization': 'Bearer ' + token(), 'Content-Type': 'application/json' }; }

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function timeAgo(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr.indexOf('Z') === -1 && dateStr.indexOf('+') === -1 ? dateStr + 'Z' : dateStr);
    var diff = Date.now() - d.getTime();
    if (diff < 0) diff = 0;
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    var h = Math.floor(mins / 60);
    if (h < 24) return h + 'h ago';
    var days = Math.floor(h / 24);
    if (days < 7) return days + 'd ago';
    return d.toLocaleDateString();
  }

  function priorityBadge(p) {
    var cfg = {
      urgent: { bg: '#dc2626', fg: '#fff', label: '🚨 URGENT' },
      high:   { bg: '#f59e0b', fg: '#111', label: '⚡ HIGH' },
      normal: { bg: '#e5e7eb', fg: '#374151', label: 'normal' },
      low:    { bg: '#f3f4f6', fg: '#6b7280', label: 'low' }
    };
    var c = cfg[p] || cfg.normal;
    return '<span style="background:' + c.bg + ';color:' + c.fg + ';font-size:10px;font-weight:700;padding:3px 8px;border-radius:999px;white-space:nowrap">' + esc(c.label) + '</span>';
  }

  function statusBadge(s) {
    var cfg = {
      new: { bg: '#10b98115', fg: '#059669', label: '● new' },
      contacted: { bg: '#3b82f615', fg: '#2563eb', label: 'contacted' },
      report_sent: { bg: '#8b5cf615', fg: '#7c3aed', label: 'report sent' },
      converted: { bg: '#22c55e15', fg: '#15803d', label: 'converted' },
      closed_lost: { bg: '#ef444415', fg: '#b91c1c', label: 'closed lost' }
    };
    var c = cfg[s] || cfg.new;
    return '<span style="background:' + c.bg + ';color:' + c.fg + ';font-size:10px;font-weight:600;padding:3px 8px;border-radius:6px;white-space:nowrap">' + esc(c.label) + '</span>';
  }

  function buildQuery() {
    var p = new URLSearchParams();
    if (SAL.filterStatus) p.set('status', SAL.filterStatus);
    if (SAL.filterLeadType) p.set('lead_type', SAL.filterLeadType);
    if (SAL.filterPriority) p.set('priority', SAL.filterPriority);
    if (SAL.search) p.set('q', SAL.search);
    p.set('limit', '100');
    return p.toString();
  }

  function load() {
    SAL.loading = true;
    render();
    fetch('/api/admin/leads?' + buildQuery(), { headers: authHeaders() })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        SAL.leads = data.leads || [];
        SAL.total = data.total || 0;
        if (data.counts) SAL.counts = data.counts;
        SAL.loading = false;
        SAL.lastFetchedAt = new Date().toISOString();
        render();
        startPolling();
      })
      .catch(function(err) {
        SAL.loading = false;
        console.warn('[leads] load error:', err);
        render();
      });
  }

  function poll() {
    if (document.visibilityState !== 'visible') return;
    if (!SAL.lastFetchedAt) return;
    var params = buildQuery() + '&since=' + encodeURIComponent(SAL.lastFetchedAt);
    fetch('/api/admin/leads?' + params, { headers: authHeaders() })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var fresh = (data.leads || []).filter(function(l) {
          return !SAL.leads.some(function(x) { return x.id === l.id; });
        });
        if (fresh.length > 0) {
          SAL.leads = fresh.concat(SAL.leads);
          SAL.total += fresh.length;
          if (data.counts) SAL.counts = data.counts;
          SAL.lastFetchedAt = new Date().toISOString();
          render();
          // Flash new rows
          fresh.forEach(function(l) {
            var row = document.querySelector('[data-lead-row="' + l.id + '"]');
            if (row) {
              row.style.background = '#fef9c3';
              setTimeout(function() { row.style.transition = 'background 1.2s'; row.style.background = ''; }, 100);
            }
          });
          // Audible ping (best-effort)
          try {
            var AC = window.AudioContext || window.webkitAudioContext;
            if (AC) {
              var ctx = new AC();
              var o = ctx.createOscillator(); var g = ctx.createGain();
              o.frequency.value = 880; g.gain.value = 0.05;
              o.connect(g); g.connect(ctx.destination);
              o.start(); o.stop(ctx.currentTime + 0.12);
            }
          } catch (_) {}
        } else if (data.counts) {
          SAL.counts = data.counts;
          var header = document.querySelector('[data-leads-new-count]');
          if (header) header.textContent = SAL.counts.new || 0;
        }
      })
      .catch(function() {});
  }

  function startPolling() {
    if (SAL.pollTimer) return;
    SAL.pollTimer = setInterval(poll, 20000);
  }

  function stopPolling() {
    if (SAL.pollTimer) { clearInterval(SAL.pollTimer); SAL.pollTimer = null; }
  }

  // ── RENDER ──
  function render() {
    var root = document.getElementById('sa-root');
    if (!root) return;

    if (SAL.loading) {
      root.innerHTML = '<div class="p-8 text-center text-gray-500"><div class="inline-block w-8 h-8 border-[3px] border-teal-100 border-t-teal-500 rounded-full animate-spin"></div><p class="mt-3 text-sm">Loading leads…</p></div>';
      return;
    }

    var statusChips = ['', 'new', 'contacted', 'report_sent', 'converted', 'closed_lost'];
    var chipsHtml = statusChips.map(function(s) {
      var active = SAL.filterStatus === s;
      var label = s === '' ? 'All' : (s === 'report_sent' ? 'Report Sent' : s.charAt(0).toUpperCase() + s.slice(1).replace('_', ' '));
      var cnt = s === '' ? SAL.total : (SAL.counts[s] || 0);
      return '<button onclick="window._salSetStatus(\'' + s + '\')" class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ' +
        (active ? 'bg-slate-800 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200') +
        '">' + esc(label) + ' <span class="ml-1 opacity-70">(' + cnt + ')</span></button>';
    }).join(' ');

    var newDot = (SAL.counts.new || 0) > 0
      ? '<span class="inline-block w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse mr-1.5"></span>'
      : '';

    var html = '' +
      '<div class="mb-5 flex flex-wrap items-center justify-between gap-3">' +
        '<div>' +
          '<h2 class="text-2xl font-black text-gray-900">' + newDot + 'Leads Inbox <span class="text-sm font-normal text-gray-500">(<span data-leads-new-count>' + (SAL.counts.new || 0) + '</span> new)</span></h2>' +
          '<p class="text-xs text-gray-500 mt-0.5">Lead-magnet submissions, contact forms, and demo requests</p>' +
        '</div>' +
        '<div class="flex items-center gap-2">' +
          '<input id="sal-search" type="text" placeholder="Search name, email, address…" value="' + esc(SAL.search) + '" oninput="window._salSearch(this.value)" class="px-3 py-2 border border-gray-300 rounded-lg text-sm w-64 focus:outline-none focus:border-teal-500">' +
          '<select onchange="window._salSetPriority(this.value)" class="px-3 py-2 border border-gray-300 rounded-lg text-sm">' +
            '<option value="">All priority</option>' +
            ['urgent','high','normal','low'].map(function(p){return '<option value="'+p+'"' + (SAL.filterPriority===p?' selected':'') + '>' + p + '</option>';}).join('') +
          '</select>' +
          '<select onchange="window._salSetLeadType(this.value)" class="px-3 py-2 border border-gray-300 rounded-lg text-sm">' +
            '<option value="">All types</option>' +
            ['free_measurement_report','contact','demo','comparison','storm','hail','hurricane','other'].map(function(t){return '<option value="'+t+'"' + (SAL.filterLeadType===t?' selected':'') + '>' + t + '</option>';}).join('') +
          '</select>' +
          '<button onclick="window._salRefresh()" class="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm"><i class="fas fa-sync-alt"></i></button>' +
          '<button onclick="window._salExport()" class="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm"><i class="fas fa-download mr-1"></i>CSV</button>' +
        '</div>' +
      '</div>';

    html += '<div class="flex flex-wrap gap-2 mb-4">' + chipsHtml + '</div>';

    if (SAL.leads.length === 0) {
      html += '<div class="bg-white border border-gray-200 rounded-xl p-12 text-center">' +
        '<i class="fas fa-inbox text-4xl text-gray-300 mb-3"></i>' +
        '<p class="font-semibold text-gray-700">No leads match these filters</p>' +
        '<p class="text-sm text-gray-500 mt-1">Try clearing filters or check back later.</p>' +
      '</div>';
    } else {
      // Desktop table
      html += '<div class="hidden md:block bg-white border border-gray-200 rounded-xl overflow-hidden">' +
        '<table class="w-full text-sm">' +
        '<thead class="bg-gray-50 text-gray-600 text-xs uppercase"><tr>' +
          '<th class="px-3 py-2.5 text-left font-semibold">Priority</th>' +
          '<th class="px-3 py-2.5 text-left font-semibold">Name</th>' +
          '<th class="px-3 py-2.5 text-left font-semibold">Email</th>' +
          '<th class="px-3 py-2.5 text-left font-semibold">Address</th>' +
          '<th class="px-3 py-2.5 text-left font-semibold">Source</th>' +
          '<th class="px-3 py-2.5 text-left font-semibold">Type</th>' +
          '<th class="px-3 py-2.5 text-left font-semibold">Status</th>' +
          '<th class="px-3 py-2.5 text-left font-semibold">Created</th>' +
        '</tr></thead><tbody>';

      SAL.leads.forEach(function(l, idx) {
        var addr = l.address ? String(l.address) : '';
        var addrShort = addr.length > 40 ? addr.slice(0, 38) + '…' : addr;
        var sel = SAL.selectedId === l.id ? ' bg-teal-50' : '';
        html += '<tr data-lead-row="' + l.id + '" data-idx="' + idx + '" onclick="window._salOpenDrawer(' + l.id + ')" class="border-t border-gray-100 hover:bg-gray-50 cursor-pointer' + sel + '">' +
          '<td class="px-3 py-2.5">' + priorityBadge(l.priority || 'normal') + '</td>' +
          '<td class="px-3 py-2.5 font-medium text-gray-900">' + esc(l.name || '—') + '</td>' +
          '<td class="px-3 py-2.5 text-gray-700">' + esc(l.email || '—') + '</td>' +
          '<td class="px-3 py-2.5 text-gray-600" title="' + esc(addr) + '">' + esc(addrShort || '—') + '</td>' +
          '<td class="px-3 py-2.5 text-gray-600 text-xs">' + esc(l.source_page || '—') + '</td>' +
          '<td class="px-3 py-2.5 text-gray-600 text-xs">' + esc(l.lead_type || '—') + '</td>' +
          '<td class="px-3 py-2.5">' + statusBadge(l.status || 'new') + '</td>' +
          '<td class="px-3 py-2.5 text-gray-500 text-xs whitespace-nowrap">' + timeAgo(l.created_at) + '</td>' +
        '</tr>';
      });
      html += '</tbody></table></div>';

      // Mobile card list
      html += '<div class="md:hidden space-y-2">';
      SAL.leads.forEach(function(l) {
        html += '<div data-lead-row="' + l.id + '" onclick="window._salOpenDrawer(' + l.id + ')" class="bg-white border border-gray-200 rounded-xl p-4 cursor-pointer">' +
          '<div class="flex items-center justify-between mb-1">' +
            priorityBadge(l.priority || 'normal') +
            '<span class="text-[10px] text-gray-400">' + timeAgo(l.created_at) + '</span>' +
          '</div>' +
          '<p class="font-semibold text-gray-900">' + esc(l.name || '—') + '</p>' +
          '<p class="text-xs text-gray-600">' + esc(l.email || '') + '</p>' +
          '<p class="text-xs text-gray-500 mt-1">' + esc(l.address || '') + '</p>' +
          '<div class="flex items-center gap-2 mt-2">' + statusBadge(l.status || 'new') + '<span class="text-[10px] text-gray-500">' + esc(l.lead_type || '') + '</span></div>' +
        '</div>';
      });
      html += '</div>';
    }

    // Drawer mount point
    html += '<div id="sal-drawer-mount"></div>';
    html += '<div id="sal-modal-mount"></div>';
    html += '<div id="sal-toast"></div>';

    root.innerHTML = html;

    // Deep-link to lead id from URL ?id=NN
    var urlId = new URLSearchParams(location.search).get('id');
    if (urlId && !SAL.selectedId) {
      var idNum = parseInt(urlId, 10);
      if (idNum) window._salOpenDrawer(idNum);
    }
  }

  // ── DRAWER ──
  function renderDrawer(lead) {
    var mount = document.getElementById('sal-drawer-mount');
    if (!mount) return;
    var addr = lead.address ? esc(lead.address) : '—';
    var sentInfo = lead.report_sent_at
      ? '<div class="text-xs text-emerald-600 font-semibold mb-3"><i class="fas fa-check-circle mr-1"></i>Report sent ' + timeAgo(lead.report_sent_at) + '</div>'
      : '';

    mount.innerHTML =
      '<div onclick="if(event.target===this)window._salCloseDrawer()" style="position:fixed;inset:0;background:rgba(15,23,42,0.45);z-index:9000;display:flex;justify-content:flex-end" class="sal-backdrop">' +
        '<div style="width:min(520px,100%);height:100%;background:#fff;box-shadow:-4px 0 24px rgba(0,0,0,0.15);overflow-y:auto" class="p-6">' +
          '<div class="flex items-center justify-between mb-4">' +
            '<h3 class="text-lg font-bold text-gray-900">Lead #' + lead.id + '</h3>' +
            '<button onclick="window._salCloseDrawer()" class="text-gray-400 hover:text-gray-700"><i class="fas fa-times text-xl"></i></button>' +
          '</div>' +
          sentInfo +
          '<div class="space-y-3 mb-5">' +
            '<div><div class="text-[11px] uppercase text-gray-500 font-semibold">Name</div><div class="text-gray-900">' + esc(lead.name || '—') + '</div></div>' +
            '<div><div class="text-[11px] uppercase text-gray-500 font-semibold">Email</div><div class="text-gray-900"><a href="mailto:' + esc(lead.email) + '" class="text-teal-600">' + esc(lead.email) + '</a></div></div>' +
            (lead.phone ? '<div><div class="text-[11px] uppercase text-gray-500 font-semibold">Phone</div><div class="text-gray-900"><a href="tel:' + esc(lead.phone) + '" class="text-teal-600">' + esc(lead.phone) + '</a></div></div>' : '') +
            '<div><div class="text-[11px] uppercase text-gray-500 font-semibold">Property Address</div><div class="text-gray-900">' + addr + '</div></div>' +
            '<div class="grid grid-cols-2 gap-3">' +
              '<div><div class="text-[11px] uppercase text-gray-500 font-semibold">Source</div><div class="text-gray-700 text-sm">' + esc(lead.source_page || '—') + '</div></div>' +
              '<div><div class="text-[11px] uppercase text-gray-500 font-semibold">Lead Type</div><div class="text-gray-700 text-sm">' + esc(lead.lead_type || '—') + '</div></div>' +
            '</div>' +
            (lead.utm_source || lead.utm_medium || lead.utm_campaign ? '<div class="text-xs text-gray-500">' +
              (lead.utm_source ? 'utm_source: <b>' + esc(lead.utm_source) + '</b> &middot; ' : '') +
              (lead.utm_medium ? 'medium: <b>' + esc(lead.utm_medium) + '</b> &middot; ' : '') +
              (lead.utm_campaign ? 'campaign: <b>' + esc(lead.utm_campaign) + '</b>' : '') +
            '</div>' : '') +
          '</div>' +
          '<div class="grid grid-cols-2 gap-3 mb-4">' +
            '<label class="block"><div class="text-[11px] uppercase text-gray-500 font-semibold mb-1">Status</div>' +
            '<select id="sal-edit-status" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">' +
              ['new','contacted','report_sent','converted','closed_lost'].map(function(s){return '<option value="'+s+'"' + (lead.status===s?' selected':'') + '>' + s.replace('_',' ') + '</option>';}).join('') +
            '</select></label>' +
            '<label class="block"><div class="text-[11px] uppercase text-gray-500 font-semibold mb-1">Priority</div>' +
            '<select id="sal-edit-priority" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">' +
              ['urgent','high','normal','low'].map(function(p){return '<option value="'+p+'"' + ((lead.priority||'normal')===p?' selected':'') + '>' + p + '</option>';}).join('') +
            '</select></label>' +
          '</div>' +
          '<label class="block mb-4"><div class="text-[11px] uppercase text-gray-500 font-semibold mb-1">Admin Notes</div>' +
            '<textarea id="sal-edit-notes" rows="4" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono">' + esc(lead.admin_notes || '') + '</textarea>' +
          '</label>' +
          '<div class="flex gap-2">' +
            '<button onclick="window._salSaveLead(' + lead.id + ')" class="flex-1 bg-slate-800 text-white font-semibold py-2.5 rounded-lg hover:bg-slate-900"><i class="fas fa-save mr-1"></i>Save</button>' +
            '<button onclick="window._salOpenCompose(' + lead.id + ')" class="flex-1 bg-emerald-500 text-white font-bold py-2.5 rounded-lg hover:bg-emerald-600"><i class="fas fa-paper-plane mr-1"></i>Compose Report Email</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  // ── COMPOSE MODAL ──
  function renderCompose(lead) {
    var mount = document.getElementById('sal-modal-mount');
    if (!mount) return;
    var defSubject = 'Your free roof measurement report' + (lead.address ? ' for ' + lead.address : '');
    mount.innerHTML =
      '<div onclick="if(event.target===this)window._salCloseCompose()" style="position:fixed;inset:0;background:rgba(15,23,42,0.55);z-index:9100;display:flex;align-items:center;justify-content:center;padding:20px">' +
        '<div style="width:min(640px,100%);background:#fff;border-radius:14px;max-height:90vh;overflow-y:auto" class="p-6">' +
          '<div class="flex items-center justify-between mb-4">' +
            '<h3 class="text-lg font-bold text-gray-900">Send Report Email</h3>' +
            '<button onclick="window._salCloseCompose()" class="text-gray-400 hover:text-gray-700"><i class="fas fa-times text-xl"></i></button>' +
          '</div>' +
          '<label class="block mb-3"><div class="text-[11px] uppercase text-gray-500 font-semibold mb-1">To</div>' +
            '<input type="text" readonly value="' + esc(lead.email) + '" class="w-full border border-gray-300 bg-gray-50 rounded-lg px-3 py-2 text-sm"></label>' +
          '<label class="block mb-3"><div class="text-[11px] uppercase text-gray-500 font-semibold mb-1">Subject</div>' +
            '<input id="sal-cm-subject" type="text" value="' + esc(defSubject) + '" maxlength="200" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"></label>' +
          '<label class="block mb-3"><div class="text-[11px] uppercase text-gray-500 font-semibold mb-1">Body (HTML allowed)</div>' +
            '<textarea id="sal-cm-body" rows="10" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono">' +
              'Hi ' + esc((lead.name || '').split(' ')[0] || 'there') + ',\n\n' +
              'Your roof measurement report' + (lead.address ? ' for ' + esc(lead.address) : '') + ' is attached.\n\n' +
              'Let me know if you have any questions — just reply to this email.\n\n' +
              '— The Roof Manager Team' +
            '</textarea></label>' +
          '<label class="block mb-4"><div class="text-[11px] uppercase text-gray-500 font-semibold mb-1">Attachment URL (optional)</div>' +
            '<input id="sal-cm-url" type="url" placeholder="https://…/report.pdf" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">' +
            '<p class="text-[11px] text-gray-500 mt-1">Must be HTTPS on storage.googleapis.com, *.r2.dev, or roofmanager.ca.</p></label>' +
          '<div id="sal-cm-err" class="text-sm text-red-600 mb-3" style="display:none"></div>' +
          '<div class="flex gap-2">' +
            '<button onclick="window._salCloseCompose()" class="flex-1 bg-gray-100 text-gray-700 py-2.5 rounded-lg font-semibold hover:bg-gray-200">Cancel</button>' +
            '<button id="sal-cm-send" onclick="window._salSendReport(' + lead.id + ')" class="flex-1 bg-emerald-500 text-white py-2.5 rounded-lg font-bold hover:bg-emerald-600"><i class="fas fa-paper-plane mr-1"></i>Send</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function toast(msg, kind) {
    var t = document.getElementById('sal-toast');
    if (!t) return;
    var bg = kind === 'err' ? '#dc2626' : '#059669';
    t.innerHTML = '<div style="position:fixed;bottom:24px;right:24px;background:' + bg + ';color:#fff;padding:12px 18px;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.18);z-index:9200;font-size:14px;font-weight:600">' + esc(msg) + '</div>';
    setTimeout(function() { t.innerHTML = ''; }, 3500);
  }

  // ── GLOBAL HANDLERS ──
  window._salSetStatus = function(s) { SAL.filterStatus = s; load(); };
  window._salSetPriority = function(p) { SAL.filterPriority = p; load(); };
  window._salSetLeadType = function(t) { SAL.filterLeadType = t; load(); };
  var searchDebounce;
  window._salSearch = function(v) {
    SAL.search = v;
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(load, 250);
  };
  window._salRefresh = function() { load(); };
  window._salExport = function() {
    fetch('/api/admin/leads/export', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ status: SAL.filterStatus, lead_type: SAL.filterLeadType, priority: SAL.filterPriority, q: SAL.search })
    }).then(function(r) { return r.blob(); })
      .then(function(b) {
        var url = URL.createObjectURL(b);
        var a = document.createElement('a'); a.href = url; a.download = 'leads.csv'; a.click();
        URL.revokeObjectURL(url);
      })
      .catch(function() { toast('Export failed', 'err'); });
  };

  window._salOpenDrawer = function(id) {
    fetch('/api/admin/leads/' + id, { headers: authHeaders() })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!data || !data.lead) { toast('Lead not found', 'err'); return; }
        SAL.selectedId = id;
        renderDrawer(data.lead);
      });
  };
  window._salCloseDrawer = function() {
    SAL.selectedId = null;
    var m = document.getElementById('sal-drawer-mount'); if (m) m.innerHTML = '';
  };

  window._salSaveLead = function(id) {
    var status = document.getElementById('sal-edit-status').value;
    var priority = document.getElementById('sal-edit-priority').value;
    var notes = document.getElementById('sal-edit-notes').value;
    fetch('/api/admin/leads/' + id, {
      method: 'PATCH', headers: authHeaders(),
      body: JSON.stringify({ status: status, priority: priority, admin_notes: notes })
    }).then(function(r) { return r.json(); })
      .then(function(data) {
        if (data && data.success) {
          toast('Saved');
          window._salCloseDrawer();
          load();
        } else {
          toast((data && data.error) || 'Save failed', 'err');
        }
      })
      .catch(function() { toast('Save failed', 'err'); });
  };

  window._salOpenCompose = function(id) {
    var lead = SAL.leads.find(function(l) { return l.id === id; });
    if (lead) renderCompose(lead);
    else fetch('/api/admin/leads/' + id, { headers: authHeaders() }).then(function(r) { return r.json(); }).then(function(d) { if (d && d.lead) renderCompose(d.lead); });
  };
  window._salCloseCompose = function() {
    var m = document.getElementById('sal-modal-mount'); if (m) m.innerHTML = '';
  };

  window._salSendReport = function(id) {
    var subject = document.getElementById('sal-cm-subject').value.trim();
    var body = document.getElementById('sal-cm-body').value.trim();
    var url = document.getElementById('sal-cm-url').value.trim();
    var err = document.getElementById('sal-cm-err');
    if (!subject || subject.length > 200) { err.style.display = 'block'; err.textContent = 'Subject must be 1–200 chars'; return; }
    if (!body) { err.style.display = 'block'; err.textContent = 'Body required'; return; }
    err.style.display = 'none';
    var btn = document.getElementById('sal-cm-send');
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending…';
    fetch('/api/admin/leads/' + id + '/send-report', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ subject: subject, body_html: body.replace(/\n/g, '<br>'), attachment_url: url || undefined })
    }).then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
      .then(function(res) {
        if (res.ok && res.data && res.data.success) {
          toast('Report sent');
          window._salCloseCompose();
          window._salCloseDrawer();
          load();
        } else {
          err.style.display = 'block';
          err.textContent = (res.data && res.data.error) || 'Send failed';
          btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane mr-1"></i>Send';
        }
      })
      .catch(function(e) {
        err.style.display = 'block'; err.textContent = 'Network error';
        btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane mr-1"></i>Send';
      });
  };

  // Keyboard shortcuts
  document.addEventListener('keydown', function(e) {
    if (!document.getElementById('sa-root')) return;
    if (typeof SA !== 'undefined' && SA.view !== 'leads-inbox') return;
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
      e.preventDefault();
      var s = document.getElementById('sal-search'); if (s) s.focus();
    } else if (e.key === 'Escape') {
      if (document.getElementById('sal-modal-mount') && document.getElementById('sal-modal-mount').innerHTML) window._salCloseCompose();
      else if (SAL.selectedId) window._salCloseDrawer();
    } else if ((e.key === 'j' || e.key === 'k') && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
      if (SAL.leads.length === 0) return;
      if (e.key === 'j') SAL.selectedIndex = Math.min(SAL.leads.length - 1, SAL.selectedIndex + 1);
      else SAL.selectedIndex = Math.max(0, SAL.selectedIndex - 1);
      var row = document.querySelector('[data-idx="' + SAL.selectedIndex + '"]');
      if (row) { row.scrollIntoView({ block: 'nearest' }); row.style.outline = '2px solid #10b981'; setTimeout(function(){ row.style.outline=''; }, 800); }
    }
  });

  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible') startPolling();
    else stopPolling();
  });

  // Entry point invoked by super-admin-dashboard.js when SA.view === 'leads-inbox'
  window.renderSuperAdminLeadsView = function() {
    load();
  };
})();

// ============================================================
// Leads Inbox — Unified view of all customer leads/messages
// Pulls from: widget, D2D, secretary calls/SMS/callbacks,
//   lead-capture forms, job messages
// ============================================================
(function() {
  'use strict';

  var root = document.getElementById('leads-root');
  if (!root) return;

  function getToken() { return localStorage.getItem('rc_customer_token') || ''; }
  function authHeaders() { return { 'Authorization': 'Bearer ' + getToken() }; }

  var state = {
    leads: [],
    total: 0,
    unread_count: 0,
    channels: {},
    activeChannel: 'all',
    loading: true,
    offset: 0,
    limit: 50
  };

  var channelMeta = {
    all:              { icon: 'fa-inbox',        label: 'All Leads',     color: '#10b981' },
    voice_call:       { icon: 'fa-phone-alt',    label: 'Calls',         color: '#3b82f6' },
    sms:              { icon: 'fa-comment-dots',  label: 'Messages',      color: '#8b5cf6' },
    voicemail:        { icon: 'fa-voicemail',    label: 'Callbacks',     color: '#f59e0b' },
    web_widget:       { icon: 'fa-globe',        label: 'Widget',        color: '#06b6d4' },
    d2d_appointment:  { icon: 'fa-door-open',    label: 'D2D',           color: '#ef4444' },
    crm_job_message:  { icon: 'fa-hard-hat',     label: 'Job Messages',  color: '#6b7280' }
  };

  function loadLeads() {
    state.loading = true;
    render();
    var url = '/api/customer-leads?channel=' + state.activeChannel + '&limit=' + state.limit + '&offset=' + state.offset;
    fetch(url, { headers: authHeaders() })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        state.leads = data.leads || [];
        state.total = data.total || 0;
        state.unread_count = data.unread_count || 0;
        state.channels = data.channels || {};
        state.loading = false;
        render();
        // Auto-mark visible leads as read
        markVisibleAsRead();
      })
      .catch(function() {
        state.loading = false;
        state.leads = [];
        render();
      });
  }

  function markVisibleAsRead() {
    var unread = state.leads.filter(function(l) { return !l.is_read; });
    if (unread.length === 0) return;
    fetch('/api/customer-leads/mark-read', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ leads: unread.map(function(l) { return { id: l.id, channel: l.channel }; }) })
    }).catch(function() {});
  }

  function timeAgo(dateStr) {
    if (!dateStr) return '';
    var diff = Date.now() - new Date(dateStr).getTime();
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + 'h ago';
    var days = Math.floor(hours / 24);
    if (days < 7) return days + 'd ago';
    return new Date(dateStr).toLocaleDateString();
  }

  function render() {
    if (state.loading) {
      root.innerHTML = '<div class="text-center py-12"><div class="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-emerald-500 mx-auto mb-3"></div><p class="text-sm" style="color:var(--text-muted)">Loading leads...</p></div>';
      return;
    }

    // Header
    var html = '<div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-6">' +
      '<div>' +
        '<h2 class="text-xl font-bold" style="color:var(--text-primary)"><i class="fas fa-inbox mr-2 text-emerald-400"></i>Leads Inbox</h2>' +
        '<p class="text-sm mt-0.5" style="color:var(--text-muted)">' + state.total + ' total leads' + (state.unread_count > 0 ? ' &middot; <span class="text-emerald-400 font-semibold">' + state.unread_count + ' unread</span>' : '') + '</p>' +
      '</div>' +
      '<button onclick="window._leadsRefresh()" class="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors" style="background:var(--bg-card);color:var(--text-secondary);border:1px solid var(--border-color)"><i class="fas fa-sync-alt mr-1"></i>Refresh</button>' +
    '</div>';

    // Channel filter tabs
    html += '<div class="flex gap-1.5 mb-5 overflow-x-auto pb-1">';
    var channelKeys = ['all', 'voice_call', 'sms', 'voicemail', 'web_widget', 'd2d_appointment', 'crm_job_message'];
    for (var i = 0; i < channelKeys.length; i++) {
      var key = channelKeys[i];
      var meta = channelMeta[key];
      var count = key === 'all' ? state.total : (state.channels[key] || 0);
      var active = state.activeChannel === key;
      html += '<button onclick="window._leadsChannel(\'' + key + '\')" class="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-all ' +
        (active ? 'text-white shadow-sm' : '') + '" style="' +
        (active ? 'background:' + meta.color + ';color:white' : 'background:var(--bg-card);color:var(--text-muted);border:1px solid var(--border-color)') +
        '"><i class="fas ' + meta.icon + '"></i>' + meta.label +
        (count > 0 ? '<span class="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold" style="background:' + (active ? 'rgba(255,255,255,0.25)' : 'var(--bg-elevated)') + '">' + count + '</span>' : '') +
        '</button>';
    }
    html += '</div>';

    // Lead list
    if (state.leads.length === 0) {
      html += '<div class="rounded-2xl p-10 text-center" style="background:var(--bg-card);border:1px solid var(--border-color)">' +
        '<i class="fas fa-inbox text-4xl mb-3" style="color:var(--text-muted)"></i>' +
        '<p class="font-semibold text-sm" style="color:var(--text-primary)">No leads yet</p>' +
        '<p class="text-xs mt-1" style="color:var(--text-muted)">Leads from your website widget, secretary calls, D2D appointments, and more will appear here.</p>' +
      '</div>';
    } else {
      html += '<div class="space-y-2">';
      for (var j = 0; j < state.leads.length; j++) {
        var lead = state.leads[j];
        var ch = channelMeta[lead.channel] || channelMeta.all;
        var unreadDot = !lead.is_read ? '<div class="w-2.5 h-2.5 rounded-full bg-emerald-400 flex-shrink-0 animate-pulse"></div>' : '<div class="w-2.5 h-2.5 flex-shrink-0"></div>';

        html += '<div class="flex items-start gap-3 rounded-xl p-4 transition-colors hover:brightness-110 cursor-default" style="background:var(--bg-card);border:1px solid var(--border-color)">' +
          unreadDot +
          '<div class="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style="background:' + ch.color + '15">' +
            '<i class="fas ' + ch.icon + ' text-sm" style="color:' + ch.color + '"></i>' +
          '</div>' +
          '<div class="flex-1 min-w-0">' +
            '<div class="flex items-center justify-between gap-2">' +
              '<p class="text-sm font-semibold truncate" style="color:var(--text-primary)">' + escapeHtml(lead.contact_name) + '</p>' +
              '<span class="text-[10px] whitespace-nowrap flex-shrink-0" style="color:var(--text-muted)">' + timeAgo(lead.created_at) + '</span>' +
            '</div>' +
            '<p class="text-xs truncate mt-0.5" style="color:var(--text-secondary)">' + escapeHtml(lead.summary) + '</p>' +
            '<div class="flex items-center gap-2 mt-1">' +
              '<span class="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style="background:' + ch.color + '15;color:' + ch.color + '">' + ch.label + '</span>' +
              (lead.contact_info ? '<span class="text-[10px] truncate" style="color:var(--text-muted)">' + escapeHtml(lead.contact_info) + '</span>' : '') +
              (lead.detail ? '<span class="text-[10px] truncate" style="color:var(--text-muted)">' + escapeHtml(lead.detail) + '</span>' : '') +
            '</div>' +
          '</div>' +
        '</div>';
      }
      html += '</div>';

      // Pagination
      if (state.total > state.limit) {
        var totalPages = Math.ceil(state.total / state.limit);
        var currentPage = Math.floor(state.offset / state.limit) + 1;
        html += '<div class="flex items-center justify-center gap-2 mt-6">';
        if (state.offset > 0) {
          html += '<button onclick="window._leadsPrev()" class="px-3 py-1.5 rounded-lg text-xs font-medium" style="background:var(--bg-card);color:var(--text-secondary);border:1px solid var(--border-color)"><i class="fas fa-chevron-left mr-1"></i>Prev</button>';
        }
        html += '<span class="text-xs" style="color:var(--text-muted)">Page ' + currentPage + ' of ' + totalPages + '</span>';
        if (state.offset + state.limit < state.total) {
          html += '<button onclick="window._leadsNext()" class="px-3 py-1.5 rounded-lg text-xs font-medium" style="background:var(--bg-card);color:var(--text-secondary);border:1px solid var(--border-color)">Next<i class="fas fa-chevron-right ml-1"></i></button>';
        }
        html += '</div>';
      }
    }

    root.innerHTML = html;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Global handlers
  window._leadsChannel = function(ch) {
    state.activeChannel = ch;
    state.offset = 0;
    loadLeads();
  };

  window._leadsRefresh = function() {
    state.offset = 0;
    loadLeads();
  };

  window._leadsPrev = function() {
    state.offset = Math.max(0, state.offset - state.limit);
    loadLeads();
  };

  window._leadsNext = function() {
    state.offset += state.limit;
    loadLeads();
  };

  // Init
  loadLeads();
})();

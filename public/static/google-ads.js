// ============================================================
// Google Ads Dashboard — Campaign Management
// ============================================================

(function() {
  'use strict';

  var root = document.getElementById('ga-root');
  if (!root) return;

  function getToken() { return localStorage.getItem('rc_customer_token') || ''; }
  function authHeaders() { return { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' }; }

  // ============================================================
  // STATE
  // ============================================================
  var state = {
    connected: false,
    customer_id: null,
    connected_at: null,
    campaigns: [],
    loading: false,
    syncing: false,
    message: null
  };

  // ============================================================
  // API CALLS
  // ============================================================
  function apiGet(path) {
    return fetch('/api/google-ads' + path, { headers: authHeaders() }).then(function(r) { return r.json(); });
  }
  function apiPost(path, body) {
    return fetch('/api/google-ads' + path, {
      method: 'POST',
      headers: authHeaders(),
      body: body ? JSON.stringify(body) : undefined
    }).then(function(r) { return r.json(); });
  }

  // ============================================================
  // RENDER
  // ============================================================
  function render() {
    var h = '';

    // Page header
    h += '<div class="max-w-6xl mx-auto px-4 py-6">';
    h += '<div class="flex items-center justify-between mb-6">';
    h += '<div><h1 class="text-2xl font-bold text-white">Google Ads</h1>';
    h += '<p class="text-gray-400 text-sm mt-1">Manage your Google Ads campaigns</p></div>';
    h += '<a href="/customer/dashboard" class="text-gray-400 hover:text-white text-sm"><i class="fas fa-arrow-left mr-1"></i> Dashboard</a>';
    h += '</div>';

    // Connection status card
    h += '<div class="rounded-xl p-6 mb-6" style="background:#111111;border:1px solid #222">';
    if (!state.connected) {
      h += '<div class="flex items-center gap-4">';
      h += '<div class="w-14 h-14 rounded-xl flex items-center justify-center" style="background:#1a1a2e"><i class="fab fa-google text-2xl text-blue-400"></i></div>';
      h += '<div class="flex-1">';
      h += '<h2 class="text-lg font-bold text-white">Connect Google Ads</h2>';
      h += '<p class="text-gray-400 text-sm mt-1">Link your Google Ads account to view campaign performance, manage budgets, and pause/enable campaigns directly from Roof Manager.</p>';
      h += '</div>';
      h += '<button onclick="window._gaConnect()" class="px-5 py-2.5 rounded-lg font-semibold text-white text-sm" style="background:#4285f4">Connect Account</button>';
      h += '</div>';
    } else {
      h += '<div class="flex items-center justify-between">';
      h += '<div class="flex items-center gap-4">';
      h += '<div class="w-14 h-14 rounded-xl flex items-center justify-center" style="background:#0d2818"><i class="fab fa-google text-2xl text-green-400"></i></div>';
      h += '<div>';
      h += '<h2 class="text-lg font-bold text-white">Google Ads Connected</h2>';
      if (state.customer_id) h += '<p class="text-gray-400 text-sm">Customer ID: ' + state.customer_id + '</p>';
      if (state.connected_at) h += '<p class="text-gray-500 text-xs mt-0.5">Connected ' + new Date(state.connected_at).toLocaleDateString() + '</p>';
      h += '</div></div>';
      h += '<div class="flex items-center gap-3">';
      h += '<button onclick="window._gaSync()" class="px-4 py-2 rounded-lg font-semibold text-white text-sm" style="background:#4285f4"' + (state.syncing ? ' disabled' : '') + '>';
      h += state.syncing ? '<i class="fas fa-spinner fa-spin mr-1"></i> Syncing...' : '<i class="fas fa-sync mr-1"></i> Sync from Google';
      h += '</button>';
      h += '<button onclick="window._gaDisconnect()" class="px-4 py-2 rounded-lg font-semibold text-gray-400 text-sm border border-gray-700 hover:text-red-400 hover:border-red-800">Disconnect</button>';
      h += '</div></div>';
    }
    h += '</div>';

    // Message
    if (state.message) {
      h += '<div class="rounded-xl p-4 mb-6 text-sm" style="background:#111111;border:1px solid #222;color:#9ca3af"><i class="fas fa-info-circle mr-2 text-blue-400"></i>' + state.message + '</div>';
    }

    if (state.connected) {
      // Metrics summary
      var totalSpend = 0, totalClicks = 0, totalImpressions = 0, totalConversions = 0;
      for (var i = 0; i < state.campaigns.length; i++) {
        var camp = state.campaigns[i];
        totalSpend += (camp.cost_micros || 0) / 1000000;
        totalClicks += camp.clicks || 0;
        totalImpressions += camp.impressions || 0;
        totalConversions += camp.conversions || 0;
      }
      var avgCtr = totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) : '0.00';

      h += '<div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">';
      h += metricCard('Total Spend', '$' + totalSpend.toFixed(2), 'fa-dollar-sign', '#4285f4');
      h += metricCard('Clicks', totalClicks.toLocaleString(), 'fa-mouse-pointer', '#34a853');
      h += metricCard('Impressions', totalImpressions.toLocaleString(), 'fa-eye', '#fbbc05');
      h += metricCard('Conversions', totalConversions.toFixed(1), 'fa-bullseye', '#ea4335');
      h += '</div>';

      // Campaigns table
      h += '<div class="rounded-xl overflow-hidden" style="background:#111111;border:1px solid #222">';
      h += '<div class="px-6 py-4 border-b" style="border-color:#222"><h3 class="text-white font-bold">Campaigns</h3></div>';

      if (state.campaigns.length === 0) {
        h += '<div class="px-6 py-12 text-center">';
        h += '<div class="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center" style="background:#1a1a2e"><i class="fab fa-google text-2xl text-gray-600"></i></div>';
        h += '<p class="text-gray-400 mb-2">No campaigns found.</p>';
        h += '<p class="text-gray-500 text-sm">Connect your Google Ads account and sync to see your campaigns here.</p>';
        h += '</div>';
      } else {
        h += '<div class="overflow-x-auto">';
        h += '<table class="w-full text-sm">';
        h += '<thead><tr style="background:#0a0a0a">';
        h += '<th class="text-left px-4 py-3 text-gray-400 font-medium">Campaign</th>';
        h += '<th class="text-left px-4 py-3 text-gray-400 font-medium">Status</th>';
        h += '<th class="text-right px-4 py-3 text-gray-400 font-medium">Budget</th>';
        h += '<th class="text-right px-4 py-3 text-gray-400 font-medium">Impressions</th>';
        h += '<th class="text-right px-4 py-3 text-gray-400 font-medium">Clicks</th>';
        h += '<th class="text-right px-4 py-3 text-gray-400 font-medium">Conv.</th>';
        h += '<th class="text-right px-4 py-3 text-gray-400 font-medium">Spend</th>';
        h += '<th class="text-right px-4 py-3 text-gray-400 font-medium">CTR</th>';
        h += '<th class="text-center px-4 py-3 text-gray-400 font-medium">Actions</th>';
        h += '</tr></thead><tbody>';

        for (var j = 0; j < state.campaigns.length; j++) {
          var c = state.campaigns[j];
          var spend = ((c.cost_micros || 0) / 1000000).toFixed(2);
          var budget = ((c.budget_micros || 0) / 1000000).toFixed(2);
          var ctr = c.ctr ? (c.ctr * 100).toFixed(2) : '0.00';
          var statusColor = c.status === 'ENABLED' ? '#34a853' : c.status === 'PAUSED' ? '#fbbc05' : '#666';
          var statusLabel = c.status === 'ENABLED' ? 'Active' : c.status === 'PAUSED' ? 'Paused' : c.status;

          h += '<tr style="border-top:1px solid #1a1a1a">';
          h += '<td class="px-4 py-3 text-white font-medium">' + (c.name || 'Unnamed') + '</td>';
          h += '<td class="px-4 py-3"><span class="inline-flex items-center gap-1.5 text-xs font-medium" style="color:' + statusColor + '"><span class="w-1.5 h-1.5 rounded-full" style="background:' + statusColor + '"></span>' + statusLabel + '</span></td>';
          h += '<td class="px-4 py-3 text-right text-gray-300">$' + budget + '/day</td>';
          h += '<td class="px-4 py-3 text-right text-gray-300">' + (c.impressions || 0).toLocaleString() + '</td>';
          h += '<td class="px-4 py-3 text-right text-gray-300">' + (c.clicks || 0).toLocaleString() + '</td>';
          h += '<td class="px-4 py-3 text-right text-gray-300">' + (c.conversions || 0).toFixed(1) + '</td>';
          h += '<td class="px-4 py-3 text-right text-gray-300">$' + spend + '</td>';
          h += '<td class="px-4 py-3 text-right text-gray-300">' + ctr + '%</td>';
          h += '<td class="px-4 py-3 text-center">';
          if (c.status === 'ENABLED') {
            h += '<button onclick="window._gaPause(\'' + c.campaign_id + '\')" class="text-xs text-yellow-400 hover:text-yellow-300"><i class="fas fa-pause mr-1"></i>Pause</button>';
          } else if (c.status === 'PAUSED') {
            h += '<button onclick="window._gaEnable(\'' + c.campaign_id + '\')" class="text-xs text-green-400 hover:text-green-300"><i class="fas fa-play mr-1"></i>Enable</button>';
          }
          h += '</td></tr>';
        }
        h += '</tbody></table></div>';
      }
      h += '</div>';
    }

    h += '</div>'; // max-w container
    root.innerHTML = h;
  }

  function metricCard(label, value, icon, color) {
    return '<div class="rounded-xl p-4" style="background:#111111;border:1px solid #222">' +
      '<div class="flex items-center gap-3 mb-2">' +
      '<div class="w-8 h-8 rounded-lg flex items-center justify-center" style="background:' + color + '22"><i class="fas ' + icon + '" style="color:' + color + ';font-size:14px"></i></div>' +
      '<span class="text-gray-400 text-xs">' + label + '</span></div>' +
      '<div class="text-xl font-bold text-white">' + value + '</div></div>';
  }

  // ============================================================
  // ACTIONS
  // ============================================================
  window._gaConnect = function() {
    apiGet('/connect').then(function(data) {
      if (data.auth_url) {
        window.open(data.auth_url, 'google_ads_connect', 'width=600,height=700');
      } else {
        window.rmToast(data.error || 'Failed to start connection', 'info');
      }
    });
  };

  window._gaDisconnect = function() {
    if (!(await window.rmConfirm('Disconnect your Google Ads account? Your cached campaign data will remain.'))) return
    apiPost('/disconnect').then(function() {
      state.connected = false;
      state.customer_id = null;
      state.connected_at = null;
      render();
    });
  };

  window._gaSync = function() {
    state.syncing = true;
    state.message = null;
    render();
    apiPost('/sync').then(function(data) {
      state.syncing = false;
      if (data.error) {
        state.message = data.error;
      } else {
        state.message = data.message || 'Sync complete.';
        loadCampaigns();
      }
      render();
    }).catch(function() {
      state.syncing = false;
      state.message = 'Sync failed. Please try again.';
      render();
    });
  };

  window._gaPause = function(campaignId) {
    apiPost('/campaigns/' + campaignId + '/pause').then(function() {
      for (var i = 0; i < state.campaigns.length; i++) {
        if (state.campaigns[i].campaign_id === campaignId) {
          state.campaigns[i].status = 'PAUSED';
        }
      }
      render();
    });
  };

  window._gaEnable = function(campaignId) {
    apiPost('/campaigns/' + campaignId + '/enable').then(function() {
      for (var i = 0; i < state.campaigns.length; i++) {
        if (state.campaigns[i].campaign_id === campaignId) {
          state.campaigns[i].status = 'ENABLED';
        }
      }
      render();
    });
  };

  // Listen for OAuth popup messages
  window.addEventListener('message', function(event) {
    if (event.data && event.data.type === 'google_ads_connected') {
      loadStatus();
      loadCampaigns();
    }
  });

  // ============================================================
  // INIT
  // ============================================================
  function loadStatus() {
    apiGet('/status').then(function(data) {
      state.connected = data.connected;
      state.customer_id = data.customer_id;
      state.connected_at = data.connected_at;
      render();
    });
  }

  function loadCampaigns() {
    apiGet('/campaigns').then(function(data) {
      state.campaigns = data.campaigns || [];
      render();
    });
  }

  // Check URL for connected param
  if (window.location.search.indexOf('connected=true') !== -1) {
    history.replaceState(null, '', window.location.pathname);
  }

  loadStatus();
  loadCampaigns();
  render();
})();

// ============================================================
// D2D Manager — Full-featured door-to-door sales management
// Features: Turf drawing on map, pin placement, team management
// ============================================================
(function() {
  'use strict';

  var root = document.getElementById('d2d-app');
  if (!root) return;

  // --- State ---
  var map, geocoder;
  var turfs = [], pins = [], team = [], stats = {};
  var viewerRole = 'owner'; // 'owner' | 'member' — populated from /stats response
  var selectedTurfId = null;
  var activeTool = 'pointer'; // pointer | pin | turf
  var initialLoadDone = false;
  var turfPolygons = {};  // id -> google.maps.Polygon
  var pinMarkers = {};    // id -> google.maps.Marker
  var infoWindow = null;

  // Drawing state
  var isDrawing = false;
  var drawingPoints = [];
  var drawingMarkers = [];
  var drawingPolyline = null;
  var drawingPreviewPolygon = null;
  var clickTimer = null; // debounce click vs dblclick

  var COLORS = ['#0ea5e9','#ef4444','#22c55e','#f59e0b','#8b5cf6','#ec4899','#14b8a6','#f97316',
                '#6366f1','#84cc16','#06b6d4','#e11d48','#a855f7','#10b981','#f43f5e','#3b82f6'];

  var PIN_COLORS = {
    yes: '#22c55e', no: '#ef4444', no_answer: '#f59e0b', not_knocked: '#9ca3af'
  };
  var PIN_ICONS = {
    yes: 'fa-check-circle', no: 'fa-times-circle', no_answer: 'fa-question-circle', not_knocked: 'fa-circle'
  };
  var PIN_LABELS = {
    yes: 'Yes / Interested', no: 'No / Not Interested', no_answer: 'No Answer', not_knocked: 'Not Knocked'
  };

  function getToken() { return localStorage.getItem('rc_customer_token') || ''; }
  function authHeaders() { return { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' }; }

  // --- API ---
  function api(method, path, body) {
    var opts = { method: method, headers: authHeaders() };
    if (body) opts.body = JSON.stringify(body);
    return fetch('/api/d2d' + path, opts).then(function(r) {
      if (!r.ok) {
        console.error('[D2D] API error:', method, path, 'status:', r.status);
        return r.text().then(function(txt) {
          try { return JSON.parse(txt); } catch(e) { return { error: 'Server error (' + r.status + '): ' + txt.substring(0, 100) }; }
        });
      }
      return r.json();
    }).catch(function(err) {
      console.error('[D2D] Network error:', method, path, err);
      return { error: 'Network error: ' + (err.message || 'Could not reach server. Check your connection.') };
    });
  }

  // --- Toast ---
  function toast(msg, type) {
    var t = document.createElement('div');
    t.className = 'fixed bottom-4 right-4 z-[60] px-5 py-3 rounded-xl shadow-xl text-sm font-medium text-white ' +
      (type === 'error' ? 'bg-red-600' : type === 'info' ? 'bg-sky-600' : 'bg-green-600');
    t.innerHTML = '<i class="fas ' + (type === 'error' ? 'fa-exclamation-circle' : type === 'info' ? 'fa-info-circle' : 'fa-check-circle') + ' mr-2"></i>' + msg;
    document.body.appendChild(t);
    setTimeout(function() { t.remove(); }, 4000);
  }

  // ============================================================
  // RENDER LAYOUT
  // ============================================================
  function renderLayout() {
    root.innerHTML = '<div class="d2d-container">' +
      '<div class="d2d-sidebar">' +
        '<div class="d2d-stats" id="d2dStats"></div>' +
        '<div class="d2d-tabs">' +
          '<div class="d2d-tab active" data-tab="turfs"><i class="fas fa-map"></i>Turfs</div>' +
          '<div class="d2d-tab" data-tab="pins"><i class="fas fa-map-pin"></i>Pins</div>' +
          '<div class="d2d-tab" data-tab="team"><i class="fas fa-users"></i>Team</div>' +
        '</div>' +
        '<div class="d2d-panel active" id="panelTurfs"></div>' +
        '<div class="d2d-panel" id="panelPins"></div>' +
        '<div class="d2d-panel" id="panelTeam"></div>' +
      '</div>' +
      '<div class="d2d-map-area">' +
        '<div id="d2dMap" style="width:100%;height:100%"></div>' +
        '<div class="d2d-toolbar" id="d2dToolbar"></div>' +
        // Instruction banner (hidden by default)
        '<div id="d2dBanner" style="position:absolute;top:12px;left:50%;transform:translateX(-50%);z-index:10;background:#fff;padding:8px 20px;border-radius:10px;box-shadow:0 2px 12px rgba(0,0,0,.15);font-size:13px;font-weight:600;white-space:nowrap;display:none;"></div>' +
        // Finish drawing button (hidden by default)
        '<div id="d2dFinishBar" style="position:absolute;top:60px;left:50%;transform:translateX(-50%);z-index:10;display:none;gap:8px;">' +
          '<button onclick="window.d2d.finishDrawing()" class="d2d-btn d2d-btn-primary" style="box-shadow:0 2px 12px rgba(0,0,0,.2)"><i class="fas fa-check mr-1"></i>Finish Turf</button>' +
          '<button onclick="window.d2d.cancelDrawing()" class="d2d-btn d2d-btn-outline" style="background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.2)"><i class="fas fa-times mr-1"></i>Cancel</button>' +
        '</div>' +
        '<div class="d2d-legend">' +
          '<div class="d2d-legend-row"><div class="d2d-legend-dot" style="background:#22c55e"></div>Yes / Interested</div>' +
          '<div class="d2d-legend-row"><div class="d2d-legend-dot" style="background:#ef4444"></div>No / Not Interested</div>' +
          '<div class="d2d-legend-row"><div class="d2d-legend-dot" style="background:#f59e0b"></div>No Answer</div>' +
          '<div class="d2d-legend-row"><div class="d2d-legend-dot" style="background:#9ca3af"></div>Not Knocked</div>' +
        '</div>' +
      '</div>' +
    '</div>';

    // Tab switching
    document.querySelectorAll('.d2d-tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        document.querySelectorAll('.d2d-tab').forEach(function(t) { t.classList.remove('active'); });
        document.querySelectorAll('.d2d-panel').forEach(function(p) { p.classList.remove('active'); });
        tab.classList.add('active');
        document.getElementById('panel' + capitalize(tab.getAttribute('data-tab'))).classList.add('active');
      });
    });

  }

  function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function setActiveTool(tool) {
    activeTool = tool;
    document.querySelectorAll('.d2d-tool').forEach(function(t) {
      t.classList.toggle('active', t.getAttribute('data-tool') === tool);
    });

    var banner = document.getElementById('d2dBanner');
    if (banner) {
      if (tool === 'pin') {
        banner.style.display = 'block';
        banner.innerHTML = '<i class="fas fa-map-pin mr-2 text-sky-500"></i>Click on a house to place a door pin';
        banner.style.color = '#0369a1';
      } else if (tool === 'turf') {
        // Handled by startDrawTurf
      } else {
        banner.style.display = 'none';
      }
    }

    var finishBar = document.getElementById('d2dFinishBar');
    if (finishBar && tool !== 'turf') {
      finishBar.style.display = 'none';
    }

    if (map) {
      map.setOptions({ draggableCursor: (tool === 'pin' || tool === 'turf') ? 'crosshair' : '' });
    }
  }

  function showBanner(html, color) {
    var banner = document.getElementById('d2dBanner');
    if (banner) {
      banner.style.display = 'block';
      banner.innerHTML = html;
      banner.style.color = color || '#374151';
    }
  }

  function hideBanner() {
    var banner = document.getElementById('d2dBanner');
    if (banner) banner.style.display = 'none';
  }

  // ============================================================
  // STATS
  // ============================================================
  function renderStats() {
    var el = document.getElementById('d2dStats');
    if (!el) return;
    el.innerHTML =
      '<div class="d2d-stat"><div class="d2d-stat-val text-sky-600">' + (stats.total_turfs || 0) + '</div><div class="d2d-stat-label">Turfs</div></div>' +
      '<div class="d2d-stat"><div class="d2d-stat-val text-emerald-400">' + (stats.total_yes || 0) + '</div><div class="d2d-stat-label">Yes</div></div>' +
      '<div class="d2d-stat"><div class="d2d-stat-val text-red-400">' + (stats.total_no || 0) + '</div><div class="d2d-stat-label">No</div></div>' +
      '<div class="d2d-stat"><div class="d2d-stat-val text-gray-400">' + (stats.total_no_answer || 0) + '</div><div class="d2d-stat-label">No Ans</div></div>' +
      (viewerRole === 'owner'
        ? '<button onclick="window.d2d.openDashboard()" style="margin-top:8px;width:100%;padding:8px 0;background:#6366f1;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px"><i class="fas fa-chart-bar"></i>Team Dashboard</button>'
        : '');
  }

  // ============================================================
  // DASHBOARD OVERLAY
  // ============================================================
  function openDashboard() {
    // Create overlay covering the whole root
    var overlay = document.createElement('div');
    overlay.id = 'd2d-dashboard-overlay';
    overlay.style.cssText = 'position:absolute;inset:0;background:var(--bg-elevated,#0f0f0f);z-index:500;overflow-y:auto;padding:20px';
    overlay.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">' +
      '<h2 style="color:var(--text-primary,#f1f5f9);font-size:18px;font-weight:800;display:flex;align-items:center;gap:8px"><i class="fas fa-chart-bar" style="color:#6366f1"></i>Team Dashboard</h2>' +
      '<div style="display:flex;gap:8px">' +
        '<button onclick="window.d2d.refreshDashboard()" style="padding:7px 14px;background:var(--bg-card,#1a1a1a);color:var(--text-muted,#9ca3af);border:1px solid var(--border-color,#333);border-radius:8px;font-size:12px;font-weight:600;cursor:pointer"><i class="fas fa-sync-alt mr-1"></i>Refresh</button>' +
        '<button onclick="window.d2d.closeDashboard()" style="padding:7px 14px;background:var(--bg-card,#1a1a1a);color:var(--text-muted,#9ca3af);border:1px solid var(--border-color,#333);border-radius:8px;font-size:12px;font-weight:600;cursor:pointer"><i class="fas fa-arrow-left mr-1"></i>Back to Map</button>' +
      '</div>' +
    '</div>' +
    '<div id="d2d-dash-content" style="display:flex;align-items:center;justify-content:center;padding:40px;color:var(--text-muted,#9ca3af)"><i class="fas fa-spinner fa-spin mr-2"></i>Loading...</div>';

    var container = root.querySelector('.d2d-container') || root;
    container.style.position = 'relative';
    container.appendChild(overlay);

    loadDashboardData();
  }

  function closeDashboard() {
    var el = document.getElementById('d2d-dashboard-overlay');
    if (el) el.remove();
  }

  function refreshDashboard() {
    var el = document.getElementById('d2d-dash-content');
    if (el) el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;padding:40px;color:var(--text-muted,#9ca3af)"><i class="fas fa-spinner fa-spin mr-2"></i>Loading...</div>';
    loadDashboardData();
  }

  function loadDashboardData() {
    Promise.all([
      api('GET', '/stats'),
      api('GET', '/team/activity'),
      api('GET', '/turfs'),
      api('GET', '/pins?sort=recent&limit=25')
    ]).then(function(results) {
      var s = results[0].stats || {};
      var activity = results[1].activity || [];
      var turfList = results[2].turfs || [];
      var recentPins = results[3].pins || [];
      renderDashboardContent(s, activity, turfList, recentPins);
    }).catch(function(err) {
      var el = document.getElementById('d2d-dash-content');
      if (el) el.innerHTML = '<p style="color:#ef4444;text-align:center">Failed to load dashboard data.</p>';
    });
  }

  function renderDashboardContent(s, activity, turfList, recentPins) {
    var el = document.getElementById('d2d-dash-content');
    if (!el) return;

    var knocked = (s.total_yes||0) + (s.total_no||0) + (s.total_no_answer||0);
    var convRate = knocked > 0 ? ((s.total_yes||0) / knocked * 100).toFixed(1) : '0.0';

    // KPI bar
    var kpi = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:24px">' +
      kpiCard('Doors Knocked', knocked, '#0ea5e9', 'fa-hand-fist') +
      kpiCard('Interested', s.total_yes||0, '#22c55e', 'fa-thumbs-up') +
      kpiCard('Conversion Rate', convRate + '%', '#a78bfa', 'fa-percent') +
      kpiCard('Team Members', s.total_members||0, '#f59e0b', 'fa-users') +
    '</div>';

    // Team leaderboard
    var leaderboard = '<div style="background:var(--bg-card,#1a1a1a);border:1px solid var(--border-color,#333);border-radius:12px;overflow:hidden;margin-bottom:20px">' +
      '<div style="padding:14px 16px;border-bottom:1px solid var(--border-color,#333)">' +
        '<h3 style="color:var(--text-primary,#f1f5f9);font-size:14px;font-weight:700;margin:0"><i class="fas fa-trophy" style="color:#f59e0b;margin-right:8px"></i>Team Leaderboard</h3>' +
      '</div>';

    if (activity.length === 0) {
      leaderboard += '<div style="padding:24px;text-align:center;color:var(--text-muted,#9ca3af);font-size:13px">No activity yet — team members need to start knocking doors.</div>';
    } else {
      leaderboard += '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">' +
        '<thead><tr style="background:var(--bg-elevated,#111)">' +
          thD('#') + thD('Name') + thD('Doors') + thD('Yes') + thD('No') + thD('N/A') + thD('Conv%') + thD('Last Active') +
        '</tr></thead><tbody>';
      for (var i = 0; i < activity.length; i++) {
        var m = activity[i];
        var mKnocked = (m.yes_count||0) + (m.no_count||0) + (m.no_answer_count||0);
        var mConv = mKnocked > 0 ? ((m.yes_count||0) / mKnocked * 100).toFixed(0) : '0';
        var convColor = parseInt(mConv) >= 30 ? '#22c55e' : parseInt(mConv) >= 15 ? '#f59e0b' : '#9ca3af';
        var lastActive = m.last_activity ? timeAgo(m.last_activity) : '—';
        var rowBg = i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)';
        leaderboard += '<tr style="border-top:1px solid var(--border-color,#333);background:' + rowBg + '">' +
          tdD('<span style="color:#f59e0b;font-weight:800">' + (i+1) + '</span>') +
          tdD('<div style="display:flex;align-items:center;gap:8px"><div style="width:8px;height:8px;border-radius:50%;background:' + (m.color||'#6366f1') + ';flex-shrink:0"></div><span style="color:var(--text-primary,#f1f5f9);font-weight:600">' + escH(m.name||'') + '</span></div>') +
          tdD('<span style="font-weight:700;color:var(--text-primary,#f1f5f9)">' + (m.total_knocks||0) + '</span>') +
          tdD('<span style="color:#22c55e;font-weight:600">' + (m.yes_count||0) + '</span>') +
          tdD('<span style="color:#ef4444">' + (m.no_count||0) + '</span>') +
          tdD('<span style="color:#9ca3af">' + (m.no_answer_count||0) + '</span>') +
          tdD('<span style="font-weight:700;color:' + convColor + '">' + mConv + '%</span>') +
          tdD('<span style="color:var(--text-muted,#9ca3af);font-size:11px">' + lastActive + '</span>') +
        '</tr>';
      }
      leaderboard += '</tbody></table></div>';
    }
    leaderboard += '</div>';

    // Territory progress
    var territories = '<div style="background:var(--bg-card,#1a1a1a);border:1px solid var(--border-color,#333);border-radius:12px;overflow:hidden;margin-bottom:20px">' +
      '<div style="padding:14px 16px;border-bottom:1px solid var(--border-color,#333)">' +
        '<h3 style="color:var(--text-primary,#f1f5f9);font-size:14px;font-weight:700;margin:0"><i class="fas fa-map-marked-alt" style="color:#0ea5e9;margin-right:8px"></i>Territory Progress</h3>' +
      '</div>';

    if (turfList.length === 0) {
      territories += '<div style="padding:24px;text-align:center;color:var(--text-muted,#9ca3af);font-size:13px">No territories created yet.</div>';
    } else {
      territories += '<div style="padding:8px 0">';
      for (var j = 0; j < turfList.length; j++) {
        var tf = turfList[j];
        var total = (tf.yes_count||0) + (tf.no_count||0) + (tf.no_answer_count||0) + (tf.not_knocked_count||0);
        var knocked2 = (tf.yes_count||0) + (tf.no_count||0) + (tf.no_answer_count||0);
        var pct = total > 0 ? Math.round((knocked2 / total) * 100) : 0;
        var barColor = pct >= 75 ? '#22c55e' : pct >= 25 ? '#f59e0b' : '#6366f1';
        territories += '<div style="padding:12px 16px;border-bottom:1px solid var(--border-color,#333)">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
            '<div>' +
              '<span style="color:var(--text-primary,#f1f5f9);font-weight:600;font-size:13px">' + escH(tf.name||'') + '</span>' +
              (tf.assigned_name ? '<span style="color:var(--text-muted,#9ca3af);font-size:11px;margin-left:8px">→ ' + escH(tf.assigned_name) + '</span>' : '<span style="color:var(--text-muted,#9ca3af);font-size:11px;margin-left:8px">Unassigned</span>') +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:12px;font-size:12px">' +
              '<span style="color:var(--text-muted,#9ca3af)">' + knocked2 + '/' + total + ' knocked</span>' +
              '<span style="color:#22c55e;font-weight:600">' + (tf.yes_count||0) + ' ✓</span>' +
              '<span style="font-weight:700;color:' + barColor + '">' + pct + '%</span>' +
            '</div>' +
          '</div>' +
          '<div style="height:6px;background:rgba(255,255,255,0.1);border-radius:999px;overflow:hidden">' +
            '<div style="height:100%;width:' + pct + '%;background:' + barColor + ';border-radius:999px;transition:width 0.6s ease"></div>' +
          '</div>' +
        '</div>';
      }
      territories += '</div>';
    }
    territories += '</div>';

    // Recent activity
    var statusConfig = {
      yes: { label: 'Interested', color: '#22c55e', icon: 'fa-thumbs-up' },
      no: { label: 'Not Interested', color: '#ef4444', icon: 'fa-thumbs-down' },
      no_answer: { label: 'No Answer', color: '#f59e0b', icon: 'fa-question-circle' },
      not_knocked: { label: 'Not Knocked', color: '#6b7280', icon: 'fa-clock' }
    };
    var activity2 = '<div style="background:var(--bg-card,#1a1a1a);border:1px solid var(--border-color,#333);border-radius:12px;overflow:hidden">' +
      '<div style="padding:14px 16px;border-bottom:1px solid var(--border-color,#333)">' +
        '<h3 style="color:var(--text-primary,#f1f5f9);font-size:14px;font-weight:700;margin:0"><i class="fas fa-bolt" style="color:#f59e0b;margin-right:8px"></i>Recent Activity</h3>' +
      '</div>';

    var knocked3 = recentPins.filter(function(p) { return p.status && p.status !== 'not_knocked' && p.knocked_at; });
    if (knocked3.length === 0) {
      activity2 += '<div style="padding:24px;text-align:center;color:var(--text-muted,#9ca3af);font-size:13px">No door knocks recorded yet.</div>';
    } else {
      activity2 += '<div style="max-height:320px;overflow-y:auto">';
      for (var k = 0; k < knocked3.length; k++) {
        var p = knocked3[k];
        var sc = statusConfig[p.status] || statusConfig.not_knocked;
        activity2 += '<div style="display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid rgba(255,255,255,0.05)">' +
          '<div style="width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,0.07);display:flex;align-items:center;justify-content:center;flex-shrink:0">' +
            '<i class="fas ' + sc.icon + '" style="color:' + sc.color + ';font-size:13px"></i>' +
          '</div>' +
          '<div style="flex:1;min-width:0">' +
            '<div style="display:flex;justify-content:space-between;align-items:center">' +
              '<span style="color:var(--text-primary,#f1f5f9);font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px">' + escH(p.address || ('Pin #' + p.id)) + '</span>' +
              '<span style="color:var(--text-muted,#9ca3af);font-size:11px;flex-shrink:0;margin-left:8px">' + (p.knocked_at ? timeAgo(p.knocked_at) : '') + '</span>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:6px;margin-top:2px">' +
              '<span style="color:' + sc.color + ';font-size:11px;font-weight:600">' + sc.label + '</span>' +
              (p.knocked_by_name ? '<span style="color:var(--text-muted,#9ca3af);font-size:11px">· ' + escH(p.knocked_by_name) + '</span>' : '') +
            '</div>' +
          '</div>' +
        '</div>';
      }
      activity2 += '</div>';
    }
    activity2 += '</div>';

    el.innerHTML = kpi + leaderboard + territories + activity2;
  }

  // Dashboard render helpers
  function kpiCard(label, value, color, icon) {
    return '<div style="background:var(--bg-card,#1a1a1a);border:1px solid var(--border-color,#333);border-radius:12px;padding:16px;text-align:center">' +
      '<div style="width:40px;height:40px;border-radius:10px;background:' + color + '22;display:flex;align-items:center;justify-content:center;margin:0 auto 10px">' +
        '<i class="fas ' + icon + '" style="color:' + color + ';font-size:16px"></i>' +
      '</div>' +
      '<div style="font-size:26px;font-weight:900;color:' + color + '">' + value + '</div>' +
      '<div style="font-size:11px;color:var(--text-muted,#9ca3af);margin-top:4px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px">' + label + '</div>' +
    '</div>';
  }
  function thD(label) {
    return '<th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:700;color:var(--text-muted,#9ca3af);text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap">' + label + '</th>';
  }
  function tdD(content) {
    return '<td style="padding:10px 12px;white-space:nowrap">' + content + '</td>';
  }
  function timeAgo(dateStr) {
    if (!dateStr) return '—';
    var diff = Date.now() - new Date(dateStr).getTime();
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    var days = Math.floor(hrs / 24);
    if (days === 1) return 'Yesterday';
    if (days < 7) return days + 'd ago';
    return fmtDate(dateStr);
  }

  // ============================================================
  // TURFS PANEL
  // ============================================================
  function renderTurfsPanel() {
    var panel = document.getElementById('panelTurfs');
    if (!panel) return;

    var html = '<div class="flex items-center justify-between mb-3">' +
      '<h3 class="font-bold text-gray-100 text-sm">Turfs <span class="text-gray-400 font-normal">(' + turfs.length + ')</span></h3>' +
      (viewerRole === 'owner' ? '<button class="d2d-btn d2d-btn-primary d2d-btn-sm" onclick="window.d2d.startDrawTurf()"><i class="fas fa-plus mr-1"></i>New Turf</button>' : '') +
    '</div>';

    if (turfs.length === 0) {
      html += '<div class="d2d-empty"><i class="fas fa-map-marked-alt"></i><p>No turfs yet.' + (viewerRole === 'owner' ? '<br>Click "New Turf" or use the polygon tool to draw one on the map.' : '') + '</p></div>';
    } else {
      for (var i = 0; i < turfs.length; i++) {
        var t = turfs[i];
        var total = (t.yes_count||0) + (t.no_count||0) + (t.no_answer_count||0) + (t.not_knocked_count||0);
        var knocked = (t.yes_count||0) + (t.no_count||0) + (t.no_answer_count||0);
        var pct = total > 0 ? Math.round((knocked / total) * 100) : 0;
        html += '<div class="d2d-card' + (selectedTurfId == t.id ? ' selected' : '') + '" onclick="window.d2d.selectTurf(' + t.id + ')">' +
          '<div class="flex items-start justify-between">' +
            '<div class="flex items-center gap-2">' +
              '<div style="width:14px;height:14px;border-radius:4px;background:' + (t.color || '#0ea5e9') + '"></div>' +
              '<div><div class="font-semibold text-gray-100 text-sm">' + escH(t.name) + '</div>' +
                (t.assigned_name ? '<div class="text-xs text-gray-500"><i class="fas fa-user mr-1"></i>' + escH(t.assigned_name) + '</div>' : '<div class="text-xs text-gray-400">Unassigned</div>') +
              '</div>' +
            '</div>' +
            (viewerRole === 'owner' ? '<div class="flex gap-1">' +
              '<button class="text-gray-400 hover:text-sky-500 text-xs" onclick="event.stopPropagation();window.d2d.editTurf(' + t.id + ')" title="Edit"><i class="fas fa-pen"></i></button>' +
              '<button class="text-gray-400 hover:text-red-500 text-xs" onclick="event.stopPropagation();window.d2d.deleteTurf(' + t.id + ')" title="Delete"><i class="fas fa-trash"></i></button>' +
            '</div>' : '<div></div>') +
          '</div>' +
          '<div class="mt-2 grid grid-cols-4 gap-1 text-center text-[10px]">' +
            '<div class="pin-yes rounded px-1 py-0.5"><b>' + (t.yes_count||0) + '</b> Yes</div>' +
            '<div class="pin-no rounded px-1 py-0.5"><b>' + (t.no_count||0) + '</b> No</div>' +
            '<div class="pin-no-answer rounded px-1 py-0.5"><b>' + (t.no_answer_count||0) + '</b> N/A</div>' +
            '<div class="pin-not-knocked rounded px-1 py-0.5"><b>' + (t.not_knocked_count||0) + '</b> TBD</div>' +
          '</div>' +
          '<div class="mt-2">' +
            '<div class="flex justify-between text-[10px] mb-1"><span class="text-gray-500">Progress</span><span class="font-semibold">' + pct + '%</span></div>' +
            '<div class="w-full bg-gray-200 rounded-full h-1.5"><div class="h-1.5 rounded-full" style="width:' + pct + '%;background:' + (t.color||'#0ea5e9') + '"></div></div>' +
          '</div>' +
        '</div>';
      }
    }

    panel.innerHTML = html;
  }

  // ============================================================
  // PINS PANEL
  // ============================================================
  function renderPinsPanel() {
    var panel = document.getElementById('panelPins');
    if (!panel) return;

    var html = '<div class="flex items-center justify-between mb-3">' +
      '<h3 class="font-bold text-gray-100 text-sm">Door Pins <span class="text-gray-400 font-normal">(' + pins.length + ')</span></h3>' +
      '<select id="pinFilter" class="d2d-select" style="width:auto;font-size:11px;padding:4px 8px" onchange="window.d2d.filterPins(this.value)">' +
        '<option value="">All Statuses</option>' +
        '<option value="yes">Yes</option>' +
        '<option value="no">No</option>' +
        '<option value="no_answer">No Answer</option>' +
        '<option value="not_knocked">Not Knocked</option>' +
      '</select>' +
    '</div>';

    if (pins.length === 0) {
      html += '<div class="d2d-empty"><i class="fas fa-map-pin"></i><p>No pins yet.<br>Select the pin tool and click on houses on the map.</p></div>';
    } else {
      var byTurf = {};
      var noTurf = [];
      for (var i = 0; i < pins.length; i++) {
        var p = pins[i];
        if (p.turf_id) {
          if (!byTurf[p.turf_id]) byTurf[p.turf_id] = { name: p.turf_name || 'Turf #' + p.turf_id, pins: [] };
          byTurf[p.turf_id].pins.push(p);
        } else {
          noTurf.push(p);
        }
      }

      for (var tid in byTurf) {
        html += '<div class="text-xs font-semibold text-gray-500 mb-1 mt-2"><i class="fas fa-map mr-1"></i>' + escH(byTurf[tid].name) + ' (' + byTurf[tid].pins.length + ')</div>';
        for (var j = 0; j < byTurf[tid].pins.length; j++) html += renderPinCard(byTurf[tid].pins[j]);
      }
      if (noTurf.length > 0) {
        html += '<div class="text-xs font-semibold text-gray-500 mb-1 mt-2">Unassigned (' + noTurf.length + ')</div>';
        for (var k = 0; k < noTurf.length; k++) html += renderPinCard(noTurf[k]);
      }
    }

    panel.innerHTML = html;
  }

  function renderPinCard(p) {
    var statusClass = 'pin-' + (p.status || 'not_knocked').replace(/_/g, '-');
    return '<div class="d2d-card" onclick="window.d2d.focusPin(' + p.id + ')" style="padding:8px 10px">' +
      '<div class="flex items-center justify-between">' +
        '<div class="flex items-center gap-2">' +
          '<i class="fas ' + (PIN_ICONS[p.status] || 'fa-circle') + '" style="color:' + (PIN_COLORS[p.status] || '#9ca3af') + '"></i>' +
          '<div>' +
            '<div class="text-xs font-semibold text-gray-100">' + escH(p.address || 'Pin #' + p.id) + '</div>' +
            '<div class="text-[10px] text-gray-400">' + (p.knocked_by_name ? 'by ' + escH(p.knocked_by_name) : '') +
              (p.knocked_at ? ' · ' + fmtDate(p.knocked_at) : '') + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="flex items-center gap-1">' +
          '<span class="' + statusClass + ' text-[10px] px-2 py-0.5 rounded-full font-semibold">' + (PIN_LABELS[p.status] || p.status) + '</span>' +
          '<button class="text-gray-400 hover:text-red-500 text-[10px] ml-1" onclick="event.stopPropagation();window.d2d.deletePin(' + p.id + ')"><i class="fas fa-trash"></i></button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  // ============================================================
  // TEAM PANEL
  // ============================================================
  function renderTeamPanel() {
    var panel = document.getElementById('panelTeam');
    if (!panel) return;

    var html = '<div class="flex items-center justify-between mb-3">' +
      '<h3 class="font-bold text-gray-100 text-sm">Team Members <span class="text-gray-400 font-normal">(' + team.length + ')</span></h3>' +
      (viewerRole === 'owner' ? '<button class="d2d-btn d2d-btn-primary d2d-btn-sm" onclick="window.d2d.addMember()"><i class="fas fa-plus mr-1"></i>Add Member</button>' : '') +
    '</div>';

    if (team.length === 0) {
      html += '<div class="d2d-empty"><i class="fas fa-users"></i><p>No team members yet.' + (viewerRole === 'owner' ? '<br>Add your door knockers to assign turfs &amp; track activity.' : '') + '</p></div>';
    } else {
      for (var i = 0; i < team.length; i++) {
        var m = team[i];
        var totalKnocks = (m.knock_count || 0);
        var yesCount = (m.yes_count || 0);
        var convRate = totalKnocks > 0 ? Math.round((yesCount / totalKnocks) * 100) : 0;
        var lastActive = m.last_activity ? fmtDate(m.last_activity) : 'No activity';
        var perms = null;
        try { perms = m.permissions ? JSON.parse(m.permissions) : null; } catch(e) {}
        var permBadges = '';
        if (perms) {
          if (perms.d2d === 'assigned') permBadges += '<span class="px-1.5 py-0.5 bg-blue-500/15/10 text-gray-400 rounded text-[9px] font-semibold">Assigned Turfs Only</span> ';
          if (perms.reports === false) permBadges += '<span class="px-1.5 py-0.5 bg-red-500/10 text-red-400 rounded text-[9px] font-semibold">No Reports</span> ';
          if (perms.crm === false) permBadges += '<span class="px-1.5 py-0.5 bg-red-500/10 text-red-400 rounded text-[9px] font-semibold">No CRM</span> ';
        }

        html += '<div class="d2d-card">' +
          // Header row
          '<div class="flex items-center justify-between">' +
            '<div class="flex items-center gap-2">' +
              '<div style="width:34px;height:34px;border-radius:50%;background:' + (m.color || '#3B82F6') + ';display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:13px;flex-shrink:0">' + (m.name || '?').charAt(0).toUpperCase() + '</div>' +
              '<div>' +
                '<div class="font-semibold text-gray-100 text-sm">' + escH(m.name) + '</div>' +
                '<div class="text-[10px] text-gray-400 capitalize"><i class="fas ' + (m.role === 'manager' ? 'fa-user-tie' : 'fa-walking') + ' mr-1"></i>' + (m.role || 'salesperson') +
                  (m.email ? ' · ' + escH(m.email) : '') + '</div>' +
              '</div>' +
            '</div>' +
            (viewerRole === 'owner' ? '<div class="flex gap-1">' +
              '<button class="text-gray-400 hover:text-sky-500 text-xs p-1" onclick="window.d2d.editMember(' + m.id + ')" title="Edit Settings"><i class="fas fa-cog"></i></button>' +
              '<button class="text-gray-400 hover:text-red-500 text-xs p-1" onclick="window.d2d.deleteMember(' + m.id + ')" title="Remove"><i class="fas fa-trash"></i></button>' +
            '</div>' : '<div></div>') +
          '</div>' +
          // Stats grid
          '<div class="mt-2 grid grid-cols-4 gap-1 text-center text-[10px]">' +
            '<div class="bg-sky-50 text-sky-700 rounded px-1 py-1"><div class="font-bold text-sm">' + (m.turf_count||0) + '</div><div>Turfs</div></div>' +
            '<div class="bg-[#0A0A0A] text-gray-300 rounded px-1 py-1"><div class="font-bold text-sm">' + totalKnocks + '</div><div>Knocks</div></div>' +
            '<div class="bg-emerald-500/10 text-green-700 rounded px-1 py-1"><div class="font-bold text-sm">' + yesCount + '</div><div>Yes</div></div>' +
            '<div class="bg-blue-500/15 text-blue-400 rounded px-1 py-1"><div class="font-bold text-sm">' + convRate + '%</div><div>Rate</div></div>' +
          '</div>' +
          // Last activity + permissions badges
          '<div class="mt-2 flex items-center justify-between">' +
            '<div class="text-[10px] text-gray-400"><i class="fas fa-clock mr-1"></i>' + lastActive + '</div>' +
            (permBadges ? '<div class="flex gap-1 flex-wrap">' + permBadges + '</div>' : '') +
          '</div>' +
          // View activity button
          (totalKnocks > 0 ? '<button class="mt-2 w-full d2d-btn d2d-btn-outline d2d-btn-sm" onclick="window.d2d.filterPinsByMember(' + m.id + ',\'' + escAttr(m.name) + '\')"><i class="fas fa-map-pin mr-1"></i>View ' + totalKnocks + ' Pin' + (totalKnocks !== 1 ? 's' : '') + '</button>' : '') +
        '</div>';
      }
    }

    panel.innerHTML = html;
  }

  // ============================================================
  // MAP INITIALIZATION — Single click handler architecture
  // ============================================================
  var _d2dMapRetries = 0;
  function initMap() {
    if (typeof google === 'undefined' || !google.maps) {
      _d2dMapRetries++;
      if (_d2dMapRetries < 60) {
        setTimeout(initMap, 500);
      } else {
        console.error('[D2D] Google Maps API failed to load');
      }
      return;
    }

    var defaultCenter = { lat: 51.0447, lng: -114.0719 }; // Calgary, AB
    map = new google.maps.Map(document.getElementById('d2dMap'), {
      center: defaultCenter,
      zoom: 13,
      mapTypeId: 'roadmap',
      mapTypeControl: true,
      mapTypeControlOptions: { position: google.maps.ControlPosition.TOP_RIGHT },
      streetViewControl: false,
      fullscreenControl: true,
      fullscreenControlOptions: { position: google.maps.ControlPosition.RIGHT_TOP },
      disableDoubleClickZoom: false, // will be toggled during drawing
      styles: [
        { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
        { featureType: 'transit', stylers: [{ visibility: 'off' }] }
      ]
    });

    geocoder = new google.maps.Geocoder();
    infoWindow = new google.maps.InfoWindow();

    // ---- SINGLE unified click handler for the entire map ----
    // Uses a 250ms debounce to distinguish single-click from double-click
    map.addListener('click', function(e) {
      console.log('[D2D] Map click — tool:', activeTool, 'isDrawing:', isDrawing, 'latLng:', e.latLng.lat(), e.latLng.lng());

      // If we're drawing a turf, debounce to avoid double-click adding an extra point
      if (isDrawing) {
        if (clickTimer) clearTimeout(clickTimer);
        clickTimer = setTimeout(function() {
          addDrawingPoint(e.latLng);
        }, 250);
        return;
      }

      // Pin tool — place pin
      if (activeTool === 'pin') {
        placePinAtLocation(e.latLng);
      }
    });

    map.addListener('dblclick', function(e) {
      if (isDrawing) {
        // Cancel the pending single-click
        if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
        finishDrawing();
      }
    });

    // Load data
    loadAll();
  }

  // ============================================================
  // DATA LOADING
  // ============================================================
  function loadAll() {
    Promise.all([
      api('GET', '/turfs'),
      api('GET', '/pins'),
      api('GET', '/team'),
      api('GET', '/stats')
    ]).then(function(results) {
      turfs = (results[0].turfs || []);
      pins = (results[1].pins || []);
      team = (results[2].members || []);
      stats = results[3].stats || {};
      viewerRole = results[3].viewer_role || 'owner';
      renderAll();
      renderMapObjects();
    }).catch(function(err) {
      console.error('[D2D] Load error:', err);
    });
  }

  function renderToolbar() {
    var tb = document.getElementById('d2dToolbar');
    if (!tb) return;
    tb.innerHTML =
      '<div class="d2d-tool active" data-tool="pointer" title="Select / Navigate"><i class="fas fa-mouse-pointer"></i></div>' +
      (viewerRole === 'owner' ? '<div class="d2d-tool" data-tool="turf" title="Draw Turf Zone"><i class="fas fa-draw-polygon"></i></div>' : '') +
      '<div class="d2d-tool" data-tool="pin" title="Place Door Pin"><i class="fas fa-map-pin"></i></div>';
    // Re-attach tool click handlers
    tb.querySelectorAll('.d2d-tool').forEach(function(tool) {
      tool.addEventListener('click', function() {
        var t = tool.getAttribute('data-tool');
        if (t === 'turf') {
          startDrawTurf();
        } else {
          if (isDrawing) cancelDrawing();
          setActiveTool(t);
        }
      });
    });
  }

  function renderAll() {
    renderToolbar();
    renderStats();
    renderTurfsPanel();
    renderPinsPanel();
    renderTeamPanel();
  }

  // ============================================================
  // MAP RENDERING
  // ============================================================
  function renderMapObjects() {
    // Clear old
    for (var pid in pinMarkers) { pinMarkers[pid].setMap(null); }
    pinMarkers = {};
    for (var tid in turfPolygons) { turfPolygons[tid].setMap(null); }
    turfPolygons = {};

    for (var i = 0; i < turfs.length; i++) drawTurfOnMap(turfs[i]);
    for (var j = 0; j < pins.length; j++) drawPinOnMap(pins[j]);

    // Auto-zoom to fit only on initial load — not after placing individual pins
    if (!initialLoadDone && (turfs.length > 0 || pins.length > 0)) {
      var bounds = new google.maps.LatLngBounds();
      for (var ti = 0; ti < turfs.length; ti++) {
        try {
          var poly = JSON.parse(turfs[ti].polygon_json || '[]');
          for (var pi = 0; pi < poly.length; pi++) bounds.extend(new google.maps.LatLng(poly[pi].lat, poly[pi].lng));
        } catch(e) {}
      }
      for (var pk = 0; pk < pins.length; pk++) bounds.extend(new google.maps.LatLng(pins[pk].lat, pins[pk].lng));
      map.fitBounds(bounds, 60);
    }
    initialLoadDone = true;
  }

  function drawTurfOnMap(turf) {
    try {
      var coords = JSON.parse(turf.polygon_json || '[]');
      if (coords.length < 3) return;

      var color = turf.color || '#0ea5e9';
      var polygon = new google.maps.Polygon({
        paths: coords,
        strokeColor: color,
        strokeOpacity: 0.9,
        strokeWeight: 2,
        fillColor: color,
        fillOpacity: 0.15,
        map: map,
        zIndex: 1
      });

      polygon.addListener('click', function(e) {
        // When in pin mode, forward the click to pin placement instead of turf info
        if (activeTool === 'pin') {
          placePinAtLocation(e.latLng);
          return;
        }
        if (isDrawing) {
          // During drawing, add point (use debounce like the map handler)
          if (clickTimer) clearTimeout(clickTimer);
          clickTimer = setTimeout(function() {
            addDrawingPoint(e.latLng);
          }, 250);
          return;
        }
        selectTurf(turf.id);
        showTurfInfo(turf, e.latLng);
      });

      // Also forward dblclick from polygon during drawing
      polygon.addListener('dblclick', function(e) {
        if (isDrawing) {
          if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
          finishDrawing();
        }
      });

      turfPolygons[turf.id] = polygon;
    } catch(e) {
      console.error('[D2D] Invalid turf polygon:', e);
    }
  }

  function drawPinOnMap(pin) {
    var color = PIN_COLORS[pin.status] || '#9ca3af';

    var marker = new google.maps.Marker({
      map: map,
      position: { lat: pin.lat, lng: pin.lng },
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 10,
        fillColor: color,
        fillOpacity: 1,
        strokeColor: '#fff',
        strokeWeight: 3
      },
      zIndex: 10,
      title: pin.address || 'Pin #' + pin.id
    });

    marker.addListener('click', function(e) {
      if (isDrawing) return;
      // In pin mode, don't open info window for existing pins — place a new pin nearby
      if (activeTool === 'pin') return;
      showPinInfo(pin, marker);
    });

    pinMarkers[pin.id] = marker;
  }

  // ============================================================
  // INFO WINDOWS
  // ============================================================
  function showTurfInfo(turf, latLng) {
    var total = (turf.yes_count||0) + (turf.no_count||0) + (turf.no_answer_count||0) + (turf.not_knocked_count||0);
    var html = '<div class="d2d-info">' +
      '<h4><i class="fas fa-map mr-1" style="color:' + (turf.color||'#0ea5e9') + '"></i>' + escH(turf.name) + '</h4>' +
      '<div class="d2d-info-row"><span class="d2d-info-label">Assigned to</span><span class="d2d-info-value">' + escH(turf.assigned_name || 'Unassigned') + '</span></div>' +
      '<div class="d2d-info-row"><span class="d2d-info-label">Total pins</span><span class="d2d-info-value">' + total + '</span></div>' +
      '<div class="d2d-info-row"><span class="d2d-info-label">Yes</span><span class="d2d-info-value" style="color:#22c55e">' + (turf.yes_count||0) + '</span></div>' +
      '<div class="d2d-info-row"><span class="d2d-info-label">No</span><span class="d2d-info-value" style="color:#ef4444">' + (turf.no_count||0) + '</span></div>' +
      '<div class="d2d-info-row"><span class="d2d-info-label">No Answer</span><span class="d2d-info-value" style="color:#f59e0b">' + (turf.no_answer_count||0) + '</span></div>' +
      (viewerRole === 'owner' ? '<div style="margin-top:8px;display:flex;gap:4px">' +
        '<button onclick="window.d2d.editTurf(' + turf.id + ')" class="d2d-btn d2d-btn-outline d2d-btn-sm"><i class="fas fa-pen mr-1"></i>Edit</button>' +
        '<button onclick="window.d2d.deleteTurf(' + turf.id + ')" class="d2d-btn d2d-btn-danger d2d-btn-sm"><i class="fas fa-trash mr-1"></i>Delete</button>' +
      '</div>' : '') +
    '</div>';
    infoWindow.setContent(html);
    infoWindow.setPosition(latLng);
    infoWindow.open(map);
  }

  function showPinInfo(pin, marker) {
    var memberOpts = '<option value="">Not assigned</option>';
    for (var i = 0; i < team.length; i++) {
      memberOpts += '<option value="' + team[i].id + '"' + (pin.knocked_by == team[i].id ? ' selected' : '') + '>' + escH(team[i].name) + '</option>';
    }

    var html = '<div class="d2d-info">' +
      '<h4><i class="fas fa-map-pin mr-1" style="color:' + (PIN_COLORS[pin.status]||'#9ca3af') + '"></i>' + escH(pin.address || 'Pin #' + pin.id) + '</h4>' +
      (pin.turf_name ? '<div class="text-xs text-gray-500 mb-2"><i class="fas fa-map mr-1"></i>' + escH(pin.turf_name) + '</div>' : '') +
      '<div class="d2d-info-row"><span class="d2d-info-label">Status</span><span class="d2d-info-value">' + (PIN_LABELS[pin.status]||pin.status) + '</span></div>' +
      (pin.knocked_by_name ? '<div class="d2d-info-row"><span class="d2d-info-label">Knocked by</span><span class="d2d-info-value">' + escH(pin.knocked_by_name) + '</span></div>' : '') +
      (pin.knocked_at ? '<div class="d2d-info-row"><span class="d2d-info-label">Date</span><span class="d2d-info-value">' + fmtDate(pin.knocked_at) + '</span></div>' : '') +
      (pin.notes ? '<div class="d2d-info-row"><span class="d2d-info-label">Notes</span><span class="d2d-info-value">' + escH(pin.notes) + '</span></div>' : '') +
      '<div style="margin-top:10px">' +
        '<div class="text-xs text-gray-500 mb-1">Update Status:</div>' +
        '<div class="d2d-pin-actions">' +
          '<button onclick="window.d2d.updatePinStatus(' + pin.id + ',\'yes\')" class="d2d-pin-btn" style="background:#dcfce7;border-color:#86efac;color:#166534">Yes</button>' +
          '<button onclick="window.d2d.updatePinStatus(' + pin.id + ',\'no\')" class="d2d-pin-btn" style="background:#fee2e2;border-color:#fca5a5;color:#991b1b">No</button>' +
          '<button onclick="window.d2d.updatePinStatus(' + pin.id + ',\'no_answer\')" class="d2d-pin-btn" style="background:#fef3c7;border-color:#fcd34d;color:#92400e">N/A</button>' +
        '</div>' +
      '</div>' +
      '<div style="margin-top:8px">' +
        '<label class="text-xs text-gray-500">Assign to:</label>' +
        '<select onchange="window.d2d.assignPin(' + pin.id + ',this.value)" style="width:100%;font-size:11px;padding:4px 8px;border:1px solid #d1d5db;border-radius:6px;margin-top:2px">' + memberOpts + '</select>' +
      '</div>' +
      '<div style="margin-top:8px;display:flex;gap:4px">' +
        '<button onclick="window.d2d.addPinNotes(' + pin.id + ')" class="d2d-btn d2d-btn-outline d2d-btn-sm"><i class="fas fa-sticky-note mr-1"></i>Notes</button>' +
        '<button onclick="window.d2d.deletePin(' + pin.id + ')" class="d2d-btn d2d-btn-danger d2d-btn-sm"><i class="fas fa-trash mr-1"></i>Delete</button>' +
      '</div>' +
    '</div>';

    infoWindow.setContent(html);
    infoWindow.setPosition(marker.getPosition());
    infoWindow.open(map);
  }

  // ============================================================
  // TURF DRAWING — Click-by-click polygon with finish button
  // ============================================================
  function startDrawTurf() {
    // If already drawing, do nothing
    if (isDrawing) return;

    // Guard: map must be initialized
    if (!map) {
      toast('Map is still loading. Please wait a moment and try again.', 'error');
      console.error('[D2D] startDrawTurf called but map is null');
      return;
    }

    console.log('[D2D] Starting turf drawing mode');

    isDrawing = true;
    activeTool = 'turf';
    drawingPoints = [];
    clearDrawingUI();

    // Update toolbar
    document.querySelectorAll('.d2d-tool').forEach(function(t) {
      t.classList.toggle('active', t.getAttribute('data-tool') === 'turf');
    });

    try {
      // Disable double-click zoom while drawing
      map.setOptions({ disableDoubleClickZoom: true, draggableCursor: 'crosshair' });
    } catch (err) {
      console.error('[D2D] Error setting map options:', err);
    }

    // Show instructions
    showBanner('<i class="fas fa-draw-polygon mr-2 text-sky-500"></i>Click to add boundary points. Click "Finish Turf" or double-click to complete.', '#0369a1');

    // Show finish/cancel bar
    var finishBar = document.getElementById('d2dFinishBar');
    if (finishBar) {
      finishBar.style.display = 'flex';
      console.log('[D2D] Finish bar shown');
    } else {
      console.error('[D2D] Finish bar element not found!');
    }

    // Close any open info window
    if (infoWindow) infoWindow.close();
  }

  function addDrawingPoint(latLng) {
    try {
      var pt = { lat: latLng.lat(), lng: latLng.lng() };
      drawingPoints.push(pt);
      console.log('[D2D] Point added:', drawingPoints.length, 'lat:', pt.lat.toFixed(6), 'lng:', pt.lng.toFixed(6));

      // Drop a numbered marker
      var marker = new google.maps.Marker({
        position: latLng,
        map: map,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 7,
          fillColor: '#0ea5e9',
          fillOpacity: 1,
          strokeColor: '#fff',
          strokeWeight: 2
        },
        label: {
          text: String(drawingPoints.length),
          color: '#fff',
          fontSize: '10px',
          fontWeight: 'bold'
        },
        zIndex: 100
      });
      drawingMarkers.push(marker);

      // Update polyline preview
      if (drawingPolyline) drawingPolyline.setMap(null);
      drawingPolyline = new google.maps.Polyline({
        path: drawingPoints,
        strokeColor: '#0ea5e9',
        strokeWeight: 2,
        strokeOpacity: 0.8,
        map: map
      });

      // Show preview polygon fill after 3+ points
      if (drawingPoints.length >= 3) {
        if (drawingPreviewPolygon) drawingPreviewPolygon.setMap(null);
        drawingPreviewPolygon = new google.maps.Polygon({
          paths: drawingPoints,
          strokeColor: '#0ea5e9',
          strokeOpacity: 0.5,
          strokeWeight: 1,
          fillColor: '#0ea5e9',
          fillOpacity: 0.1,
          map: map,
          clickable: false,
          zIndex: 0
        });
      }

      // Show a quick toast for the first point to confirm drawing is working
      if (drawingPoints.length === 1) {
        toast('First boundary point placed! Keep clicking to add more.', 'info');
      }

      // Update banner with point count
      showBanner('<i class="fas fa-draw-polygon mr-2 text-sky-500"></i>' + drawingPoints.length + ' point' + (drawingPoints.length > 1 ? 's' : '') + ' placed — ' + (drawingPoints.length < 3 ? 'need ' + (3 - drawingPoints.length) + ' more' : 'click "Finish Turf" or double-click to save'), '#0369a1');
    } catch (err) {
      console.error('[D2D] Error adding drawing point:', err);
      toast('Error adding point: ' + err.message, 'error');
    }
  }

  function finishDrawing() {
    if (!isDrawing) return;
    console.log('[D2D] Finishing drawing with', drawingPoints.length, 'points');

    // Cancel the debounce timer
    if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }

    if (drawingPoints.length < 3) {
      toast('Need at least 3 points to create a turf. You have ' + drawingPoints.length + '.', 'error');
      return; // Don't cancel, let user keep adding points
    }

    var polygon = drawingPoints.slice(); // copy
    clearDrawingUI();
    isDrawing = false;
    try {
      if (map) map.setOptions({ disableDoubleClickZoom: false, draggableCursor: '' });
    } catch(e) {}
    hideBanner();
    var finishBar = document.getElementById('d2dFinishBar');
    if (finishBar) finishBar.style.display = 'none';

    showSaveTurfModal(polygon);
  }

  function cancelDrawing() {
    if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
    clearDrawingUI();
    isDrawing = false;
    drawingPoints = [];
    try {
      if (map) map.setOptions({ disableDoubleClickZoom: false, draggableCursor: '' });
    } catch(e) {}
    hideBanner();
    var finishBar = document.getElementById('d2dFinishBar');
    if (finishBar) finishBar.style.display = 'none';
    setActiveTool('pointer');
    toast('Drawing cancelled.', 'info');
  }

  function clearDrawingUI() {
    for (var i = 0; i < drawingMarkers.length; i++) drawingMarkers[i].setMap(null);
    drawingMarkers = [];
    if (drawingPolyline) { drawingPolyline.setMap(null); drawingPolyline = null; }
    if (drawingPreviewPolygon) { drawingPreviewPolygon.setMap(null); drawingPreviewPolygon = null; }
  }

  function showSaveTurfModal(polygon) {
    var cLat = 0, cLng = 0;
    for (var i = 0; i < polygon.length; i++) { cLat += polygon[i].lat; cLng += polygon[i].lng; }
    cLat /= polygon.length; cLng /= polygon.length;

    var colorGrid = '';
    for (var ci = 0; ci < COLORS.length; ci++) {
      colorGrid += '<div class="d2d-color-swatch' + (ci === 0 ? ' selected' : '') + '" style="background:' + COLORS[ci] + '" data-color="' + COLORS[ci] + '"></div>';
    }

    var teamOpts = '<option value="">Unassigned</option>';
    for (var ti = 0; ti < team.length; ti++) {
      teamOpts += '<option value="' + team[ti].id + '">' + escH(team[ti].name) + '</option>';
    }

    var overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4';
    overlay.id = 'd2dModal';
    overlay.innerHTML = '<div class="bg-[#111111] rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">' +
      '<div class="px-6 py-4 border-b border-white/5 flex items-center justify-between"><h3 class="font-bold text-gray-100"><i class="fas fa-draw-polygon mr-2 text-sky-500"></i>Save New Turf</h3><button onclick="document.getElementById(\'d2dModal\').remove();window.d2d.setTool(\'pointer\')" class="text-gray-400 hover:text-gray-400 text-lg">&times;</button></div>' +
      '<div class="p-6 space-y-4">' +
        '<div><label class="text-xs font-semibold text-gray-400 mb-1 block">Turf Name *</label><input id="turfName" class="d2d-input" placeholder="e.g., North Hill Crescent" autofocus></div>' +
        '<div><label class="text-xs font-semibold text-gray-400 mb-1 block">Description</label><input id="turfDesc" class="d2d-input" placeholder="Optional description..."></div>' +
        '<div><label class="text-xs font-semibold text-gray-400 mb-1 block">Assign To</label><select id="turfAssign" class="d2d-select">' + teamOpts + '</select></div>' +
        '<div><label class="text-xs font-semibold text-gray-400 mb-1 block">Color</label><div class="d2d-color-grid" id="colorGrid">' + colorGrid + '</div></div>' +
        '<div class="text-xs text-gray-400"><i class="fas fa-info-circle mr-1"></i>' + polygon.length + ' boundary points drawn</div>' +
      '</div>' +
      '<div class="px-6 py-4 border-t border-white/5 flex justify-end gap-2">' +
        '<button onclick="document.getElementById(\'d2dModal\').remove();window.d2d.setTool(\'pointer\')" class="d2d-btn d2d-btn-outline">Cancel</button>' +
        '<button id="saveTurfBtn" class="d2d-btn d2d-btn-primary"><i class="fas fa-save mr-1"></i>Save Turf</button>' +
      '</div>' +
    '</div>';

    document.body.appendChild(overlay);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) { overlay.remove(); setActiveTool('pointer'); } });

    var selectedColor = COLORS[0];
    document.querySelectorAll('#colorGrid .d2d-color-swatch').forEach(function(sw) {
      sw.addEventListener('click', function() {
        document.querySelectorAll('#colorGrid .d2d-color-swatch').forEach(function(s) { s.classList.remove('selected'); });
        sw.classList.add('selected');
        selectedColor = sw.getAttribute('data-color');
      });
    });

    document.getElementById('saveTurfBtn').addEventListener('click', function() {
      var name = document.getElementById('turfName').value.trim();
      if (!name) { toast('Please enter a turf name.', 'error'); return; }

      var btn = document.getElementById('saveTurfBtn');
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Saving...';

      api('POST', '/turfs', {
        name: name,
        description: document.getElementById('turfDesc').value.trim(),
        polygon: polygon,
        center_lat: cLat,
        center_lng: cLng,
        color: selectedColor,
        assigned_to: document.getElementById('turfAssign').value || null
      }).then(function(r) {
        if (r.success) {
          toast('Turf "' + name + '" created!');
          overlay.remove();
          setActiveTool('pointer');
          loadAll();
        } else {
          toast(r.error || 'Failed to create turf', 'error');
          btn.disabled = false;
          btn.innerHTML = '<i class="fas fa-save mr-1"></i>Save Turf';
        }
      }).catch(function(err) {
        console.error('[D2D] Turf save error:', err);
        toast('Network error: ' + (err.message || 'Unknown'), 'error');
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save mr-1"></i>Save Turf';
      });
    });
  }

  // ============================================================
  // PIN PLACEMENT
  // ============================================================
  function placePinAtLocation(latLng) {
    var lat = latLng.lat();
    var lng = latLng.lng();
    console.log('[D2D] Pin placement at', lat, lng);

    // Show a temporary pulsing marker while geocoding
    var tempMarker = new google.maps.Marker({
      position: latLng,
      map: map,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 12,
        fillColor: '#0ea5e9',
        fillOpacity: 0.6,
        strokeColor: '#0ea5e9',
        strokeWeight: 3
      },
      zIndex: 100
    });

    // Reverse geocode to get address
    if (geocoder) {
      geocoder.geocode({ location: latLng }, function(results, status) {
        tempMarker.setMap(null); // remove temp marker
        var address = (status === 'OK' && results && results[0]) ? results[0].formatted_address : '';
        console.log('[D2D] Geocode result:', status, address);
        showPlacePinModal(lat, lng, address);
      });
    } else {
      tempMarker.setMap(null);
      showPlacePinModal(lat, lng, '');
    }
  }

  function showPlacePinModal(lat, lng, address) {
    // Find which turf this point is in
    var inTurf = null;
    for (var i = 0; i < turfs.length; i++) {
      try {
        var poly = JSON.parse(turfs[i].polygon_json || '[]');
        if (poly.length >= 3 && google.maps.geometry && google.maps.geometry.poly) {
          var gPoly = new google.maps.Polygon({ paths: poly });
          if (google.maps.geometry.poly.containsLocation(new google.maps.LatLng(lat, lng), gPoly)) {
            inTurf = turfs[i];
            break;
          }
        }
      } catch(e) {}
    }

    var memberOpts = '<option value="">Not assigned</option>';
    for (var ti = 0; ti < team.length; ti++) {
      memberOpts += '<option value="' + team[ti].id + '">' + escH(team[ti].name) + '</option>';
    }

    var overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4';
    overlay.id = 'd2dModal';
    overlay.innerHTML = '<div class="bg-[#111111] rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">' +
      '<div class="px-6 py-4 border-b border-white/5 flex items-center justify-between"><h3 class="font-bold text-gray-100"><i class="fas fa-map-pin mr-2 text-sky-500"></i>Place Door Pin</h3><button onclick="document.getElementById(\'d2dModal\').remove()" class="text-gray-400 hover:text-gray-400 text-lg">&times;</button></div>' +
      '<div class="p-6 space-y-4">' +
        '<div><label class="text-xs font-semibold text-gray-400 mb-1 block">Address</label><input id="pinAddress" class="d2d-input" value="' + escAttr(address) + '"></div>' +
        (inTurf ? '<div class="text-xs text-sky-600 bg-sky-50 rounded-lg p-2"><i class="fas fa-map mr-1"></i>Inside turf: <b>' + escH(inTurf.name) + '</b></div>' : '<div class="text-xs text-gray-400 bg-[#0A0A0A] rounded-lg p-2"><i class="fas fa-exclamation-triangle mr-1 text-gray-400"></i>Not inside any turf</div>') +
        '<div><label class="text-xs font-semibold text-gray-400 mb-1 block">Status</label>' +
          '<div class="grid grid-cols-2 gap-2" id="pinStatusGrid">' +
            '<div class="border-2 rounded-lg p-2 cursor-pointer text-center text-xs font-semibold" data-status="not_knocked" style="border-color:#9ca3af;background:#f9fafb"><i class="fas fa-circle mr-1" style="color:#9ca3af"></i>Not Knocked</div>' +
            '<div class="border-2 rounded-lg p-2 cursor-pointer text-center text-xs font-semibold border-white/10" data-status="yes"><i class="fas fa-check-circle mr-1" style="color:#22c55e"></i>Yes</div>' +
            '<div class="border-2 rounded-lg p-2 cursor-pointer text-center text-xs font-semibold border-white/10" data-status="no"><i class="fas fa-times-circle mr-1" style="color:#ef4444"></i>No</div>' +
            '<div class="border-2 rounded-lg p-2 cursor-pointer text-center text-xs font-semibold border-white/10" data-status="no_answer"><i class="fas fa-question-circle mr-1" style="color:#f59e0b"></i>No Answer</div>' +
          '</div>' +
        '</div>' +
        '<div><label class="text-xs font-semibold text-gray-400 mb-1 block">Knocked By</label><select id="pinKnockedBy" class="d2d-select">' + memberOpts + '</select></div>' +
        '<div><label class="text-xs font-semibold text-gray-400 mb-1 block">Notes</label><textarea id="pinNotes" class="d2d-input" rows="2" placeholder="Optional notes..."></textarea></div>' +
      '</div>' +
      '<div class="px-6 py-4 border-t border-white/5 flex justify-end gap-2">' +
        '<button onclick="document.getElementById(\'d2dModal\').remove()" class="d2d-btn d2d-btn-outline">Cancel</button>' +
        '<button id="savePinBtn" class="d2d-btn d2d-btn-primary"><i class="fas fa-map-pin mr-1"></i>Save Pin</button>' +
      '</div>' +
    '</div>';

    document.body.appendChild(overlay);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });

    // Status selection
    var selectedStatus = 'not_knocked';
    document.querySelectorAll('#pinStatusGrid > div').forEach(function(el) {
      el.addEventListener('click', function() {
        document.querySelectorAll('#pinStatusGrid > div').forEach(function(d) { d.style.borderColor = '#e5e7eb'; d.style.background = ''; });
        el.style.borderColor = PIN_COLORS[el.getAttribute('data-status')] || '#9ca3af';
        el.style.background = '#f9fafb';
        selectedStatus = el.getAttribute('data-status');
      });
    });

    document.getElementById('savePinBtn').addEventListener('click', function() {
      var btn = document.getElementById('savePinBtn');
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Saving...';

      api('POST', '/pins', {
        lat: lat,
        lng: lng,
        address: document.getElementById('pinAddress').value.trim(),
        turf_id: inTurf ? inTurf.id : null,
        status: selectedStatus,
        notes: document.getElementById('pinNotes').value.trim(),
        knocked_by: document.getElementById('pinKnockedBy').value || null
      }).then(function(r) {
        console.log('[D2D] Pin save response:', r);
        if (r.success) {
          toast('Pin placed!');
          overlay.remove();
          loadAll();
        } else {
          toast(r.error || 'Failed to place pin', 'error');
          btn.disabled = false;
          btn.innerHTML = '<i class="fas fa-map-pin mr-1"></i>Save Pin';
        }
      }).catch(function(err) {
        console.error('[D2D] Pin save error:', err);
        toast('Network error: ' + (err.message || 'Unknown'), 'error');
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-map-pin mr-1"></i>Save Pin';
      });
    });
  }

  // ============================================================
  // TURF ACTIONS
  // ============================================================
  function selectTurf(id) {
    selectedTurfId = (selectedTurfId == id) ? null : id;
    renderTurfsPanel();

    if (selectedTurfId) {
      var turf = turfs.find(function(t) { return t.id == id; });
      if (turf) {
        try {
          var coords = JSON.parse(turf.polygon_json || '[]');
          var bounds = new google.maps.LatLngBounds();
          for (var i = 0; i < coords.length; i++) bounds.extend(new google.maps.LatLng(coords[i].lat, coords[i].lng));
          map.fitBounds(bounds, 80);
        } catch(e) {}
      }
      for (var tid in turfPolygons) {
        turfPolygons[tid].setOptions({ fillOpacity: tid == id ? 0.25 : 0.08, strokeOpacity: tid == id ? 1 : 0.4 });
      }
    } else {
      for (var tid2 in turfPolygons) {
        turfPolygons[tid2].setOptions({ fillOpacity: 0.15, strokeOpacity: 0.9 });
      }
    }
  }

  function editTurf(id) {
    var turf = turfs.find(function(t) { return t.id == id; });
    if (!turf) return;

    var teamOpts = '<option value="">Unassigned</option>';
    for (var ti = 0; ti < team.length; ti++) {
      teamOpts += '<option value="' + team[ti].id + '"' + (turf.assigned_to == team[ti].id ? ' selected' : '') + '>' + escH(team[ti].name) + '</option>';
    }

    var colorGrid = '';
    for (var ci = 0; ci < COLORS.length; ci++) {
      colorGrid += '<div class="d2d-color-swatch' + (COLORS[ci] === turf.color ? ' selected' : '') + '" style="background:' + COLORS[ci] + '" data-color="' + COLORS[ci] + '"></div>';
    }

    var overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4';
    overlay.id = 'd2dModal';
    overlay.innerHTML = '<div class="bg-[#111111] rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">' +
      '<div class="px-6 py-4 border-b border-white/5"><h3 class="font-bold text-gray-100"><i class="fas fa-pen mr-2 text-sky-500"></i>Edit Turf</h3></div>' +
      '<div class="p-6 space-y-4">' +
        '<div><label class="text-xs font-semibold text-gray-400 mb-1 block">Name</label><input id="editTurfName" class="d2d-input" value="' + escAttr(turf.name) + '"></div>' +
        '<div><label class="text-xs font-semibold text-gray-400 mb-1 block">Description</label><input id="editTurfDesc" class="d2d-input" value="' + escAttr(turf.description || '') + '"></div>' +
        '<div><label class="text-xs font-semibold text-gray-400 mb-1 block">Assign To</label><select id="editTurfAssign" class="d2d-select">' + teamOpts + '</select></div>' +
        '<div><label class="text-xs font-semibold text-gray-400 mb-1 block">Color</label><div class="d2d-color-grid" id="editColorGrid">' + colorGrid + '</div></div>' +
      '</div>' +
      '<div class="px-6 py-4 border-t border-white/5 flex justify-end gap-2">' +
        '<button onclick="document.getElementById(\'d2dModal\').remove()" class="d2d-btn d2d-btn-outline">Cancel</button>' +
        '<button id="updateTurfBtn" class="d2d-btn d2d-btn-primary"><i class="fas fa-save mr-1"></i>Update</button>' +
      '</div>' +
    '</div>';

    document.body.appendChild(overlay);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });

    var selectedColor = turf.color || COLORS[0];
    document.querySelectorAll('#editColorGrid .d2d-color-swatch').forEach(function(sw) {
      sw.addEventListener('click', function() {
        document.querySelectorAll('#editColorGrid .d2d-color-swatch').forEach(function(s) { s.classList.remove('selected'); });
        sw.classList.add('selected');
        selectedColor = sw.getAttribute('data-color');
      });
    });

    document.getElementById('updateTurfBtn').addEventListener('click', function() {
      api('PUT', '/turfs/' + id, {
        name: document.getElementById('editTurfName').value.trim(),
        description: document.getElementById('editTurfDesc').value.trim(),
        assigned_to: document.getElementById('editTurfAssign').value || null,
        color: selectedColor
      }).then(function(r) {
        if (r.success) { toast('Turf updated!'); overlay.remove(); loadAll(); }
        else { toast(r.error || 'Failed to update', 'error'); }
      }).catch(function(err) { toast('Network error: ' + (err.message || 'Unknown'), 'error'); });
    });
  }

  async function deleteTurf(id) {
    if (!(await window.rmConfirm('Delete this turf and all its pins?'))) return
    api('DELETE', '/turfs/' + id).then(function(r) {
      if (r.success) { toast('Turf deleted'); infoWindow.close(); loadAll(); }
      else { toast(r.error || 'Failed to delete turf', 'error'); }
    }).catch(function(err) { toast('Network error: ' + (err.message || 'Unknown'), 'error'); });
  }

  // ============================================================
  // PIN ACTIONS
  // ============================================================
  function updatePinStatus(id, status) {
    api('PUT', '/pins/' + id, { status: status }).then(function(r) {
      if (r.success) { toast('Pin updated to ' + PIN_LABELS[status]); infoWindow.close(); loadAll(); }
      else { toast(r.error || 'Failed to update pin', 'error'); }
    }).catch(function(err) { toast('Network error: ' + (err.message || 'Unknown'), 'error'); });
  }

  function assignPin(id, memberId) {
    api('PUT', '/pins/' + id, { knocked_by: memberId || null }).then(function(r) {
      if (r.success) { toast('Pin assigned'); loadAll(); }
      else { toast(r.error || 'Failed to assign pin', 'error'); }
    }).catch(function(err) { toast('Network error: ' + (err.message || 'Unknown'), 'error'); });
  }

  function addPinNotes(id) {
    var pin = pins.find(function(p) { return p.id == id; });
    var note = prompt('Enter notes for this pin:', pin ? (pin.notes || '') : '');
    if (note !== null) {
      api('PUT', '/pins/' + id, { notes: note }).then(function(r) {
        if (r.success) { toast('Notes saved'); loadAll(); }
        else { toast(r.error || 'Failed to save notes', 'error'); }
      }).catch(function(err) { toast('Network error: ' + (err.message || 'Unknown'), 'error'); });
    }
  }

  async function deletePin(id) {
    if (!(await window.rmConfirm('Delete this pin?'))) return
    api('DELETE', '/pins/' + id).then(function(r) {
      if (r.success) { toast('Pin deleted'); infoWindow.close(); loadAll(); }
      else { toast(r.error || 'Failed to delete pin', 'error'); }
    }).catch(function(err) { toast('Network error: ' + (err.message || 'Unknown'), 'error'); });
  }

  function focusPin(id) {
    var pin = pins.find(function(p) { return p.id == id; });
    if (pin && map) {
      map.panTo({ lat: pin.lat, lng: pin.lng });
      map.setZoom(18);
      if (pinMarkers[id]) showPinInfo(pin, pinMarkers[id]);
    }
  }

  function filterPins(status) {
    var url = '/pins' + (status ? '?status=' + status : '');
    api('GET', url).then(function(r) {
      pins = r.pins || [];
      renderPinsPanel();
      for (var pid in pinMarkers) {
        var show = !status || pins.some(function(p) { return p.id == pid; });
        pinMarkers[pid].setMap(show ? map : null);
      }
    });
  }

  // ============================================================
  // TEAM MEMBER ACTIONS
  // ============================================================

  function buildPermissionsHtml(perms, prefix) {
    var d2dAll = !perms || perms.d2d !== 'assigned';
    return '<div class="mt-1 p-3 bg-[#0A0A0A] rounded-xl border border-white/10 space-y-3">' +
      // D2D turf visibility
      '<div>' +
        '<p class="text-[11px] font-semibold text-gray-500 mb-1.5">D2D Turf Visibility</p>' +
        '<div class="flex gap-2">' +
          '<button type="button" data-perm="d2d" data-val="all" class="' + prefix + '-perm-d2d flex-1 text-xs py-1.5 rounded-lg border-2 font-semibold transition-all ' + (d2dAll ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-white/10 text-gray-500') + '"><i class="fas fa-globe mr-1"></i>All Turfs</button>' +
          '<button type="button" data-perm="d2d" data-val="assigned" class="' + prefix + '-perm-d2d flex-1 text-xs py-1.5 rounded-lg border-2 font-semibold transition-all ' + (!d2dAll ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-white/10 text-gray-500') + '"><i class="fas fa-user-tag mr-1"></i>Assigned Only</button>' +
        '</div>' +
      '</div>' +
      // Feature toggles
      '<div class="grid grid-cols-2 gap-2">' +
        buildPermToggle(prefix, 'reports', 'fa-file-alt', 'Reports', !perms || perms.reports !== false) +
        buildPermToggle(prefix, 'crm', 'fa-briefcase', 'CRM', !perms || perms.crm !== false) +
        buildPermToggle(prefix, 'secretary', 'fa-headset', 'Secretary', perms && perms.secretary === true) +
        buildPermToggle(prefix, 'team', 'fa-users-cog', 'Team Mgmt', perms && perms.team === true) +
      '</div>' +
    '</div>';
  }

  function buildPermToggle(prefix, key, icon, label, checked) {
    return '<label class="flex items-center gap-2 cursor-pointer p-2 bg-[#111111] rounded-lg border border-white/5">' +
      '<div class="relative flex-shrink-0">' +
        '<input type="checkbox" id="' + prefix + '-perm-' + key + '" class="sr-only peer" ' + (checked ? 'checked' : '') + '>' +
        '<div class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[\'\'] after:absolute after:top-[2px] after:left-[2px] after:bg-[#111111] after:border-white/15 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-sky-500"></div>' +
      '</div>' +
      '<span class="text-xs font-medium text-gray-300"><i class="fas ' + icon + ' mr-1 text-gray-400"></i>' + label + '</span>' +
    '</label>';
  }

  function readPermissions(prefix) {
    var d2dBtns = document.querySelectorAll('.' + prefix + '-perm-d2d');
    var d2dVal = 'all';
    d2dBtns.forEach(function(btn) { if (btn.style.borderColor === 'rgb(14, 165, 233)' || btn.classList.contains('border-sky-500')) { d2dVal = btn.getAttribute('data-val'); } });
    // Better: check which button has active class
    d2dBtns.forEach(function(btn) { if (btn.getAttribute('data-val') === 'assigned' && btn.classList.contains('text-sky-700')) d2dVal = 'assigned'; });
    return {
      d2d: d2dVal,
      reports: document.getElementById(prefix + '-perm-reports') ? document.getElementById(prefix + '-perm-reports').checked : true,
      crm: document.getElementById(prefix + '-perm-crm') ? document.getElementById(prefix + '-perm-crm').checked : true,
      secretary: document.getElementById(prefix + '-perm-secretary') ? document.getElementById(prefix + '-perm-secretary').checked : false,
      team: document.getElementById(prefix + '-perm-team') ? document.getElementById(prefix + '-perm-team').checked : false
    };
  }

  function attachPermButtons(prefix) {
    document.querySelectorAll('.' + prefix + '-perm-d2d').forEach(function(btn) {
      btn.addEventListener('click', function() {
        document.querySelectorAll('.' + prefix + '-perm-d2d').forEach(function(b) {
          b.className = b.className.split('border-sky-500').join('').split('bg-sky-50').join('').split('text-sky-700').join('').split('border-white/10').join('').split('text-gray-500').join('').trim();
          b.classList.add('border-white/10', 'text-gray-500');
        });
        btn.classList.remove('border-white/10', 'text-gray-500');
        btn.classList.add('border-sky-500', 'bg-sky-50', 'text-sky-700');
      });
    });
  }

  function addMember() {
    var colorGrid = '';
    for (var ci = 0; ci < COLORS.length; ci++) {
      colorGrid += '<div class="d2d-color-swatch' + (ci === 0 ? ' selected' : '') + '" style="background:' + COLORS[ci] + '" data-color="' + COLORS[ci] + '"></div>';
    }

    var overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4';
    overlay.id = 'd2dModal';
    overlay.innerHTML = '<div class="bg-[#111111] rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden" style="max-height:90vh;display:flex;flex-direction:column">' +
      '<div class="px-6 py-4 border-b border-white/5 flex items-center justify-between flex-shrink-0">' +
        '<h3 class="font-bold text-gray-100"><i class="fas fa-user-plus mr-2 text-sky-500"></i>Add Team Member</h3>' +
        '<button onclick="document.getElementById(\'d2dModal\').remove()" class="text-gray-400 hover:text-gray-400 text-lg">&times;</button>' +
      '</div>' +
      '<div class="p-6 space-y-4 overflow-y-auto flex-1">' +
        // Basic info
        '<div class="grid grid-cols-2 gap-3">' +
          '<div class="col-span-2"><label class="text-xs font-semibold text-gray-400 mb-1 block">Full Name *</label><input id="memberName" class="d2d-input" placeholder="e.g. John Smith" autofocus></div>' +
          '<div><label class="text-xs font-semibold text-gray-400 mb-1 block">Phone</label><input id="memberPhone" class="d2d-input" type="tel" placeholder="(555) 123-4567"></div>' +
          '<div><label class="text-xs font-semibold text-gray-400 mb-1 block">Role</label><select id="memberRole" class="d2d-select"><option value="salesperson">Salesperson</option><option value="manager">Manager</option></select></div>' +
        '</div>' +
        // Login credentials section
        '<div class="border border-dashed border-sky-300 bg-sky-50/50 rounded-xl p-4">' +
          '<p class="text-xs font-bold text-sky-700 mb-3"><i class="fas fa-key mr-1.5"></i>Login Credentials <span class="font-normal text-sky-500">(optional — set so they can log in to the platform)</span></p>' +
          '<div class="space-y-2">' +
            '<div><label class="text-xs font-semibold text-gray-400 mb-1 block">Email / Username</label><input id="memberEmail" class="d2d-input" type="email" placeholder="their-email@example.com"></div>' +
            '<div><label class="text-xs font-semibold text-gray-400 mb-1 block">Password</label><input id="memberPassword" class="d2d-input" type="password" placeholder="Min 6 characters"></div>' +
          '</div>' +
          '<p class="text-[10px] text-sky-600 mt-2"><i class="fas fa-info-circle mr-1"></i>They will log in at /customer/login with this email &amp; password and access your account\'s D2D data.</p>' +
        '</div>' +
        // Permissions
        '<div>' +
          '<label class="text-xs font-semibold text-gray-400 mb-1 block"><i class="fas fa-shield-alt mr-1 text-gray-400"></i>Access Permissions</label>' +
          buildPermissionsHtml(null, 'new') +
        '</div>' +
        // Color
        '<div><label class="text-xs font-semibold text-gray-400 mb-1 block">Map Color</label><div class="d2d-color-grid" id="memberColorGrid">' + colorGrid + '</div></div>' +
      '</div>' +
      '<div class="px-6 py-4 border-t border-white/5 flex justify-end gap-2 flex-shrink-0">' +
        '<button onclick="document.getElementById(\'d2dModal\').remove()" class="d2d-btn d2d-btn-outline">Cancel</button>' +
        '<button id="saveMemberBtn" class="d2d-btn d2d-btn-primary"><i class="fas fa-save mr-1"></i>Add Member</button>' +
      '</div>' +
    '</div>';

    document.body.appendChild(overlay);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
    attachPermButtons('new');

    var selectedColor = COLORS[0];
    document.querySelectorAll('#memberColorGrid .d2d-color-swatch').forEach(function(sw) {
      sw.addEventListener('click', function() {
        document.querySelectorAll('#memberColorGrid .d2d-color-swatch').forEach(function(s) { s.classList.remove('selected'); });
        sw.classList.add('selected');
        selectedColor = sw.getAttribute('data-color');
      });
    });

    document.getElementById('saveMemberBtn').addEventListener('click', function() {
      var name = document.getElementById('memberName').value.trim();
      var email = document.getElementById('memberEmail').value.trim();
      var password = document.getElementById('memberPassword').value;
      if (!name) { toast('Name is required', 'error'); return; }
      if (password && password.length < 6) { toast('Password must be at least 6 characters', 'error'); return; }
      if (password && !email) { toast('Email is required when setting a password', 'error'); return; }

      var btn = document.getElementById('saveMemberBtn');
      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Adding...';

      api('POST', '/team', {
        name: name,
        email: email || null,
        phone: document.getElementById('memberPhone').value.trim(),
        role: document.getElementById('memberRole').value,
        color: selectedColor,
        password: password || null,
        permissions: readPermissions('new')
      }).then(function(r) {
        if (r.success) { toast('Team member added!' + (password ? ' They can now log in.' : '')); overlay.remove(); loadAll(); }
        else { toast(r.error || 'Failed to add member', 'error'); btn.disabled = false; btn.innerHTML = '<i class="fas fa-save mr-1"></i>Add Member'; }
      }).catch(function(err) { toast('Network error', 'error'); btn.disabled = false; btn.innerHTML = '<i class="fas fa-save mr-1"></i>Add Member'; });
    });
  }

  function editMember(id) {
    var m = team.find(function(t) { return t.id == id; });
    if (!m) return;

    var perms = null;
    try { perms = m.permissions ? JSON.parse(m.permissions) : null; } catch(e) {}

    var colorGrid = '';
    for (var ci = 0; ci < COLORS.length; ci++) {
      colorGrid += '<div class="d2d-color-swatch' + (COLORS[ci] === m.color ? ' selected' : '') + '" style="background:' + COLORS[ci] + '" data-color="' + COLORS[ci] + '"></div>';
    }

    var overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4';
    overlay.id = 'd2dModal';
    overlay.innerHTML = '<div class="bg-[#111111] rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden" style="max-height:90vh;display:flex;flex-direction:column">' +
      '<div class="px-6 py-4 border-b border-white/5 flex items-center justify-between flex-shrink-0">' +
        '<h3 class="font-bold text-gray-100"><i class="fas fa-user-edit mr-2 text-sky-500"></i>Edit ' + escH(m.name) + '</h3>' +
        '<button onclick="document.getElementById(\'d2dModal\').remove()" class="text-gray-400 hover:text-gray-400 text-lg">&times;</button>' +
      '</div>' +
      '<div class="p-6 space-y-4 overflow-y-auto flex-1">' +
        '<div class="grid grid-cols-2 gap-3">' +
          '<div class="col-span-2"><label class="text-xs font-semibold text-gray-400 mb-1 block">Name</label><input id="editMemberName" class="d2d-input" value="' + escAttr(m.name) + '"></div>' +
          '<div><label class="text-xs font-semibold text-gray-400 mb-1 block">Phone</label><input id="editMemberPhone" class="d2d-input" type="tel" value="' + escAttr(m.phone || '') + '"></div>' +
          '<div><label class="text-xs font-semibold text-gray-400 mb-1 block">Role</label><select id="editMemberRole" class="d2d-select"><option value="salesperson"' + (m.role !== 'manager' ? ' selected' : '') + '>Salesperson</option><option value="manager"' + (m.role === 'manager' ? ' selected' : '') + '>Manager</option></select></div>' +
        '</div>' +
        // Login credentials
        '<div class="border border-dashed border-sky-300 bg-sky-50/50 rounded-xl p-4">' +
          '<p class="text-xs font-bold text-sky-700 mb-3"><i class="fas fa-key mr-1.5"></i>Login Credentials</p>' +
          '<div class="space-y-2">' +
            '<div><label class="text-xs font-semibold text-gray-400 mb-1 block">Email / Username</label><input id="editMemberEmail" class="d2d-input" type="email" value="' + escAttr(m.email || '') + '"></div>' +
            '<div><label class="text-xs font-semibold text-gray-400 mb-1 block">New Password <span class="font-normal text-gray-400">(leave blank to keep existing)</span></label><input id="editMemberPassword" class="d2d-input" type="password" placeholder="Min 6 characters"></div>' +
          '</div>' +
        '</div>' +
        // Permissions
        '<div>' +
          '<label class="text-xs font-semibold text-gray-400 mb-1 block"><i class="fas fa-shield-alt mr-1 text-gray-400"></i>Access Permissions</label>' +
          buildPermissionsHtml(perms, 'edit') +
        '</div>' +
        // Color
        '<div><label class="text-xs font-semibold text-gray-400 mb-1 block">Map Color</label><div class="d2d-color-grid" id="editMemberColorGrid">' + colorGrid + '</div></div>' +
      '</div>' +
      '<div class="px-6 py-4 border-t border-white/5 flex justify-end gap-2 flex-shrink-0">' +
        '<button onclick="document.getElementById(\'d2dModal\').remove()" class="d2d-btn d2d-btn-outline">Cancel</button>' +
        '<button id="updateMemberBtn" class="d2d-btn d2d-btn-primary"><i class="fas fa-save mr-1"></i>Update</button>' +
      '</div>' +
    '</div>';

    document.body.appendChild(overlay);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
    attachPermButtons('edit');

    var selectedColor = m.color || COLORS[0];
    document.querySelectorAll('#editMemberColorGrid .d2d-color-swatch').forEach(function(sw) {
      sw.addEventListener('click', function() {
        document.querySelectorAll('#editMemberColorGrid .d2d-color-swatch').forEach(function(s) { s.classList.remove('selected'); });
        sw.classList.add('selected');
        selectedColor = sw.getAttribute('data-color');
      });
    });

    document.getElementById('updateMemberBtn').addEventListener('click', function() {
      var password = document.getElementById('editMemberPassword').value;
      if (password && password.length < 6) { toast('Password must be at least 6 characters', 'error'); return; }

      var btn = document.getElementById('updateMemberBtn');
      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Saving...';

      api('PUT', '/team/' + id, {
        name: document.getElementById('editMemberName').value.trim(),
        email: document.getElementById('editMemberEmail').value.trim() || null,
        phone: document.getElementById('editMemberPhone').value.trim(),
        role: document.getElementById('editMemberRole').value,
        color: selectedColor,
        password: password || null,
        permissions: readPermissions('edit')
      }).then(function(r) {
        if (r.success) { toast('Team member updated!'); overlay.remove(); loadAll(); }
        else { toast(r.error || 'Failed to update', 'error'); btn.disabled = false; btn.innerHTML = '<i class="fas fa-save mr-1"></i>Update'; }
      }).catch(function(err) { toast('Network error', 'error'); btn.disabled = false; btn.innerHTML = '<i class="fas fa-save mr-1"></i>Update'; });
    });
  }

  async function deleteMember(id) {
    if (!(await window.rmConfirm('Remove this team member?'))) return
    api('DELETE', '/team/' + id).then(function(r) {
      if (r.success) { toast('Team member removed'); loadAll(); }
      else { toast(r.error || 'Failed to remove member', 'error'); }
    }).catch(function(err) { toast('Network error: ' + (err.message || 'Unknown'), 'error'); });
  }

  function filterPinsByMember(memberId, memberName) {
    api('GET', '/pins?member_id=' + memberId).then(function(r) {
      pins = r.pins || [];
      renderPinsPanel();
      // Switch to pins tab
      document.querySelectorAll('.d2d-tab').forEach(function(t) { t.classList.remove('active'); });
      document.querySelectorAll('.d2d-panel').forEach(function(p) { p.classList.remove('active'); });
      var pinsTab = document.querySelector('.d2d-tab[data-tab="pins"]');
      var pinsPanel = document.getElementById('panelPins');
      if (pinsTab) pinsTab.classList.add('active');
      if (pinsPanel) pinsPanel.classList.add('active');
      toast('Showing ' + (r.pins || []).length + ' pins for ' + memberName, 'info');
    });
  }

  // ============================================================
  // UTILITIES
  // ============================================================
  function escH(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
  function escAttr(s) { return (s || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function fmtDate(d) { return d ? new Date(d).toLocaleDateString() : ''; }

  // ============================================================
  // GLOBAL API (exposed for onclick handlers)
  // ============================================================
  window.d2d = {
    startDrawTurf: startDrawTurf,
    finishDrawing: finishDrawing,
    cancelDrawing: cancelDrawing,
    selectTurf: selectTurf,
    editTurf: editTurf,
    deleteTurf: deleteTurf,
    focusPin: focusPin,
    filterPins: filterPins,
    filterPinsByMember: filterPinsByMember,
    updatePinStatus: updatePinStatus,
    assignPin: assignPin,
    addPinNotes: addPinNotes,
    deletePin: deletePin,
    addMember: addMember,
    editMember: editMember,
    deleteMember: deleteMember,
    setTool: setActiveTool,
    openDashboard: openDashboard,
    closeDashboard: closeDashboard,
    refreshDashboard: refreshDashboard
  };

  // ============================================================
  // INIT
  // ============================================================
  renderLayout();

  var _d2dWaitRetries = 0;
  function waitForMaps() {
    if (typeof google !== 'undefined' && google.maps) {
      initMap();
    } else {
      _d2dWaitRetries++;
      if (_d2dWaitRetries < 60) {
        setTimeout(waitForMaps, 300);
      } else {
        console.error('[D2D] Google Maps failed to load after 18s');
      }
    }
  }
  waitForMaps();

})();

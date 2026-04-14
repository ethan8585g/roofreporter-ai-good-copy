// ============================================================
// Storm Scout — Real-time storm damage map for roofers
// Phase 2: ECCC + NWS alerts, NWS LSR hail heatmap, time slider
// ============================================================
(function () {
  'use strict';

  var root = document.getElementById('storm-scout-app');
  if (!root) return;

  var map = null;
  var infoWindow = null;
  var polygons = {};   // id -> google.maps.Polygon
  var markers = {};    // id -> google.maps.Marker
  var heatmapLayer = null;
  var hailMarkers = [];
  var alerts = [];
  var hailReports = [];
  var filter = { hail: true, wind: true, tornado: true, thunderstorm: true, other: true };
  var layers = { alerts: true, heatmap: true };
  var daysBack = 7;
  var historyMode = false;
  var historyDate = null;

  function getToken() { return localStorage.getItem('rc_customer_token') || ''; }
  function authHeaders() { return { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' }; }

  function api(path) {
    return fetch('/api/storm-scout' + path, { headers: authHeaders() }).then(function (r) {
      if (!r.ok) return r.json().then(function (j) { throw new Error(j.error || ('HTTP ' + r.status)); });
      return r.json();
    });
  }

  function toast(msg, type) {
    var t = document.createElement('div');
    t.className = 'fixed bottom-4 right-4 z-[60] px-5 py-3 rounded-xl shadow-xl text-sm font-medium text-white ' +
      (type === 'error' ? 'bg-red-600' : type === 'info' ? 'bg-sky-600' : 'bg-green-600');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 4000);
  }

  var SEVERITY_COLORS = {
    advisory: '#eab308', watch: '#f97316', warning: '#ef4444', extreme: '#7f1d1d'
  };
  var TYPE_ICONS = {
    hail: 'fa-cloud-meatball', wind: 'fa-wind', tornado: 'fa-tornado',
    thunderstorm: 'fa-bolt', other: 'fa-triangle-exclamation'
  };

  function renderLayout() {
    root.innerHTML =
      '<div class="ss-container">' +
        '<aside class="ss-sidebar">' +
          '<div class="ss-sidebar-header">' +
            '<h2><i class="fas fa-cloud-showers-heavy mr-2"></i>Storm Scout</h2>' +
            '<p class="ss-sub">Live alerts + hail reports</p>' +
          '</div>' +
          '<div class="ss-section">' +
            '<div class="ss-section-title">Layers</div>' +
            '<label><input type="checkbox" data-layer="alerts" checked> <i class="fas fa-triangle-exclamation" style="color:#ef4444"></i> Active alerts</label>' +
            '<label><input type="checkbox" data-layer="heatmap" checked> <i class="fas fa-fire" style="color:#f97316"></i> Hail heatmap</label>' +
          '</div>' +
          '<div class="ss-section">' +
            '<div class="ss-section-title">Alert type filters</div>' +
            '<label><input type="checkbox" data-filter="tornado" checked> <i class="fas fa-tornado" style="color:#7f1d1d"></i> Tornado</label>' +
            '<label><input type="checkbox" data-filter="hail" checked> <i class="fas fa-cloud-meatball" style="color:#ef4444"></i> Hail</label>' +
            '<label><input type="checkbox" data-filter="wind" checked> <i class="fas fa-wind" style="color:#f97316"></i> Wind</label>' +
            '<label><input type="checkbox" data-filter="thunderstorm" checked> <i class="fas fa-bolt" style="color:#eab308"></i> Thunderstorm</label>' +
          '</div>' +
          '<div class="ss-section">' +
            '<div class="ss-section-title">Active alerts <span id="ssCount" class="ss-count">0</span></div>' +
            '<div id="ssList" class="ss-list"></div>' +
          '</div>' +
          '<div class="ss-section">' +
            '<div class="ss-section-title">Hail reports <span id="ssHailCount" class="ss-count">0</span></div>' +
            '<div id="ssHailSummary" class="ss-sub" style="font-size:11px"></div>' +
          '</div>' +
          '<div class="ss-section ss-footer">' +
            '<button id="ssRefresh" class="ss-btn"><i class="fas fa-rotate mr-1"></i>Refresh</button>' +
            '<div id="ssUpdated" class="ss-updated"></div>' +
          '</div>' +
        '</aside>' +
        '<div class="ss-map-wrap">' +
          '<div id="ssMap" class="ss-map"></div>' +
          '<div class="ss-timebar">' +
            '<span class="ss-timebar-label">Hail history:</span>' +
            '<div class="ss-timebar-btns">' +
              '<button data-days="1">1d</button>' +
              '<button data-days="3">3d</button>' +
              '<button data-days="7" class="active">7d</button>' +
              '<button data-days="14">14d</button>' +
              '<button data-days="30">30d</button>' +
            '</div>' +
            '<div class="ss-legend">' +
              '<span class="ss-legend-item"><span class="ss-dot" style="background:#22c55e"></span>&lt;1"</span>' +
              '<span class="ss-legend-item"><span class="ss-dot" style="background:#eab308"></span>1–2"</span>' +
              '<span class="ss-legend-item"><span class="ss-dot" style="background:#ef4444"></span>&gt;2"</span>' +
            '</div>' +
            '<div class="ss-history-picker">' +
              '<span class="ss-timebar-label">History:</span>' +
              '<input type="date" id="ssHistoryDate" class="ss-date-input">' +
              '<button id="ssHistoryGo">Load</button>' +
              '<button id="ssHistoryLive" class="ss-live">Live</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    root.querySelectorAll('input[data-filter]').forEach(function (el) {
      el.addEventListener('change', function () {
        filter[el.getAttribute('data-filter')] = el.checked;
        renderAlertsOnMap();
      });
    });
    root.querySelectorAll('input[data-layer]').forEach(function (el) {
      el.addEventListener('change', function () {
        layers[el.getAttribute('data-layer')] = el.checked;
        renderAlertsOnMap();
        renderHeatmap();
      });
    });
    root.querySelectorAll('.ss-timebar-btns button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        daysBack = parseInt(btn.getAttribute('data-days'), 10);
        root.querySelectorAll('.ss-timebar-btns button').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        loadHail();
      });
    });
    document.getElementById('ssRefresh').addEventListener('click', function () { loadAll(true); });

    document.getElementById('ssHistoryGo').addEventListener('click', function () {
      var val = document.getElementById('ssHistoryDate').value;
      if (!val) { toast('Pick a date first', 'info'); return; }
      historyMode = true;
      historyDate = val;
      loadHistory(val);
    });
    document.getElementById('ssHistoryLive').addEventListener('click', function () {
      historyMode = false;
      historyDate = null;
      document.getElementById('ssHistoryDate').value = '';
      loadAll(true);
    });
  }

  function initMap() {
    var el = document.getElementById('ssMap');
    if (!el || !window.google || !google.maps) return;
    map = new google.maps.Map(el, {
      center: { lat: 45.0, lng: -90.0 },
      zoom: 4,
      mapTypeId: 'terrain',
      streetViewControl: false,
      mapTypeControl: true,
      fullscreenControl: true
    });
    infoWindow = new google.maps.InfoWindow();
    loadAll(false);
  }

  function clearAlertLayers() {
    Object.keys(polygons).forEach(function (k) { polygons[k].setMap(null); });
    Object.keys(markers).forEach(function (k) { markers[k].setMap(null); });
    polygons = {}; markers = {};
  }

  function clearHeatmap() {
    if (heatmapLayer) { heatmapLayer.setMap(null); heatmapLayer = null; }
    hailMarkers.forEach(function (m) { m.setMap(null); });
    hailMarkers = [];
  }

  function renderAlertsOnMap() {
    if (!map) return;
    clearAlertLayers();
    var listEl = document.getElementById('ssList');
    var countEl = document.getElementById('ssCount');
    var visible = layers.alerts ? alerts.filter(function (a) { return filter[a.type] !== false; }) : [];
    countEl.textContent = String(visible.length);

    var itemsHtml = '';
    visible.forEach(function (a) {
      var color = SEVERITY_COLORS[a.severity] || '#6b7280';
      if (a.polygon && a.polygon.length >= 3) {
        var poly = new google.maps.Polygon({
          paths: a.polygon, strokeColor: color, strokeOpacity: 0.9, strokeWeight: 2,
          fillColor: color, fillOpacity: 0.28, map: map
        });
        poly.addListener('click', function (e) { openInfo(a, e.latLng); });
        polygons[a.id] = poly;
      } else if (a.coordinates && a.coordinates.lat && a.coordinates.lng) {
        var m = new google.maps.Marker({
          position: a.coordinates, map: map, title: a.headline || a.description,
          icon: { path: google.maps.SymbolPath.CIRCLE, scale: 8, fillColor: color, fillOpacity: 0.9, strokeColor: '#fff', strokeWeight: 2 }
        });
        m.addListener('click', function () { openInfo(a, m.getPosition()); });
        markers[a.id] = m;
      }
      var icon = TYPE_ICONS[a.type] || TYPE_ICONS.other;
      itemsHtml +=
        '<div class="ss-item" data-id="' + escapeAttr(a.id) + '">' +
          '<div class="ss-item-head" style="border-left-color:' + color + '">' +
            '<i class="fas ' + icon + '"></i> <span class="ss-item-type">' + capitalize(a.type) + '</span>' +
            '<span class="ss-item-sev ss-sev-' + a.severity + '">' + a.severity + '</span>' +
          '</div>' +
          '<div class="ss-item-head2">' + escapeHtml(a.headline || a.description || '').slice(0, 120) + '</div>' +
        '</div>';
    });
    listEl.innerHTML = itemsHtml || '<div class="ss-empty">No active alerts match your filters.</div>';
    listEl.querySelectorAll('.ss-item').forEach(function (el) {
      el.addEventListener('click', function () {
        var id = el.getAttribute('data-id');
        var a = alerts.find(function (x) { return x.id === id; });
        if (!a) return;
        var pos = (a.polygon && a.polygon[0]) || a.coordinates;
        if (pos && pos.lat) { map.panTo(pos); map.setZoom(Math.max(map.getZoom(), 8)); openInfo(a, pos); }
      });
    });
  }

  function colorForHailSize(size) {
    if (size >= 2) return '#ef4444';
    if (size >= 1) return '#eab308';
    return '#22c55e';
  }

  function renderHeatmap() {
    if (!map) return;
    clearHeatmap();
    var countEl = document.getElementById('ssHailCount');
    var summaryEl = document.getElementById('ssHailSummary');
    var hail = hailReports.filter(function (r) { return r.type === 'hail'; });
    countEl.textContent = String(hail.length);

    if (!layers.heatmap || !hail.length) {
      summaryEl.textContent = hail.length ? 'Heatmap hidden' : 'No hail reports in window';
      return;
    }

    // Summary stats
    var maxSize = 0, severe = 0;
    hail.forEach(function (r) { if (r.sizeInches > maxSize) maxSize = r.sizeInches; if (r.sizeInches >= 1) severe++; });
    summaryEl.textContent = 'Max: ' + maxSize.toFixed(2) + '" • ≥1": ' + severe + ' • window: ' + daysBack + 'd';

    if (window.google && google.maps && google.maps.visualization && google.maps.visualization.HeatmapLayer) {
      var points = hail.map(function (r) {
        return { location: new google.maps.LatLng(r.lat, r.lng), weight: Math.pow(r.sizeInches || 0.5, 2) };
      });
      heatmapLayer = new google.maps.visualization.HeatmapLayer({
        data: points,
        radius: 28,
        opacity: 0.75,
        gradient: [
          'rgba(0,0,0,0)', 'rgba(34,197,94,0.6)', 'rgba(234,179,8,0.75)',
          'rgba(249,115,22,0.85)', 'rgba(239,68,68,0.95)', 'rgba(127,29,29,1)'
        ]
      });
      heatmapLayer.setMap(map);
    }

    // Clickable markers (small) for individual hail reports — so user can see size/timestamp
    hail.forEach(function (r) {
      var m = new google.maps.Marker({
        position: { lat: r.lat, lng: r.lng }, map: map,
        title: r.sizeInches.toFixed(2) + '" hail',
        icon: {
          path: google.maps.SymbolPath.CIRCLE, scale: Math.max(4, Math.min(12, 3 + r.sizeInches * 2)),
          fillColor: colorForHailSize(r.sizeInches), fillOpacity: 0.85, strokeColor: '#fff', strokeWeight: 1
        }
      });
      m.addListener('click', function () { openHailInfo(r, m.getPosition()); });
      hailMarkers.push(m);
    });
  }

  function openInfo(a, pos) {
    var icon = TYPE_ICONS[a.type] || TYPE_ICONS.other;
    var color = SEVERITY_COLORS[a.severity] || '#6b7280';
    var when = a.timestamp ? new Date(a.timestamp).toLocaleString() : '';
    var exp = a.expiresAt ? '<div><b>Expires:</b> ' + new Date(a.expiresAt).toLocaleString() + '</div>' : '';
    var hail = a.hailSizeInches ? '<div><b>Hail:</b> ' + a.hailSizeInches + '"</div>' : '';
    var wind = a.windSpeedKmh ? '<div><b>Wind:</b> ' + a.windSpeedKmh + ' km/h</div>' : '';
    infoWindow.setContent(
      '<div style="max-width:320px;font-family:system-ui">' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">' +
          '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + color + '"></span>' +
          '<b><i class="fas ' + icon + '"></i> ' + capitalize(a.type) + ' — ' + capitalize(a.severity) + '</b>' +
        '</div>' +
        '<div style="font-weight:600;margin-bottom:4px">' + escapeHtml(a.headline || '') + '</div>' +
        '<div style="font-size:12px;color:#444;margin-bottom:6px">' + escapeHtml((a.description || '').slice(0, 400)) + '</div>' +
        hail + wind +
        (when ? '<div style="font-size:12px"><b>Issued:</b> ' + when + '</div>' : '') + exp +
        '<div style="font-size:11px;color:#888;margin-top:4px">Source: ' + a.source.toUpperCase() + '</div>' +
      '</div>'
    );
    infoWindow.setPosition(pos);
    infoWindow.open(map);
  }

  function openHailInfo(r, pos) {
    var when = r.timestamp ? new Date(r.timestamp).toLocaleString() : '';
    var loc = [r.city, r.state].filter(Boolean).join(', ');
    infoWindow.setContent(
      '<div style="max-width:280px;font-family:system-ui">' +
        '<b><i class="fas fa-cloud-meatball"></i> ' + r.sizeInches.toFixed(2) + '" hail report</b>' +
        (loc ? '<div style="margin-top:4px">' + escapeHtml(loc) + '</div>' : '') +
        (when ? '<div style="font-size:12px;color:#444">' + when + '</div>' : '') +
        (r.remarks ? '<div style="font-size:12px;margin-top:4px">' + escapeHtml(String(r.remarks).slice(0, 200)) + '</div>' : '') +
        '<div style="font-size:11px;color:#888;margin-top:4px">Source: NWS LSR via IEM</div>' +
      '</div>'
    );
    infoWindow.setPosition(pos);
    infoWindow.open(map);
  }

  function loadAlerts(force) {
    return api('/alerts' + (force ? '?t=' + Date.now() : '')).then(function (res) {
      alerts = res.alerts || [];
      renderAlertsOnMap();
      return res;
    }).catch(function (err) {
      console.error('[StormScout] alerts', err);
      toast('Failed to load alerts: ' + (err.message || err), 'error');
    });
  }

  function loadHail() {
    return api('/heatmap?days=' + daysBack).then(function (res) {
      hailReports = res.reports || [];
      renderHeatmap();
      return res;
    }).catch(function (err) {
      console.error('[StormScout] hail', err);
      toast('Failed to load hail reports: ' + (err.message || err), 'error');
    });
  }

  function loadAll(force) {
    Promise.all([loadAlerts(force), loadHail()]).then(function () {
      var updated = document.getElementById('ssUpdated');
      if (updated) updated.textContent = 'Live — ' + new Date().toLocaleTimeString();
    });
  }

  function loadHistory(date) {
    return api('/history?date=' + encodeURIComponent(date)).then(function (snap) {
      alerts = snap.alerts || [];
      hailReports = snap.hailReports || [];
      renderAlertsOnMap();
      renderHeatmap();
      var updated = document.getElementById('ssUpdated');
      if (updated) updated.textContent = 'Snapshot: ' + snap.date + ' (' + snap.summary.hailCount + ' hail, ' + snap.summary.alertCount + ' alerts)';
      toast('Loaded snapshot for ' + snap.date, 'info');
    }).catch(function (err) {
      toast('No snapshot for ' + date + ': ' + (err.message || err), 'error');
    });
  }

  function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
  function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function escapeAttr(s) { return escapeHtml(s); }

  renderLayout();
  window.initStormScoutMap = initMap;
  if (window.googleMapsReady) initMap();
})();

// ============================================================
// Storm Scout — Real-time storm damage map for roofers
// Phase 1: ECCC severe-weather alerts as colored polygons
// ============================================================
(function () {
  'use strict';

  var root = document.getElementById('storm-scout-app');
  if (!root) return;

  var map = null;
  var infoWindow = null;
  var polygons = {};   // id -> google.maps.Polygon
  var markers = {};    // id -> google.maps.Marker (for polygon-less alerts)
  var alerts = [];
  var filter = { hail: true, wind: true, tornado: true, thunderstorm: true, other: true };

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
    advisory: '#eab308',
    watch:    '#f97316',
    warning:  '#ef4444',
    extreme:  '#7f1d1d'
  };

  var TYPE_ICONS = {
    hail:         'fa-cloud-meatball',
    wind:         'fa-wind',
    tornado:      'fa-tornado',
    thunderstorm: 'fa-bolt',
    other:        'fa-triangle-exclamation'
  };

  function renderLayout() {
    root.innerHTML =
      '<div class="ss-container">' +
        '<aside class="ss-sidebar">' +
          '<div class="ss-sidebar-header">' +
            '<h2><i class="fas fa-cloud-showers-heavy mr-2"></i>Storm Scout</h2>' +
            '<p class="ss-sub">Live severe-weather alerts</p>' +
          '</div>' +
          '<div class="ss-section">' +
            '<div class="ss-section-title">Filters</div>' +
            '<label><input type="checkbox" data-filter="tornado" checked> <i class="fas fa-tornado" style="color:#7f1d1d"></i> Tornado</label>' +
            '<label><input type="checkbox" data-filter="hail" checked> <i class="fas fa-cloud-meatball" style="color:#ef4444"></i> Hail</label>' +
            '<label><input type="checkbox" data-filter="wind" checked> <i class="fas fa-wind" style="color:#f97316"></i> Wind</label>' +
            '<label><input type="checkbox" data-filter="thunderstorm" checked> <i class="fas fa-bolt" style="color:#eab308"></i> Thunderstorm</label>' +
          '</div>' +
          '<div class="ss-section">' +
            '<div class="ss-section-title">Active alerts <span id="ssCount" class="ss-count">0</span></div>' +
            '<div id="ssList" class="ss-list"></div>' +
          '</div>' +
          '<div class="ss-section ss-footer">' +
            '<button id="ssRefresh" class="ss-btn"><i class="fas fa-rotate mr-1"></i>Refresh</button>' +
            '<div id="ssUpdated" class="ss-updated"></div>' +
          '</div>' +
        '</aside>' +
        '<div class="ss-map-wrap"><div id="ssMap" class="ss-map"></div></div>' +
      '</div>';

    root.querySelectorAll('input[data-filter]').forEach(function (el) {
      el.addEventListener('change', function () {
        filter[el.getAttribute('data-filter')] = el.checked;
        renderAlertsOnMap();
      });
    });
    document.getElementById('ssRefresh').addEventListener('click', function () { loadAlerts(true); });
  }

  function initMap() {
    var el = document.getElementById('ssMap');
    if (!el || !window.google || !google.maps) return;
    map = new google.maps.Map(el, {
      center: { lat: 56.1, lng: -96.8 }, // Canada-ish
      zoom: 4,
      mapTypeId: 'terrain',
      streetViewControl: false,
      mapTypeControl: true,
      fullscreenControl: true
    });
    infoWindow = new google.maps.InfoWindow();
    loadAlerts(false);
  }

  function clearLayers() {
    Object.keys(polygons).forEach(function (k) { polygons[k].setMap(null); });
    Object.keys(markers).forEach(function (k) { markers[k].setMap(null); });
    polygons = {};
    markers = {};
  }

  function renderAlertsOnMap() {
    if (!map) return;
    clearLayers();
    var listEl = document.getElementById('ssList');
    var countEl = document.getElementById('ssCount');
    var visible = alerts.filter(function (a) { return filter[a.type] !== false; });
    countEl.textContent = String(visible.length);

    var itemsHtml = '';
    visible.forEach(function (a) {
      var color = SEVERITY_COLORS[a.severity] || '#6b7280';
      if (a.polygon && a.polygon.length >= 3) {
        var poly = new google.maps.Polygon({
          paths: a.polygon,
          strokeColor: color,
          strokeOpacity: 0.9,
          strokeWeight: 2,
          fillColor: color,
          fillOpacity: 0.28,
          map: map
        });
        poly.addListener('click', function (e) { openInfo(a, e.latLng); });
        polygons[a.id] = poly;
      } else if (a.coordinates && a.coordinates.lat && a.coordinates.lng) {
        var m = new google.maps.Marker({
          position: a.coordinates,
          map: map,
          title: a.headline || a.description,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 8, fillColor: color, fillOpacity: 0.9, strokeColor: '#fff', strokeWeight: 2
          }
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

  function openInfo(a, pos) {
    var icon = TYPE_ICONS[a.type] || TYPE_ICONS.other;
    var color = SEVERITY_COLORS[a.severity] || '#6b7280';
    var when = a.timestamp ? new Date(a.timestamp).toLocaleString() : '';
    var exp = a.expiresAt ? '<div><b>Expires:</b> ' + new Date(a.expiresAt).toLocaleString() + '</div>' : '';
    infoWindow.setContent(
      '<div style="max-width:320px;font-family:system-ui">' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">' +
          '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + color + '"></span>' +
          '<b><i class="fas ' + icon + '"></i> ' + capitalize(a.type) + ' — ' + capitalize(a.severity) + '</b>' +
        '</div>' +
        '<div style="font-weight:600;margin-bottom:4px">' + escapeHtml(a.headline || '') + '</div>' +
        '<div style="font-size:12px;color:#444;margin-bottom:6px">' + escapeHtml((a.description || '').slice(0, 400)) + '</div>' +
        (when ? '<div style="font-size:12px"><b>Issued:</b> ' + when + '</div>' : '') +
        exp +
        '<div style="font-size:11px;color:#888;margin-top:4px">Source: ' + a.source.toUpperCase() + '</div>' +
      '</div>'
    );
    infoWindow.setPosition(pos);
    infoWindow.open(map);
  }

  function loadAlerts(force) {
    var url = '/alerts' + (force ? '?t=' + Date.now() : '');
    api(url).then(function (res) {
      alerts = res.alerts || [];
      var updated = document.getElementById('ssUpdated');
      if (updated) updated.textContent = 'Updated: ' + new Date(res.fetchedAt || Date.now()).toLocaleTimeString() + (res.cached ? ' (cached)' : '');
      renderAlertsOnMap();
    }).catch(function (err) {
      console.error('[StormScout] load error', err);
      toast('Failed to load alerts: ' + (err.message || err), 'error');
    });
  }

  function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
  function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function escapeAttr(s) { return escapeHtml(s); }

  // Entry points
  renderLayout();
  window.initStormScoutMap = initMap;
  if (window.googleMapsReady) initMap();
})();

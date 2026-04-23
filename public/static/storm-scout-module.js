// ============================================================
// Storm Scout — Real-time storm damage map for roofers
// Phase 2: ECCC + NWS alerts, NWS LSR hail heatmap, time slider
// ============================================================
(function () {
  'use strict';

  var root = document.getElementById('storm-scout-app');
  if (!root) return;

  // Race guard: the Google Maps callback (onStormScoutMapsReady) may fire
  // before this module finishes parsing and replaces the real function
  // below. Install a stub so the early call is a no-op, and set a flag so
  // we can run init ourselves once we're ready.
  var earlyReadyFire = false;
  window.initStormScoutMap = function () { earlyReadyFire = true; };

  var map = null;
  var infoWindow = null;
  var polygons = {};   // id -> google.maps.Polygon
  var markers = {};    // id -> google.maps.Marker
  var heatmapLayer = null;
  var hailMarkers = [];
  var alerts = [];
  var hailReports = [];
  var filter = { hail: true, wind: true, tornado: true, thunderstorm: true, other: true };
  var layers = { alerts: true, heatmap: true, satellite: false };
  var satelliteLayer = null;
  var satelliteType = 'modis_true_color'; // GIBS layer key
  var daysBack = 7;
  var historyMode = false;
  var historyDate = null;

  // Perf: individual clickable hail markers are expensive when there are
  // hundreds/thousands of reports. The HeatmapLayer alone is enough at
  // continental view; markers only add value once the user is zoomed in
  // enough to distinguish individual storm cells.
  var MARKER_MIN_ZOOM = 9;
  var MARKER_CAP = 300; // hard cap even at high zoom, to keep pan smooth

  // Territory (Phase 3) state
  var territories = [];
  var territoryPolygons = {};   // id -> google.maps.Polygon
  var drawingManager = null;
  var drawingActive = false;
  var pendingEditAreaId = null;
  var territoriesFitDone = false;

  // Playback state
  var playback = {
    playing: false,
    cursor: null,        // ms epoch — cutoff time for visible hail
    windowStart: null,   // ms epoch
    windowEnd: null,     // ms epoch
    speed: 2,            // animation multiplier (1/2/5/10)
    durationMs: 8000,    // wall-clock duration for 1× of full window
    lastTick: 0,
    rafId: 0
  };

  function getToken() { return localStorage.getItem('rc_customer_token') || ''; }
  function authHeaders() { return { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' }; }

  function alertsApi(method, path, body) {
    var opts = { method: method, headers: authHeaders() };
    if (body) opts.body = JSON.stringify(body);
    return fetch('/api/storm-alerts' + path, opts).then(function (r) {
      return r.text().then(function (text) {
        var parsed = null;
        try { parsed = text ? JSON.parse(text) : null; } catch (e) {}
        if (!r.ok) {
          var msg = (parsed && parsed.error) ? parsed.error : ('HTTP ' + r.status + (text ? ': ' + text.slice(0, 120) : ''));
          throw new Error(msg);
        }
        return parsed;
      });
    });
  }

  function ssTrack(event_type, meta) {
    try {
      fetch('/api/storm-analytics/event', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ event_type: event_type, meta: meta || null })
      }).catch(function(){});
    } catch (e) {}
  }
  window.ssTrack = ssTrack;

  function api(path) {
    return fetch('/api/storm-scout' + path, { headers: authHeaders() }).then(function (r) {
      return r.text().then(function (text) {
        var parsed = null;
        try { parsed = text ? JSON.parse(text) : null; } catch (e) { /* non-JSON body */ }
        if (!r.ok) {
          var msg = (parsed && parsed.error) ? parsed.error : ('HTTP ' + r.status + (text ? ': ' + text.slice(0, 120) : ''));
          throw new Error(msg);
        }
        if (parsed == null) throw new Error('Invalid JSON from server');
        return parsed;
      });
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
        '<button id="ssMobileToggle" class="ss-mobile-toggle" aria-label="Toggle sidebar"><i class="fas fa-bars"></i></button>' +
        '<aside class="ss-sidebar" id="ssSidebar">' +
          '<div class="ss-sidebar-header">' +
            '<h2><i class="fas fa-cloud-showers-heavy mr-2"></i>Storm Scout</h2>' +
            '<p class="ss-sub">Live alerts + hail reports</p>' +
            '<button class="ss-sidebar-close" id="ssSidebarClose" aria-label="Close"><i class="fas fa-xmark"></i></button>' +
          '</div>' +
          '<div class="ss-section">' +
            '<div class="ss-section-title">Layers</div>' +
            '<label><input type="checkbox" data-layer="alerts" checked> <i class="fas fa-triangle-exclamation" style="color:#ef4444"></i> Active alerts</label>' +
            '<label><input type="checkbox" data-layer="heatmap" checked> <i class="fas fa-fire" style="color:#f97316"></i> Hail heatmap</label>' +
            '<label><input type="checkbox" data-layer="satellite"> <i class="fas fa-satellite" style="color:#60a5fa"></i> NASA satellite (storm-day)</label>' +
            '<select id="ssSatType" class="ss-sat-type">' +
              '<option value="modis_true_color" selected>MODIS true-color (day)</option>' +
              '<option value="viirs_true_color">VIIRS true-color (day)</option>' +
              '<option value="precip_rate">IMERG precipitation</option>' +
            '</select>' +
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
          '<div class="ss-section">' +
            '<div class="ss-section-title">My territory <span id="ssTerrCount" class="ss-count">0</span></div>' +
            '<button id="ssDrawTerr" class="ss-btn ss-btn-secondary"><i class="fas fa-draw-polygon mr-1"></i> Draw new area</button>' +
            '<button id="ssEnablePush" class="ss-btn ss-btn-secondary" style="margin-top:6px"><i class="fas fa-bell mr-1"></i> Enable push alerts</button>' +
            '<div id="ssTerrList" class="ss-terr-list"></div>' +
          '</div>' +
          '<div class="ss-section">' +
            '<div class="ss-section-title">ROI — last 30 days</div>' +
            '<div id="ssRoi" class="ss-roi"><div class="ss-empty">Loading\u2026</div></div>' +
          '</div>' +
          '<div class="ss-section">' +
            '<div class="ss-section-title">Recent matches <span id="ssMatchCount" class="ss-count">0</span></div>' +
            '<div id="ssMatchList" class="ss-match-list"></div>' +
          '</div>' +
          '<div class="ss-section ss-footer">' +
            '<button id="ssRefresh" class="ss-btn"><i class="fas fa-rotate mr-1"></i>Refresh</button>' +
            '<div id="ssUpdated" class="ss-updated"></div>' +
          '</div>' +
        '</aside>' +
        '<div class="ss-map-wrap">' +
          '<div id="ssMap" class="ss-map"></div>' +
          '<div class="ss-searchbar">' +
            '<div class="ss-search-input-wrap">' +
              '<i class="fas fa-magnifying-glass ss-search-icon"></i>' +
              '<input id="ssSearchInput" class="ss-search-input" type="text" placeholder="Search address or place…" autocomplete="off">' +
              '<button id="ssSearchClear" class="ss-search-clear" title="Clear" aria-label="Clear search"><i class="fas fa-xmark"></i></button>' +
            '</div>' +
            '<div class="ss-tracebar">' +
              '<button id="ssTracePoly" class="ss-trace-btn" title="Trace polygon"><i class="fas fa-draw-polygon"></i></button>' +
              '<button id="ssTraceLine" class="ss-trace-btn" title="Trace line"><i class="fas fa-pen-nib"></i></button>' +
              '<button id="ssTraceRect" class="ss-trace-btn" title="Trace rectangle"><i class="far fa-square"></i></button>' +
              '<button id="ssTraceCircle" class="ss-trace-btn" title="Trace circle"><i class="far fa-circle"></i></button>' +
              '<button id="ssTraceClear" class="ss-trace-btn ss-trace-clear" title="Clear drawings"><i class="fas fa-trash"></i></button>' +
            '</div>' +
            '<div id="ssTraceStats" class="ss-trace-stats"></div>' +
          '</div>' +
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
          '<div class="ss-playback">' +
            '<button id="ssPlayBtn" class="ss-pb-btn" title="Play/Pause"><i class="fas fa-play"></i></button>' +
            '<button id="ssResetBtn" class="ss-pb-btn" title="Reset"><i class="fas fa-rotate-left"></i></button>' +
            '<input type="range" id="ssScrubber" class="ss-scrubber" min="0" max="1000" value="1000">' +
            '<span id="ssCursor" class="ss-cursor-label">—</span>' +
            '<select id="ssSpeed" class="ss-speed">' +
              '<option value="1">1×</option>' +
              '<option value="2" selected>2×</option>' +
              '<option value="5">5×</option>' +
              '<option value="10">10×</option>' +
            '</select>' +
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
        var name = el.getAttribute('data-layer');
        layers[name] = el.checked;
        ssTrack('layer_toggle', { layer: name, enabled: el.checked });
        renderAlertsOnMap();
        renderHeatmap();
        renderSatellite();
      });
    });
    document.getElementById('ssSatType').addEventListener('change', function (e) {
      satelliteType = e.target.value;
      if (layers.satellite) renderSatellite();
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

    document.getElementById('ssPlayBtn').addEventListener('click', togglePlayback);
    document.getElementById('ssResetBtn').addEventListener('click', resetPlayback);
    document.getElementById('ssScrubber').addEventListener('input', function (e) {
      if (playback.windowStart == null) return;
      var frac = parseInt(e.target.value, 10) / 1000;
      playback.cursor = playback.windowStart + frac * (playback.windowEnd - playback.windowStart);
      if (playback.playing) pausePlayback();
      renderHeatmap();
      updateCursorLabel();
    });
    document.getElementById('ssSpeed').addEventListener('change', function (e) {
      playback.speed = parseFloat(e.target.value) || 1;
    });

    var sidebar = document.getElementById('ssSidebar');
    var mobileToggle = document.getElementById('ssMobileToggle');
    var sidebarClose = document.getElementById('ssSidebarClose');
    if (mobileToggle) mobileToggle.addEventListener('click', function () { sidebar.classList.toggle('ss-open'); });
    if (sidebarClose) sidebarClose.addEventListener('click', function () { sidebar.classList.remove('ss-open'); });
  }

  function computePlaybackWindow() {
    if (!hailReports.length) { playback.windowStart = playback.windowEnd = playback.cursor = null; return; }
    var min = Infinity, max = -Infinity;
    for (var i = 0; i < hailReports.length; i++) {
      var t = new Date(hailReports[i].timestamp).getTime();
      if (!isNaN(t)) { if (t < min) min = t; if (t > max) max = t; }
    }
    if (!isFinite(min)) { playback.windowStart = playback.windowEnd = null; return; }
    // If window collapses (single point), widen ±30 min so playback has range.
    if (max - min < 60000) { min -= 30 * 60000; max += 30 * 60000; }
    playback.windowStart = min;
    playback.windowEnd = max;
    if (playback.cursor == null || playback.cursor < min || playback.cursor > max) {
      playback.cursor = max; // default: show everything
    }
    updateScrubber();
    updateCursorLabel();
  }

  function updateScrubber() {
    var sc = document.getElementById('ssScrubber');
    if (!sc || playback.windowStart == null) return;
    var frac = (playback.cursor - playback.windowStart) / (playback.windowEnd - playback.windowStart || 1);
    sc.value = String(Math.round(frac * 1000));
  }

  function updateCursorLabel() {
    var el = document.getElementById('ssCursor');
    if (!el) return;
    if (playback.cursor == null) { el.textContent = '—'; return; }
    el.textContent = new Date(playback.cursor).toLocaleString();
  }

  function togglePlayback() {
    if (playback.windowStart == null) return;
    if (playback.playing) pausePlayback(); else startPlayback();
  }

  function startPlayback() {
    if (playback.windowStart == null) return;
    // If at the end, rewind to start before playing
    if (playback.cursor >= playback.windowEnd) playback.cursor = playback.windowStart;
    playback.playing = true;
    playback.lastTick = performance.now();
    document.getElementById('ssPlayBtn').innerHTML = '<i class="fas fa-pause"></i>';
    tick();
  }

  function pausePlayback() {
    playback.playing = false;
    if (playback.rafId) cancelAnimationFrame(playback.rafId);
    document.getElementById('ssPlayBtn').innerHTML = '<i class="fas fa-play"></i>';
  }

  function resetPlayback() {
    pausePlayback();
    if (playback.windowStart == null) return;
    playback.cursor = playback.windowEnd;
    updateScrubber();
    updateCursorLabel();
    renderHeatmap();
  }

  function tick() {
    if (!playback.playing) return;
    if (playback.windowStart == null || playback.windowEnd == null || playback.windowEnd <= playback.windowStart) {
      pausePlayback();
      return;
    }
    var now = performance.now();
    var delta = Math.max(0, now - playback.lastTick);
    playback.lastTick = now;
    var totalWallMs = Math.max(500, playback.durationMs / Math.max(0.1, playback.speed));
    var rangeMs = playback.windowEnd - playback.windowStart;
    var advance = (delta / totalWallMs) * rangeMs;
    playback.cursor = Math.min(playback.windowEnd, (playback.cursor || playback.windowStart) + advance);
    var atEnd = playback.cursor >= playback.windowEnd;
    updateScrubber();
    updateCursorLabel();
    renderHeatmap();
    if (atEnd) { pausePlayback(); return; }
    playback.rafId = requestAnimationFrame(tick);
  }

  function initMap() {
    var el = document.getElementById('ssMap');
    if (!el || !window.google || !google.maps) return;
    map = new google.maps.Map(el, {
      center: { lat: 39.8, lng: -98.5 },
      zoom: 5,
      mapTypeId: 'hybrid',
      streetViewControl: false,
      mapTypeControl: true,
      fullscreenControl: true,
      // Scroll-to-zoom without requiring Ctrl — faster to drill down.
      gestureHandling: 'greedy',
      mapTypeControlOptions: {
        style: google.maps.MapTypeControlStyle.DROPDOWN_MENU,
        mapTypeIds: ['roadmap', 'hybrid', 'satellite', 'terrain']
      }
    });
    infoWindow = new google.maps.InfoWindow();

    // Re-render hail markers when the viewport changes. `idle` fires once
    // after pan/zoom settles — much cheaper than re-rendering on every
    // bounds_changed tick. Only markers are rebuilt; the HeatmapLayer
    // itself stays put, so this is near-free at low zooms.
    var scheduled = false;
    map.addListener('idle', function () {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(function () {
        scheduled = false;
        renderHeatmap();
      });
    });

    ssTrack('map_open');
    // Defer non-critical network calls so the map paints first.
    requestAnimationFrame(function () { loadBasemapProviders(); });
    loadAll(false);
  }

  // Register higher-resolution basemap providers (Esri, Mapbox, Nearmap…)
  // as selectable MapTypes. Attribution shown in a small overlay when
  // the active basemap comes from a non-Google provider.
  function loadBasemapProviders() {
    api('/basemaps').then(function (res) {
      var providers = (res && res.providers) || [];
      if (!providers.length) return;
      var controlIds = ['roadmap', 'hybrid', 'satellite', 'terrain'];

      providers.forEach(function (p) {
        var layer = new google.maps.ImageMapType({
          name: p.name,
          tileSize: new google.maps.Size(256, 256),
          minZoom: 1,
          maxZoom: p.maxZoom,
          getTileUrl: function (coord, zoom) {
            if (zoom > p.maxZoom) return null;
            // Esri uses z/y/x; Mapbox/Nearmap use z/x/y — drive from the template.
            return p.urlTemplate
              .replace('{z}', String(zoom))
              .replace('{x}', String(coord.x))
              .replace('{y}', String(coord.y));
          }
        });
        map.mapTypes.set(p.id, layer);
        controlIds.push(p.id);
      });

      map.setOptions({
        mapTypeControlOptions: {
          style: google.maps.MapTypeControlStyle.DROPDOWN_MENU,
          mapTypeIds: controlIds
        }
      });

      // Attribution badge that swaps in/out based on active basemap
      map.addListener('maptypeid_changed', function () {
        var id = map.getMapTypeId();
        var match = providers.find(function (x) { return x.id === id; });
        showBasemapAttribution(match ? match.attribution : '');
      });
    }).catch(function (err) {
      console.warn('[StormScout] basemaps', err);
    });
  }

  function showBasemapAttribution(text) {
    var el = document.getElementById('ssBasemapAttr');
    if (!text) { if (el) el.remove(); return; }
    if (!el) {
      var wrap = document.querySelector('.ss-map-wrap');
      if (!wrap) return;
      el = document.createElement('div');
      el.id = 'ssBasemapAttr';
      el.className = 'ss-basemap-attr';
      wrap.appendChild(el);
    }
    el.textContent = text;
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
    var allHail = hailReports.filter(function (r) { return r.type === 'hail'; });
    var hail = allHail;
    if (playback.cursor != null) {
      var cutoff = playback.cursor;
      hail = allHail.filter(function (r) {
        var t = new Date(r.timestamp).getTime();
        return isNaN(t) ? true : t <= cutoff;
      });
    }
    countEl.textContent = hail.length + (hail.length !== allHail.length ? ' / ' + allHail.length : '');

    if (!layers.heatmap || !hail.length) {
      summaryEl.textContent = allHail.length ? (layers.heatmap ? 'No hail up to cursor' : 'Heatmap hidden') : 'No hail reports in window';
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

    // Clickable markers only when the user is zoomed in enough to care.
    // At continental view, the HeatmapLayer tells the story; rendering
    // thousands of Marker objects there makes pan/zoom crawl.
    var z = map.getZoom() || 0;
    if (z < MARKER_MIN_ZOOM) return;

    // Viewport-gate so we never render off-screen markers. Also cap at
    // MARKER_CAP by largest hail size so dense storm days stay smooth.
    var bounds = map.getBounds();
    var visibleHail = bounds
      ? hail.filter(function (r) { return bounds.contains({ lat: r.lat, lng: r.lng }); })
      : hail;
    if (visibleHail.length > MARKER_CAP) {
      visibleHail = visibleHail.slice().sort(function (a, b) { return (b.sizeInches || 0) - (a.sizeInches || 0); }).slice(0, MARKER_CAP);
    }

    visibleHail.forEach(function (r) {
      var m = new google.maps.Marker({
        position: { lat: r.lat, lng: r.lng }, map: map,
        title: r.sizeInches.toFixed(2) + '" hail',
        optimized: true,
        icon: {
          path: google.maps.SymbolPath.CIRCLE, scale: Math.max(4, Math.min(12, 3 + r.sizeInches * 2)),
          fillColor: colorForHailSize(r.sizeInches), fillOpacity: 0.85, strokeColor: '#fff', strokeWeight: 1
        }
      });
      m.addListener('click', function () { openHailInfo(r, m.getPosition()); });
      hailMarkers.push(m);
    });
  }

  var GIBS_LAYER_IDS = {
    modis_true_color: { id: 'MODIS_Terra_CorrectedReflectance_TrueColor', ext: 'jpg', set: 'GoogleMapsCompatible_Level9', max: 9 },
    viirs_true_color: { id: 'VIIRS_SNPP_CorrectedReflectance_TrueColor',  ext: 'jpg', set: 'GoogleMapsCompatible_Level9', max: 9 },
    precip_rate:      { id: 'IMERG_Precipitation_Rate',                   ext: 'png', set: 'GoogleMapsCompatible_Level6', max: 6 }
  };

  function activeImageryDate() {
    // Use the loaded history date if we're in snapshot mode; otherwise yesterday
    // (GIBS daily composites lag ~24h behind realtime).
    if (historyMode && historyDate) return historyDate;
    var d = new Date(Date.now() - 24 * 3600 * 1000);
    return d.toISOString().slice(0, 10);
  }

  function renderSatellite() {
    if (!map) return;
    if (satelliteLayer) {
      var arr = map.overlayMapTypes.getArray();
      var idx = arr.indexOf(satelliteLayer);
      if (idx >= 0) map.overlayMapTypes.removeAt(idx);
      satelliteLayer = null;
    }
    if (!layers.satellite) {
      var attr = document.getElementById('ssSatAttr');
      if (attr) attr.remove();
      return;
    }
    var conf = GIBS_LAYER_IDS[satelliteType] || GIBS_LAYER_IDS.modis_true_color;
    var date = activeImageryDate();
    satelliteLayer = new google.maps.ImageMapType({
      name: 'NASA GIBS',
      tileSize: new google.maps.Size(256, 256),
      minZoom: 1,
      maxZoom: conf.max,
      opacity: 0.6,
      getTileUrl: function (coord, zoom) {
        if (zoom > conf.max) return null;
        return 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/' +
               conf.id + '/default/' + date + '/' + conf.set + '/' +
               zoom + '/' + coord.y + '/' + coord.x + '.' + conf.ext;
      }
    });
    map.overlayMapTypes.push(satelliteLayer);
    // Attribution (NASA TOU requires visible credit)
    showSatelliteAttribution(date);
  }

  function showSatelliteAttribution(date) {
    var el = document.getElementById('ssSatAttr');
    if (!el) {
      var wrap = document.querySelector('.ss-map-wrap');
      if (!wrap) return;
      el = document.createElement('div');
      el.id = 'ssSatAttr';
      el.className = 'ss-sat-attr';
      wrap.appendChild(el);
    }
    el.textContent = 'Imagery: NASA GIBS / EOSDIS • ' + date;
  }

  // --- Before/After modal ---
  function openBeforeAfter(center, stormDate) {
    var existing = document.getElementById('ssBAModal');
    if (existing) existing.remove();
    var dBefore = shiftDate(stormDate, -7);
    var dAfter = shiftDate(stormDate, 1);
    var modal = document.createElement('div');
    modal.id = 'ssBAModal';
    modal.className = 'ss-ba-modal';
    modal.innerHTML =
      '<div class="ss-ba-inner">' +
        '<div class="ss-ba-head">' +
          '<h3><i class="fas fa-image"></i> Before / After — storm of ' + escapeHtml(stormDate) + '</h3>' +
          '<button class="ss-ba-close" aria-label="Close">&times;</button>' +
        '</div>' +
        '<div class="ss-ba-grid">' +
          '<div class="ss-ba-col"><div class="ss-ba-label">Before (' + escapeHtml(dBefore) + ')</div><div class="ss-ba-img" id="ssBABefore"><i class="fas fa-spinner fa-spin"></i></div></div>' +
          '<div class="ss-ba-col"><div class="ss-ba-label">After (' + escapeHtml(dAfter) + ')</div><div class="ss-ba-img" id="ssBAAfter"><i class="fas fa-spinner fa-spin"></i></div></div>' +
        '</div>' +
        '<p class="ss-ba-note"><i class="fas fa-circle-info"></i> Roof-level imagery is Google Static Maps (current). Dates are documentation labels. Historical roof-level pre/post imagery ships with the premium tier.</p>' +
      '</div>';
    document.body.appendChild(modal);
    modal.querySelector('.ss-ba-close').addEventListener('click', function () { modal.remove(); });
    modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });

    loadSnapshot(center.lat(), center.lng(), dBefore, 'ssBABefore');
    loadSnapshot(center.lat(), center.lng(), dAfter, 'ssBAAfter');
  }

  function loadSnapshot(lat, lng, date, elId) {
    api('/satellite/snapshot?lat=' + lat + '&lng=' + lng + '&zoom=19&date=' + encodeURIComponent(date))
      .then(function (res) {
        var el = document.getElementById(elId);
        if (!el) return;
        el.innerHTML = '<img src="' + res.url + '" alt="Satellite snapshot">';
      })
      .catch(function (err) {
        var el = document.getElementById(elId);
        if (el) el.innerHTML = '<span class="ss-err">Snapshot failed: ' + escapeHtml(err.message || '') + '</span>';
      });
  }

  function shiftDate(isoDate, deltaDays) {
    var d = new Date(isoDate + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + deltaDays);
    return d.toISOString().slice(0, 10);
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
        '<button class="ss-ba-btn" data-lat="' + pos.lat() + '" data-lng="' + pos.lng() + '" data-date="' + (a.timestamp || '').slice(0,10) + '"><i class="fas fa-image"></i> Before / After</button>' +
      '</div>'
    );
    infoWindow.close();
    infoWindow.setPosition(pos);
    infoWindow.open(map);
    ssTrack('alert_view', { source: a.source, type: a.type, severity: a.severity });
    attachBeforeAfterHandler();
  }

  var baDelegationWired = false;
  function attachBeforeAfterHandler() {
    // Use a single document-level delegated handler so infowindow re-renders
    // don't create duplicate listeners or miss buttons mounted late.
    if (baDelegationWired) return;
    baDelegationWired = true;
    document.addEventListener('click', function (e) {
      var btn = e.target && (e.target.closest ? e.target.closest('.ss-ba-btn') : null);
      if (!btn) return;
      var lat = parseFloat(btn.getAttribute('data-lat'));
      var lng = parseFloat(btn.getAttribute('data-lng'));
      var date = btn.getAttribute('data-date') || new Date().toISOString().slice(0, 10);
      if (isNaN(lat) || isNaN(lng)) return;
      ssTrack('before_after_open', { date: date });
      openBeforeAfter({ lat: function () { return lat; }, lng: function () { return lng; } }, date);
    });
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
        '<button class="ss-ba-btn" data-lat="' + r.lat + '" data-lng="' + r.lng + '" data-date="' + (r.timestamp || '').slice(0,10) + '"><i class="fas fa-image"></i> Before / After</button>' +
      '</div>'
    );
    infoWindow.close();
    infoWindow.setPosition(pos);
    infoWindow.open(map);
    attachBeforeAfterHandler();
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
      pausePlayback();
      playback.cursor = null;
      computePlaybackWindow();
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
    ssTrack('history_load', { date: date });
    return api('/history?date=' + encodeURIComponent(date)).then(function (snap) {
      alerts = snap.alerts || [];
      hailReports = snap.hailReports || [];
      pausePlayback();
      playback.cursor = null;
      computePlaybackWindow();
      renderAlertsOnMap();
      renderHeatmap();
      if (layers.satellite) renderSatellite();
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

  // ============================================================
  // TERRITORY (Phase 3) — draw, save, list, delete, matches feed
  // ============================================================
  function setupDrawingManager() {
    if (!map || !google.maps.drawing || drawingManager) return;
    drawingManager = new google.maps.drawing.DrawingManager({
      drawingMode: null,
      drawingControl: false,
      polygonOptions: {
        strokeColor: '#2563eb', strokeWeight: 2, fillColor: '#2563eb', fillOpacity: 0.18,
        editable: true, zIndex: 5
      }
    });
    drawingManager.setMap(map);
    google.maps.event.addListener(drawingManager, 'polygoncomplete', function (poly) {
      drawingManager.setDrawingMode(null);
      drawingActive = false;
      var drawBtn = document.getElementById('ssDrawTerr');
      if (drawBtn) drawBtn.classList.remove('active');
      promptAndSaveTerritory(poly);
    });
  }

  function startDrawing() {
    if (!drawingManager) { toast('Drawing library not ready yet', 'info'); return; }
    drawingActive = true;
    drawingManager.setDrawingMode(google.maps.drawing.OverlayType.POLYGON);
    var drawBtn = document.getElementById('ssDrawTerr');
    if (drawBtn) drawBtn.classList.add('active');
    toast('Click the map to add points. Double-click or close the polygon to finish.', 'info');
  }

  function promptAndSaveTerritory(poly) {
    var path = poly.getPath();
    var pts = [];
    for (var i = 0; i < path.getLength(); i++) {
      var p = path.getAt(i);
      pts.push({ lat: p.lat(), lng: p.lng() });
    }
    if (pts.length < 3) { poly.setMap(null); toast('Need at least 3 points', 'error'); return; }

    var name = (prompt('Name this territory (e.g. "North Oakville"):') || '').trim();
    if (!name) { poly.setMap(null); return; }
    var hail = parseFloat(prompt('Minimum hail size to alert on (inches). 0 = never, 1.0 = golf-ball-ish:', '1.0') || '1');
    if (!Number.isFinite(hail)) hail = 1;
    var wind = parseInt(prompt('Minimum wind gust to alert on (km/h). 0 = never:', '0') || '0', 10);
    if (!Number.isFinite(wind)) wind = 0;

    alertsApi('POST', '/areas', {
      name: name, polygon: pts, min_hail_inches: hail, min_wind_kmh: wind,
      types: ['hail', 'wind', 'tornado', 'thunderstorm'],
      notify_email: true, notify_push: false
    }).then(function () {
      poly.setMap(null); // remove the draft — the DB-backed render takes over
      toast('Territory saved', 'info');
      ssTrack('territory_create', { name: name, min_hail_inches: hail, min_wind_kmh: wind });
      loadTerritories();
    }).catch(function (err) {
      toast('Save failed: ' + (err.message || err) + ' — your drawing is still on the map; fix thresholds and try again, or click it to delete.', 'error');
      // Keep poly on map so user can see/edit/delete their draft.
    });
  }

  function clearTerritoryPolygons() {
    Object.keys(territoryPolygons).forEach(function (k) {
      territoryPolygons[k].setMap(null);
    });
    territoryPolygons = {};
  }

  function renderTerritories() {
    var listEl = document.getElementById('ssTerrList');
    var countEl = document.getElementById('ssTerrCount');
    countEl.textContent = String(territories.length);
    clearTerritoryPolygons();

    if (!territories.length) {
      listEl.innerHTML = '<div class="ss-empty">No territories yet. Draw one to start getting storm alerts.</div>';
      return;
    }

    listEl.innerHTML = territories.map(function (t) {
      return '<div class="ss-terr-item" data-id="' + t.id + '">' +
        '<div class="ss-terr-head">' +
          '<span class="ss-terr-name">' + escapeHtml(t.name) + '</span>' +
          '<button class="ss-terr-del" title="Delete">&times;</button>' +
        '</div>' +
        '<div class="ss-terr-meta">≥ ' + t.min_hail_inches.toFixed(2) + '" hail' +
          (t.min_wind_kmh > 0 ? ' • ≥ ' + t.min_wind_kmh + ' km/h' : '') +
          (t.notify_email ? ' • email on' : '') +
        '</div>' +
      '</div>';
    }).join('');

    territories.forEach(function (t) {
      if (!Array.isArray(t.polygon) || t.polygon.length < 3) return;
      var poly = new google.maps.Polygon({
        paths: t.polygon,
        strokeColor: '#60a5fa', strokeWeight: 2, strokeOpacity: 0.9,
        fillColor: '#60a5fa', fillOpacity: 0.1, map: map, zIndex: 2
      });
      poly.addListener('click', function () {
        if (!map) return;
        map.panTo(computeCentroid(t.polygon));
      });
      territoryPolygons[t.id] = poly;
    });

    listEl.querySelectorAll('.ss-terr-del').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var item = btn.closest('.ss-terr-item');
        var id = parseInt(item.getAttribute('data-id'), 10);
        if (!confirm('Delete this territory?')) return;
        alertsApi('DELETE', '/areas/' + id).then(function () { loadTerritories(); }).catch(function (err) { toast(err.message, 'error'); });
      });
    });
    listEl.querySelectorAll('.ss-terr-item').forEach(function (item) {
      item.addEventListener('click', function () {
        var id = parseInt(item.getAttribute('data-id'), 10);
        var t = territories.find(function (x) { return x.id === id; });
        if (t && t.polygon && t.polygon.length && map) {
          var c = computeCentroid(t.polygon);
          map.panTo(c); map.setZoom(Math.max(map.getZoom(), 10));
        }
      });
    });
  }

  function computeCentroid(ring) {
    var lat = 0, lng = 0;
    for (var i = 0; i < ring.length; i++) { lat += ring[i].lat; lng += ring[i].lng; }
    return { lat: lat / ring.length, lng: lng / ring.length };
  }

  function loadTerritories() {
    return alertsApi('GET', '/areas').then(function (res) {
      territories = res.areas || [];
      renderTerritories();
      // First-time zoom to the user's territories so they aren't stuck
      // panning in from continental view. Only on initial load — if the
      // user has already interacted with the map, don't yank them around.
      if (!territoriesFitDone && map && territories.length) {
        territoriesFitDone = true;
        var bounds = new google.maps.LatLngBounds();
        var n = 0;
        territories.forEach(function (t) {
          if (!Array.isArray(t.polygon)) return;
          t.polygon.forEach(function (p) { bounds.extend({ lat: p.lat, lng: p.lng }); n++; });
        });
        if (n >= 2) map.fitBounds(bounds, 40);
      }
    }).catch(function (err) {
      console.error('[StormScout] territories', err);
      var listEl = document.getElementById('ssTerrList');
      if (listEl) listEl.innerHTML = '<div class="ss-empty">Could not load territories: ' + escapeHtml(err.message || '') + '</div>';
    });
  }

  function loadMatches() {
    return alertsApi('GET', '/notifications?limit=20').then(function (res) {
      var list = res.notifications || [];
      var countEl = document.getElementById('ssMatchCount');
      var listEl = document.getElementById('ssMatchList');
      countEl.textContent = String(list.length);
      if (!list.length) {
        listEl.innerHTML = '<div class="ss-empty">No matches yet. You\u2019ll get an email when a storm hits your territory.</div>';
        return;
      }
      listEl.innerHTML = list.map(function (m) {
        var when = m.matched_at ? new Date(m.matched_at + 'Z').toLocaleString() : '';
        var size = m.hail_inches ? m.hail_inches.toFixed(2) + '" hail' : m.wind_kmh ? m.wind_kmh + ' km/h wind' : m.event_type;
        return '<div class="ss-match-item" data-lat="' + m.lat + '" data-lng="' + m.lng + '">' +
          '<div class="ss-match-head">' +
            '<b>' + escapeHtml(m.area_name || '') + '</b>' +
            '<span class="ss-match-badge">' + escapeHtml(m.event_type || '') + '</span>' +
          '</div>' +
          '<div class="ss-match-meta">' + escapeHtml(size) + ' • ' + when + '</div>' +
          (m.description ? '<div class="ss-match-desc">' + escapeHtml(String(m.description).slice(0, 140)) + '</div>' : '') +
        '</div>';
      }).join('');
      listEl.querySelectorAll('.ss-match-item').forEach(function (item) {
        item.addEventListener('click', function () {
          var lat = parseFloat(item.getAttribute('data-lat'));
          var lng = parseFloat(item.getAttribute('data-lng'));
          ssTrack('match_click', { lat: lat, lng: lng });
          if (Number.isFinite(lat) && Number.isFinite(lng) && map) {
            map.panTo({ lat: lat, lng: lng }); map.setZoom(Math.max(map.getZoom(), 10));
          }
        });
      });
    }).catch(function (err) {
      console.warn('[StormScout] matches load failed', err);
    });
  }

  // Hook draw + push buttons
  function wireTerritoryControls() {
    var drawBtn = document.getElementById('ssDrawTerr');
    if (drawBtn) drawBtn.addEventListener('click', function () {
      if (drawingActive) {
        drawingManager && drawingManager.setDrawingMode(null);
        drawingActive = false;
        drawBtn.classList.remove('active');
      } else {
        startDrawing();
      }
    });

    var pushBtn = document.getElementById('ssEnablePush');
    if (pushBtn) {
      if (!window.ssPushSupported || !window.ssPushSupported()) {
        pushBtn.textContent = 'Push not supported in this browser';
        pushBtn.disabled = true;
        pushBtn.style.opacity = '0.5';
      } else {
        pushBtn.addEventListener('click', function () {
          pushBtn.disabled = true;
          pushBtn.textContent = 'Requesting permission\u2026';
          window.ssEnablePush().then(function () {
            toast('Push alerts enabled on this device', 'info');
            pushBtn.innerHTML = '<i class="fas fa-check mr-1"></i> Push enabled';
          }).catch(function (err) {
            toast('Push failed: ' + (err.message || err), 'error');
            pushBtn.disabled = false;
            pushBtn.innerHTML = '<i class="fas fa-bell mr-1"></i> Enable push alerts';
          });
        });
      }
    }
  }

  function renderRoi() {
    var el = document.getElementById('ssRoi');
    if (!el) return;
    fetch('/api/storm-analytics/summary?days=30', { headers: authHeaders() })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res || !res.kpis) { el.innerHTML = '<div class="ss-empty">No data yet.</div>'; return; }
        var k = res.kpis, rv = res.revenue;
        el.innerHTML =
          '<div class="ss-roi-grid">' +
            '<div class="ss-roi-cell"><div class="ss-roi-n">' + k.matches_sent + '</div><div class="ss-roi-l">Alerts matched</div></div>' +
            '<div class="ss-roi-cell"><div class="ss-roi-n">' + k.leads_from_storm + '</div><div class="ss-roi-l">Leads</div></div>' +
            '<div class="ss-roi-cell"><div class="ss-roi-n">$' + (rv.estimated_from_storm_scout || 0).toLocaleString() + '</div><div class="ss-roi-l">Est. revenue</div></div>' +
            '<div class="ss-roi-cell"><div class="ss-roi-n">' + k.territories_active + '</div><div class="ss-roi-l">Territories</div></div>' +
            '<div class="ss-roi-cell"><div class="ss-roi-n">' + k.days_active + '</div><div class="ss-roi-l">Days active</div></div>' +
            '<div class="ss-roi-cell"><div class="ss-roi-n">' + k.alert_views + '</div><div class="ss-roi-l">Alert views</div></div>' +
          '</div>' +
          '<div class="ss-roi-note">Est. revenue = leads × $' + rv.avg_job_value.toLocaleString() + ' avg job.</div>';
      })
      .catch(function () { el.innerHTML = '<div class="ss-empty">ROI unavailable.</div>'; });
  }

  // ============================================================
  // SEARCH + TRACE — address search and standalone drawing tools.
  // This is independent of the territory-save flow above; shapes
  // drawn here stay on the map until cleared.
  // ============================================================
  var searchAutocomplete = null;
  var searchMarker = null;
  var traceDrawingManager = null;
  var tracedShapes = [];

  function setupSearchBar() {
    if (!map || !window.google || !google.maps || !google.maps.places) return;
    var input = document.getElementById('ssSearchInput');
    var clearBtn = document.getElementById('ssSearchClear');
    if (!input || searchAutocomplete) return;

    searchAutocomplete = new google.maps.places.Autocomplete(input, {
      fields: ['geometry', 'formatted_address', 'name'],
      types: ['geocode']
    });
    searchAutocomplete.bindTo('bounds', map);

    searchAutocomplete.addListener('place_changed', function () {
      var place = searchAutocomplete.getPlace();
      if (!place || !place.geometry) { toast('No location found for that search', 'info'); return; }
      if (searchMarker) { searchMarker.setMap(null); searchMarker = null; }
      if (place.geometry.viewport) {
        map.fitBounds(place.geometry.viewport);
      } else if (place.geometry.location) {
        map.setCenter(place.geometry.location);
        map.setZoom(17);
      }
      if (place.geometry.location) {
        searchMarker = new google.maps.Marker({
          position: place.geometry.location,
          map: map,
          title: place.formatted_address || place.name || '',
          animation: google.maps.Animation.DROP
        });
      }
      ssTrack('search_place', { query: input.value });
    });

    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        input.value = '';
        if (searchMarker) { searchMarker.setMap(null); searchMarker = null; }
        input.focus();
      });
    }
  }

  function formatArea(sqMeters) {
    var sqFt = sqMeters * 10.7639;
    var acres = sqMeters / 4046.8564224;
    if (acres >= 0.1) return acres.toFixed(2) + ' acres (' + Math.round(sqFt).toLocaleString() + ' ft²)';
    return Math.round(sqFt).toLocaleString() + ' ft²';
  }
  function formatLength(meters) {
    var ft = meters * 3.28084;
    if (ft >= 5280) return (ft / 5280).toFixed(2) + ' mi';
    return Math.round(ft).toLocaleString() + ' ft';
  }

  function updateTraceStats() {
    var el = document.getElementById('ssTraceStats');
    if (!el) return;
    if (!tracedShapes.length) { el.textContent = ''; el.style.display = 'none'; return; }
    var totalArea = 0, totalLen = 0, nArea = 0, nLen = 0;
    tracedShapes.forEach(function (s) {
      try {
        if (s.type === 'polygon') {
          totalArea += google.maps.geometry.spherical.computeArea(s.shape.getPath());
          totalLen += google.maps.geometry.spherical.computeLength(s.shape.getPath()); nArea++;
        } else if (s.type === 'rectangle') {
          var b = s.shape.getBounds();
          var ne = b.getNorthEast(), sw = b.getSouthWest();
          var nw = new google.maps.LatLng(ne.lat(), sw.lng());
          var se = new google.maps.LatLng(sw.lat(), ne.lng());
          var path = [nw, ne, se, sw];
          totalArea += google.maps.geometry.spherical.computeArea(path);
          totalLen += google.maps.geometry.spherical.computeLength(path.concat([nw])); nArea++;
        } else if (s.type === 'circle') {
          var r = s.shape.getRadius();
          totalArea += Math.PI * r * r;
          totalLen += 2 * Math.PI * r; nArea++;
        } else if (s.type === 'polyline') {
          totalLen += google.maps.geometry.spherical.computeLength(s.shape.getPath()); nLen++;
        }
      } catch (e) {}
    });
    var parts = [];
    if (nArea) parts.push('<i class="fas fa-ruler-combined"></i> ' + formatArea(totalArea));
    if (totalLen) parts.push('<i class="fas fa-ruler"></i> ' + formatLength(totalLen));
    parts.push('<span class="ss-trace-count">' + tracedShapes.length + ' shape' + (tracedShapes.length > 1 ? 's' : '') + '</span>');
    el.innerHTML = parts.join(' • ');
    el.style.display = 'flex';
  }

  function registerTracedShape(type, shape) {
    var entry = { type: type, shape: shape };
    tracedShapes.push(entry);
    // Live-update stats while user edits the shape
    if (type === 'polygon' || type === 'polyline') {
      var path = shape.getPath();
      google.maps.event.addListener(path, 'set_at', updateTraceStats);
      google.maps.event.addListener(path, 'insert_at', updateTraceStats);
      google.maps.event.addListener(path, 'remove_at', updateTraceStats);
    } else if (type === 'rectangle') {
      google.maps.event.addListener(shape, 'bounds_changed', updateTraceStats);
    } else if (type === 'circle') {
      google.maps.event.addListener(shape, 'radius_changed', updateTraceStats);
      google.maps.event.addListener(shape, 'center_changed', updateTraceStats);
    }
    // Right-click a shape to delete it
    google.maps.event.addListener(shape, 'rightclick', function () {
      shape.setMap(null);
      tracedShapes = tracedShapes.filter(function (s) { return s !== entry; });
      updateTraceStats();
    });
    updateTraceStats();
  }

  function setupTraceDrawing() {
    if (!map || !google.maps.drawing || traceDrawingManager) return;
    traceDrawingManager = new google.maps.drawing.DrawingManager({
      drawingMode: null,
      drawingControl: false,
      polygonOptions: {
        strokeColor: '#10b981', strokeWeight: 2, fillColor: '#10b981', fillOpacity: 0.18,
        editable: true, zIndex: 6
      },
      polylineOptions: {
        strokeColor: '#10b981', strokeWeight: 3, editable: true, zIndex: 6
      },
      rectangleOptions: {
        strokeColor: '#10b981', strokeWeight: 2, fillColor: '#10b981', fillOpacity: 0.18,
        editable: true, zIndex: 6
      },
      circleOptions: {
        strokeColor: '#10b981', strokeWeight: 2, fillColor: '#10b981', fillOpacity: 0.18,
        editable: true, zIndex: 6
      }
    });
    traceDrawingManager.setMap(map);

    google.maps.event.addListener(traceDrawingManager, 'polygoncomplete', function (p) {
      traceDrawingManager.setDrawingMode(null); clearActiveTraceBtn();
      registerTracedShape('polygon', p);
    });
    google.maps.event.addListener(traceDrawingManager, 'polylinecomplete', function (p) {
      traceDrawingManager.setDrawingMode(null); clearActiveTraceBtn();
      registerTracedShape('polyline', p);
    });
    google.maps.event.addListener(traceDrawingManager, 'rectanglecomplete', function (r) {
      traceDrawingManager.setDrawingMode(null); clearActiveTraceBtn();
      registerTracedShape('rectangle', r);
    });
    google.maps.event.addListener(traceDrawingManager, 'circlecomplete', function (c) {
      traceDrawingManager.setDrawingMode(null); clearActiveTraceBtn();
      registerTracedShape('circle', c);
    });
  }

  function clearActiveTraceBtn() {
    ['ssTracePoly', 'ssTraceLine', 'ssTraceRect', 'ssTraceCircle'].forEach(function (id) {
      var b = document.getElementById(id); if (b) b.classList.remove('active');
    });
  }

  function setTraceMode(mode, btnId) {
    if (!traceDrawingManager) { toast('Drawing library not ready yet', 'info'); return; }
    var btn = document.getElementById(btnId);
    var isActive = btn && btn.classList.contains('active');
    clearActiveTraceBtn();
    if (isActive) {
      traceDrawingManager.setDrawingMode(null);
      return;
    }
    traceDrawingManager.setDrawingMode(mode);
    if (btn) btn.classList.add('active');
    toast('Click the map to start drawing. Right-click a shape to delete it.', 'info');
  }

  function wireTraceControls() {
    var poly = document.getElementById('ssTracePoly');
    var line = document.getElementById('ssTraceLine');
    var rect = document.getElementById('ssTraceRect');
    var circ = document.getElementById('ssTraceCircle');
    var clr = document.getElementById('ssTraceClear');
    if (poly) poly.addEventListener('click', function () { setTraceMode(google.maps.drawing.OverlayType.POLYGON, 'ssTracePoly'); });
    if (line) line.addEventListener('click', function () { setTraceMode(google.maps.drawing.OverlayType.POLYLINE, 'ssTraceLine'); });
    if (rect) rect.addEventListener('click', function () { setTraceMode(google.maps.drawing.OverlayType.RECTANGLE, 'ssTraceRect'); });
    if (circ) circ.addEventListener('click', function () { setTraceMode(google.maps.drawing.OverlayType.CIRCLE, 'ssTraceCircle'); });
    if (clr) clr.addEventListener('click', function () {
      tracedShapes.forEach(function (s) { try { s.shape.setMap(null); } catch (e) {} });
      tracedShapes = [];
      clearActiveTraceBtn();
      if (traceDrawingManager) traceDrawingManager.setDrawingMode(null);
      updateTraceStats();
    });
  }

  renderLayout();
  wireTerritoryControls();
  wireTraceControls();
  window.initStormScoutMap = function () {
    initMap();
    setupDrawingManager();
    setupTraceDrawing();
    setupSearchBar();
    loadTerritories();
    loadMatches();
    renderRoi();
  };
  // If Maps already loaded (and fired the early-stub), or flag is set, run now.
  if (window.googleMapsReady || earlyReadyFire) window.initStormScoutMap();
})();

// ============================================================
// Solar Panel Design Tool
// Canvas-based panel placement on satellite roof image
// ============================================================

(function () {
  'use strict';

  var root = document.getElementById('solar-design-root');
  var token = localStorage.getItem('rc_customer_token') || '';
  function authHeaders() { return { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }; }

  // ── State ──────────────────────────────────────────────────
  var state = {
    reportId: null,
    satelliteUrl: null,
    panelWattage: 400,
    // Panel display size in canvas pixels (can be adjusted)
    panelW: 40,
    panelH: 68,
    panels: [],       // [{x, y}] — top-left canvas coords of each panel
    placing: false,   // drag-place mode active
    img: null,
    canvas: null,
    ctx: null,
    imgOffsetX: 0,
    imgOffsetY: 0,
    imgDrawW: 0,
    imgDrawH: 0,
    hoverX: null,
    hoverY: null,
    layout: null,     // { suggested_panels, image_center, image_zoom, image_size_px, panel_*_meters, ... }
    hydrated: false,
    saving: false,
  };

  // ── Web Mercator projection (Google Maps tile system) ──────
  // Converts lat/lng → pixel coords on a Google Static Maps image of known
  // center/zoom/size. Mirrors Google's tile math (256px tile @ zoom 0).
  function latLngToPixel(lat, lng, centerLat, centerLng, zoom, sizePx) {
    var scale = Math.pow(2, zoom);
    function project(la, ln) {
      var siny = Math.sin(la * Math.PI / 180);
      siny = Math.min(Math.max(siny, -0.9999), 0.9999);
      return {
        x: 256 * (0.5 + ln / 360),
        y: 256 * (0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI)),
      };
    }
    var p = project(lat, lng);
    var c = project(centerLat, centerLng);
    var dx = (p.x - c.x) * scale;
    var dy = (p.y - c.y) * scale;
    return { x: dx + sizePx / 2, y: dy + sizePx / 2 };
  }

  function hydrateFromLayout() {
    if (state.hydrated || !state.layout || !state.img || !state.canvas) return;
    var L = state.layout;
    var src = (L.user_panels && L.user_panels.length) ? L.user_panels : (L.suggested_panels || []);
    if (!src.length) { state.hydrated = true; return; }
    var srcSize = L.image_size_px || 1600;
    var scaleToCanvas = state.imgDrawW / srcSize;
    var newPanels = [];
    for (var i = 0; i < src.length; i++) {
      var p = src[i];
      if (typeof p.lat !== 'number' || typeof p.lng !== 'number') continue;
      var px = latLngToPixel(p.lat, p.lng, L.image_center.lat, L.image_center.lng, L.image_zoom, srcSize);
      var cx = px.x * scaleToCanvas;
      var cy = px.y * scaleToCanvas;
      newPanels.push({ x: Math.round(cx - state.panelW / 2), y: Math.round(cy - state.panelH / 2) });
    }
    state.panels = newPanels;
    state.hydrated = true;
    drawCanvas();
  }

  // ── Bootstrap ──────────────────────────────────────────────
  var params = new URLSearchParams(window.location.search);
  state.reportId = params.get('report_id');

  if (!token) {
    window.location.href = '/customer/login';
    return;
  }

  var custRaw = localStorage.getItem('rc_customer');
  if (custRaw) {
    try { var cust = JSON.parse(custRaw); state.panelWattage = cust.solar_panel_wattage_w || 400; } catch(e) {}
  }

  if (!state.reportId) {
    root.innerHTML = '<div class="bg-red-50 border border-red-200 rounded-xl p-8 text-center text-red-700"><i class="fas fa-exclamation-circle text-3xl mb-3"></i><p class="font-semibold">No report selected.</p><a href="/customer/reports" class="mt-3 inline-block text-blue-600 hover:underline">Go to Reports</a></div>';
    return;
  }

  renderLoading();
  loadReport();

  // ── Load report data ───────────────────────────────────────
  function loadReport() {
    fetch('/api/customer/orders', { headers: authHeaders() })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var orders = data.orders || [];
        var order = null;
        for (var i = 0; i < orders.length; i++) {
          if (String(orders[i].id) === String(state.reportId)) { order = orders[i]; break; }
        }
        if (!order) {
          root.innerHTML = '<div class="bg-red-50 border border-red-200 rounded-xl p-8 text-center text-red-700"><p class="font-semibold">Report not found.</p><a href="/customer/reports" class="mt-3 inline-block text-blue-600 hover:underline">Go to Reports</a></div>';
          return;
        }
        state.satelliteUrl = order.satellite_image_url || null;
        if (order.solar_panel_layout) {
          try {
            state.layout = typeof order.solar_panel_layout === 'string'
              ? JSON.parse(order.solar_panel_layout)
              : order.solar_panel_layout;
            if (state.layout && state.layout.panel_capacity_watts) {
              state.panelWattage = state.layout.panel_capacity_watts;
            }
          } catch(e) { console.warn('Failed to parse solar_panel_layout', e); }
        }
        if (!state.satelliteUrl) {
          root.innerHTML = '<div class="bg-amber-50 border border-amber-200 rounded-xl p-8 text-center text-amber-800"><i class="fas fa-satellite text-3xl mb-3"></i><p class="font-semibold">No satellite image available for this report.</p><p class="text-sm mt-1">The image is attached once the report finishes processing.</p><a href="/customer/reports" class="mt-3 inline-block text-blue-600 hover:underline">Back to Reports</a></div>';
          return;
        }
        renderDesigner(order);
      })
      .catch(function() {
        root.innerHTML = '<div class="bg-red-50 border border-red-200 rounded-xl p-8 text-center text-red-700"><p>Failed to load report data.</p></div>';
      });
  }

  // ── Render loading ─────────────────────────────────────────
  function renderLoading() {
    root.innerHTML = '<div class="flex items-center justify-center py-20 text-gray-400"><div class="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-amber-500 mr-3"></div><span>Loading satellite image...</span></div>';
  }

  // ── Render designer ────────────────────────────────────────
  function renderDesigner(order) {
    root.innerHTML =
      '<div class="flex flex-col lg:flex-row gap-4 h-full">' +
        // Sidebar
        '<div class="lg:w-56 flex-shrink-0">' +
          '<div class="bg-gray-800 rounded-xl p-4 text-white space-y-4">' +
            '<div>' +
              '<p class="text-xs font-bold text-gray-400 uppercase mb-2">Property</p>' +
              '<p class="text-sm text-gray-200 leading-snug">' + (order.property_address || '') + '</p>' +
            '</div>' +
            '<div>' +
              '<p class="text-xs font-bold text-gray-400 uppercase mb-2">Panel Wattage</p>' +
              '<div class="flex items-center gap-2">' +
                '<input type="number" id="sdWattage" value="' + state.panelWattage + '" min="100" max="800" step="5" class="flex-1 px-2 py-1.5 bg-gray-700 border border-gray-600 rounded-lg text-sm text-center text-white">' +
                '<span class="text-xs text-gray-400">W</span>' +
              '</div>' +
            '</div>' +
            '<div>' +
              '<p class="text-xs font-bold text-gray-400 uppercase mb-2">Panel Size</p>' +
              '<div class="grid grid-cols-2 gap-2">' +
                '<div><label class="text-xs text-gray-500">W (px)</label><input type="number" id="sdPanelW" value="' + state.panelW + '" min="10" max="200" class="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-xs text-center text-white" onchange="window._sdUpdatePanelSize()"></div>' +
                '<div><label class="text-xs text-gray-500">H (px)</label><input type="number" id="sdPanelH" value="' + state.panelH + '" min="10" max="200" class="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-xs text-center text-white" onchange="window._sdUpdatePanelSize()"></div>' +
              '</div>' +
            '</div>' +
            // Stats
            '<div class="bg-gray-700 rounded-lg p-3 space-y-2">' +
              '<div class="flex justify-between text-sm">' +
                '<span class="text-gray-400">Panels</span>' +
                '<span class="font-bold text-white" id="sdPanelCount">0</span>' +
              '</div>' +
              '<div class="flex justify-between text-sm">' +
                '<span class="text-gray-400">Capacity</span>' +
                '<span class="font-bold text-amber-400" id="sdCapacity">0.00 kW</span>' +
              '</div>' +
            '</div>' +
            // Actions
            '<div class="space-y-2 pt-1">' +
              '<button onclick="window._sdUndo()" class="w-full bg-gray-700 hover:bg-gray-600 text-white py-2 rounded-lg text-sm font-medium transition-colors"><i class="fas fa-undo mr-1"></i>Undo</button>' +
              '<button onclick="window._sdClearAll()" class="w-full bg-red-700 hover:bg-red-600 text-white py-2 rounded-lg text-sm font-medium transition-colors"><i class="fas fa-trash mr-1"></i>Clear All</button>' +
              '<button onclick="window._sdSaveLayout()" id="sdSaveBtn" class="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-2 rounded-lg text-sm font-bold transition-colors"><i class="fas fa-cloud-upload-alt mr-1"></i>Save to Report</button>' +
              '<button onclick="window._sdDownload()" class="w-full bg-amber-500 hover:bg-amber-400 text-white py-2 rounded-lg text-sm font-bold transition-colors"><i class="fas fa-download mr-1"></i>Download PNG</button>' +
            '</div>' +
            '<p class="text-xs text-gray-500 leading-relaxed">Click on the roof to place panels. Each click places one panel.</p>' +
          '</div>' +
        '</div>' +
        // Canvas area
        '<div class="flex-1 min-w-0">' +
          '<div class="bg-gray-800 rounded-xl overflow-hidden relative" id="sdCanvasWrapper">' +
            '<canvas id="sdCanvas" class="block w-full cursor-crosshair"></canvas>' +
          '</div>' +
        '</div>' +
      '</div>';

    // Load satellite image onto canvas
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function() {
      state.img = img;
      initCanvas();
    };
    img.onerror = function() {
      // Try without crossOrigin (proxy image through our API if needed)
      var img2 = new Image();
      img2.onload = function() { state.img = img2; initCanvas(); };
      img2.onerror = function() {
        document.getElementById('sdCanvasWrapper').innerHTML =
          '<div class="flex items-center justify-center h-48 text-amber-300 text-sm"><i class="fas fa-exclamation-triangle mr-2"></i>Could not load satellite image. Try saving the design anyway.</div>';
      };
      img2.src = state.satelliteUrl;
    };
    img.src = state.satelliteUrl;
  }

  function initCanvas() {
    var wrapper = document.getElementById('sdCanvasWrapper');
    var canvas = document.getElementById('sdCanvas');
    if (!canvas || !wrapper) return;

    // Size canvas to image aspect ratio within wrapper
    var maxW = wrapper.clientWidth || 800;
    var aspect = state.img.naturalHeight / state.img.naturalWidth;
    var canvasW = maxW;
    var canvasH = Math.round(maxW * aspect);

    canvas.width = canvasW;
    canvas.height = canvasH;
    canvas.style.width = canvasW + 'px';
    canvas.style.height = canvasH + 'px';

    state.canvas = canvas;
    state.ctx = canvas.getContext('2d');

    // Image fills canvas entirely
    state.imgOffsetX = 0;
    state.imgOffsetY = 0;
    state.imgDrawW = canvasW;
    state.imgDrawH = canvasH;

    drawCanvas();
    attachCanvasEvents();
    hydrateFromLayout();
  }

  // ── Draw ───────────────────────────────────────────────────
  function drawCanvas() {
    var ctx = state.ctx;
    var canvas = state.canvas;
    if (!ctx || !canvas) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw satellite image
    if (state.img) {
      ctx.drawImage(state.img, state.imgOffsetX, state.imgOffsetY, state.imgDrawW, state.imgDrawH);
    }

    // Draw placed panels
    for (var i = 0; i < state.panels.length; i++) {
      drawPanel(ctx, state.panels[i].x, state.panels[i].y, false);
    }

    // Draw hover ghost
    if (state.hoverX !== null && state.hoverY !== null) {
      ctx.globalAlpha = 0.5;
      drawPanel(ctx, state.hoverX - state.panelW / 2, state.hoverY - state.panelH / 2, true);
      ctx.globalAlpha = 1.0;
    }

    updateStats();
  }

  function drawPanel(ctx, x, y, ghost) {
    var w = state.panelW;
    var h = state.panelH;

    // Panel fill
    ctx.fillStyle = ghost ? 'rgba(59,130,246,0.3)' : 'rgba(59,130,246,0.45)';
    ctx.fillRect(x, y, w, h);

    // Border
    ctx.strokeStyle = ghost ? 'rgba(147,197,253,0.8)' : 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, w, h);

    // Grid lines inside panel (simulate cells)
    ctx.strokeStyle = ghost ? 'rgba(147,197,253,0.4)' : 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 0.5;
    // 2 vertical divisions
    var colW = w / 3;
    for (var ci = 1; ci < 3; ci++) {
      ctx.beginPath(); ctx.moveTo(x + colW * ci, y); ctx.lineTo(x + colW * ci, y + h); ctx.stroke();
    }
    // 5 horizontal divisions
    var rowH = h / 6;
    for (var ri = 1; ri < 6; ri++) {
      ctx.beginPath(); ctx.moveTo(x, y + rowH * ri); ctx.lineTo(x + w, y + rowH * ri); ctx.stroke();
    }
  }

  function updateStats() {
    var count = state.panels.length;
    var wattage = parseInt(document.getElementById('sdWattage').value) || state.panelWattage;
    var kw = (count * wattage / 1000).toFixed(2);
    var countEl = document.getElementById('sdPanelCount');
    var capEl = document.getElementById('sdCapacity');
    if (countEl) countEl.textContent = count;
    if (capEl) capEl.textContent = kw + ' kW';
  }

  // ── Canvas events ──────────────────────────────────────────
  function attachCanvasEvents() {
    var canvas = state.canvas;

    canvas.addEventListener('click', function(e) {
      var rect = canvas.getBoundingClientRect();
      var scaleX = canvas.width / rect.width;
      var scaleY = canvas.height / rect.height;
      var cx = (e.clientX - rect.left) * scaleX;
      var cy = (e.clientY - rect.top) * scaleY;
      state.panels.push({ x: Math.round(cx - state.panelW / 2), y: Math.round(cy - state.panelH / 2) });
      drawCanvas();
    });

    canvas.addEventListener('mousemove', function(e) {
      var rect = canvas.getBoundingClientRect();
      var scaleX = canvas.width / rect.width;
      var scaleY = canvas.height / rect.height;
      state.hoverX = (e.clientX - rect.left) * scaleX;
      state.hoverY = (e.clientY - rect.top) * scaleY;
      drawCanvas();
    });

    canvas.addEventListener('mouseleave', function() {
      state.hoverX = null;
      state.hoverY = null;
      drawCanvas();
    });
  }

  // ── Controls ───────────────────────────────────────────────
  window._sdUndo = function() {
    state.panels.pop();
    drawCanvas();
  };

  window._sdClearAll = async function() {
    if (state.panels.length === 0) return;
    if (await window.rmConfirm('Remove all ' + state.panels.length + ' panels?')) {
      state.panels = [];
      drawCanvas();
    }
  };

  window._sdUpdatePanelSize = function() {
    state.panelW = parseInt(document.getElementById('sdPanelW').value) || 40;
    state.panelH = parseInt(document.getElementById('sdPanelH').value) || 68;
    drawCanvas();
  };

  function pixelToLatLng(px, py, centerLat, centerLng, zoom, sizePx) {
    var scale = Math.pow(2, zoom);
    function project(la, ln) {
      var siny = Math.sin(la * Math.PI / 180);
      siny = Math.min(Math.max(siny, -0.9999), 0.9999);
      return { x: 256 * (0.5 + ln / 360), y: 256 * (0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI)) };
    }
    var c = project(centerLat, centerLng);
    var wx = c.x + (px - sizePx / 2) / scale;
    var wy = c.y + (py - sizePx / 2) / scale;
    var lng = (wx / 256 - 0.5) * 360;
    var n = Math.PI - 2 * Math.PI * (wy / 256);
    var lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
    return { lat: lat, lng: lng };
  }

  window._sdSaveLayout = function() {
    if (state.saving) return;
    var btn = document.getElementById('sdSaveBtn');
    var layout = state.layout;
    var userPanels;
    if (layout && layout.image_center && state.imgDrawW > 0) {
      var srcSize = layout.image_size_px || 1600;
      var scaleToSrc = srcSize / state.imgDrawW;
      userPanels = state.panels.map(function(p) {
        var cx = (p.x + state.panelW / 2) * scaleToSrc;
        var cy = (p.y + state.panelH / 2) * scaleToSrc;
        var ll = pixelToLatLng(cx, cy, layout.image_center.lat, layout.image_center.lng, layout.image_zoom, srcSize);
        return { lat: ll.lat, lng: ll.lng, orientation: 'PORTRAIT' };
      });
    } else {
      userPanels = state.panels.map(function(p) { return { x: p.x, y: p.y, canvas_w: state.canvas && state.canvas.width, canvas_h: state.canvas && state.canvas.height, orientation: 'PORTRAIT' }; });
    }
    state.saving = true;
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Saving...'; }
    fetch('/api/customer/reports/' + state.reportId + '/panel-layout', {
      method: 'PATCH', headers: authHeaders(),
      body: JSON.stringify({ user_panels: userPanels })
    })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        state.saving = false;
        if (data.success) {
          if (btn) { btn.innerHTML = '<i class="fas fa-check mr-1"></i>Saved (' + data.panel_count + ')'; }
          setTimeout(function() { if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-cloud-upload-alt mr-1"></i>Save to Report'; } }, 1800);
        } else {
          if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-exclamation-triangle mr-1"></i>Save failed'; }
        }
      })
      .catch(function() {
        state.saving = false;
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-exclamation-triangle mr-1"></i>Save failed'; }
      });
  };

  window._sdDownload = function() {
    // Render a clean version without hover ghost for download
    var tmpHover = state.hoverX;
    state.hoverX = null;
    state.hoverY = null;
    drawCanvas();

    var canvas = state.canvas;
    if (!canvas) return;
    var link = document.createElement('a');
    link.download = 'solar-design-report-' + (state.reportId || 'unknown') + '.png';
    link.href = canvas.toDataURL('image/png');
    link.click();

    // Restore hover
    state.hoverX = tmpHover;
  };

})();

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
    mode: 'place',    // 'place' | 'obstruct'
    obstructionType: 'vent',  // vent (1ft) | chimney (3ft) | skylight (4ft)
    obstructions: [], // [{x, y, size, type}] in canvas pixels (size = side length)
    selectedSegment: null,  // index of clicked segment
    inverter: { type: 'micro', sku: 'IQ8M', count: 0 },
    battery: { sku: '', count: 0 },
    showSegments: true,
    variants: [],            // [{name, panels:[{lat,lng,orientation}], obstructions, inverter_config, battery_config}]
    activeVariantIndex: 0,
  };

  // ── Equipment catalog (hardcoded common SKUs) ──────────────
  var EQUIP = {
    micro: [
      { sku: 'IQ8+',  name: 'Enphase IQ8+',  ac_w: 290 },
      { sku: 'IQ8M',  name: 'Enphase IQ8M',  ac_w: 330 },
      { sku: 'IQ8A',  name: 'Enphase IQ8A',  ac_w: 366 },
    ],
    string: [
      { sku: 'SE3000H',  name: 'SolarEdge SE3000H-US',  kw_ac: 3.0 },
      { sku: 'SE5000H',  name: 'SolarEdge SE5000H-US',  kw_ac: 5.0 },
      { sku: 'SE7600H',  name: 'SolarEdge SE7600H-US',  kw_ac: 7.6 },
      { sku: 'SE10000H', name: 'SolarEdge SE10000H-US', kw_ac: 10.0 },
      { sku: 'SE11400H', name: 'SolarEdge SE11400H-US', kw_ac: 11.4 },
    ],
    battery: [
      { sku: 'PW3',   name: 'Tesla Powerwall 3',         kwh: 13.5, kw_peak: 11.5, max_count: 4 },
      { sku: 'IQ5P',  name: 'Enphase IQ Battery 5P',     kwh: 5.0,  kw_peak: 3.84, max_count: 4 },
    ],
  };

  // Pick the smallest string inverter where DC:AC ratio is ≤ 1.30, prefer 1.10–1.20.
  function recommendStringInverter(systemKwDc) {
    if (systemKwDc <= 0) return EQUIP.string[0];
    var best = null;
    for (var i = 0; i < EQUIP.string.length; i++) {
      var inv = EQUIP.string[i];
      var ratio = systemKwDc / inv.kw_ac;
      if (ratio >= 1.05 && ratio <= 1.30) { best = inv; break; }
    }
    return best || EQUIP.string[EQUIP.string.length - 1];  // fallback to largest
  }

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

    // Hydrate obstructions (lat/lng → canvas px). size_meters → px.
    if (Array.isArray(L.obstructions)) {
      var mpp = metersPerCanvasPx();
      state.obstructions = L.obstructions.map(function(o) {
        if (typeof o.lat === 'number' && typeof o.lng === 'number' && mpp > 0) {
          var pp = latLngToPixel(o.lat, o.lng, L.image_center.lat, L.image_center.lng, L.image_zoom, srcSize);
          var sizePx = (o.size_meters || 0.3048) / mpp;
          return { x: Math.round(pp.x * scaleToCanvas - sizePx / 2), y: Math.round(pp.y * scaleToCanvas - sizePx / 2), size: Math.round(sizePx), type: o.type || 'vent' };
        }
        return null;
      }).filter(Boolean);
    }

    // Hydrate inverter / battery
    if (L.inverter_config && L.inverter_config.sku) state.inverter = Object.assign({ count: 0 }, L.inverter_config);
    if (L.battery_config && L.battery_config.sku) state.battery = Object.assign({ count: 1 }, L.battery_config);
    populateEquipmentUI();

    // Hydrate variants. If no variants, create a single "Default" variant from current state.
    if (Array.isArray(L.variants) && L.variants.length > 0) {
      state.variants = L.variants;
      state.activeVariantIndex = Math.min(L.active_variant_index || 0, state.variants.length - 1);
      loadVariant(state.activeVariantIndex);
    } else {
      state.variants = [{
        name: 'Default',
        panels: src.map(function(p) { return { lat: p.lat, lng: p.lng, orientation: p.orientation || 'PORTRAIT' }; }),
        obstructions: (L.obstructions || []).slice(),
        inverter_config: state.inverter,
        battery_config: state.battery,
      }];
      state.activeVariantIndex = 0;
    }
    renderVariantTabs();
    updateProposalLink();

    state.hydrated = true;
    drawCanvas();
  }

  // ── Variant management ─────────────────────────────────────
  function snapshotCurrentVariant() {
    var L = state.layout;
    if (!L || !L.image_center || state.imgDrawW <= 0) return null;
    var srcSize = L.image_size_px || 1600;
    var scaleToSrc = srcSize / state.imgDrawW;
    var mpp = metersPerCanvasPx();
    var panels = state.panels.map(function(p) {
      var cx = (p.x + state.panelW / 2) * scaleToSrc;
      var cy = (p.y + state.panelH / 2) * scaleToSrc;
      var ll = pixelToLatLng(cx, cy, L.image_center.lat, L.image_center.lng, L.image_zoom, srcSize);
      return { lat: ll.lat, lng: ll.lng, orientation: 'PORTRAIT' };
    });
    var obstructions = state.obstructions.map(function(o) {
      var ccx = (o.x + o.size / 2) * scaleToSrc;
      var ccy = (o.y + o.size / 2) * scaleToSrc;
      var ll = pixelToLatLng(ccx, ccy, L.image_center.lat, L.image_center.lng, L.image_zoom, srcSize);
      return { lat: ll.lat, lng: ll.lng, size_meters: o.size * mpp, type: o.type };
    });
    return {
      panels: panels,
      obstructions: obstructions,
      inverter_config: Object.assign({}, state.inverter),
      battery_config: state.battery && state.battery.sku ? Object.assign({}, state.battery) : null,
    };
  }

  function commitCurrentVariant() {
    var snap = snapshotCurrentVariant();
    if (!snap || !state.variants[state.activeVariantIndex]) return;
    var v = state.variants[state.activeVariantIndex];
    v.panels = snap.panels;
    v.obstructions = snap.obstructions;
    v.inverter_config = snap.inverter_config;
    v.battery_config = snap.battery_config;
  }

  function loadVariant(i) {
    var v = state.variants[i];
    if (!v) return;
    state.activeVariantIndex = i;
    var L = state.layout;
    if (!L) return;
    var srcSize = L.image_size_px || 1600;
    var scaleToCanvas = state.imgDrawW / srcSize;
    state.panels = (v.panels || []).map(function(p) {
      var px = latLngToPixel(p.lat, p.lng, L.image_center.lat, L.image_center.lng, L.image_zoom, srcSize);
      return { x: Math.round(px.x * scaleToCanvas - state.panelW / 2), y: Math.round(px.y * scaleToCanvas - state.panelH / 2) };
    });
    var mpp = metersPerCanvasPx();
    state.obstructions = (v.obstructions || []).map(function(o) {
      var pp = latLngToPixel(o.lat, o.lng, L.image_center.lat, L.image_center.lng, L.image_zoom, srcSize);
      var sizePx = (o.size_meters || 0.3048) / (mpp || 0.05);
      return { x: Math.round(pp.x * scaleToCanvas - sizePx / 2), y: Math.round(pp.y * scaleToCanvas - sizePx / 2), size: Math.round(sizePx), type: o.type || 'vent' };
    });
    if (v.inverter_config && v.inverter_config.sku) state.inverter = Object.assign({ count: 0 }, v.inverter_config);
    if (v.battery_config && v.battery_config.sku) state.battery = Object.assign({ count: 1 }, v.battery_config);
    else state.battery = { sku: '', count: 0 };
    populateEquipmentUI();
    renderVariantTabs();
    drawCanvas();
  }

  function renderVariantTabs() {
    var wrap = document.getElementById('sdVariantTabs');
    if (!wrap) return;
    wrap.innerHTML = '';
    for (var i = 0; i < state.variants.length; i++) {
      var btn = document.createElement('button');
      var active = i === state.activeVariantIndex;
      btn.className = 'px-3 py-1 rounded text-xs font-semibold ' + (active ? 'bg-amber-500 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600');
      btn.textContent = state.variants[i].name + ' (' + (state.variants[i].panels || []).length + ')';
      btn.dataset.idx = i;
      btn.onclick = (function(idx) { return function() { commitCurrentVariant(); loadVariant(idx); }; })(i);
      wrap.appendChild(btn);
    }
  }

  function updateProposalLink() {
    var a = document.getElementById('sdProposalLink');
    if (a && state.reportId) a.href = '/api/reports/' + state.reportId + '/proposal';
  }

  window._sdNewVariant = function() {
    commitCurrentVariant();
    var name = prompt('Variant name (e.g. Better, Best, Battery+):', 'Variant ' + (state.variants.length + 1));
    if (!name) return;
    state.variants.push({ name: name, panels: [], obstructions: [], inverter_config: state.inverter, battery_config: null });
    state.activeVariantIndex = state.variants.length - 1;
    state.panels = []; state.obstructions = []; state.battery = { sku: '', count: 0 };
    populateEquipmentUI();
    renderVariantTabs();
    drawCanvas();
  };

  window._sdCloneVariant = function() {
    commitCurrentVariant();
    var src = state.variants[state.activeVariantIndex];
    if (!src) return;
    var name = prompt('Clone name:', src.name + ' copy');
    if (!name) return;
    state.variants.push(JSON.parse(JSON.stringify(Object.assign({}, src, { name: name }))));
    state.activeVariantIndex = state.variants.length - 1;
    loadVariant(state.activeVariantIndex);
  };

  window._sdRenameVariant = function() {
    var v = state.variants[state.activeVariantIndex];
    if (!v) return;
    var name = prompt('Rename variant:', v.name);
    if (!name) return;
    v.name = name;
    renderVariantTabs();
  };

  window._sdDeleteVariant = function() {
    if (state.variants.length <= 1) { alert('At least one variant is required.'); return; }
    if (!confirm('Delete variant "' + state.variants[state.activeVariantIndex].name + '"?')) return;
    state.variants.splice(state.activeVariantIndex, 1);
    state.activeVariantIndex = Math.max(0, state.activeVariantIndex - 1);
    loadVariant(state.activeVariantIndex);
  };

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
            '<div class="bg-gray-700/50 border border-gray-600 rounded-lg p-3">' +
              '<p class="text-xs font-bold text-amber-400 uppercase mb-2"><i class="fas fa-bolt mr-1"></i>Power Usage (kWh)</p>' +
              '<div class="grid grid-cols-3 gap-1 mb-2">' +
                ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map(function(m,i){
                  return '<div><label class="text-[9px] text-gray-400 uppercase">'+m+'</label><input type="number" id="sdUsage'+i+'" min="0" step="1" placeholder="0" class="w-full px-1 py-1 bg-gray-800 border border-gray-600 rounded text-[11px] text-center text-white"></div>';
                }).join('') +
              '</div>' +
              '<div class="flex items-center gap-2 mb-2">' +
                '<label class="text-[10px] text-gray-400 uppercase flex-1">Offset %</label>' +
                '<input type="number" id="sdOffsetPct" value="110" min="50" max="200" step="1" class="w-16 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-xs text-center text-white">' +
              '</div>' +
              '<button onclick="window._sdCalcPanels()" class="w-full bg-amber-600 hover:bg-amber-500 text-white py-1.5 rounded text-xs font-semibold"><i class="fas fa-calculator mr-1"></i>Calculate</button>' +
              '<div id="sdUsageResult" class="mt-2 text-[11px] text-gray-300 leading-tight hidden"></div>' +
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
            // Mode toggle
            '<div>' +
              '<p class="text-xs font-bold text-gray-400 uppercase mb-2">Mode</p>' +
              '<div class="grid grid-cols-2 gap-1.5">' +
                '<button id="sdModePlace" onclick="window._sdSetMode(\'place\')" class="py-1.5 rounded text-xs font-semibold bg-blue-600 text-white"><i class="fas fa-th mr-1"></i>Panels</button>' +
                '<button id="sdModeObs" onclick="window._sdSetMode(\'obstruct\')" class="py-1.5 rounded text-xs font-semibold bg-gray-700 text-gray-300"><i class="fas fa-ban mr-1"></i>Obstruct</button>' +
              '</div>' +
              '<select id="sdObsType" onchange="window._sdSetObsType(this.value)" class="hidden mt-2 w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-xs text-white">' +
                '<option value="vent">Vent (1 ft)</option>' +
                '<option value="chimney">Chimney (3 ft)</option>' +
                '<option value="skylight">Skylight (4 ft)</option>' +
              '</select>' +
            '</div>' +
            // Auto-fill
            '<div>' +
              '<p class="text-xs font-bold text-gray-400 uppercase mb-2">Auto-Fill (3 ft setback)</p>' +
              '<div class="space-y-1.5">' +
                '<button onclick="window._sdAutofillAll()" class="w-full bg-amber-600 hover:bg-amber-500 text-white py-1.5 rounded text-xs font-semibold"><i class="fas fa-magic mr-1"></i>Fill All Segments</button>' +
                '<button onclick="window._sdAutofillSelected()" id="sdAutofillSelBtn" class="w-full bg-gray-700 hover:bg-gray-600 text-white py-1.5 rounded text-xs font-semibold disabled:opacity-50" disabled><i class="fas fa-magic mr-1"></i>Fill Selected</button>' +
                '<p class="text-[10px] text-gray-500 leading-tight">Click a roof segment outline to select it.</p>' +
              '</div>' +
            '</div>' +
            // Equipment
            '<div>' +
              '<p class="text-xs font-bold text-gray-400 uppercase mb-2">Equipment</p>' +
              '<div class="space-y-2">' +
                '<select id="sdInvType" onchange="window._sdInvTypeChange(this.value)" class="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-xs text-white">' +
                  '<option value="micro">Microinverters</option>' +
                  '<option value="string">String Inverter</option>' +
                '</select>' +
                '<select id="sdInvSku" onchange="window._sdInvSkuChange(this.value)" class="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-xs text-white"></select>' +
                '<div class="border-t border-gray-700 pt-2">' +
                  '<label class="flex items-center gap-2 text-xs text-gray-300"><input type="checkbox" id="sdBatteryOn" onchange="window._sdBatteryToggle(this.checked)"> Battery storage</label>' +
                  '<div id="sdBatteryRow" class="hidden mt-2 grid grid-cols-3 gap-1.5">' +
                    '<select id="sdBatterySku" onchange="window._sdBatteryChange()" class="col-span-2 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-xs text-white"></select>' +
                    '<input type="number" id="sdBatteryQty" value="1" min="1" max="4" onchange="window._sdBatteryChange()" class="px-2 py-1 bg-gray-700 border border-gray-600 rounded text-xs text-center text-white">' +
                  '</div>' +
                '</div>' +
                '<div id="sdInvSummary" class="text-[10px] text-gray-400 leading-tight"></div>' +
              '</div>' +
            '</div>' +
            // Actions
            '<div class="space-y-2 pt-1">' +
              '<button onclick="window._sdUndo()" class="w-full bg-gray-700 hover:bg-gray-600 text-white py-2 rounded-lg text-sm font-medium transition-colors"><i class="fas fa-undo mr-1"></i>Undo</button>' +
              '<button onclick="window._sdClearAll()" class="w-full bg-red-700 hover:bg-red-600 text-white py-2 rounded-lg text-sm font-medium transition-colors"><i class="fas fa-trash mr-1"></i>Clear All</button>' +
              '<button onclick="window._sdSaveLayout()" id="sdSaveBtn" class="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-2 rounded-lg text-sm font-bold transition-colors"><i class="fas fa-cloud-upload-alt mr-1"></i>Save to Report</button>' +
              '<button onclick="window._sdDownload()" class="w-full bg-amber-500 hover:bg-amber-400 text-white py-2 rounded-lg text-sm font-bold transition-colors"><i class="fas fa-download mr-1"></i>Download PNG</button>' +
            '</div>' +
            '<p class="text-xs text-gray-500 leading-relaxed">Panels mode: click to place. Obstruct mode: click to mark vents/chimneys.</p>' +
          '</div>' +
        '</div>' +
        // Canvas area
        '<div class="flex-1 min-w-0">' +
          // Variants strip
          '<div class="bg-gray-800 rounded-xl p-3 mb-3 flex items-center gap-2 flex-wrap" id="sdVariantStrip">' +
            '<span class="text-xs font-bold text-gray-400 uppercase mr-1">Variants:</span>' +
            '<div id="sdVariantTabs" class="flex flex-wrap gap-1.5"></div>' +
            '<div class="flex-1"></div>' +
            '<button onclick="window._sdNewVariant()" class="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-semibold"><i class="fas fa-plus mr-1"></i>New</button>' +
            '<button onclick="window._sdCloneVariant()" class="px-2.5 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded text-xs font-semibold"><i class="fas fa-clone mr-1"></i>Clone</button>' +
            '<button onclick="window._sdRenameVariant()" class="px-2.5 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded text-xs font-semibold"><i class="fas fa-pen mr-1"></i>Rename</button>' +
            '<button onclick="window._sdDeleteVariant()" class="px-2.5 py-1 bg-red-700 hover:bg-red-600 text-white rounded text-xs font-semibold"><i class="fas fa-trash mr-1"></i>Delete</button>' +
            '<a id="sdProposalLink" href="#" target="_blank" class="px-2.5 py-1 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 text-white rounded text-xs font-bold"><i class="fas fa-file-pdf mr-1"></i>View Proposal</a>' +
          '</div>' +
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
    populateEquipmentUI();
    hydrateFromLayout();
  }

  // ── Equipment UI population & handlers ─────────────────────
  function populateEquipmentUI() {
    var typeSel = document.getElementById('sdInvType');
    var skuSel = document.getElementById('sdInvSku');
    var batSel = document.getElementById('sdBatterySku');
    if (!typeSel || !skuSel || !batSel) return;
    typeSel.value = state.inverter.type;
    refreshInverterSkus();
    skuSel.value = state.inverter.sku;
    batSel.innerHTML = '';
    EQUIP.battery.forEach(function(b) {
      var opt = document.createElement('option');
      opt.value = b.sku; opt.textContent = b.name + ' (' + b.kwh + ' kWh)';
      batSel.appendChild(opt);
    });
    if (state.battery.sku) {
      batSel.value = state.battery.sku;
      document.getElementById('sdBatteryOn').checked = true;
      document.getElementById('sdBatteryRow').classList.remove('hidden');
      document.getElementById('sdBatteryQty').value = state.battery.count || 1;
    }
    updateInverterSummary();
  }

  function refreshInverterSkus() {
    var skuSel = document.getElementById('sdInvSku');
    if (!skuSel) return;
    skuSel.innerHTML = '';
    var list = EQUIP[state.inverter.type] || [];
    list.forEach(function(inv) {
      var opt = document.createElement('option');
      opt.value = inv.sku;
      opt.textContent = inv.name + (inv.kw_ac ? ' (' + inv.kw_ac + ' kW)' : ' (' + inv.ac_w + ' W)');
      skuSel.appendChild(opt);
    });
    // Auto-recommend for current panel count
    var systemKw = state.panels.length * (parseInt(document.getElementById('sdWattage').value) || state.panelWattage) / 1000;
    if (state.inverter.type === 'string' && systemKw > 0) {
      state.inverter.sku = recommendStringInverter(systemKw).sku;
    } else if (!list.find(function(i) { return i.sku === state.inverter.sku; })) {
      state.inverter.sku = list[0].sku;
    }
    skuSel.value = state.inverter.sku;
  }

  function updateInverterSummary() {
    var el = document.getElementById('sdInvSummary');
    if (!el) return;
    var watt = parseInt((document.getElementById('sdWattage') || {}).value) || state.panelWattage;
    var systemKwDc = state.panels.length * watt / 1000;
    var line = '';
    if (state.inverter.type === 'micro') {
      var inv = EQUIP.micro.find(function(i) { return i.sku === state.inverter.sku; }) || EQUIP.micro[0];
      var totalAcW = state.panels.length * inv.ac_w;
      state.inverter.count = state.panels.length;
      line = state.panels.length + '× ' + inv.name + ' = ' + (totalAcW / 1000).toFixed(2) + ' kW AC';
    } else {
      var inv2 = EQUIP.string.find(function(i) { return i.sku === state.inverter.sku; }) || EQUIP.string[0];
      var ratio = inv2.kw_ac > 0 ? (systemKwDc / inv2.kw_ac).toFixed(2) : '–';
      state.inverter.count = 1;
      line = '1× ' + inv2.name + ' &middot; DC:AC ' + ratio;
    }
    if (state.battery.sku && state.battery.count > 0) {
      var b = EQUIP.battery.find(function(x) { return x.sku === state.battery.sku; });
      if (b) line += '<br>' + state.battery.count + '× ' + b.name + ' = ' + (b.kwh * state.battery.count).toFixed(1) + ' kWh';
    }
    el.innerHTML = line;
  }

  window._sdInvTypeChange = function(t) {
    state.inverter.type = t;
    refreshInverterSkus();
    updateInverterSummary();
  };
  window._sdInvSkuChange = function(s) { state.inverter.sku = s; updateInverterSummary(); };
  window._sdBatteryToggle = function(on) {
    var row = document.getElementById('sdBatteryRow');
    if (on) {
      row.classList.remove('hidden');
      state.battery.sku = EQUIP.battery[0].sku;
      state.battery.count = 1;
    } else {
      row.classList.add('hidden');
      state.battery = { sku: '', count: 0 };
    }
    updateInverterSummary();
  };
  window._sdBatteryChange = function() {
    state.battery.sku = document.getElementById('sdBatterySku').value;
    state.battery.count = parseInt(document.getElementById('sdBatteryQty').value) || 1;
    updateInverterSummary();
  };
  window._sdSetMode = function(m) {
    state.mode = m;
    document.getElementById('sdModePlace').className = 'py-1.5 rounded text-xs font-semibold ' + (m === 'place' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300');
    document.getElementById('sdModeObs').className = 'py-1.5 rounded text-xs font-semibold ' + (m === 'obstruct' ? 'bg-red-600 text-white' : 'bg-gray-700 text-gray-300');
    var obsType = document.getElementById('sdObsType');
    if (m === 'obstruct') obsType.classList.remove('hidden'); else obsType.classList.add('hidden');
    if (state.canvas) state.canvas.style.cursor = m === 'obstruct' ? 'cell' : 'crosshair';
  };
  window._sdSetObsType = function(t) { state.obstructionType = t; };

  // ── Auto-fill ──────────────────────────────────────────────
  // Project a segment bbox (lat/lng SW + NE) → axis-aligned canvas rect.
  function segmentToCanvasRect(seg) {
    if (!state.layout || !seg.sw || !seg.ne) return null;
    var L = state.layout;
    var srcSize = L.image_size_px || 1600;
    var scaleToCanvas = state.imgDrawW / srcSize;
    var sw = latLngToPixel(seg.sw.lat, seg.sw.lng, L.image_center.lat, L.image_center.lng, L.image_zoom, srcSize);
    var ne = latLngToPixel(seg.ne.lat, seg.ne.lng, L.image_center.lat, L.image_center.lng, L.image_zoom, srcSize);
    // sw has lower lng + lower lat (lat→y inverted in mercator)
    var x = Math.min(sw.x, ne.x) * scaleToCanvas;
    var y = Math.min(sw.y, ne.y) * scaleToCanvas;
    var w = Math.abs(ne.x - sw.x) * scaleToCanvas;
    var h = Math.abs(ne.y - sw.y) * scaleToCanvas;
    return { x: x, y: y, w: w, h: h };
  }

  // Meters/pixel at current view (Web Mercator, scale=2 because Static Maps).
  function metersPerCanvasPx() {
    if (!state.layout) return 0.05;
    var L = state.layout;
    var lat = L.image_center.lat || 0;
    var srcMpp = (156543.03392 * Math.cos(lat * Math.PI / 180)) / Math.pow(2, L.image_zoom) / 2; // /2 for scale=2
    var srcSize = L.image_size_px || 1600;
    return srcMpp * (srcSize / state.imgDrawW);
  }

  function rectsOverlap(a, b) {
    return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
  }

  function autofillSegment(seg, accumulated) {
    var rect = segmentToCanvasRect(seg);
    if (!rect || rect.w < 10 || rect.h < 10) return [];
    var mpp = metersPerCanvasPx();
    if (mpp <= 0) return [];

    // Setbacks: 3 ft (0.914 m) from segment edges; 1.5 ft (0.457 m) from obstructions.
    var setbackPx = 0.914 / mpp;
    var inset = {
      x: rect.x + setbackPx,
      y: rect.y + setbackPx,
      w: Math.max(0, rect.w - 2 * setbackPx),
      h: Math.max(0, rect.h - 2 * setbackPx),
    };
    if (inset.w < state.panelW || inset.h < state.panelH) return [];

    // Tile size in true meters; convert to canvas px using mpp.
    var L = state.layout;
    var pw = (L.panel_width_meters || 1.045) / mpp;
    var ph = (L.panel_height_meters || 1.879) / mpp;
    var gap = 0.152 / mpp;  // 0.5 ft inter-panel gap

    // Override the visual panelW/H so drawn panels match real-world size.
    state.panelW = Math.max(8, Math.round(pw));
    state.panelH = Math.max(12, Math.round(ph));

    var obsBuffer = 0.457 / mpp;  // 1.5 ft from obstructions
    var allObs = (accumulated || []).concat(state.obstructions || []);
    var newPanels = [];
    for (var py = inset.y; py + ph <= inset.y + inset.h + 0.5; py += ph + gap) {
      for (var px = inset.x; px + pw <= inset.x + inset.w + 0.5; px += pw + gap) {
        var cand = { x: Math.round(px), y: Math.round(py), w: pw, h: ph };
        // Skip if intersects any obstruction (with buffer)
        var blocked = false;
        for (var oi = 0; oi < allObs.length; oi++) {
          var o = allObs[oi];
          var ob = { x: o.x - obsBuffer, y: o.y - obsBuffer, w: o.size + 2 * obsBuffer, h: o.size + 2 * obsBuffer };
          if (rectsOverlap(cand, ob)) { blocked = true; break; }
        }
        if (!blocked) newPanels.push({ x: cand.x, y: cand.y });
      }
    }
    return newPanels;
  }

  window._sdAutofillAll = function() {
    if (!state.layout || !state.layout.segments || !state.layout.segments.length) {
      window.rmConfirm && window.rmConfirm('No roof segments available for this report.');
      return;
    }
    state.panels = [];
    var all = [];
    for (var i = 0; i < state.layout.segments.length; i++) {
      var added = autofillSegment(state.layout.segments[i], all);
      all = all.concat(added);
    }
    state.panels = all;
    drawCanvas();
    refreshInverterSkus();
    updateInverterSummary();
  };

  window._sdAutofillSelected = function() {
    if (state.selectedSegment === null || !state.layout || !state.layout.segments) return;
    var seg = state.layout.segments[state.selectedSegment];
    if (!seg) return;
    // Remove existing panels inside this segment's rect, then add new ones
    var rect = segmentToCanvasRect(seg);
    if (rect) {
      state.panels = state.panels.filter(function(p) {
        var pr = { x: p.x, y: p.y, w: state.panelW, h: state.panelH };
        return !rectsOverlap(pr, rect);
      });
    }
    var added = autofillSegment(seg, state.panels);
    state.panels = state.panels.concat(added);
    drawCanvas();
    refreshInverterSkus();
    updateInverterSummary();
  };

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

    // Draw segment outlines (selectable for "Fill Selected")
    if (state.layout && state.layout.segments && state.showSegments) {
      for (var si = 0; si < state.layout.segments.length; si++) {
        var seg = state.layout.segments[si];
        var r = segmentToCanvasRect(seg);
        if (!r) continue;
        var isSel = state.selectedSegment === si;
        ctx.strokeStyle = isSel ? 'rgba(251,191,36,0.95)' : 'rgba(251,191,36,0.45)';
        ctx.setLineDash(isSel ? [] : [6, 4]);
        ctx.lineWidth = isSel ? 3 : 1.5;
        ctx.strokeRect(r.x, r.y, r.w, r.h);
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(251,191,36,0.85)';
        ctx.font = 'bold 11px sans-serif';
        ctx.fillText('S' + (seg.index + 1), r.x + 4, r.y + 14);
      }
    }

    // Draw placed panels
    for (var i = 0; i < state.panels.length; i++) {
      drawPanel(ctx, state.panels[i].x, state.panels[i].y, false);
    }

    // Draw obstructions
    for (var oi = 0; oi < state.obstructions.length; oi++) {
      var o = state.obstructions[oi];
      drawObstruction(ctx, o);
    }

    // Draw hover ghost
    if (state.hoverX !== null && state.hoverY !== null) {
      ctx.globalAlpha = 0.5;
      if (state.mode === 'obstruct') {
        var sz = obstructionSizePx(state.obstructionType);
        ctx.fillStyle = 'rgba(220,38,38,0.4)';
        ctx.fillRect(state.hoverX - sz / 2, state.hoverY - sz / 2, sz, sz);
        ctx.strokeStyle = 'rgba(248,113,113,0.9)';
        ctx.lineWidth = 2;
        ctx.strokeRect(state.hoverX - sz / 2, state.hoverY - sz / 2, sz, sz);
      } else {
        drawPanel(ctx, state.hoverX - state.panelW / 2, state.hoverY - state.panelH / 2, true);
      }
      ctx.globalAlpha = 1.0;
    }

    updateStats();
  }

  function obstructionSizePx(type) {
    var ft = type === 'chimney' ? 3 : type === 'skylight' ? 4 : 1;
    var meters = ft * 0.3048;
    var mpp = metersPerCanvasPx();
    return Math.max(10, Math.round(meters / (mpp || 0.05)));
  }

  function drawObstruction(ctx, o) {
    ctx.fillStyle = 'rgba(220,38,38,0.55)';
    ctx.fillRect(o.x, o.y, o.size, o.size);
    ctx.strokeStyle = 'rgba(254,202,202,0.95)';
    ctx.lineWidth = 2;
    ctx.strokeRect(o.x, o.y, o.size, o.size);
    ctx.fillStyle = 'white';
    ctx.font = 'bold 9px sans-serif';
    var label = o.type === 'chimney' ? 'CH' : o.type === 'skylight' ? 'SK' : 'V';
    ctx.fillText(label, o.x + 3, o.y + 11);
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

      if (state.mode === 'obstruct') {
        var sz = obstructionSizePx(state.obstructionType);
        state.obstructions.push({
          x: Math.round(cx - sz / 2),
          y: Math.round(cy - sz / 2),
          size: sz,
          type: state.obstructionType,
        });
        drawCanvas();
        return;
      }

      // Segment selection: if click hits a segment outline (not inside a panel),
      // select it for "Fill Selected" — otherwise place a panel.
      if (state.layout && state.layout.segments) {
        for (var si = 0; si < state.layout.segments.length; si++) {
          var r = segmentToCanvasRect(state.layout.segments[si]);
          if (!r) continue;
          // Click within 8px of segment border = select segment, not place panel.
          var border = 8;
          var nearBorder = (
            Math.abs(cx - r.x) < border || Math.abs(cx - (r.x + r.w)) < border ||
            Math.abs(cy - r.y) < border || Math.abs(cy - (r.y + r.h)) < border
          ) && cx >= r.x - border && cx <= r.x + r.w + border && cy >= r.y - border && cy <= r.y + r.h + border;
          if (nearBorder) {
            state.selectedSegment = si;
            var btn = document.getElementById('sdAutofillSelBtn');
            if (btn) { btn.disabled = false; btn.className = 'w-full bg-amber-600 hover:bg-amber-500 text-white py-1.5 rounded text-xs font-semibold'; }
            drawCanvas();
            return;
          }
        }
      }

      state.panels.push({ x: Math.round(cx - state.panelW / 2), y: Math.round(cy - state.panelH / 2) });
      drawCanvas();
      updateInverterSummary();
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

  window._sdCalcPanels = function() {
    var total = 0;
    for (var i = 0; i < 12; i++) {
      var v = parseFloat((document.getElementById('sdUsage'+i) || {}).value) || 0;
      total += v;
    }
    var offset = parseFloat((document.getElementById('sdOffsetPct') || {}).value) || 110;
    var wattage = parseInt((document.getElementById('sdWattage') || {}).value) || state.panelWattage || 400;
    var PROD_KWH_PER_KW = 1200; // annual kWh produced per 1 kW installed (regional avg)
    var targetKwh = total * (offset / 100);
    var requiredKw = targetKwh / PROD_KWH_PER_KW;
    var panels = wattage > 0 ? Math.ceil((requiredKw * 1000) / wattage) : 0;
    var systemKw = (panels * wattage) / 1000;
    var out = document.getElementById('sdUsageResult');
    if (out) {
      out.classList.remove('hidden');
      out.innerHTML =
        '<div class="flex justify-between"><span class="text-gray-400">Annual usage</span><span class="font-bold text-white">' + total.toLocaleString() + ' kWh</span></div>' +
        '<div class="flex justify-between"><span class="text-gray-400">Target (' + offset + '%)</span><span class="font-bold text-white">' + Math.round(targetKwh).toLocaleString() + ' kWh</span></div>' +
        '<div class="flex justify-between"><span class="text-gray-400">Panels needed</span><span class="font-bold text-amber-400">' + panels + ' × ' + wattage + 'W</span></div>' +
        '<div class="flex justify-between"><span class="text-gray-400">System size</span><span class="font-bold text-amber-400">' + systemKw.toFixed(2) + ' kW</span></div>';
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
    // Convert obstructions → lat/lng + size_meters
    var obstructions = [];
    if (layout && layout.image_center && state.imgDrawW > 0) {
      var srcSize2 = layout.image_size_px || 1600;
      var scaleToSrc2 = srcSize2 / state.imgDrawW;
      var mpp = metersPerCanvasPx();
      obstructions = state.obstructions.map(function(o) {
        var ccx = (o.x + o.size / 2) * scaleToSrc2;
        var ccy = (o.y + o.size / 2) * scaleToSrc2;
        var ll = pixelToLatLng(ccx, ccy, layout.image_center.lat, layout.image_center.lng, layout.image_zoom, srcSize2);
        return { lat: ll.lat, lng: ll.lng, size_meters: o.size * mpp, type: o.type };
      });
    }
    commitCurrentVariant();
    fetch('/api/customer/reports/' + state.reportId + '/panel-layout', {
      method: 'PATCH', headers: authHeaders(),
      body: JSON.stringify({
        user_panels: userPanels,
        obstructions: obstructions,
        inverter_config: state.inverter,
        battery_config: state.battery && state.battery.sku ? state.battery : null,
        variants: state.variants,
        active_variant_index: state.activeVariantIndex,
      })
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

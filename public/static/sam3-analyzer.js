// ============================================================
// Roof Manager — SAM 3 Satellite Image Analyzer Frontend
//
// Interactive satellite image viewer with AI-powered roof
// segmentation overlay (SAM 3 + Gemini pipeline).
//
// Features:
//   - Satellite image viewer with zoom/pan
//   - One-click SAM 3 + Gemini roof analysis
//   - SVG overlay showing segments, edges, measurements
//   - Toggle segment layers (facets, edges, obstructions)
//   - Confidence scores & pipeline tier breakdown
//   - Export annotated image as SVG
//
// Hooks into: /api/sam3/:orderId/sam3-analyze
//             /api/sam3/:orderId/sam3-results
//             /api/sam3/:orderId/sam3-annotate
//             /api/sam3/sam3-capabilities
// ============================================================

(function () {
  'use strict';

  var root = document.getElementById('sam3-root');
  if (!root) return;

  var token = localStorage.getItem('rc_customer_token') || localStorage.getItem('adminToken') || '';

  // ── State ──
  var state = {
    orderId: null,
    loading: false,
    analyzing: false,
    error: null,
    capabilities: null,
    analysis: null,
    annotatedSvg: null,
    satelliteImageUrl: null,
    layers: {
      facets: true,
      edges: true,
      measurements: true,
      obstructions: true,
      legend: true,
    },
    zoom: 1,
    panX: 0,
    panY: 0,
    pipelineLog: [],
  };

  // Extract orderId from URL or data attribute
  state.orderId = root.getAttribute('data-order-id') || new URLSearchParams(window.location.search).get('orderId') || '';

  // ── API Helper ──
  function api(method, path, body) {
    var opts = {
      method: method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    if (body) opts.body = JSON.stringify(body);
    return fetch('/api/sam3' + path, opts).then(function (r) { return r.json(); });
  }

  // ── Render ──
  function render() {
    if (!root) return;

    if (!state.orderId) {
      renderOrderSelector();
    } else if (state.analyzing) {
      renderAnalyzing();
    } else if (state.analysis) {
      renderAnalysisViewer();
    } else {
      renderStartAnalysis();
    }
  }

  // ════════════════════════════════════════════════════════
  // ORDER SELECTOR (when no orderId given)
  // ════════════════════════════════════════════════════════

  function renderOrderSelector() {
    root.innerHTML =
      '<div class="max-w-lg mx-auto">' +
        '<div class="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">' +
          '<div class="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-8 py-8 text-center">' +
            '<div class="w-16 h-16 bg-gradient-to-br from-teal-400 to-cyan-500 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-teal-500/30">' +
              '<i class="fas fa-satellite text-white text-2xl"></i>' +
            '</div>' +
            '<h2 class="text-2xl font-extrabold text-white mb-2">SAM 3 Roof Analyzer</h2>' +
            '<p class="text-slate-300 text-sm">AI-powered satellite image segmentation using Meta SAM 3 + Google Gemini</p>' +
          '</div>' +
          '<div class="p-6 space-y-4">' +
            '<div>' +
              '<label class="text-sm font-bold text-gray-700 block mb-1.5">Enter Order ID</label>' +
              '<input id="sam3-order-input" type="text" placeholder="e.g., 42" class="w-full px-4 py-3 border border-gray-200 rounded-xl focus:border-teal-500 focus:ring-2 focus:ring-teal-100 outline-none text-sm bg-gray-50">' +
            '</div>' +
            '<button onclick="window._sam3SelectOrder()" class="w-full py-3 bg-gradient-to-r from-teal-600 to-cyan-600 text-white font-bold rounded-xl hover:from-teal-700 hover:to-cyan-700 shadow-lg transition-all text-sm">' +
              '<i class="fas fa-search mr-2"></i>Load Satellite Image' +
            '</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  window._sam3SelectOrder = function () {
    var input = document.getElementById('sam3-order-input');
    if (input && input.value) {
      state.orderId = input.value.trim();
      checkExistingResults();
    }
  };

  // ════════════════════════════════════════════════════════
  // START ANALYSIS VIEW
  // ════════════════════════════════════════════════════════

  function renderStartAnalysis() {
    var capHtml = '';
    if (state.capabilities) {
      var cap = state.capabilities;
      capHtml =
        '<div class="bg-slate-50 rounded-xl border border-gray-200 p-4 mb-4">' +
          '<h4 class="font-bold text-gray-700 text-xs mb-3 uppercase tracking-wider"><i class="fas fa-cog mr-1 text-teal-500"></i>Pipeline Capabilities</h4>' +
          '<div class="grid grid-cols-3 gap-2">' +
            buildCapCard('SAM 3', cap.sam3?.available, 'Tier 1', 'fa-brain') +
            buildCapCard('Gemini', cap.gemini?.available, 'Tier 2', 'fa-eye') +
            buildCapCard('RANSAC', cap.ransac?.available, 'Tier 3', 'fa-ruler-combined') +
          '</div>' +
        '</div>';
    }

    root.innerHTML =
      '<div class="max-w-2xl mx-auto">' +
        '<div class="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">' +

          '<div class="bg-gradient-to-r from-slate-800 to-slate-900 px-6 py-4 flex items-center justify-between">' +
            '<div class="flex items-center gap-3">' +
              '<div class="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-400 to-cyan-500 flex items-center justify-center">' +
                '<i class="fas fa-satellite text-white text-lg"></i>' +
              '</div>' +
              '<div>' +
                '<h3 class="text-white font-bold">SAM 3 Roof Analyzer</h3>' +
                '<p class="text-slate-400 text-xs">Order #' + state.orderId + '</p>' +
              '</div>' +
            '</div>' +
            '<button onclick="window._sam3ChangeOrder()" class="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs font-bold transition-colors"><i class="fas fa-exchange-alt mr-1"></i>Change</button>' +
          '</div>' +

          '<div class="p-6">' +

            // Satellite image preview placeholder
            '<div class="bg-gray-100 rounded-xl border border-gray-200 mb-5 overflow-hidden" style="aspect-ratio: 1;">' +
              '<div class="w-full h-full flex items-center justify-center">' +
                '<div class="text-center">' +
                  '<i class="fas fa-satellite-dish text-gray-300 text-4xl mb-3"></i>' +
                  '<p class="text-gray-400 text-sm font-medium">Satellite image will load from report data</p>' +
                  '<p class="text-gray-300 text-xs">Google Solar API • zoom 20</p>' +
                '</div>' +
              '</div>' +
            '</div>' +

            capHtml +

            (state.error ?
              '<div class="bg-red-50 border border-red-200 rounded-xl p-3 mb-4">' +
                '<p class="text-red-600 text-sm"><i class="fas fa-exclamation-triangle mr-1"></i>' + state.error + '</p>' +
              '</div>'
            : '') +

            // Pipeline description
            '<div class="bg-gradient-to-r from-teal-50 to-cyan-50 border border-teal-200 rounded-xl p-4 mb-5">' +
              '<h4 class="font-bold text-teal-800 text-sm mb-2"><i class="fas fa-project-diagram mr-1"></i>Multi-Tier Pipeline</h4>' +
              '<div class="space-y-2 text-xs text-teal-700">' +
                '<div class="flex items-center gap-2"><span class="w-5 h-5 rounded bg-teal-600 text-white flex items-center justify-center text-[9px] font-bold">1</span>SAM 3 — Instance segmentation (270K concepts)</div>' +
                '<div class="flex items-center gap-2"><span class="w-5 h-5 rounded bg-teal-500 text-white flex items-center justify-center text-[9px] font-bold">2</span>Gemini — Architectural reasoning (pitch, material, condition)</div>' +
                '<div class="flex items-center gap-2"><span class="w-5 h-5 rounded bg-teal-400 text-white flex items-center justify-center text-[9px] font-bold">3</span>RANSAC — Geometric edge classification (fallback)</div>' +
              '</div>' +
              '<p class="text-[10px] text-teal-600 mt-2">Results are fused: SAM 3 masks + Gemini reasoning = best accuracy.</p>' +
            '</div>' +

            // Run buttons
            '<div class="space-y-2">' +
              '<button onclick="window._sam3RunAnalysis()" class="w-full py-3.5 bg-gradient-to-r from-teal-600 to-cyan-600 text-white font-bold rounded-xl hover:from-teal-700 hover:to-cyan-700 shadow-lg shadow-teal-500/20 transition-all text-sm">' +
                '<i class="fas fa-brain mr-2"></i>Run SAM 3 + Gemini Analysis' +
              '</button>' +
              '<button onclick="window._sam3RunFullPipeline()" class="w-full py-3 bg-white border-2 border-teal-200 text-teal-700 font-bold rounded-xl hover:bg-teal-50 transition-all text-sm">' +
                '<i class="fas fa-project-diagram mr-2"></i>Run Full Auto-Fallback Pipeline' +
              '</button>' +
            '</div>' +

          '</div>' +
        '</div>' +
      '</div>';
  }

  function buildCapCard(name, available, tier, icon) {
    return '<div class="bg-white rounded-lg p-2.5 text-center border border-gray-100">' +
      '<div class="w-8 h-8 rounded-lg ' + (available ? 'bg-teal-100' : 'bg-gray-100') + ' flex items-center justify-center mx-auto mb-1.5">' +
        '<i class="fas ' + icon + ' ' + (available ? 'text-teal-600' : 'text-gray-400') + ' text-sm"></i>' +
      '</div>' +
      '<p class="text-xs font-bold ' + (available ? 'text-gray-800' : 'text-gray-400') + '">' + name + '</p>' +
      '<p class="text-[9px] ' + (available ? 'text-teal-600' : 'text-gray-400') + '">' + tier + ' &bull; ' + (available ? 'Ready' : 'Not configured') + '</p>' +
    '</div>';
  }

  // ════════════════════════════════════════════════════════
  // ANALYZING STATE
  // ════════════════════════════════════════════════════════

  function renderAnalyzing() {
    root.innerHTML =
      '<div class="max-w-lg mx-auto">' +
        '<div class="bg-white rounded-2xl shadow-xl border border-gray-100 p-10 text-center">' +
          '<div class="relative w-24 h-24 mx-auto mb-8">' +
            '<div class="absolute inset-0 rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-500 animate-pulse opacity-20"></div>' +
            '<div class="absolute inset-1 rounded-[14px] bg-white"></div>' +
            '<div class="absolute inset-2 rounded-xl bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center">' +
              '<i class="fas fa-brain text-white text-2xl animate-pulse"></i>' +
            '</div>' +
            '<div class="absolute -top-1 -right-1 w-6 h-6 bg-cyan-400 rounded-full animate-ping"></div>' +
          '</div>' +
          '<h3 class="text-xl font-bold text-gray-900 mb-2">Analyzing Satellite Image</h3>' +
          '<p class="text-gray-500 text-sm mb-6">SAM 3 + Gemini pipeline running on your satellite imagery...</p>' +
          '<div class="space-y-2 text-left max-w-xs mx-auto">' +
            '<div class="flex items-center gap-2 px-3 py-2 bg-teal-50 rounded-lg animate-pulse"><i class="fas fa-satellite text-teal-500 text-xs"></i><span class="text-xs text-teal-700">Fetching satellite image from Google Solar API</span></div>' +
            '<div class="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg"><i class="fas fa-brain text-gray-400 text-xs"></i><span class="text-xs text-gray-500">Running SAM 3 instance segmentation</span></div>' +
            '<div class="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg"><i class="fas fa-eye text-gray-400 text-xs"></i><span class="text-xs text-gray-500">Gemini structured segmentation</span></div>' +
            '<div class="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg"><i class="fas fa-project-diagram text-gray-400 text-xs"></i><span class="text-xs text-gray-500">Fusing results & computing measurements</span></div>' +
          '</div>' +
          '<p class="text-[10px] text-gray-400 mt-6">This usually takes 10-30 seconds depending on pipeline tiers.</p>' +
        '</div>' +
      '</div>';
  }

  // ════════════════════════════════════════════════════════
  // ANALYSIS VIEWER — Main result view with satellite + overlay
  // ════════════════════════════════════════════════════════

  function renderAnalysisViewer() {
    var a = state.analysis;
    if (!a) return;

    var summary = a.summary || {};
    var segments = a.enriched_segments || [];
    var edges = a.edges_detected || [];
    var obstructions = a.obstructions_detected || [];
    var tiers = a.tiers_attempted || [];

    // Layer toggles
    var layerToggles = [
      { key: 'facets', label: 'Facets', icon: 'fa-shapes', count: segments.length },
      { key: 'edges', label: 'Edges', icon: 'fa-ruler', count: edges.length },
      { key: 'measurements', label: 'Labels', icon: 'fa-tag', count: '' },
      { key: 'obstructions', label: 'Obstructions', icon: 'fa-exclamation', count: obstructions.length },
      { key: 'legend', label: 'Legend', icon: 'fa-list', count: '' },
    ].map(function (t) {
      var active = state.layers[t.key];
      return '<button onclick="window._sam3ToggleLayer(\'' + t.key + '\')" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ' +
        (active ? 'bg-teal-100 text-teal-700 border border-teal-200' : 'bg-gray-100 text-gray-400 border border-gray-200 hover:bg-gray-200') + '">' +
        '<i class="fas ' + t.icon + '"></i>' + t.label + (t.count ? ' (' + t.count + ')' : '') +
      '</button>';
    }).join('');

    // Pipeline tier badges
    var tierBadges = tiers.map(function (t) {
      var names = { 1: 'SAM 3', 2: 'Gemini', 3: 'RANSAC' };
      var colors = { 1: 'bg-blue-100 text-blue-700', 2: 'bg-purple-100 text-purple-700', 3: 'bg-amber-100 text-amber-700' };
      return '<span class="px-2 py-0.5 ' + (colors[t] || 'bg-gray-100') + ' text-[10px] rounded-full font-bold">' + (names[t] || 'T' + t) + '</span>';
    }).join(' ');

    // Segment details table
    var segTable = '';
    if (segments.length > 0) {
      segTable = '<div class="bg-gray-50 rounded-xl border border-gray-200 p-3 mt-3">' +
        '<h5 class="font-bold text-gray-700 text-xs mb-2 uppercase tracking-wider"><i class="fas fa-th mr-1 text-teal-500"></i>Detected Segments</h5>' +
        '<div class="overflow-x-auto"><table class="w-full text-[10px]">' +
          '<thead><tr class="text-gray-500 border-b border-gray-200">' +
            '<th class="pb-1.5 text-left font-bold">ID</th>' +
            '<th class="pb-1.5 text-left font-bold">Type</th>' +
            '<th class="pb-1.5 text-right font-bold">Area (SF)</th>' +
            '<th class="pb-1.5 text-right font-bold">Pitch</th>' +
            '<th class="pb-1.5 text-left font-bold">Material</th>' +
            '<th class="pb-1.5 text-right font-bold">Conf.</th>' +
            '<th class="pb-1.5 text-left font-bold">Source</th>' +
          '</tr></thead><tbody>';

      for (var i = 0; i < Math.min(segments.length, 20); i++) {
        var s = segments[i];
        var sourceColor = s.source === 'fused' ? 'text-teal-600' : (s.source === 'gemini' ? 'text-purple-600' : (s.source === 'sam3' ? 'text-blue-600' : 'text-amber-600'));
        segTable += '<tr class="border-b border-gray-100">' +
          '<td class="py-1.5 font-bold text-gray-700">' + String.fromCharCode(65 + i) + '</td>' +
          '<td class="py-1.5 text-gray-600 capitalize">' + (s.type || '—').replace('_', ' ') + '</td>' +
          '<td class="py-1.5 text-right font-mono font-bold text-gray-700">' + (s.area_sqft ? Math.round(s.area_sqft).toLocaleString() : '—') + '</td>' +
          '<td class="py-1.5 text-right text-gray-600">' + (s.estimated_pitch_label || s.estimated_pitch_deg + '°' || '—') + '</td>' +
          '<td class="py-1.5 text-gray-600 capitalize">' + (s.material_type || '—').replace('_', ' ') + '</td>' +
          '<td class="py-1.5 text-right font-mono">' + (s.confidence ? (s.confidence * 100).toFixed(0) + '%' : '—') + '</td>' +
          '<td class="py-1.5 ' + sourceColor + ' font-bold capitalize">' + (s.source || '—') + '</td>' +
        '</tr>';
      }

      segTable += '</tbody></table></div></div>';
    }

    root.innerHTML =
      '<div class="max-w-6xl mx-auto space-y-4">' +

        // Header
        '<div class="bg-gradient-to-r from-slate-800 to-slate-900 rounded-2xl shadow-xl overflow-hidden">' +
          '<div class="px-6 py-4 flex items-center justify-between">' +
            '<div class="flex items-center gap-4">' +
              '<div class="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-400 to-cyan-500 flex items-center justify-center shadow-lg">' +
                '<i class="fas fa-satellite text-white text-lg"></i>' +
              '</div>' +
              '<div>' +
                '<h3 class="text-lg font-extrabold text-white">SAM 3 Analysis — Order #' + state.orderId + '</h3>' +
                '<div class="flex items-center gap-2 mt-0.5">' + tierBadges + '<span class="text-slate-400 text-[10px]">&bull; ' + (a.processing_time_ms || 0) + 'ms</span></div>' +
              '</div>' +
            '</div>' +
            '<div class="flex gap-2">' +
              '<button onclick="window._sam3ReAnalyze()" class="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold transition-colors"><i class="fas fa-redo mr-1"></i>Re-Analyze</button>' +
              '<button onclick="window._sam3ExportSvg()" class="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold transition-colors shadow-lg"><i class="fas fa-download mr-1"></i>Export SVG</button>' +
            '</div>' +
          '</div>' +
        '</div>' +

        // Main grid
        '<div class="grid grid-cols-1 lg:grid-cols-3 gap-4">' +

          // Left: Image + Overlay (2 cols)
          '<div class="lg:col-span-2">' +
            '<div class="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">' +
              '<div class="bg-gray-800 px-4 py-2 flex items-center justify-between">' +
                '<div class="flex gap-1.5">' + layerToggles + '</div>' +
                '<div class="flex gap-1">' +
                  '<button onclick="window._sam3Zoom(0.2)" class="w-7 h-7 rounded bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-xs"><i class="fas fa-plus"></i></button>' +
                  '<button onclick="window._sam3Zoom(-0.2)" class="w-7 h-7 rounded bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-xs"><i class="fas fa-minus"></i></button>' +
                  '<button onclick="window._sam3ResetView()" class="w-7 h-7 rounded bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-xs"><i class="fas fa-compress-arrows-alt"></i></button>' +
                '</div>' +
              '</div>' +
              // Image container
              '<div class="relative bg-gray-900 overflow-hidden" style="aspect-ratio: 1;">' +
                '<div id="sam3-image-container" style="transform: scale(' + state.zoom + ') translate(' + state.panX + 'px,' + state.panY + 'px); transition: transform 0.2s; transform-origin: center;">' +
                  (state.annotatedSvg ?
                    '<div class="w-full h-full">' + state.annotatedSvg + '</div>'
                  :
                    '<div class="w-full h-full flex items-center justify-center">' +
                      '<div class="text-center">' +
                        '<i class="fas fa-map-marked-alt text-gray-600 text-3xl mb-2"></i>' +
                        '<p class="text-gray-500 text-xs">Annotated satellite overlay</p>' +
                        '<button onclick="window._sam3GenerateAnnotation()" class="mt-3 px-4 py-2 bg-teal-600 text-white rounded-lg text-xs font-bold hover:bg-teal-700"><i class="fas fa-palette mr-1"></i>Generate Overlay</button>' +
                      '</div>' +
                    '</div>'
                  ) +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>' +

          // Right: Summary + Details (1 col)
          '<div class="space-y-4">' +

            // Summary card
            '<div class="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">' +
              '<div class="bg-gradient-to-r from-gray-800 to-gray-900 px-4 py-2.5">' +
                '<h4 class="font-bold text-white text-sm"><i class="fas fa-chart-bar text-teal-300 mr-2"></i>Measurement Summary</h4>' +
              '</div>' +
              '<div class="p-4">' +
                '<div class="grid grid-cols-2 gap-2 mb-3">' +
                  buildStatCard('Total Area', summary.total_area_sqft ? Math.round(summary.total_area_sqft).toLocaleString() + ' SF' : 'N/A', 'fa-th') +
                  buildStatCard('Pitch', summary.predominant_pitch_label || 'N/A', 'fa-angle-double-up') +
                  buildStatCard('Facets', (summary.num_facets || segments.length || 0).toString(), 'fa-shapes') +
                  buildStatCard('Complexity', (summary.complexity || 'N/A'), 'fa-sitemap') +
                '</div>' +
                '<div class="bg-gray-50 rounded-xl p-3">' +
                  '<h5 class="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Linear Measurements</h5>' +
                  '<div class="grid grid-cols-2 gap-1.5 text-[10px]">' +
                    buildLinearRow('Ridge', summary.ridge_lf, '#DC2626') +
                    buildLinearRow('Hip', summary.hip_lf, '#EA580C') +
                    buildLinearRow('Valley', summary.valley_lf, '#2563EB') +
                    buildLinearRow('Eave', summary.eave_lf, '#16A34A') +
                    buildLinearRow('Rake', summary.rake_lf, '#7C3AED') +
                    buildLinearRow('Total LF', summary.total_linear_ft, '#1E293B') +
                  '</div>' +
                '</div>' +
              '</div>' +
            '</div>' +

            // Pipeline log
            (state.pipelineLog.length > 0 ?
              '<div class="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">' +
                '<div class="bg-gradient-to-r from-gray-800 to-gray-900 px-4 py-2.5">' +
                  '<h4 class="font-bold text-white text-sm"><i class="fas fa-clipboard-list text-teal-300 mr-2"></i>Pipeline Log</h4>' +
                '</div>' +
                '<div class="p-3 space-y-1.5">' +
                  state.pipelineLog.slice(0, 10).map(function (log) {
                    var statusIcon = log.status === 'success' ? '<i class="fas fa-check-circle text-green-500"></i>' :
                      (log.status === 'error' ? '<i class="fas fa-times-circle text-red-500"></i>' :
                        '<i class="fas fa-info-circle text-gray-400"></i>');
                    return '<div class="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg">' +
                      '<div class="flex items-center gap-2">' +
                        statusIcon +
                        '<span class="text-xs font-bold text-gray-700">' + (log.tier_name || 'T' + log.tier) + '</span>' +
                      '</div>' +
                      '<div class="flex items-center gap-2">' +
                        (log.segments_found ? '<span class="text-[10px] text-gray-500">' + log.segments_found + ' seg</span>' : '') +
                        (log.processing_time_ms ? '<span class="text-[10px] text-gray-400">' + log.processing_time_ms + 'ms</span>' : '') +
                        (log.confidence ? '<span class="text-[10px] font-mono text-teal-600">' + (log.confidence * 100).toFixed(0) + '%</span>' : '') +
                      '</div>' +
                    '</div>';
                  }).join('') +
                '</div>' +
              '</div>'
            : '') +

          '</div>' +
        '</div>' +

        // Segment table (full width)
        (segments.length > 0 ?
          '<div class="bg-white rounded-2xl shadow-lg border border-gray-100 p-5">' +
            segTable +
          '</div>'
        : '') +

        // Footer
        '<div class="text-center pb-2">' +
          '<p class="text-[10px] text-gray-400"><i class="fas fa-info-circle mr-1"></i>SAM 3 + Gemini analysis is AI-estimated. GSD-based measurements depend on imagery resolution and zoom level. Powered by Roof Manager.</p>' +
        '</div>' +

      '</div>';
  }

  function buildStatCard(label, value, icon) {
    return '<div class="bg-gray-50 rounded-lg p-2.5 text-center border border-gray-100">' +
      '<div class="text-[10px] text-gray-400 mb-0.5"><i class="fas ' + icon + ' mr-1"></i>' + label + '</div>' +
      '<p class="text-sm font-extrabold text-gray-800">' + value + '</p>' +
    '</div>';
  }

  function buildLinearRow(label, value, color) {
    return '<div class="flex items-center justify-between py-0.5">' +
      '<div class="flex items-center gap-1.5">' +
        '<div class="w-2.5 h-2.5 rounded-sm" style="background:' + color + '"></div>' +
        '<span class="text-gray-600 font-medium">' + label + '</span>' +
      '</div>' +
      '<span class="font-mono font-bold text-gray-800">' + (value ? Math.round(value) + ' LF' : '—') + '</span>' +
    '</div>';
  }

  // ════════════════════════════════════════════════════════
  // API ACTIONS
  // ════════════════════════════════════════════════════════

  function checkExistingResults() {
    state.loading = true;
    render();

    // Check capabilities + existing results in parallel
    Promise.all([
      api('GET', '/sam3-capabilities'),
      api('GET', '/' + state.orderId + '/sam3-results'),
    ]).then(function (results) {
      state.loading = false;
      if (results[0].success) {
        state.capabilities = results[0].capabilities;
      }
      if (results[1].success && results[1].analysis) {
        state.analysis = results[1].analysis;
        state.pipelineLog = results[1].pipeline_log || [];
        if (results[1].analysis.annotated_svg) {
          state.annotatedSvg = results[1].analysis.annotated_svg;
        }
      }
      render();
    }).catch(function () {
      state.loading = false;
      render();
    });
  }

  window._sam3RunAnalysis = function () {
    state.analyzing = true;
    state.error = null;
    render();

    api('POST', '/' + state.orderId + '/sam3-analyze')
      .then(function (res) {
        state.analyzing = false;
        if (res.success) {
          // Re-fetch full results
          return api('GET', '/' + state.orderId + '/sam3-results');
        } else {
          state.error = res.error || 'Analysis failed';
          render();
          return null;
        }
      })
      .then(function (res) {
        if (res && res.success) {
          state.analysis = res.analysis;
          state.pipelineLog = res.pipeline_log || [];
          // Auto-generate annotation
          window._sam3GenerateAnnotation();
        }
        render();
      })
      .catch(function (err) {
        state.analyzing = false;
        state.error = err.message;
        render();
      });
  };

  window._sam3RunFullPipeline = function () {
    state.analyzing = true;
    state.error = null;
    render();

    api('POST', '/' + state.orderId + '/auto-pipeline')
      .then(function (res) {
        state.analyzing = false;
        if (res.success) {
          return api('GET', '/' + state.orderId + '/sam3-results');
        } else {
          state.error = res.error || 'Pipeline failed';
          render();
          return null;
        }
      })
      .then(function (res) {
        if (res && res.success) {
          state.analysis = res.analysis;
          state.pipelineLog = res.pipeline_log || [];
          window._sam3GenerateAnnotation();
        }
        render();
      })
      .catch(function (err) {
        state.analyzing = false;
        state.error = err.message;
        render();
      });
  };

  window._sam3GenerateAnnotation = function () {
    api('POST', '/' + state.orderId + '/sam3-annotate')
      .then(function (res) {
        if (res.success && res.annotated_svg) {
          state.annotatedSvg = res.annotated_svg;
          render();
        }
      }).catch(function () {});
  };

  window._sam3ReAnalyze = function () {
    state.analysis = null;
    state.annotatedSvg = null;
    state.pipelineLog = [];
    window._sam3RunAnalysis();
  };

  window._sam3ChangeOrder = function () {
    state.orderId = null;
    state.analysis = null;
    state.annotatedSvg = null;
    state.capabilities = null;
    state.pipelineLog = [];
    render();
  };

  window._sam3ToggleLayer = function (key) {
    state.layers[key] = !state.layers[key];
    render();
  };

  window._sam3Zoom = function (delta) {
    state.zoom = Math.max(0.5, Math.min(3, state.zoom + delta));
    var container = document.getElementById('sam3-image-container');
    if (container) {
      container.style.transform = 'scale(' + state.zoom + ') translate(' + state.panX + 'px,' + state.panY + 'px)';
    }
  };

  window._sam3ResetView = function () {
    state.zoom = 1;
    state.panX = 0;
    state.panY = 0;
    var container = document.getElementById('sam3-image-container');
    if (container) {
      container.style.transform = 'scale(1)';
    }
  };

  window._sam3ExportSvg = function () {
    if (!state.annotatedSvg) return;
    var blob = new Blob([state.annotatedSvg], { type: 'image/svg+xml' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'sam3-analysis-order-' + state.orderId + '.svg';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ── Initialize ──
  if (state.orderId) {
    checkExistingResults();
  } else {
    render();
  }
})();

// ============================================================
// Roof Manager — Roof Visualizer
//
// Flow:
//   1. Upload 4–6 house photos (labeled by corner/side)
//   2. AI (Gemini) analyzes photos → returns roof geometry
//   3. SVG house diagram + material/color picker (instant preview)
//   4. Optional: AI photo preview via Replicate inpainting
//      (mask editor → Replicate → before/after result)
// ============================================================

(function () {
  'use strict';

  var root = document.getElementById('tryon-root');
  var token = localStorage.getItem('rc_customer_token') || '';

  // ── State ──────────────────────────────────────────────────
  var state = {
    step: 1,         // 1=upload, 2=analyzing, 3=visualizer, 4=mask, 5=processing, 6=result
    photos: [],      // [{label, dataUrl, base64, mimeType}]
    geometry: null,  // from Gemini
    style: 'asphalt',
    colorHex: '#4a4a4a',
    colorLabel: 'Charcoal Grey',
    // AI preview
    aiPhotoIdx: 0,
    maskBase64: null,
    jobId: null,
    resultUrl: null,
    errorMsg: null,
    pollTimer: null,
    brushSize: 30,
    isErasing: false,
  };

  // Canvas refs for mask step
  var imgCanvas, imgCtx, maskCanvas, maskCtx, overlayCanvas, overlayCtx;

  // ── API helper ─────────────────────────────────────────────
  function api(method, path, body) {
    var opts = { method: method, headers: { 'Content-Type': 'application/json' } };
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    if (body) opts.body = JSON.stringify(body);
    return fetch('/api/virtual-tryon' + path, opts).then(function (r) { return r.json(); });
  }

  // ── Render router ──────────────────────────────────────────
  function render() {
    switch (state.step) {
      case 1: renderUpload(); break;
      case 2: renderAnalyzing(); break;
      case 3: renderVisualizer(); break;
      case 4: renderMaskEditor(); break;
      case 5: renderProcessing(); break;
      case 6: renderResult(); break;
    }
  }

  // ── Data ───────────────────────────────────────────────────
  var PHOTO_SLOTS = [
    { id: 'front-left',  label: 'Front Left',  icon: 'fa-sign-out-alt fa-flip-horizontal' },
    { id: 'front-right', label: 'Front Right', icon: 'fa-sign-out-alt' },
    { id: 'back-left',   label: 'Back Left',   icon: 'fa-sign-out-alt fa-flip-horizontal' },
    { id: 'back-right',  label: 'Back Right',  icon: 'fa-sign-out-alt' },
    { id: 'side-left',   label: 'Left Side',   icon: 'fa-arrows-alt-h' },
    { id: 'side-right',  label: 'Right Side',  icon: 'fa-arrows-alt-h' },
  ];

  var MATERIALS = [
    { id: 'asphalt', label: 'Architectural Shingles', icon: 'fa-home' },
    { id: 'metal',   label: 'Standing Seam Metal',    icon: 'fa-industry' },
    { id: 'tile',    label: 'Clay / Concrete Tile',   icon: 'fa-building' },
    { id: 'slate',   label: 'Natural Slate',          icon: 'fa-gem' },
    { id: 'cedar',   label: 'Cedar Shake',            icon: 'fa-tree' },
  ];

  var COLORS = [
    { hex: '#4a4a4a', label: 'Charcoal Grey' },
    { hex: '#1e1e1e', label: 'Matte Black' },
    { hex: '#5c3d2e', label: 'Dark Bronze' },
    { hex: '#2d6a2d', label: 'Forest Green' },
    { hex: '#8b1a1a', label: 'Barn Red' },
    { hex: '#3a5570', label: 'Slate Blue' },
    { hex: '#5a7a6a', label: 'Aged Copper' },
    { hex: '#9a9a9a', label: 'Galvalume Silver' },
    { hex: '#c8a87a', label: 'Sandstone Tan' },
    { hex: '#7a4a2a', label: 'Cedar Brown' },
  ];

  function slotLabel(id) {
    var s = PHOTO_SLOTS.find(function (x) { return x.id === id; });
    return s ? s.label : id;
  }
  function matLabel(id) {
    var m = MATERIALS.find(function (x) { return x.id === id; });
    return m ? m.label : id;
  }
  function cap(str) { return str ? str.charAt(0).toUpperCase() + str.slice(1) : ''; }

  // ════════════════════════════════════════════════════════
  // STEP 1: Multi-photo upload
  // ════════════════════════════════════════════════════════

  function renderUpload() {
    var uploaded = state.photos.length;
    var canGo = uploaded >= 2;

    root.innerHTML =
      '<div class="max-w-4xl mx-auto space-y-4">' +

        // Header
        '<div class="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">' +
          '<div class="flex items-start gap-4">' +
            '<div class="w-14 h-14 bg-gradient-to-br from-violet-500 to-purple-700 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-lg">' +
              '<i class="fas fa-house-user text-white text-2xl"></i>' +
            '</div>' +
            '<div>' +
              '<h2 class="text-xl font-bold text-gray-900">Roof Visualizer</h2>' +
              '<p class="text-gray-500 text-sm mt-1">Upload 4–6 photos of your house from each corner. Our AI will analyze the structure and let you instantly preview different roofing materials and colors.</p>' +
            '</div>' +
          '</div>' +
        '</div>' +

        // Photo grid
        '<div class="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">' +
          '<div class="flex items-center justify-between mb-4">' +
            '<h3 class="font-semibold text-gray-800 text-sm"><i class="fas fa-camera text-violet-500 mr-2"></i>House Photos</h3>' +
            '<span class="text-xs text-gray-400">' + uploaded + ' / 6 uploaded</span>' +
          '</div>' +
          '<div class="grid grid-cols-2 md:grid-cols-3 gap-3">' +
            PHOTO_SLOTS.map(function (slot) {
              var photo = state.photos.find(function (p) { return p.label === slot.id; });
              return '<div>' +
                (photo
                  ? '<div class="relative rounded-xl overflow-hidden border-2 border-violet-400">' +
                      '<img src="' + photo.dataUrl + '" class="w-full h-32 object-cover">' +
                      '<div class="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent"></div>' +
                      '<p class="absolute bottom-2 left-2 text-white text-xs font-medium">' + slot.label + '</p>' +
                      '<button onclick="window._vizRemove(\'' + slot.id + '\')" class="absolute top-2 right-2 w-7 h-7 bg-red-500 hover:bg-red-600 text-white rounded-full text-xs flex items-center justify-center"><i class="fas fa-times"></i></button>' +
                    '</div>'
                  : '<label class="block cursor-pointer">' +
                      '<input type="file" accept="image/*" class="hidden" onchange="window._vizFile(this,\'' + slot.id + '\')">' +
                      '<div class="border-2 border-dashed border-gray-200 rounded-xl h-32 flex flex-col items-center justify-center hover:border-violet-400 hover:bg-violet-50 transition-all">' +
                        '<i class="fas fa-plus text-gray-300 text-2xl mb-2"></i>' +
                        '<p class="text-xs font-medium text-gray-400">' + slot.label + '</p>' +
                      '</div>' +
                    '</label>'
                ) +
              '</div>';
            }).join('') +
          '</div>' +
          (!canGo ? '<p class="text-center text-xs text-amber-600 mt-4"><i class="fas fa-info-circle mr-1"></i>Upload at least 2 photos to continue</p>' : '') +
        '</div>' +

        // Analyze button
        '<button onclick="window._vizAnalyze()" ' +
          (canGo ? '' : 'disabled ') +
          'class="w-full py-4 rounded-2xl font-bold text-lg shadow-lg transition-all ' +
          (canGo ? 'bg-gradient-to-r from-violet-600 to-purple-700 text-white hover:from-violet-700 hover:to-purple-800' : 'bg-gray-100 text-gray-400 cursor-not-allowed') + '">' +
          '<i class="fas fa-wand-magic-sparkles mr-2"></i>Analyze My House' +
        '</button>' +

      '</div>';
  }

  window._vizFile = function (input, slotId) {
    if (!input.files || !input.files[0]) return;
    var file = input.files[0];
    if (file.size > 20 * 1024 * 1024) { alert('Max 20MB per photo.'); return; }
    var reader = new FileReader();
    reader.onload = function (e) {
      // Compress to max 1024px before storing (display + Gemini analysis + Replicate)
      var img = new Image();
      img.onload = function () {
        var maxDim = 1024;
        var scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        var cv = document.createElement('canvas');
        cv.width = Math.round(img.width * scale);
        cv.height = Math.round(img.height * scale);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        var dataUrl = cv.toDataURL('image/jpeg', 0.88);
        state.photos = state.photos.filter(function (p) { return p.label !== slotId; });
        state.photos.push({ label: slotId, dataUrl: dataUrl, base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' });
        render();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  };

  window._vizRemove = function (slotId) {
    state.photos = state.photos.filter(function (p) { return p.label !== slotId; });
    render();
  };

  window._vizAnalyze = function () {
    if (state.photos.length < 2) return;
    state.step = 2;
    render();
  };

  // ════════════════════════════════════════════════════════
  // STEP 2: Analyzing (Gemini Vision call)
  // ════════════════════════════════════════════════════════

  function renderAnalyzing() {
    root.innerHTML =
      '<div class="max-w-lg mx-auto">' +
        '<div class="bg-white rounded-2xl shadow-sm border border-gray-200 p-12 text-center">' +
          '<div class="relative w-24 h-24 mx-auto mb-6">' +
            '<div class="absolute inset-0 rounded-full border-4 border-gray-100"></div>' +
            '<div class="absolute inset-0 rounded-full border-4 border-t-violet-500 border-r-purple-500 border-b-transparent border-l-transparent animate-spin"></div>' +
            '<div class="absolute inset-3 bg-gradient-to-br from-violet-500 to-purple-700 rounded-full flex items-center justify-center">' +
              '<i class="fas fa-house-user text-white text-2xl"></i>' +
            '</div>' +
          '</div>' +
          '<h3 class="text-xl font-bold text-gray-900 mb-2">Analyzing Your House</h3>' +
          '<p class="text-sm text-gray-500 mb-6">AI is studying your photos...</p>' +
          '<div class="space-y-3 text-left max-w-xs mx-auto" id="checkList">' +
            '<div id="chk0" class="flex items-center gap-3 text-sm text-gray-400"><div class="w-5 h-5 rounded-full border-2 border-gray-200 flex-shrink-0 animate-pulse"></div>Identifying roof type...</div>' +
            '<div id="chk1" class="flex items-center gap-3 text-sm text-gray-400"><div class="w-5 h-5 rounded-full border-2 border-gray-200 flex-shrink-0"></div>Measuring proportions...</div>' +
            '<div id="chk2" class="flex items-center gap-3 text-sm text-gray-400"><div class="w-5 h-5 rounded-full border-2 border-gray-200 flex-shrink-0"></div>Detecting house features...</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    function tick(id, text, delay) {
      setTimeout(function () {
        var el = document.getElementById(id);
        if (el) el.innerHTML = '<div class="w-5 h-5 rounded-full bg-green-400 flex-shrink-0 flex items-center justify-center"><i class="fas fa-check text-white" style="font-size:9px"></i></div><span class="text-green-700 font-medium">' + text + '</span>';
      }, delay);
    }
    tick('chk0', 'Roof type identified', 1400);
    tick('chk1', 'Proportions measured', 2600);

    var images = state.photos.map(function (p) {
      return { label: p.label, base64: p.base64, mimeType: p.mimeType };
    });

    api('POST', '/analyze-house', { images: images })
      .then(function (res) {
        state.geometry = (res.success && res.geometry) ? res.geometry : defaultGeo();
        tick('chk2', 'Features detected', 0);
        setTimeout(function () { state.step = 3; render(); }, 700);
      })
      .catch(function () {
        state.geometry = defaultGeo();
        state.step = 3;
        render();
      });
  }

  function defaultGeo() {
    return { roof_type: 'gable', pitch_estimate: 'medium', stories: 1, width_depth_ratio: 1.6, num_facets: 2, house_style: 'ranch' };
  }

  // ════════════════════════════════════════════════════════
  // STEP 3: Visualizer — SVG diagram + material/color picker
  // ════════════════════════════════════════════════════════

  function renderVisualizer() {
    var geo = state.geometry || defaultGeo();

    root.innerHTML =
      '<div class="max-w-5xl mx-auto space-y-4">' +

        // Main visualizer card
        '<div class="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">' +

          // Header bar
          '<div class="flex items-center justify-between px-5 py-3 border-b border-gray-100 bg-gray-50">' +
            '<div>' +
              '<h3 class="font-bold text-gray-900 text-sm"><i class="fas fa-house-user text-violet-500 mr-2"></i>Roof Visualizer</h3>' +
              '<p class="text-xs text-gray-400 mt-0.5">' +
                cap(geo.roof_type) + ' roof · ' + cap(geo.pitch_estimate) + ' pitch' +
                (geo.stories ? ' · ' + geo.stories + (geo.stories === 1 ? ' story' : ' stories') : '') +
              '</p>' +
            '</div>' +
            '<button onclick="window._vizGoUpload()" class="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"><i class="fas fa-arrow-left"></i>New Photos</button>' +
          '</div>' +

          // Two-column layout
          '<div class="grid grid-cols-1 md:grid-cols-5">' +

            // SVG diagram panel (3 cols)
            '<div class="md:col-span-3 bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center p-6 min-h-64">' +
              '<div class="w-full max-w-lg" id="svgWrap">' +
                buildHouseSVG(geo, state.style, state.colorHex) +
              '</div>' +
            '</div>' +

            // Controls panel (2 cols)
            '<div class="md:col-span-2 p-5 border-t md:border-t-0 md:border-l border-gray-100 flex flex-col gap-4">' +

              // Material picker
              '<div>' +
                '<h4 class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Roof Material</h4>' +
                '<div class="space-y-1">' +
                  MATERIALS.map(function (m) {
                    var sel = m.id === state.style;
                    return '<button onclick="window._vizStyle(\'' + m.id + '\')" class="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all ' +
                      (sel ? 'bg-violet-50 border-2 border-violet-400 text-violet-700 font-semibold' : 'border-2 border-transparent text-gray-600 hover:bg-gray-50') + '">' +
                      '<i class="fas ' + m.icon + ' w-4 text-center ' + (sel ? 'text-violet-500' : 'text-gray-400') + '"></i>' +
                      m.label +
                      (sel ? '<i class="fas fa-check-circle text-violet-400 ml-auto text-xs"></i>' : '') +
                    '</button>';
                  }).join('') +
                '</div>' +
              '</div>' +

              // Color picker
              '<div>' +
                '<h4 class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Color</h4>' +
                '<div class="grid grid-cols-5 gap-1.5">' +
                  COLORS.map(function (col) {
                    var sel = col.hex === state.colorHex;
                    return '<button onclick="window._vizColor(\'' + col.hex + '\',\'' + col.label + '\')" title="' + col.label + '" class="relative rounded-lg border-2 p-0.5 transition-all ' +
                      (sel ? 'border-violet-500 shadow-md scale-110' : 'border-transparent hover:border-gray-300') + '">' +
                      '<div class="w-full aspect-square rounded-md shadow-inner" style="background:' + col.hex + '"></div>' +
                      (sel ? '<div class="absolute inset-0 flex items-center justify-center"><i class="fas fa-check text-white text-[9px] drop-shadow-sm"></i></div>' : '') +
                    '</button>';
                  }).join('') +
                '</div>' +
                '<p class="text-xs text-gray-500 mt-2 font-medium">' + state.colorLabel + '</p>' +
              '</div>' +

              // Selected summary + AI button
              '<div class="mt-auto pt-2">' +
                '<div class="flex items-center gap-2 p-3 bg-gray-50 rounded-xl border border-gray-200 mb-3">' +
                  '<div class="w-6 h-6 rounded-full border border-gray-300 flex-shrink-0 shadow-inner" style="background:' + state.colorHex + '"></div>' +
                  '<div>' +
                    '<p class="text-xs font-semibold text-gray-700">' + matLabel(state.style) + '</p>' +
                    '<p class="text-xs text-gray-400">' + state.colorLabel + '</p>' +
                  '</div>' +
                '</div>' +
                (state.photos.length > 0
                  ? '<button onclick="window._vizOpenAI(0)" class="w-full py-2.5 bg-gradient-to-r from-violet-600 to-purple-700 text-white rounded-xl font-semibold text-sm hover:from-violet-700 hover:to-purple-800 shadow transition-all">' +
                      '<i class="fas fa-magic mr-1.5"></i>Generate AI Photo Preview' +
                    '</button>'
                  : ''
                ) +
              '</div>' +

            '</div>' +
          '</div>' +
        '</div>' +

        // Photo gallery with hover tint
        (state.photos.length > 0
          ? '<div class="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">' +
              '<h3 class="font-semibold text-gray-800 text-sm mb-3"><i class="fas fa-images text-violet-500 mr-2"></i>Your House — Click to Generate AI Preview</h3>' +
              '<div class="grid grid-cols-2 md:grid-cols-3 gap-3">' +
                state.photos.map(function (photo, idx) {
                  return '<div class="relative rounded-xl overflow-hidden border border-gray-200 cursor-pointer group hover:shadow-lg transition-shadow" onclick="window._vizOpenAI(' + idx + ')">' +
                    '<img src="' + photo.dataUrl + '" class="w-full h-36 object-cover group-hover:scale-105 transition-transform duration-300">' +
                    '<div class="absolute inset-0 transition-opacity duration-200" style="background:' + state.colorHex + ';mix-blend-mode:multiply;opacity:0"></div>' +
                    '<div class="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent"></div>' +
                    '<div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">' +
                      '<span class="bg-violet-600 text-white text-xs px-3 py-1.5 rounded-full font-semibold shadow"><i class="fas fa-magic mr-1"></i>AI Preview</span>' +
                    '</div>' +
                    '<p class="absolute bottom-2 left-2 text-white text-xs font-medium">' + slotLabel(photo.label) + '</p>' +
                  '</div>';
                }).join('') +
              '</div>' +
              '<p class="text-xs text-center text-gray-400 mt-3"><i class="fas fa-info-circle mr-1"></i>AI preview paints the roof area with your chosen material using Stable Diffusion</p>' +
            '</div>'
          : ''
        ) +

      '</div>';
  }

  window._vizStyle = function (s) { state.style = s; renderVisualizer(); };
  window._vizColor = function (hex, label) { state.colorHex = hex; state.colorLabel = label; renderVisualizer(); };
  window._vizGoUpload = function () { state.step = 1; render(); };
  window._vizOpenAI = function (idx) {
    state.aiPhotoIdx = idx;
    state.maskBase64 = null;
    state.step = 4;
    render();
  };

  // ════════════════════════════════════════════════════════
  // SVG HOUSE DIAGRAM BUILDER
  // ════════════════════════════════════════════════════════

  function buildHouseSVG(geo, style, colorHex) {
    var type = (geo.roof_type || 'gable').toLowerCase();
    var pitch = (geo.pitch_estimate || 'medium').toLowerCase();
    var stories = parseInt(geo.stories) || 1;

    var W = 500, H = 370;
    var hL = 65, hR = 435;
    var hW = hR - hL;
    var mid = (hL + hR) / 2;
    var wallTop = stories >= 2 ? 185 : 215;
    var wallBot = 330;

    // Roof apex height
    var apexDrop = pitch === 'steep' ? 95 : (pitch === 'low' ? 38 : 68);
    var apexY = wallTop - apexDrop;

    var fill = colorHex;
    var dark = darken(colorHex, 0.28);
    var mid2 = darken(colorHex, 0.12);
    var patId = 'rp_' + style;

    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" class="w-full" style="filter:drop-shadow(0 4px 16px rgba(0,0,0,0.14))">' +
      '<defs>' + patternDef(patId, style, colorHex) + '</defs>' +
      '<ellipse cx="' + mid + '" cy="352" rx="185" ry="11" fill="rgba(0,0,0,0.07)"/>';

    if (type === 'hip') {
      svg += roofHip(hL, hR, mid, wallTop, apexY, fill, dark, patId);
    } else if (type === 'flat') {
      svg += roofFlat(hL, hR, wallTop, fill, dark, patId);
    } else if (type === 'shed') {
      svg += roofShed(hL, hR, wallTop, apexY, fill, dark, patId);
    } else {
      svg += roofGable(hL, hR, mid, wallTop, apexY, fill, dark, patId, type);
    }

    // House walls
    svg += '<rect x="' + hL + '" y="' + wallTop + '" width="' + hW + '" height="' + (wallBot - wallTop) + '" fill="#f7f3ec" stroke="#c8b898" stroke-width="2"/>';

    // Facade details (windows + door)
    svg += facade(hL, hW, wallTop, wallBot, stories);

    // Foundation strip
    svg += '<rect x="' + (hL - 10) + '" y="' + wallBot + '" width="' + (hW + 20) + '" height="13" fill="#d6c9a8" stroke="#bfad8a" stroke-width="1" rx="2"/>';

    svg += '</svg>';
    return svg;
  }

  // ── Roof shapes ────────────────────────────────────────

  function roofGable(l, r, mid, wallTop, apexY, fill, dark, patId, type) {
    var o = '';
    // Shadow triangle below eave (depth effect)
    o += '<polygon points="' + l + ',' + wallTop + ' ' + r + ',' + wallTop + ' ' + (r + 14) + ',' + (wallTop + 10) + ' ' + (l - 14) + ',' + (wallTop + 10) + '" fill="rgba(0,0,0,0.06)"/>';
    // Main roof surface
    o += '<polygon points="' + l + ',' + wallTop + ' ' + mid + ',' + apexY + ' ' + r + ',' + wallTop + '" fill="' + fill + '"/>';
    // Material texture overlay
    o += '<polygon points="' + l + ',' + wallTop + ' ' + mid + ',' + apexY + ' ' + r + ',' + wallTop + '" fill="url(#' + patId + ')" opacity="0.45"/>';
    // Edges
    o += '<polyline points="' + (l - 6) + ',' + (wallTop + 1) + ' ' + mid + ',' + (apexY - 2) + ' ' + (r + 6) + ',' + (wallTop + 1) + '" stroke="' + dark + '" stroke-width="2.5" fill="none" stroke-linejoin="round"/>';
    // Fascia / eave board
    o += '<line x1="' + (l - 8) + '" y1="' + wallTop + '" x2="' + (r + 8) + '" y2="' + wallTop + '" stroke="#8b7355" stroke-width="4.5" stroke-linecap="round"/>';
    // Ridge cap
    o += '<circle cx="' + mid + '" cy="' + apexY + '" r="4" fill="' + dark + '"/>';
    return o;
  }

  function roofHip(l, r, mid, wallTop, apexY, fill, dark, patId) {
    var rL = mid - 90, rR = mid + 90;
    var o = '';
    o += '<polygon points="' + l + ',' + wallTop + ' ' + r + ',' + wallTop + ' ' + (r + 14) + ',' + (wallTop + 10) + ' ' + (l - 14) + ',' + (wallTop + 10) + '" fill="rgba(0,0,0,0.06)"/>';
    // Front face (trapezoid)
    o += '<polygon points="' + l + ',' + wallTop + ' ' + r + ',' + wallTop + ' ' + rR + ',' + apexY + ' ' + rL + ',' + apexY + '" fill="' + fill + '"/>';
    o += '<polygon points="' + l + ',' + wallTop + ' ' + r + ',' + wallTop + ' ' + rR + ',' + apexY + ' ' + rL + ',' + apexY + '" fill="url(#' + patId + ')" opacity="0.45"/>';
    // Left hip panel (darker)
    o += '<polygon points="' + l + ',' + wallTop + ' ' + rL + ',' + apexY + ' ' + l + ',' + (apexY + 18) + '" fill="' + dark + '" opacity="0.25"/>';
    // Right hip panel
    o += '<polygon points="' + r + ',' + wallTop + ' ' + rR + ',' + apexY + ' ' + r + ',' + (apexY + 18) + '" fill="' + dark + '" opacity="0.25"/>';
    // Ridge line
    o += '<line x1="' + rL + '" y1="' + apexY + '" x2="' + rR + '" y2="' + apexY + '" stroke="' + dark + '" stroke-width="3.5" stroke-linecap="round"/>';
    // Hip lines
    o += '<line x1="' + l + '" y1="' + wallTop + '" x2="' + rL + '" y2="' + apexY + '" stroke="' + dark + '" stroke-width="2"/>';
    o += '<line x1="' + r + '" y1="' + wallTop + '" x2="' + rR + '" y2="' + apexY + '" stroke="' + dark + '" stroke-width="2"/>';
    // Fascia
    o += '<line x1="' + (l - 8) + '" y1="' + wallTop + '" x2="' + (r + 8) + '" y2="' + wallTop + '" stroke="#8b7355" stroke-width="4.5" stroke-linecap="round"/>';
    return o;
  }

  function roofFlat(l, r, wallTop, fill, dark, patId) {
    var rTop = wallTop - 18;
    var o = '';
    o += '<rect x="' + (l - 12) + '" y="' + rTop + '" width="' + (r - l + 24) + '" height="18" fill="' + fill + '"/>';
    o += '<rect x="' + (l - 12) + '" y="' + rTop + '" width="' + (r - l + 24) + '" height="18" fill="url(#' + patId + ')" opacity="0.45"/>';
    o += '<line x1="' + (l - 14) + '" y1="' + rTop + '" x2="' + (r + 14) + '" y2="' + rTop + '" stroke="' + dark + '" stroke-width="3" stroke-linecap="round"/>';
    o += '<line x1="' + (l - 14) + '" y1="' + wallTop + '" x2="' + (r + 14) + '" y2="' + wallTop + '" stroke="#8b7355" stroke-width="4.5" stroke-linecap="round"/>';
    return o;
  }

  function roofShed(l, r, wallTop, apexY, fill, dark, patId) {
    var highY = apexY;
    var lowY = wallTop;
    var o = '';
    o += '<polygon points="' + (l - 8) + ',' + lowY + ' ' + l + ',' + highY + ' ' + r + ',' + highY + ' ' + (r + 8) + ',' + lowY + '" fill="' + fill + '"/>';
    o += '<polygon points="' + (l - 8) + ',' + lowY + ' ' + l + ',' + highY + ' ' + r + ',' + highY + ' ' + (r + 8) + ',' + lowY + '" fill="url(#' + patId + ')" opacity="0.45"/>';
    o += '<line x1="' + (l - 10) + '" y1="' + lowY + '" x2="' + (r + 10) + '" y2="' + highY + '" stroke="' + dark + '" stroke-width="2.5"/>';
    o += '<line x1="' + (l - 10) + '" y1="' + lowY + '" x2="' + (r + 10) + '" y2="' + lowY + '" stroke="#8b7355" stroke-width="4.5" stroke-linecap="round"/>';
    return o;
  }

  // ── Facade (windows + door) ─────────────────────────────

  function facade(l, w, wallTop, wallBot, stories) {
    var mid = l + w / 2;
    var wH = wallBot - wallTop;
    var trim = '#8b7355';
    var o = '';

    if (stories >= 2) {
      var floorY = wallTop + wH * 0.46;
      o += '<line x1="' + l + '" y1="' + floorY + '" x2="' + (l + w) + '" y2="' + floorY + '" stroke="#d6c6a6" stroke-width="1.5"/>';
      // Upper floor windows
      o += win(l + w * 0.12, wallTop + wH * 0.07, 58, 46, trim);
      o += win(l + w * 0.60, wallTop + wH * 0.07, 58, 46, trim);
      // Lower floor windows
      o += win(l + w * 0.10, wallTop + wH * 0.56, 58, 48, trim);
      o += win(l + w * 0.62, wallTop + wH * 0.56, 58, 48, trim);
      // Door
      o += door(mid - 28, wallTop + wH * 0.58, 56, wH * 0.42, trim);
    } else {
      o += win(l + w * 0.10, wallTop + wH * 0.20, 66, 54, trim);
      o += win(l + w * 0.64, wallTop + wH * 0.20, 66, 54, trim);
      o += door(mid - 28, wallTop + wH * 0.38, 56, wH * 0.62, trim);
    }
    return o;
  }

  function win(x, y, w, h, trim) {
    return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="#b8dce8" stroke="' + trim + '" stroke-width="2" rx="2"/>' +
      '<line x1="' + (x + w / 2) + '" y1="' + y + '" x2="' + (x + w / 2) + '" y2="' + (y + h) + '" stroke="' + trim + '" stroke-width="1.5"/>' +
      '<line x1="' + x + '" y1="' + (y + h / 2) + '" x2="' + (x + w) + '" y2="' + (y + h / 2) + '" stroke="' + trim + '" stroke-width="1.5"/>';
  }

  function door(x, y, w, h, trim) {
    return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + trim + '" stroke="#5d4037" stroke-width="1.5" rx="3"/>' +
      '<circle cx="' + (x + w * 0.73) + '" cy="' + (y + h * 0.5) + '" r="4" fill="#e0a030"/>';
  }

  // ── Material pattern SVG defs ───────────────────────────

  function patternDef(id, style, hex) {
    var d = darken(hex, 0.38);
    switch (style) {
      case 'metal':
        return '<pattern id="' + id + '" patternUnits="userSpaceOnUse" width="400" height="10">' +
          '<line x1="0" y1="5" x2="400" y2="5" stroke="' + d + '" stroke-width="1.8"/>' +
        '</pattern>';
      case 'tile':
        return '<pattern id="' + id + '" patternUnits="userSpaceOnUse" width="22" height="16">' +
          '<path d="M0,16 Q11,6 22,16" fill="none" stroke="' + d + '" stroke-width="1.6"/>' +
          '<path d="M-11,8 Q0,-2 11,8" fill="none" stroke="' + d + '" stroke-width="1.6"/>' +
        '</pattern>';
      case 'slate':
        return '<pattern id="' + id + '" patternUnits="userSpaceOnUse" width="26" height="14">' +
          '<rect x="1" y="1" width="24" height="12" fill="none" stroke="' + d + '" stroke-width="1"/>' +
          '<line x1="13" y1="1" x2="13" y2="13" stroke="' + d + '" stroke-width="0.5" opacity="0.5"/>' +
        '</pattern>';
      case 'cedar':
        return '<pattern id="' + id + '" patternUnits="userSpaceOnUse" width="10" height="400">' +
          '<line x1="0" y1="0" x2="0" y2="400" stroke="' + d + '" stroke-width="1.2"/>' +
          '<line x1="5" y1="0" x2="5" y2="400" stroke="' + d + '" stroke-width="0.6" opacity="0.6"/>' +
        '</pattern>';
      default: // asphalt
        return '<pattern id="' + id + '" patternUnits="userSpaceOnUse" width="12" height="12">' +
          '<path d="M0,12 L12,0" stroke="' + d + '" stroke-width="1.2"/>' +
          '<path d="M-2,2 L2,-2" stroke="' + d + '" stroke-width="1.2"/>' +
          '<path d="M10,14 L14,10" stroke="' + d + '" stroke-width="1.2"/>' +
        '</pattern>';
    }
  }

  // ── Color helpers ───────────────────────────────────────

  function darken(hex, amt) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    var r = Math.max(0, Math.round(parseInt(hex.slice(0,2),16) * (1-amt)));
    var g = Math.max(0, Math.round(parseInt(hex.slice(2,4),16) * (1-amt)));
    var b = Math.max(0, Math.round(parseInt(hex.slice(4,6),16) * (1-amt)));
    return '#'+r.toString(16).padStart(2,'0')+g.toString(16).padStart(2,'0')+b.toString(16).padStart(2,'0');
  }

  // ════════════════════════════════════════════════════════
  // STEP 4: Mask Editor (AI photo preview)
  // ════════════════════════════════════════════════════════

  function renderMaskEditor() {
    var photo = state.photos[state.aiPhotoIdx];
    if (!photo) { state.step = 3; render(); return; }
    var img = new Image();
    img.onload = function () {
      var scale = Math.min(1, 720 / img.width, 520 / img.height);
      var w = Math.round(img.width * scale);
      var h = Math.round(img.height * scale);
      buildMaskUI(img, w, h, photo);
    };
    img.src = photo.dataUrl;
  }

  function buildMaskUI(img, w, h, photo) {
    var selMat = matLabel(state.style);
    root.innerHTML =
      '<div class="max-w-4xl mx-auto">' +
        '<div class="bg-white rounded-2xl shadow-sm border border-gray-200 p-4">' +
          '<div class="flex items-center justify-between mb-3">' +
            '<div>' +
              '<h3 class="font-bold text-gray-900 text-sm"><i class="fas fa-paint-brush text-violet-500 mr-2"></i>Paint the Roof Area</h3>' +
              '<p class="text-sm text-gray-500">Paint over the roof — AI will replace it with <strong>' + state.colorLabel + ' ' + selMat + '</strong>.</p>' +
            '</div>' +
            '<button onclick="window._vizBackTo3()" class="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"><i class="fas fa-arrow-left"></i>Back</button>' +
          '</div>' +
          '<div class="flex flex-wrap items-center gap-2 mb-3 p-3 bg-gray-50 rounded-xl">' +
            '<button id="mBrush" onclick="window._vizBrush(false)" class="px-3 py-1.5 rounded-lg text-sm font-medium bg-violet-600 text-white"><i class="fas fa-paint-brush mr-1"></i>Brush</button>' +
            '<button id="mEraser" onclick="window._vizBrush(true)" class="px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-200 text-gray-700"><i class="fas fa-eraser mr-1"></i>Eraser</button>' +
            '<div class="flex items-center gap-2">' +
              '<span class="text-xs text-gray-400">Size:</span>' +
              '<input type="range" id="mSize" min="5" max="80" value="' + state.brushSize + '" class="w-24 accent-violet-500" oninput="window._vizBrushSz(this.value)">' +
              '<span id="mSzLbl" class="text-xs font-mono text-gray-400 w-6">' + state.brushSize + '</span>' +
            '</div>' +
            '<button onclick="window._vizClearM()" class="px-3 py-1.5 rounded-lg text-sm font-medium bg-red-100 text-red-600"><i class="fas fa-trash mr-1"></i>Clear</button>' +
            '<div class="flex-1"></div>' +
            '<button onclick="window._vizDoAI()" class="px-5 py-2 rounded-xl text-sm font-bold bg-violet-600 text-white hover:bg-violet-700 shadow">' +
              '<i class="fas fa-magic mr-1"></i>Generate Preview' +
            '</button>' +
          '</div>' +
          '<div id="cvWrap" class="relative mx-auto border border-gray-200 rounded-xl overflow-hidden cursor-crosshair" style="width:' + w + 'px;height:' + h + 'px;max-width:100%">' +
            '<canvas id="cvImg" width="' + w + '" height="' + h + '" class="absolute inset-0"></canvas>' +
            '<canvas id="cvMask" width="' + w + '" height="' + h + '" class="absolute inset-0" style="opacity:0"></canvas>' +
            '<canvas id="cvOver" width="' + w + '" height="' + h + '" class="absolute inset-0"></canvas>' +
          '</div>' +
          '<p class="text-xs text-center text-gray-400 mt-2">Purple overlay = area AI will replace</p>' +
        '</div>' +
      '</div>';

    imgCanvas    = document.getElementById('cvImg');   imgCtx    = imgCanvas.getContext('2d');
    maskCanvas   = document.getElementById('cvMask');  maskCtx   = maskCanvas.getContext('2d');
    overlayCanvas = document.getElementById('cvOver'); overlayCtx = overlayCanvas.getContext('2d');

    imgCtx.drawImage(img, 0, 0, w, h);
    maskCtx.fillStyle = '#000'; maskCtx.fillRect(0, 0, w, h);

    // Drawing events
    var drawing = false, lx = 0, ly = 0;
    function pt(e) {
      var rect = overlayCanvas.getBoundingClientRect();
      var sx = overlayCanvas.width / rect.width, sy = overlayCanvas.height / rect.height;
      var cx = e.touches ? e.touches[0].clientX : e.clientX;
      var cy = e.touches ? e.touches[0].clientY : e.clientY;
      return { x: (cx - rect.left) * sx, y: (cy - rect.top) * sy };
    }
    function dot(x, y) {
      var r = state.brushSize / 2;
      var op = state.isErasing ? 'destination-out' : 'source-over';
      maskCtx.globalCompositeOperation = op;
      maskCtx.fillStyle = '#fff'; maskCtx.beginPath(); maskCtx.arc(x, y, r, 0, Math.PI*2); maskCtx.fill();
      overlayCtx.globalCompositeOperation = op;
      overlayCtx.fillStyle = 'rgba(168,85,247,0.38)'; overlayCtx.beginPath(); overlayCtx.arc(x, y, r, 0, Math.PI*2); overlayCtx.fill();
    }
    function stroke(x1,y1,x2,y2) {
      var d = Math.hypot(x2-x1,y2-y1), steps = Math.max(1,Math.floor(d/3));
      for (var i = 0; i <= steps; i++) { var t=i/steps; dot(x1+(x2-x1)*t, y1+(y2-y1)*t); }
    }
    overlayCanvas.addEventListener('mousedown',  function(e){drawing=true;var p=pt(e);lx=p.x;ly=p.y;dot(p.x,p.y);});
    overlayCanvas.addEventListener('mousemove',  function(e){if(!drawing)return;var p=pt(e);stroke(lx,ly,p.x,p.y);lx=p.x;ly=p.y;});
    overlayCanvas.addEventListener('mouseup',    function(){drawing=false;});
    overlayCanvas.addEventListener('mouseleave', function(){drawing=false;});
    overlayCanvas.addEventListener('touchstart', function(e){e.preventDefault();drawing=true;var p=pt(e);lx=p.x;ly=p.y;dot(p.x,p.y);},{passive:false});
    overlayCanvas.addEventListener('touchmove',  function(e){e.preventDefault();if(!drawing)return;var p=pt(e);stroke(lx,ly,p.x,p.y);lx=p.x;ly=p.y;},{passive:false});
    overlayCanvas.addEventListener('touchend',   function(){drawing=false;});
  }

  window._vizBrush = function(erase) {
    state.isErasing = erase;
    document.getElementById('mBrush').className  = erase ? 'px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-200 text-gray-700' : 'px-3 py-1.5 rounded-lg text-sm font-medium bg-violet-600 text-white';
    document.getElementById('mEraser').className = erase ? 'px-3 py-1.5 rounded-lg text-sm font-medium bg-violet-600 text-white' : 'px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-200 text-gray-700';
  };
  window._vizBrushSz = function(v) { state.brushSize = parseInt(v); var el=document.getElementById('mSzLbl'); if(el) el.textContent=v; };
  window._vizClearM  = function() {
    if(maskCtx){maskCtx.fillStyle='#000';maskCtx.fillRect(0,0,maskCanvas.width,maskCanvas.height);}
    if(overlayCtx) overlayCtx.clearRect(0,0,overlayCanvas.width,overlayCanvas.height);
  };
  window._vizDoAI = function() {
    var data = maskCtx.getImageData(0,0,maskCanvas.width,maskCanvas.height).data;
    var wp = 0; for(var i=0;i<data.length;i+=4){if(data[i]>128)wp++;}
    if(wp/(maskCanvas.width*maskCanvas.height) < 0.01){alert('Paint over the roof area first.');return;}
    state.maskBase64 = maskCanvas.toDataURL('image/png');
    state.step = 5; render();
  };
  window._vizBackTo3 = function() { state.step = 3; render(); };

  // ════════════════════════════════════════════════════════
  // STEP 5: AI Processing (Replicate)
  // ════════════════════════════════════════════════════════

  function renderProcessing() {
    var photo = state.photos[state.aiPhotoIdx];
    var selMat = matLabel(state.style);
    root.innerHTML =
      '<div class="max-w-md mx-auto">' +
        '<div class="bg-white rounded-2xl shadow-sm border border-gray-200 p-10 text-center">' +
          '<div class="relative w-20 h-20 mx-auto mb-5">' +
            '<div class="absolute inset-0 rounded-full border-4 border-gray-100"></div>' +
            '<div class="absolute inset-0 rounded-full border-4 border-t-violet-500 border-r-purple-500 border-b-transparent border-l-transparent animate-spin"></div>' +
            '<div class="absolute inset-2.5 bg-gradient-to-br from-violet-500 to-purple-700 rounded-full flex items-center justify-center">' +
              '<i class="fas fa-magic text-white text-xl"></i>' +
            '</div>' +
          '</div>' +
          '<h3 class="text-xl font-bold text-gray-900 mb-1.5">Generating Preview</h3>' +
          '<p class="text-gray-500 text-sm mb-4">Creating <strong>' + state.colorLabel + ' ' + selMat + '</strong>...</p>' +
          '<div id="aiStatus" class="text-sm text-gray-400 mb-4"><i class="fas fa-clock mr-1"></i>Usually 10–20 seconds</div>' +
          '<div class="w-full bg-gray-100 rounded-full h-2 overflow-hidden">' +
            '<div id="aiBar" class="bg-gradient-to-r from-violet-500 to-purple-500 h-2 rounded-full transition-all duration-500" style="width:8%"></div>' +
          '</div>' +
          '<button onclick="window._vizCancelAI()" class="mt-5 text-xs text-gray-400 hover:text-red-500"><i class="fas fa-times mr-1"></i>Cancel</button>' +
        '</div>' +
      '</div>';

    // Animate progress bar
    var pv = 8;
    function anim() {
      var bar = document.getElementById('aiBar');
      if (!bar || state.step !== 5) return;
      pv = Math.min(pv + Math.random() * 6 + 1, 88);
      bar.style.width = pv + '%';
      setTimeout(anim, 1000);
    }
    anim();

    api('POST', '/generate', {
      original_image: photo.dataUrl,
      mask_image: state.maskBase64,
      roof_style: state.style,
      roof_color: state.colorLabel.toLowerCase(),
    }).then(function (res) {
      if (!res.success) {
        state.errorMsg = res.error || 'AI generation failed.';
        state.step = 6; render();
        return;
      }
      // Gemini path: result ready immediately
      if (res.status === 'succeeded' && res.final_image_url) {
        var bar = document.getElementById('aiBar');
        if (bar) bar.style.width = '100%';
        state.resultUrl = res.final_image_url;
        setTimeout(function () { state.step = 6; render(); }, 400);
        return;
      }
      // Replicate async path: poll for status
      if (res.job_id) {
        state.jobId = res.job_id;
        state.pollTimer = setInterval(function () {
          api('GET', '/status/' + state.jobId).then(function (r) {
            if (r.status === 'succeeded') {
              clearInterval(state.pollTimer);
              var bar = document.getElementById('aiBar');
              if (bar) bar.style.width = '100%';
              state.resultUrl = r.final_image_url;
              setTimeout(function () { state.step = 6; render(); }, 400);
            } else if (r.status === 'failed') {
              clearInterval(state.pollTimer);
              state.errorMsg = r.error_message || 'Generation failed. Please try again.';
              state.step = 6; render();
            } else {
              var el = document.getElementById('aiStatus');
              if (el) el.innerHTML = '<i class="fas fa-cog fa-spin mr-1"></i>Processing… ' + Math.round((r.elapsed_ms||0)/1000) + 's';
            }
          }).catch(function(){});
        }, 2000);
      } else {
        state.errorMsg = 'AI generation failed — no job ID returned.';
        state.step = 6; render();
      }
    }).catch(function (e) {
      state.errorMsg = 'Network error: ' + e.message;
      state.step = 6; render();
    });
  }

  window._vizCancelAI = function () {
    if (state.pollTimer) clearInterval(state.pollTimer);
    if (state.jobId) api('POST', '/cancel/' + state.jobId).catch(function(){});
    state.step = 3; render();
  };

  // ════════════════════════════════════════════════════════
  // STEP 6: Result
  // ════════════════════════════════════════════════════════

  function renderResult() {
    var photo = state.photos[state.aiPhotoIdx];
    var selMat = matLabel(state.style);
    root.innerHTML =
      '<div class="max-w-4xl mx-auto">' +
        (state.errorMsg && !state.resultUrl
          ? // Error
            '<div class="bg-white rounded-2xl shadow-sm border border-gray-200 p-10 text-center">' +
              '<div class="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4"><i class="fas fa-exclamation-triangle text-red-500 text-xl"></i></div>' +
              '<h3 class="text-xl font-bold text-gray-900 mb-2">Generation Failed</h3>' +
              '<p class="text-gray-500 text-sm mb-5">' + state.errorMsg + '</p>' +
              '<div class="flex justify-center flex-wrap gap-3">' +
                '<button onclick="window._vizDoAI()" class="px-5 py-2 bg-violet-600 text-white rounded-xl text-sm font-medium hover:bg-violet-700"><i class="fas fa-redo mr-1"></i>Try Again</button>' +
                '<button onclick="window._vizBackTo3()" class="px-5 py-2 bg-gray-200 text-gray-700 rounded-xl text-sm font-medium"><i class="fas fa-paint-brush mr-1"></i>Edit Mask</button>' +
                '<button onclick="window._vizReturnVis()" class="px-5 py-2 bg-gray-100 text-gray-600 rounded-xl text-sm font-medium"><i class="fas fa-palette mr-1"></i>Visualizer</button>' +
              '</div>' +
            '</div>'
          : // Success
            '<div class="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">' +
              '<div class="flex items-center justify-between mb-4 flex-wrap gap-2">' +
                '<div>' +
                  '<h3 class="font-bold text-gray-900"><i class="fas fa-check-circle text-green-500 mr-2"></i>AI Preview Ready</h3>' +
                  '<p class="text-sm text-gray-500">' + state.colorLabel + ' ' + selMat + '</p>' +
                '</div>' +
                '<div class="flex gap-2 flex-wrap">' +
                  '<button onclick="window._vizDL()" class="px-4 py-2 bg-violet-600 text-white rounded-xl text-sm font-medium hover:bg-violet-700"><i class="fas fa-download mr-1"></i>Download</button>' +
                  '<button onclick="window._vizReturnVis()" class="px-4 py-2 bg-gray-200 text-gray-700 rounded-xl text-sm font-medium"><i class="fas fa-palette mr-1"></i>Try Another Style</button>' +
                '</div>' +
              '</div>' +
              '<div class="grid grid-cols-2 gap-4">' +
                '<div>' +
                  '<p class="text-xs text-gray-400 mb-2 text-center font-medium">Before</p>' +
                  '<img src="' + (photo ? photo.dataUrl : '') + '" class="w-full rounded-xl border border-gray-200">' +
                '</div>' +
                '<div>' +
                  '<p class="text-xs text-violet-600 mb-2 text-center font-semibold"><i class="fas fa-magic mr-1"></i>After — AI Preview</p>' +
                  '<img src="' + (state.resultUrl || '') + '" class="w-full rounded-xl border-2 border-violet-300 shadow-lg">' +
                '</div>' +
              '</div>' +
              '<p class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-2.5 mt-4"><i class="fas fa-info-circle mr-1"></i>AI-generated preview. Actual installed results will vary.</p>' +
            '</div>'
        ) +
      '</div>';
  }

  window._vizReturnVis = function () {
    state.resultUrl = null; state.errorMsg = null; state.maskBase64 = null; state.jobId = null;
    state.step = 3; render();
  };
  window._vizDL = function () {
    if (!state.resultUrl) return;
    var a = document.createElement('a');
    a.href = state.resultUrl;
    a.download = 'roof-preview-' + state.style + '-' + state.colorLabel.replace(/\s/g,'-') + '.png';
    a.target = '_blank';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  // ── Boot ───────────────────────────────────────────────
  render();

})();

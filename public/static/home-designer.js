// ============================================================
// Roof Manager — Home Designer Frontend v2.0 (Hover-Style)
//
// Professional home visualization with AI roof recoloring,
// before/after comparison slider, and 2D bird's-eye diagrams.
//
// Flow: Upload 3-5 Photos → AI Segments Roofs → Pick Material
//       → Generate Renders + 2D Diagram → Present to Homeowner
// ============================================================

(function () {
  'use strict';

  var root = document.getElementById('designer-root');
  var token = localStorage.getItem('rc_customer_token') || '';
  var MAX_PHOTO_SIZE_MB = 15;

  // ── State ──
  var state = {
    step: 1,                // 1=start, 2=upload, 3=segment, 4=material, 5=results
    projectId: null,
    projectName: '',
    propertyAddress: '',
    photos: [],             // [{file, preview, photoId, angle, segResult}]
    catalog: null,
    selectedCategory: 'shingles',
    selectedProduct: null,
    segmentationResults: [],
    generateResults: [],
    diagramSvg: null,
    diagramData: null,
    loading: false,
    error: null,
    compareModes: {},       // {photoIndex: 'slider'|'side'|'toggle'}
    sliderPositions: {},    // {photoIndex: 50} (percentage)
    activePhotoTab: 0,
    recolorImages: {},      // {photoIndex: base64/url}
  };

  // ── API Helper ──
  function api(method, path, body) {
    var opts = {
      method: method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    if (body) opts.body = JSON.stringify(body);
    return fetch('/api/home-designer' + path, opts).then(function (r) { return r.json(); });
  }

  // ── Render Router ──
  function render() {
    if (!root) return;
    switch (state.step) {
      case 1: renderStart(); break;
      case 2: renderUpload(); break;
      case 3: renderSegmenting(); break;
      case 4: renderMaterialPicker(); break;
      case 5: renderResults(); break;
    }
  }

  // ════════════════════════════════════════════════════════
  // STEP 1: Start — Project Name + Address
  // ════════════════════════════════════════════════════════

  function renderStart() {
    root.innerHTML =
      '<div class="max-w-2xl mx-auto">' +
        '<div class="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">' +

          // Hero
          '<div class="relative bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-8 py-10 text-center overflow-hidden">' +
            '<div class="absolute inset-0 opacity-20" style="background-image: url(\'data:image/svg+xml,<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\"><path d=\"M50 10 L90 50 L50 90 L10 50Z\" fill=\"none\" stroke=\"white\" stroke-width=\"0.3\"/></svg>\'); background-size: 40px 40px;"></div>' +
            '<div class="relative z-10">' +
              '<div class="w-20 h-20 bg-gradient-to-br from-teal-400 to-cyan-500 rounded-2xl flex items-center justify-center mx-auto mb-5 shadow-lg shadow-teal-500/30 rotate-3">' +
                '<i class="fas fa-home text-white text-3xl"></i>' +
              '</div>' +
              '<h2 class="text-3xl font-extrabold text-white mb-3 tracking-tight">Home Designer</h2>' +
              '<p class="text-slate-300 text-sm max-w-md mx-auto leading-relaxed">Upload exterior photos of any home. Our AI segments the roof and lets you visualize different materials, colors, and styles — complete with a professional 2D roof diagram.</p>' +
              '<div class="flex items-center justify-center gap-6 mt-5">' +
                '<div class="flex items-center gap-2 text-teal-300 text-xs"><i class="fas fa-check-circle"></i>AI Segmentation</div>' +
                '<div class="flex items-center gap-2 text-teal-300 text-xs"><i class="fas fa-check-circle"></i>Before / After</div>' +
                '<div class="flex items-center gap-2 text-teal-300 text-xs"><i class="fas fa-check-circle"></i>2D Diagram</div>' +
              '</div>' +
            '</div>' +
          '</div>' +

          '<div class="p-8 space-y-5">' +

            '<div>' +
              '<label class="text-sm font-bold text-gray-700 block mb-1.5">Project Name</label>' +
              '<input id="hd-project-name" type="text" placeholder="e.g., Johnson Residence Roof Redesign" class="w-full px-4 py-3 border border-gray-200 rounded-xl focus:border-teal-500 focus:ring-2 focus:ring-teal-100 outline-none text-sm bg-gray-50 hover:bg-white transition-colors">' +
            '</div>' +

            '<div>' +
              '<label class="text-sm font-bold text-gray-700 block mb-1.5">Property Address <span class="text-gray-400 font-normal text-xs">(optional)</span></label>' +
              '<input id="hd-address" type="text" placeholder="e.g., 123 Maple Drive, Edmonton, AB" class="w-full px-4 py-3 border border-gray-200 rounded-xl focus:border-teal-500 focus:ring-2 focus:ring-teal-100 outline-none text-sm bg-gray-50 hover:bg-white transition-colors">' +
            '</div>' +

            '<button onclick="window._hdCreateProject()" class="w-full py-3.5 bg-gradient-to-r from-teal-600 to-cyan-600 text-white font-bold rounded-xl hover:from-teal-700 hover:to-cyan-700 shadow-lg shadow-teal-500/20 transition-all text-sm">' +
              '<i class="fas fa-plus-circle mr-2"></i>Start New Design Project' +
            '</button>' +

            // Recent projects
            '<div id="hd-recent" class="mt-4"></div>' +
          '</div>' +
        '</div>' +
      '</div>';

    loadRecentProjects();
  }

  window._hdCreateProject = function () {
    var name = document.getElementById('hd-project-name').value || 'New Design Project';
    var address = document.getElementById('hd-address').value || '';

    state.projectName = name;
    state.propertyAddress = address;
    state.loading = true;
    state.error = null;

    api('POST', '/projects', { name: name, property_address: address })
      .then(function (res) {
        state.loading = false;
        if (res.success) {
          state.projectId = res.project_id;
          state.step = 2;
          render();
          loadCatalog();
        } else {
          state.error = res.error || 'Failed to create project';
          render();
        }
      })
      .catch(function (err) {
        state.loading = false;
        state.error = err.message;
        render();
      });
  };

  function loadRecentProjects() {
    if (!token) return;
    api('GET', '/projects').then(function (res) {
      if (!res.success || !res.projects || res.projects.length === 0) return;
      var el = document.getElementById('hd-recent');
      if (!el) return;

      var html = '<div class="border-t border-gray-100 pt-5">' +
        '<h4 class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3"><i class="fas fa-history mr-1"></i>Recent Projects</h4>' +
        '<div class="space-y-2">';

      res.projects.slice(0, 5).forEach(function (p) {
        var statusColors = { completed: 'bg-green-100 text-green-700', segmented: 'bg-blue-100 text-blue-700', draft: 'bg-gray-100 text-gray-600', generating: 'bg-amber-100 text-amber-700' };
        var statusBadge = '<span class="px-2 py-0.5 ' + (statusColors[p.status] || 'bg-gray-100 text-gray-600') + ' text-[10px] rounded-full font-semibold">' + (p.status || 'draft') + '</span>';

        html += '<button onclick="window._hdLoadProject(' + p.id + ')" class="w-full flex items-center justify-between p-3.5 border border-gray-100 rounded-xl hover:bg-gray-50 hover:border-gray-200 transition-all text-left group">' +
          '<div class="flex items-center gap-3">' +
            '<div class="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-100 to-gray-200 flex items-center justify-center flex-shrink-0 group-hover:from-teal-50 group-hover:to-cyan-100 transition-colors">' +
              '<i class="fas fa-home text-gray-400 group-hover:text-teal-500 transition-colors"></i>' +
            '</div>' +
            '<div>' +
              '<p class="text-sm font-semibold text-gray-800">' + (p.name || 'Untitled') + '</p>' +
              '<p class="text-[10px] text-gray-400">' + (p.property_address || 'No address') + ' &bull; ' + (p.photo_count || 0) + ' photos</p>' +
            '</div>' +
          '</div>' +
          statusBadge +
        '</button>';
      });

      html += '</div></div>';
      el.innerHTML = html;
    }).catch(function () {});
  }

  window._hdLoadProject = function (id) {
    state.projectId = id;
    api('GET', '/projects/' + id).then(function (res) {
      if (!res.success) return;
      state.projectName = res.project.name;
      state.propertyAddress = res.project.property_address || '';
      if (res.project.status === 'completed' && res.photos.length > 0) {
        state.photos = res.photos.map(function (p) {
          return { photoId: p.id, angle: p.angle_label, segResult: p.segmentation, render: p.render, preview: null };
        });
        state.generateResults = res.photos.filter(function (p) { return p.render; }).map(function (p) { return p.render; });
        if (res.diagrams && res.diagrams.length > 0) {
          state.diagramSvg = res.diagrams[0].diagram_svg;
        }
        state.step = 5;
      } else if (res.photos.length > 0) {
        state.step = 4;
      } else {
        state.step = 2;
      }
      render();
      loadCatalog();
    });
  };

  function loadCatalog() {
    if (state.catalog) return;
    api('GET', '/catalog').then(function (res) {
      if (res.success) {
        state.catalog = res.catalog;
        if (state.step === 4) render();
      }
    }).catch(function () {});
  }

  // ════════════════════════════════════════════════════════
  // STEP 2: Upload 3-5 Photos (Drag & Drop + Click)
  // ════════════════════════════════════════════════════════

  function renderUpload() {
    var photoSlots = '';
    var angleLabels = ['Front Elevation', 'Left Side', 'Right Side', 'Rear Elevation', 'Close-Up Detail'];
    var angleIcons = ['fa-building', 'fa-arrow-left', 'fa-arrow-right', 'fa-building', 'fa-search-plus'];

    for (var i = 0; i < 5; i++) {
      var hasPhoto = state.photos[i] && state.photos[i].preview;
      var label = angleLabels[i];
      var isRequired = i < 1;

      if (hasPhoto) {
        photoSlots +=
          '<div class="relative group">' +
            '<div class="aspect-[4/3] rounded-xl overflow-hidden border-2 border-teal-400 shadow-md ring-2 ring-teal-100">' +
              '<img src="' + state.photos[i].preview + '" class="w-full h-full object-cover">' +
            '</div>' +
            '<div class="absolute inset-0 bg-black/50 rounded-xl opacity-0 group-hover:opacity-100 transition-all duration-200 flex items-center justify-center backdrop-blur-[1px]">' +
              '<button onclick="window._hdRemovePhoto(' + i + ')" class="px-3 py-2 bg-red-600 text-white rounded-lg text-xs font-bold shadow-lg hover:bg-red-700 transition-colors"><i class="fas fa-trash mr-1"></i>Remove</button>' +
            '</div>' +
            '<div class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2 rounded-b-xl">' +
              '<span class="text-white text-[10px] font-semibold">' + label + '</span>' +
            '</div>' +
            '<span class="absolute top-2 right-2 w-6 h-6 bg-teal-500 rounded-full flex items-center justify-center shadow"><i class="fas fa-check text-white text-[10px]"></i></span>' +
          '</div>';
      } else {
        photoSlots +=
          '<div onclick="window._hdTriggerUpload(' + i + ')" class="aspect-[4/3] rounded-xl border-2 border-dashed ' + (isRequired ? 'border-teal-300 bg-teal-50/30' : 'border-gray-200') + ' hover:border-teal-400 hover:bg-teal-50/50 cursor-pointer transition-all flex flex-col items-center justify-center group">' +
            '<div class="w-10 h-10 rounded-lg bg-gray-100 group-hover:bg-teal-100 flex items-center justify-center mb-2 transition-colors">' +
              '<i class="fas ' + angleIcons[i] + ' text-gray-300 group-hover:text-teal-500 transition-colors"></i>' +
            '</div>' +
            '<span class="text-[11px] font-semibold text-gray-400 group-hover:text-teal-600 transition-colors">' + label + '</span>' +
            (isRequired ? '<span class="text-[9px] text-teal-500 font-bold mt-0.5">Required</span>' : '<span class="text-[9px] text-gray-300 mt-0.5">Optional</span>') +
          '</div>';
      }
    }

    root.innerHTML =
      '<div class="max-w-3xl mx-auto">' +
        '<div class="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">' +

          // Header
          '<div class="bg-gradient-to-r from-slate-800 to-slate-900 px-6 py-4 flex items-center justify-between">' +
            '<div class="flex items-center gap-3">' +
              '<button onclick="window._hdBack(1)" class="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"><i class="fas fa-arrow-left text-sm"></i></button>' +
              '<div>' +
                '<h3 class="text-white font-bold text-sm">Upload Exterior Photos</h3>' +
                '<p class="text-slate-400 text-[11px]">' + (state.projectName || 'New Project') + '</p>' +
              '</div>' +
            '</div>' +
            '<div class="flex items-center gap-2">' +
              renderStepIndicator(2) +
            '</div>' +
          '</div>' +

          '<div class="p-6">' +

            // Drag & Drop Zone
            '<div id="hd-dropzone" class="border-2 border-dashed border-gray-200 rounded-xl p-6 mb-6 text-center transition-all hover:border-teal-300 hover:bg-teal-50/30"' +
              ' ondragover="event.preventDefault(); this.classList.add(\'border-teal-400\',\'bg-teal-50\');"' +
              ' ondragleave="this.classList.remove(\'border-teal-400\',\'bg-teal-50\');"' +
              ' ondrop="window._hdHandleDrop(event)">' +
              '<i class="fas fa-cloud-upload-alt text-3xl text-gray-300 mb-3"></i>' +
              '<p class="text-sm font-semibold text-gray-500">Drag & Drop Photos Here</p>' +
              '<p class="text-xs text-gray-400 mt-1">or click any slot below &bull; JPEG, PNG, WebP up to 15MB</p>' +
            '</div>' +

            // Photo grid
            '<div class="grid grid-cols-3 md:grid-cols-5 gap-3 mb-6">' + photoSlots + '</div>' +

            // Hidden file input
            '<input type="file" id="hd-file-input" accept="image/jpeg,image/png,image/webp" class="hidden" onchange="window._hdFileSelected(this)" multiple>' +

            // Tips
            '<div class="bg-gradient-to-r from-slate-50 to-gray-50 border border-gray-200 rounded-xl p-4 mb-6">' +
              '<h4 class="font-bold text-gray-700 text-sm mb-3"><i class="fas fa-lightbulb mr-2 text-amber-500"></i>Pro Tips for Best Results</h4>' +
              '<div class="grid grid-cols-2 gap-y-2 gap-x-4 text-xs text-gray-600">' +
                '<div class="flex items-center gap-2"><span class="w-5 h-5 rounded-full bg-teal-100 flex items-center justify-center flex-shrink-0"><i class="fas fa-sun text-teal-600 text-[8px]"></i></span>Daylight photos — avoid shadows</div>' +
                '<div class="flex items-center gap-2"><span class="w-5 h-5 rounded-full bg-teal-100 flex items-center justify-center flex-shrink-0"><i class="fas fa-expand text-teal-600 text-[8px]"></i></span>Show the complete roofline</div>' +
                '<div class="flex items-center gap-2"><span class="w-5 h-5 rounded-full bg-teal-100 flex items-center justify-center flex-shrink-0"><i class="fas fa-camera text-teal-600 text-[8px]"></i></span>3+ angles = better AI accuracy</div>' +
                '<div class="flex items-center gap-2"><span class="w-5 h-5 rounded-full bg-teal-100 flex items-center justify-center flex-shrink-0"><i class="fas fa-tree text-teal-600 text-[8px]"></i></span>Minimize tree obstruction</div>' +
              '</div>' +
            '</div>' +

            // Progress
            '<div class="flex items-center gap-3 mb-5">' +
              '<div class="flex-1 bg-gray-100 rounded-full h-2.5 overflow-hidden">' +
                '<div class="bg-gradient-to-r from-teal-500 to-cyan-500 rounded-full h-full transition-all duration-500" style="width:' + Math.min(100, (state.photos.length / 3) * 100) + '%"></div>' +
              '</div>' +
              '<span class="text-xs font-bold ' + (state.photos.length >= 3 ? 'text-teal-600' : 'text-gray-400') + '">' + state.photos.length + ' / 5</span>' +
            '</div>' +

            // Continue
            '<button onclick="window._hdContinueToSegment()" class="w-full py-3.5 bg-gradient-to-r from-teal-600 to-cyan-600 text-white font-bold rounded-xl hover:from-teal-700 hover:to-cyan-700 shadow-lg shadow-teal-500/20 transition-all text-sm ' + (state.photos.length < 1 ? 'opacity-40 cursor-not-allowed' : '') + '" ' + (state.photos.length < 1 ? 'disabled' : '') + '>' +
              '<i class="fas fa-brain mr-2"></i>Analyze Roof' + (state.photos.length > 0 ? ' (' + state.photos.length + ' photo' + (state.photos.length !== 1 ? 's' : '') + ')' : '') +
            '</button>' +

          '</div>' +
        '</div>' +
      '</div>';
  }

  function renderStepIndicator(current) {
    var steps = ['Create', 'Upload', 'Analyze', 'Material', 'Results'];
    var html = '';
    for (var i = 0; i < steps.length; i++) {
      var s = i + 1;
      var active = s === current;
      var done = s < current;
      html += '<div class="flex items-center gap-1">' +
        '<div class="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold ' +
          (done ? 'bg-teal-500 text-white' : (active ? 'bg-white text-slate-800' : 'bg-white/10 text-white/50')) + '">' +
          (done ? '<i class="fas fa-check text-[8px]"></i>' : s) +
        '</div>' +
        (i < steps.length - 1 ? '<div class="w-3 h-px ' + (done ? 'bg-teal-500' : 'bg-white/20') + '"></div>' : '') +
      '</div>';
    }
    return html;
  }

  var uploadingIndex = 0;

  window._hdTriggerUpload = function (index) {
    uploadingIndex = index;
    var fi = document.getElementById('hd-file-input');
    fi.multiple = false;
    fi.click();
  };

  window._hdHandleDrop = function (event) {
    event.preventDefault();
    var dropzone = document.getElementById('hd-dropzone');
    if (dropzone) {
      dropzone.classList.remove('border-teal-400', 'bg-teal-50');
    }

    var files = event.dataTransfer.files;
    if (!files || files.length === 0) return;

    for (var i = 0; i < files.length && state.photos.length < 5; i++) {
      processFile(files[i], state.photos.length);
    }
  };

  window._hdFileSelected = function (input) {
    if (!input.files || input.files.length === 0) return;

    for (var i = 0; i < input.files.length; i++) {
      var idx = input.multiple ? state.photos.length : uploadingIndex;
      if (idx >= 5) break;
      processFile(input.files[i], idx);
    }
    input.value = '';
  };

  function processFile(file, index) {
    if (file.size > MAX_PHOTO_SIZE_MB * 1024 * 1024) {
      alert('Photo too large. Maximum ' + MAX_PHOTO_SIZE_MB + 'MB.');
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      alert('Unsupported format. Use JPEG, PNG, or WebP.');
      return;
    }

    var reader = new FileReader();
    reader.onload = function (e) {
      var dataUrl = e.target.result;
      while (state.photos.length <= index) {
        state.photos.push(null);
      }
      state.photos[index] = {
        file: file,
        preview: dataUrl,
        data: dataUrl,
        angle: ['front', 'left', 'right', 'rear', 'detail'][index] || 'photo-' + (index + 1),
      };
      state.photos = state.photos.filter(function (p) { return p !== null; });
      render();
    };
    reader.readAsDataURL(file);
  }

  window._hdRemovePhoto = function (index) {
    state.photos.splice(index, 1);
    render();
  };

  window._hdBack = function (step) {
    state.step = step;
    state.error = null;
    render();
  };

  // ════════════════════════════════════════════════════════
  // STEP 3: Segmenting (AI Processing)
  // ════════════════════════════════════════════════════════

  window._hdContinueToSegment = function () {
    if (state.photos.length < 1) return;
    state.step = 3;
    state.error = null;
    render();

    var photoPayload = state.photos.map(function (p) {
      return { data: p.data, angle: p.angle };
    });
    var angleLabels = state.photos.map(function (p) { return p.angle; });

    api('POST', '/projects/' + state.projectId + '/photos', {
      photos: photoPayload,
      angle_labels: angleLabels,
    }).then(function (uploadRes) {
      if (!uploadRes.success) {
        state.error = uploadRes.error || 'Upload failed';
        render();
        return;
      }
      return api('POST', '/projects/' + state.projectId + '/segment');
    }).then(function (segRes) {
      if (!segRes) return;
      if (segRes.success) {
        state.segmentationResults = segRes.results || [];
        state.step = 4;
        render();
      } else {
        state.error = segRes.error || 'Segmentation failed';
        render();
      }
    }).catch(function (err) {
      state.error = err.message;
      render();
    });
  };

  function renderSegmenting() {
    var steps = [
      { label: 'Photos uploaded', done: true },
      { label: 'Detecting roof boundaries...', active: !state.error, done: false },
      { label: 'Identifying material & condition', active: false, done: false },
      { label: 'Preparing visualization engine', active: false, done: false },
    ];

    root.innerHTML =
      '<div class="max-w-lg mx-auto">' +
        '<div class="bg-white rounded-2xl shadow-xl border border-gray-100 p-10 text-center">' +
          (state.error ?
            '<div class="text-center">' +
              '<div class="w-20 h-20 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-5">' +
                '<i class="fas fa-exclamation-triangle text-red-400 text-3xl"></i>' +
              '</div>' +
              '<h3 class="text-xl font-bold text-gray-900 mb-2">Analysis Failed</h3>' +
              '<p class="text-gray-500 mb-6 text-sm">' + state.error + '</p>' +
              '<button onclick="window._hdBack(2)" class="px-8 py-2.5 bg-teal-600 text-white rounded-xl text-sm font-bold hover:bg-teal-700 transition-colors"><i class="fas fa-redo mr-2"></i>Try Again</button>' +
            '</div>'
          :
            '<div class="relative w-24 h-24 mx-auto mb-8">' +
              '<div class="absolute inset-0 rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-500 animate-pulse opacity-20"></div>' +
              '<div class="absolute inset-1 rounded-[14px] bg-white"></div>' +
              '<div class="absolute inset-2 rounded-xl bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center">' +
                '<i class="fas fa-brain text-white text-2xl animate-pulse"></i>' +
              '</div>' +
              '<div class="absolute -top-1 -right-1 w-6 h-6 bg-teal-500 rounded-full animate-ping"></div>' +
            '</div>' +
            '<h3 class="text-xl font-bold text-gray-900 mb-2">AI Analyzing Your Photos</h3>' +
            '<p class="text-gray-500 text-sm mb-8 max-w-sm mx-auto">Our SAM 3 + Gemini pipeline is detecting roof boundaries, identifying materials, and preparing the visualization engine...</p>' +
            '<div class="space-y-3 text-left max-w-xs mx-auto">' +
              steps.map(function (s) {
                var icon = s.done ? '<i class="fas fa-check text-teal-500 text-[10px]"></i>' :
                  (s.active ? '<i class="fas fa-cog fa-spin text-teal-500 text-[10px]"></i>' :
                    '<i class="fas fa-clock text-gray-300 text-[10px]"></i>');
                var bgColor = s.done ? 'bg-teal-50' : (s.active ? 'bg-teal-50 animate-pulse' : 'bg-gray-50');
                var textColor = s.done ? 'text-teal-700' : (s.active ? 'text-teal-600' : 'text-gray-400');
                return '<div class="flex items-center gap-3 px-4 py-2.5 rounded-xl ' + bgColor + ' transition-all">' +
                  '<div class="w-6 h-6 rounded-full ' + (s.done ? 'bg-teal-100' : (s.active ? 'bg-teal-100' : 'bg-gray-100')) + ' flex items-center justify-center flex-shrink-0">' + icon + '</div>' +
                  '<span class="text-sm font-medium ' + textColor + '">' + s.label + '</span>' +
                '</div>';
              }).join('') +
            '</div>'
          ) +
        '</div>' +
      '</div>';
  }

  // ════════════════════════════════════════════════════════
  // STEP 4: Material & Color Picker
  // ════════════════════════════════════════════════════════

  function renderMaterialPicker() {
    if (!state.catalog) {
      loadCatalog();
      root.innerHTML = '<div class="text-center py-16"><div class="w-12 h-12 mx-auto mb-3 rounded-xl bg-teal-50 flex items-center justify-center"><i class="fas fa-spinner fa-spin text-teal-500"></i></div><p class="text-gray-400 text-sm">Loading catalog...</p></div>';
      return;
    }

    var categories = Object.keys(state.catalog);
    var catTabs = categories.map(function (catId) {
      var cat = state.catalog[catId];
      var active = catId === state.selectedCategory;
      return '<button onclick="window._hdSelectCat(\'' + catId + '\')" class="px-4 py-2.5 rounded-xl text-sm font-bold transition-all whitespace-nowrap ' +
        (active ? 'bg-slate-800 text-white shadow-lg' : 'bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700') + '">' +
        '<i class="fas ' + cat.icon + ' mr-1.5"></i>' + cat.label +
      '</button>';
    }).join('');

    var activeCat = state.catalog[state.selectedCategory];
    var productsHtml = '';
    if (activeCat && activeCat.products) {
      productsHtml = activeCat.products.map(function (prod) {
        var selected = state.selectedProduct && state.selectedProduct.id === prod.id;
        return '<button onclick="window._hdSelectProduct(\'' + prod.id + '\')" class="p-3.5 rounded-xl border-2 transition-all text-left hover:shadow-md ' +
          (selected ? 'border-teal-500 bg-teal-50 ring-2 ring-teal-200 shadow-lg' : 'border-gray-100 hover:border-gray-200') + '">' +
          '<div class="flex items-center gap-3">' +
            '<div class="w-12 h-12 rounded-xl border-2 ' + (selected ? 'border-teal-300' : 'border-gray-200') + ' shadow-inner flex-shrink-0 relative overflow-hidden" style="background:' + prod.hex + '">' +
              (selected ? '<div class="absolute inset-0 flex items-center justify-center bg-black/20"><i class="fas fa-check text-white text-sm"></i></div>' : '') +
            '</div>' +
            '<div class="min-w-0 flex-1">' +
              '<p class="text-sm font-bold ' + (selected ? 'text-teal-700' : 'text-gray-800') + ' truncate">' + prod.name + '</p>' +
              '<p class="text-[10px] text-gray-400 truncate">' + prod.brand + ' &bull; ' + prod.type + '</p>' +
              '<div class="flex items-center gap-2 mt-0.5">' +
                '<span class="text-[10px] text-gray-400"><i class="fas fa-shield-alt mr-0.5"></i>' + prod.warranty + '</span>' +
                '<span class="text-[10px] font-bold text-gray-500">$' + prod.price_per_sqft.toFixed(2) + '/sqft</span>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</button>';
      }).join('');
    }

    // Segmentation summary
    var segSummary = '';
    if (state.segmentationResults.length > 0) {
      var roofTypes = state.segmentationResults.map(function (s) { return s.roof_type; }).filter(function (v, i, a) { return v !== 'unknown' && a.indexOf(v) === i; });
      var detected = state.segmentationResults.filter(function (s) { return s.roof_detected; }).length;
      segSummary =
        '<div class="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-xl p-4 mb-6">' +
          '<div class="flex items-center justify-between mb-3">' +
            '<h4 class="font-bold text-green-800 text-sm"><i class="fas fa-check-circle mr-2 text-green-500"></i>Roof Analysis Complete</h4>' +
            '<span class="px-2 py-0.5 bg-green-100 text-green-700 text-[10px] rounded-full font-bold">SAM 3 + Gemini</span>' +
          '</div>' +
          '<div class="grid grid-cols-3 gap-3">' +
            '<div class="bg-white/60 rounded-lg p-2.5 text-center"><p class="text-xl font-extrabold text-green-700">' + state.segmentationResults.length + '</p><p class="text-[10px] text-green-600 font-medium">Photos Analyzed</p></div>' +
            '<div class="bg-white/60 rounded-lg p-2.5 text-center"><p class="text-xl font-extrabold text-green-700">' + detected + '</p><p class="text-[10px] text-green-600 font-medium">Roofs Detected</p></div>' +
            '<div class="bg-white/60 rounded-lg p-2.5 text-center"><p class="text-xl font-extrabold text-green-700 capitalize">' + (roofTypes[0] || 'Mixed') + '</p><p class="text-[10px] text-green-600 font-medium">Roof Type</p></div>' +
          '</div>' +
        '</div>';
    }

    root.innerHTML =
      '<div class="max-w-4xl mx-auto">' +
        '<div class="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">' +

          // Header
          '<div class="bg-gradient-to-r from-slate-800 to-slate-900 px-6 py-4 flex items-center justify-between">' +
            '<div class="flex items-center gap-3">' +
              '<button onclick="window._hdBack(2)" class="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"><i class="fas fa-arrow-left text-sm"></i></button>' +
              '<div>' +
                '<h3 class="text-white font-bold text-sm"><i class="fas fa-palette mr-2 text-teal-300"></i>Choose Roofing Material</h3>' +
                '<p class="text-slate-400 text-[11px]">Select a material and color to visualize</p>' +
              '</div>' +
            '</div>' +
            '<div class="flex items-center gap-2">' + renderStepIndicator(4) + '</div>' +
          '</div>' +

          '<div class="p-6">' +

            segSummary +

            // Category tabs
            '<div class="flex gap-2 overflow-x-auto pb-3 mb-5 scrollbar-hide">' + catTabs + '</div>' +

            // Products grid
            '<div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6 max-h-[420px] overflow-y-auto pr-1 scrollbar-thin">' + productsHtml + '</div>' +

            // Selected preview
            (state.selectedProduct ?
              '<div class="bg-gradient-to-r from-slate-800 to-slate-900 rounded-xl p-5 mb-5 flex items-center gap-5">' +
                '<div class="w-20 h-20 rounded-xl border-2 border-white/20 shadow-xl flex-shrink-0" style="background:' + state.selectedProduct.hex + '"></div>' +
                '<div class="flex-1 min-w-0">' +
                  '<p class="text-white font-bold text-lg">' + state.selectedProduct.name + '</p>' +
                  '<p class="text-slate-400 text-sm">' + state.selectedProduct.brand + ' &bull; ' + state.selectedProduct.type + '</p>' +
                  '<div class="flex items-center gap-4 mt-1">' +
                    '<span class="text-slate-300 text-xs"><i class="fas fa-shield-alt mr-1 text-teal-400"></i>' + state.selectedProduct.warranty + '</span>' +
                    '<span class="text-teal-300 text-xs font-bold">CAD $' + state.selectedProduct.price_per_sqft.toFixed(2) + '/sqft installed</span>' +
                  '</div>' +
                '</div>' +
              '</div>'
            : '') +

            // Generate button
            '<button onclick="window._hdGenerate()" class="w-full py-4 bg-gradient-to-r from-teal-600 to-cyan-600 text-white font-bold rounded-xl hover:from-teal-700 hover:to-cyan-700 shadow-lg shadow-teal-500/20 transition-all text-sm ' + (!state.selectedProduct ? 'opacity-40 cursor-not-allowed' : '') + '" ' + (!state.selectedProduct ? 'disabled' : '') + '>' +
              '<i class="fas fa-magic mr-2"></i>Generate Roof Visualization + 2D Diagram' +
            '</button>' +

          '</div>' +
        '</div>' +
      '</div>';
  }

  window._hdSelectCat = function (catId) {
    state.selectedCategory = catId;
    state.selectedProduct = null;
    render();
  };

  window._hdSelectProduct = function (prodId) {
    var cat = state.catalog[state.selectedCategory];
    if (!cat) return;
    state.selectedProduct = cat.products.find(function (p) { return p.id === prodId; }) || null;
    render();
  };

  // ════════════════════════════════════════════════════════
  // Generate Renders + Diagram
  // ════════════════════════════════════════════════════════

  window._hdGenerate = function () {
    if (!state.selectedProduct) return;

    state.step = 3;
    state.error = null;
    render();

    var prod = state.selectedProduct;
    var categoryName = state.catalog[state.selectedCategory] ? state.catalog[state.selectedCategory].label : state.selectedCategory;

    Promise.all([
      api('POST', '/projects/' + state.projectId + '/generate', {
        material_id: prod.id,
        material_name: prod.name + ' (' + prod.brand + ')',
        material_hex: prod.hex,
        material_type: categoryName,
      }),
      api('POST', '/projects/' + state.projectId + '/diagram', {
        material_id: prod.id,
        material_name: prod.name,
        material_hex: prod.hex,
      }),
    ]).then(function (results) {
      var renderRes = results[0];
      var diagramRes = results[1];

      if (renderRes.success) {
        state.generateResults = renderRes.renders || [];
      }
      if (diagramRes.success) {
        state.diagramSvg = diagramRes.diagram_svg;
        state.diagramData = diagramRes.diagram_data || null;
      }

      state.step = 5;
      render();
    }).catch(function (err) {
      state.error = err.message;
      state.step = 3;
      render();
    });
  };

  // ════════════════════════════════════════════════════════
  // STEP 5: Results — Before/After Slider + 2D Diagram
  // ════════════════════════════════════════════════════════

  function renderResults() {
    var prod = state.selectedProduct;
    var prodName = prod ? prod.name : 'Selected Material';
    var prodHex = prod ? prod.hex : '#36454F';

    // Photo tabs
    var photoTabs = state.photos.map(function (p, i) {
      var active = i === state.activePhotoTab;
      var label = ['Front', 'Left', 'Right', 'Rear', 'Detail'][i] || 'Photo ' + (i + 1);
      return '<button onclick="window._hdSetPhotoTab(' + i + ')" class="px-4 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap ' +
        (active ? 'bg-white text-gray-800 shadow-md' : 'text-white/70 hover:text-white hover:bg-white/10') + '">' + label + '</button>';
    }).join('');

    // Active photo comparison
    var activePhoto = state.photos[state.activePhotoTab];
    var activeResult = state.generateResults[state.activePhotoTab];
    var hasRender = activeResult && (activeResult.status === 'completed' || activeResult.render_description);

    var comparisonHtml = '';
    if (activePhoto && activePhoto.preview) {
      // Before/After Slider
      comparisonHtml =
        '<div class="relative rounded-xl overflow-hidden border border-gray-200 shadow-lg" style="aspect-ratio: 4/3;">' +
          // Before image (full)
          '<img src="' + activePhoto.preview + '" class="absolute inset-0 w-full h-full object-cover" alt="Before">' +
          // After overlay with clip
          '<div id="hd-after-overlay" class="absolute inset-0 overflow-hidden" style="clip-path: inset(0 0 0 ' + (state.sliderPositions[state.activePhotoTab] || 50) + '%)">' +
            '<div class="w-full h-full relative">' +
              '<img src="' + activePhoto.preview + '" class="absolute inset-0 w-full h-full object-cover" style="filter: saturate(0.3) brightness(0.8);" alt="After">' +
              // Color overlay simulating the recolor
              '<div class="absolute inset-0" style="background: linear-gradient(135deg, ' + prodHex + 'AA, ' + prodHex + '88); mix-blend-mode: overlay;"></div>' +
              '<div class="absolute inset-0" style="background: linear-gradient(180deg, ' + prodHex + '55 0%, ' + prodHex + '33 40%, transparent 65%);"></div>' +
            '</div>' +
          '</div>' +
          // Slider handle
          '<div id="hd-slider-handle" class="absolute top-0 bottom-0 w-1 bg-white shadow-lg cursor-ew-resize z-10 group" style="left: ' + (state.sliderPositions[state.activePhotoTab] || 50) + '%"' +
            ' onmousedown="window._hdStartSlider(event)"' +
            ' ontouchstart="window._hdStartSlider(event)">' +
            '<div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 bg-white rounded-full shadow-xl flex items-center justify-center group-hover:scale-110 transition-transform">' +
              '<i class="fas fa-arrows-alt-h text-gray-600 text-sm"></i>' +
            '</div>' +
          '</div>' +
          // Labels
          '<div class="absolute top-3 left-3 px-3 py-1 bg-black/60 text-white text-xs font-bold rounded-lg backdrop-blur-sm">Before</div>' +
          '<div class="absolute top-3 right-3 px-3 py-1 bg-teal-600/90 text-white text-xs font-bold rounded-lg backdrop-blur-sm">After — ' + prodName + '</div>' +
        '</div>';
    } else {
      comparisonHtml = '<div class="bg-gray-100 rounded-xl p-12 text-center" style="aspect-ratio: 4/3;"><i class="fas fa-image text-gray-300 text-3xl mb-2"></i><p class="text-gray-400 text-sm">No preview available</p></div>';
    }

    // AI Analysis card
    var analysisHtml = '';
    if (hasRender) {
      analysisHtml =
        '<div class="bg-gradient-to-br from-slate-50 to-gray-50 rounded-xl border border-gray-200 p-4 mt-4">' +
          '<h5 class="font-bold text-gray-700 text-xs mb-3 uppercase tracking-wider"><i class="fas fa-robot mr-1 text-teal-500"></i>AI Analysis</h5>' +
          '<p class="text-sm text-gray-600 leading-relaxed">' + ((activeResult.render_description || '').substring(0, 300)) + '</p>' +
          (activeResult.curb_appeal_rating ?
            '<div class="grid grid-cols-3 gap-3 mt-4">' +
              '<div class="bg-white rounded-lg p-2.5 text-center border border-gray-100"><p class="text-lg font-extrabold text-teal-600">' + activeResult.curb_appeal_rating + '<span class="text-xs text-gray-400">/10</span></p><p class="text-[9px] text-gray-500 font-medium">Curb Appeal</p></div>' +
              '<div class="bg-white rounded-lg p-2.5 text-center border border-gray-100"><p class="text-lg font-extrabold text-teal-600">' + (activeResult.color_harmony_score || 'N/A') + '<span class="text-xs text-gray-400">/10</span></p><p class="text-[9px] text-gray-500 font-medium">Color Harmony</p></div>' +
              '<div class="bg-white rounded-lg p-2.5 text-center border border-gray-100"><p class="text-lg font-extrabold capitalize text-teal-600">' + (activeResult.contrast_with_siding || 'N/A') + '</p><p class="text-[9px] text-gray-500 font-medium">Siding Match</p></div>' +
            '</div>'
          : '') +
          (activeResult.recommendations && activeResult.recommendations.length > 0 ?
            '<div class="mt-3 flex flex-wrap gap-1">' +
              activeResult.recommendations.slice(0, 4).map(function (r) {
                return '<span class="px-2.5 py-1 bg-white border border-gray-200 text-gray-600 text-[10px] rounded-lg font-medium"><i class="fas fa-lightbulb mr-1 text-amber-400"></i>' + r + '</span>';
              }).join('') +
            '</div>'
          : '') +
        '</div>';
    }

    root.innerHTML =
      '<div class="max-w-6xl mx-auto space-y-6">' +

        // Header
        '<div class="bg-gradient-to-r from-slate-800 to-slate-900 rounded-2xl shadow-xl overflow-hidden">' +
          '<div class="px-6 py-5 flex items-center justify-between">' +
            '<div class="flex items-center gap-4">' +
              '<div class="w-12 h-12 rounded-xl bg-gradient-to-br from-teal-400 to-cyan-500 flex items-center justify-center shadow-lg">' +
                '<i class="fas fa-check text-white text-lg"></i>' +
              '</div>' +
              '<div>' +
                '<h3 class="text-xl font-extrabold text-white">' + (state.projectName || 'Your Home') + '</h3>' +
                '<p class="text-slate-400 text-sm">' + prodName + (state.propertyAddress ? ' &bull; ' + state.propertyAddress : '') + '</p>' +
              '</div>' +
            '</div>' +
            '<div class="flex gap-2">' +
              '<button onclick="window._hdBack(4)" class="px-4 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold transition-colors"><i class="fas fa-palette mr-1.5"></i>Try Another</button>' +
              '<button onclick="window._hdBack(1)" class="px-4 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold transition-colors"><i class="fas fa-plus mr-1.5"></i>New Project</button>' +
              '<button onclick="window._hdPrint()" class="px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold transition-colors shadow-lg"><i class="fas fa-print mr-1.5"></i>Print / PDF</button>' +
            '</div>' +
          '</div>' +
        '</div>' +

        // Main content grid
        '<div class="grid grid-cols-1 lg:grid-cols-5 gap-6">' +

          // Left: Photo comparison (3 cols)
          '<div class="lg:col-span-3 space-y-4">' +
            '<div class="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">' +
              '<div class="bg-gradient-to-r from-gray-800 to-gray-900 px-4 py-2.5 flex items-center justify-between">' +
                '<h4 class="font-bold text-white text-sm"><i class="fas fa-images text-teal-300 mr-2"></i>Before & After</h4>' +
                '<div class="flex gap-1">' + photoTabs + '</div>' +
              '</div>' +
              '<div class="p-4">' +
                comparisonHtml +
                analysisHtml +
              '</div>' +
            '</div>' +
          '</div>' +

          // Right: 2D Diagram + Material spec (2 cols)
          '<div class="lg:col-span-2 space-y-4">' +

            // 2D Diagram
            '<div class="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">' +
              '<div class="bg-gradient-to-r from-gray-800 to-gray-900 px-4 py-2.5 flex items-center justify-between">' +
                '<h4 class="font-bold text-white text-sm"><i class="fas fa-drafting-compass text-teal-300 mr-2"></i>2D Roof Diagram</h4>' +
                (state.diagramSvg ? '<button onclick="window._hdDownloadDiagram()" class="px-3 py-1 bg-white/10 hover:bg-white/20 text-white rounded-lg text-[10px] font-bold transition-colors"><i class="fas fa-download mr-1"></i>SVG</button>' : '') +
              '</div>' +
              '<div class="p-4">' +
                '<div id="hd-diagram-container" class="bg-gray-50 rounded-xl border border-gray-100 min-h-[250px] flex items-center justify-center overflow-hidden">' +
                  (state.diagramSvg ?
                    '<div class="w-full p-2" style="max-height:350px; overflow:auto;">' + state.diagramSvg + '</div>'
                  :
                    '<div class="text-center py-8"><i class="fas fa-spinner fa-spin text-gray-300 text-xl mb-3 block"></i><p class="text-xs text-gray-400">Generating 2D diagram...</p></div>'
                  ) +
                '</div>' +
                '<p class="text-[9px] text-gray-400 mt-2"><i class="fas fa-info-circle mr-1"></i>AI-generated roof diagram. Measurements are estimates.</p>' +
              '</div>' +
            '</div>' +

            // Material Spec
            (prod ?
              '<div class="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">' +
                '<div class="bg-gradient-to-r from-gray-800 to-gray-900 px-4 py-2.5">' +
                  '<h4 class="font-bold text-white text-sm"><i class="fas fa-clipboard-list text-teal-300 mr-2"></i>Material Spec</h4>' +
                '</div>' +
                '<div class="p-4">' +
                  '<div class="flex items-center gap-4 mb-4">' +
                    '<div class="w-16 h-16 rounded-xl border-2 border-gray-200 shadow-lg flex-shrink-0" style="background:' + prod.hex + '"></div>' +
                    '<div>' +
                      '<p class="font-bold text-gray-800">' + prod.name + '</p>' +
                      '<p class="text-xs text-gray-500">' + prod.brand + '</p>' +
                    '</div>' +
                  '</div>' +
                  '<div class="grid grid-cols-2 gap-2">' +
                    '<div class="bg-gray-50 rounded-lg p-2.5"><p class="text-[10px] text-gray-400">Type</p><p class="text-xs font-bold text-gray-700">' + prod.type + '</p></div>' +
                    '<div class="bg-gray-50 rounded-lg p-2.5"><p class="text-[10px] text-gray-400">Warranty</p><p class="text-xs font-bold text-gray-700">' + prod.warranty + '</p></div>' +
                    '<div class="bg-gray-50 rounded-lg p-2.5"><p class="text-[10px] text-gray-400">Price / sq ft</p><p class="text-xs font-bold text-teal-700">CAD $' + prod.price_per_sqft.toFixed(2) + '</p></div>' +
                    '<div class="bg-gray-50 rounded-lg p-2.5"><p class="text-[10px] text-gray-400">Color Hex</p><p class="text-xs font-bold text-gray-700">' + prod.hex + '</p></div>' +
                  '</div>' +
                '</div>' +
              '</div>'
            : '') +

          '</div>' +
        '</div>' +

        // All photos overview
        (state.photos.length > 1 ?
          '<div class="bg-white rounded-2xl shadow-lg border border-gray-100 p-6">' +
            '<h4 class="font-bold text-gray-800 text-sm mb-4"><i class="fas fa-th text-teal-500 mr-2"></i>All Photo Comparisons</h4>' +
            '<div class="grid grid-cols-2 md:grid-cols-' + Math.min(state.photos.length, 4) + ' gap-3">' +
              state.photos.map(function (p, i) {
                var label = ['Front', 'Left', 'Right', 'Rear', 'Detail'][i] || 'Photo ' + (i + 1);
                return '<div onclick="window._hdSetPhotoTab(' + i + ')" class="cursor-pointer group relative rounded-xl overflow-hidden border-2 ' + (i === state.activePhotoTab ? 'border-teal-400 ring-2 ring-teal-100' : 'border-gray-200 hover:border-gray-300') + '">' +
                  (p.preview ? '<img src="' + p.preview + '" class="w-full aspect-[4/3] object-cover">' : '<div class="w-full aspect-[4/3] bg-gray-100"></div>') +
                  '<div class="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent p-2">' +
                    '<span class="text-white text-[10px] font-bold">' + label + '</span>' +
                  '</div>' +
                '</div>';
              }).join('') +
            '</div>' +
          '</div>'
        : '') +

        // Disclaimer
        '<div class="text-center pb-4">' +
          '<p class="text-[10px] text-gray-400 max-w-2xl mx-auto"><i class="fas fa-info-circle mr-1"></i>AI-generated visualization for presentation purposes. Actual installed roofing may vary. Pricing is estimated — contact for a detailed quote. Powered by Roof Manager + SAM 3 + Gemini.</p>' +
        '</div>' +

      '</div>';
  }

  window._hdSetPhotoTab = function (i) {
    state.activePhotoTab = i;
    render();
  };

  // ── Before/After Slider Logic ──
  window._hdStartSlider = function (e) {
    e.preventDefault();
    var container = e.target.closest('[style*="aspect-ratio"]');
    if (!container) return;

    function moveSlider(clientX) {
      var rect = container.getBoundingClientRect();
      var pct = ((clientX - rect.left) / rect.width) * 100;
      pct = Math.max(5, Math.min(95, pct));
      state.sliderPositions[state.activePhotoTab] = pct;

      var handle = document.getElementById('hd-slider-handle');
      var overlay = document.getElementById('hd-after-overlay');
      if (handle) handle.style.left = pct + '%';
      if (overlay) overlay.style.clipPath = 'inset(0 0 0 ' + pct + '%)';
    }

    function onMove(ev) {
      var cx = ev.touches ? ev.touches[0].clientX : ev.clientX;
      moveSlider(cx);
    }

    function onEnd() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onEnd);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchmove', onMove);
    document.addEventListener('touchend', onEnd);
  };

  window._hdPrint = function () {
    window.print();
  };

  window._hdDownloadDiagram = function () {
    if (!state.diagramSvg) return;
    var blob = new Blob([state.diagramSvg], { type: 'image/svg+xml' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'roof-diagram-' + (state.projectName || 'project').replace(/\s/g, '-') + '.svg';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ── Initialize ──
  render();
})();

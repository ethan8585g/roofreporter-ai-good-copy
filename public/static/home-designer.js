// ============================================================
// RoofReporterAI — Home Designer Frontend (Hover-Style)
//
// Multi-photo home visualization with AI roof recoloring
// and 2D bird's-eye diagram generation.
//
// Flow: Upload 3-5 Photos → AI Segments Roofs → Pick Material
//       → Generate Renders + 2D Diagram → Present to Homeowner
// ============================================================

(function () {
  'use strict';

  var root = document.getElementById('designer-root');
  var token = localStorage.getItem('rc_customer_token') || '';

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
    loading: false,
    error: null,
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
        '<div class="bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden">' +

          // Hero
          '<div class="bg-gradient-to-r from-sky-600 to-blue-700 px-6 py-8 text-center">' +
            '<div class="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-4 backdrop-blur">' +
              '<i class="fas fa-home text-white text-2xl"></i>' +
            '</div>' +
            '<h2 class="text-2xl font-bold text-white mb-2">Home Designer</h2>' +
            '<p class="text-sky-100 text-sm max-w-md mx-auto">Upload 3-5 exterior photos of any home. Our AI will segment the roof and let you visualize different roofing materials, colors, and styles — complete with a professional 2D diagram.</p>' +
          '</div>' +

          '<div class="p-6 space-y-4">' +

            '<div>' +
              '<label class="text-sm font-semibold text-gray-700 block mb-1">Project Name</label>' +
              '<input id="hd-project-name" type="text" placeholder="e.g., Johnson Residence" class="w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:border-sky-500 focus:ring-2 focus:ring-sky-200 outline-none text-sm">' +
            '</div>' +

            '<div>' +
              '<label class="text-sm font-semibold text-gray-700 block mb-1">Property Address <span class="text-gray-400 font-normal">(optional)</span></label>' +
              '<input id="hd-address" type="text" placeholder="e.g., 123 Maple Drive, Edmonton, AB" class="w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:border-sky-500 focus:ring-2 focus:ring-sky-200 outline-none text-sm">' +
            '</div>' +

            '<button onclick="window._hdCreateProject()" class="w-full py-3 bg-gradient-to-r from-sky-600 to-blue-600 text-white font-bold rounded-xl hover:from-sky-700 hover:to-blue-700 shadow-lg transition-all text-sm">' +
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

      var html = '<div class="border-t border-gray-200 pt-4">' +
        '<h4 class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3"><i class="fas fa-history mr-1"></i>Recent Projects</h4>' +
        '<div class="space-y-2">';

      res.projects.slice(0, 5).forEach(function (p) {
        var statusBadge = p.status === 'completed'
          ? '<span class="px-2 py-0.5 bg-green-100 text-green-700 text-[10px] rounded-full font-medium">Done</span>'
          : '<span class="px-2 py-0.5 bg-sky-100 text-sky-700 text-[10px] rounded-full font-medium">' + p.status + '</span>';

        html += '<button onclick="window._hdLoadProject(' + p.id + ')" class="w-full flex items-center justify-between p-3 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors text-left">' +
          '<div>' +
            '<p class="text-sm font-medium text-gray-800">' + (p.name || 'Untitled') + '</p>' +
            '<p class="text-[10px] text-gray-400">' + (p.property_address || 'No address') + ' &bull; ' + (p.photo_count || 0) + ' photos</p>' +
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
  // STEP 2: Upload 3-5 Photos
  // ════════════════════════════════════════════════════════

  function renderUpload() {
    var photoSlots = '';
    var angleLabels = ['Front', 'Left Side', 'Right Side', 'Rear', 'Detail'];

    for (var i = 0; i < 5; i++) {
      var hasPhoto = state.photos[i] && state.photos[i].preview;
      var label = angleLabels[i];

      if (hasPhoto) {
        photoSlots +=
          '<div class="relative group">' +
            '<div class="aspect-[4/3] rounded-xl overflow-hidden border-2 border-sky-400 shadow-md">' +
              '<img src="' + state.photos[i].preview + '" class="w-full h-full object-cover">' +
            '</div>' +
            '<div class="absolute inset-0 bg-black/40 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">' +
              '<button onclick="window._hdRemovePhoto(' + i + ')" class="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium"><i class="fas fa-trash mr-1"></i>Remove</button>' +
            '</div>' +
            '<span class="absolute bottom-2 left-2 px-2 py-0.5 bg-black/60 text-white text-[10px] rounded-lg font-medium">' + label + '</span>' +
            '<span class="absolute top-2 right-2 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center"><i class="fas fa-check text-white text-[8px]"></i></span>' +
          '</div>';
      } else {
        var required = i < 1 ? '<span class="text-red-400 text-[9px]">Required</span>' : '<span class="text-gray-300 text-[9px]">Optional</span>';
        photoSlots +=
          '<div onclick="window._hdTriggerUpload(' + i + ')" class="aspect-[4/3] rounded-xl border-2 border-dashed border-gray-300 hover:border-sky-400 hover:bg-sky-50 cursor-pointer transition-all flex flex-col items-center justify-center group">' +
            '<i class="fas fa-camera text-xl text-gray-300 group-hover:text-sky-400 mb-1 transition-colors"></i>' +
            '<span class="text-[11px] font-medium text-gray-400 group-hover:text-sky-500">' + label + '</span>' +
            required +
          '</div>';
      }
    }

    root.innerHTML =
      '<div class="max-w-3xl mx-auto">' +
        '<div class="bg-white rounded-2xl shadow-lg border border-gray-200 p-6">' +

          '<div class="flex items-center justify-between mb-6">' +
            '<div>' +
              '<h3 class="text-lg font-bold text-gray-900"><i class="fas fa-camera text-sky-500 mr-2"></i>Upload Exterior Photos</h3>' +
              '<p class="text-sm text-gray-500">Upload 1-5 clear exterior photos showing the roof from different angles.</p>' +
            '</div>' +
            '<button onclick="window._hdBack(1)" class="text-sm text-gray-400 hover:text-gray-600"><i class="fas fa-arrow-left mr-1"></i>Back</button>' +
          '</div>' +

          // Photo grid
          '<div class="grid grid-cols-3 md:grid-cols-5 gap-3 mb-6">' + photoSlots + '</div>' +

          // Hidden file input
          '<input type="file" id="hd-file-input" accept="image/jpeg,image/png,image/webp" class="hidden" onchange="window._hdFileSelected(this)">' +

          // Tips
          '<div class="bg-sky-50 border border-sky-200 rounded-xl p-4 mb-6">' +
            '<h4 class="font-semibold text-sky-800 text-sm mb-2"><i class="fas fa-lightbulb mr-1 text-amber-500"></i>Photo Tips for Best Results</h4>' +
            '<div class="grid grid-cols-2 gap-2 text-xs text-sky-700">' +
              '<div><i class="fas fa-check text-sky-500 mr-1"></i>Take photos in daylight</div>' +
              '<div><i class="fas fa-check text-sky-500 mr-1"></i>Show the full roofline</div>' +
              '<div><i class="fas fa-check text-sky-500 mr-1"></i>Multiple angles = better results</div>' +
              '<div><i class="fas fa-check text-sky-500 mr-1"></i>Minimize tree obstruction</div>' +
              '<div><i class="fas fa-check text-sky-500 mr-1"></i>Straight-on angles work best</div>' +
              '<div><i class="fas fa-check text-sky-500 mr-1"></i>Include some landscaping context</div>' +
            '</div>' +
          '</div>' +

          // Progress bar
          '<div class="flex items-center gap-2 mb-4">' +
            '<div class="flex-1 bg-gray-200 rounded-full h-2">' +
              '<div class="bg-sky-500 rounded-full h-2 transition-all" style="width:' + Math.min(100, (state.photos.length / 3) * 100) + '%"></div>' +
            '</div>' +
            '<span class="text-xs font-medium text-gray-500">' + state.photos.length + '/5 photos</span>' +
          '</div>' +

          // Continue button
          '<button onclick="window._hdContinueToSegment()" class="w-full py-3 bg-gradient-to-r from-sky-600 to-blue-600 text-white font-bold rounded-xl hover:from-sky-700 hover:to-blue-700 shadow-lg transition-all text-sm ' + (state.photos.length < 1 ? 'opacity-50 cursor-not-allowed' : '') + '" ' + (state.photos.length < 1 ? 'disabled' : '') + '>' +
            '<i class="fas fa-magic mr-2"></i>Analyze Roof (' + state.photos.length + ' photo' + (state.photos.length !== 1 ? 's' : '') + ')' +
          '</button>' +

        '</div>' +
      '</div>';
  }

  var uploadingIndex = 0;

  window._hdTriggerUpload = function (index) {
    uploadingIndex = index;
    document.getElementById('hd-file-input').click();
  };

  window._hdFileSelected = function (input) {
    if (!input.files || !input.files[0]) return;
    var file = input.files[0];

    if (file.size > MAX_PHOTO_SIZE_MB * 1024 * 1024) {
      alert('Photo too large. Maximum ' + MAX_PHOTO_SIZE_MB + 'MB.');
      return;
    }

    var reader = new FileReader();
    reader.onload = function (e) {
      var dataUrl = e.target.result;
      // Store in state
      while (state.photos.length <= uploadingIndex) {
        state.photos.push(null);
      }
      state.photos[uploadingIndex] = {
        file: file,
        preview: dataUrl,
        data: dataUrl,
        angle: ['front', 'left', 'right', 'rear', 'detail'][uploadingIndex] || 'photo-' + (uploadingIndex + 1),
      };
      // Clean nulls
      state.photos = state.photos.filter(function (p) { return p !== null; });
      render();
    };
    reader.readAsDataURL(file);
    input.value = '';
  };

  window._hdRemovePhoto = function (index) {
    state.photos.splice(index, 1);
    render();
  };

  window._hdBack = function (step) {
    state.step = step;
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

    // Upload photos then segment
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

      // Now segment
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
    root.innerHTML =
      '<div class="max-w-xl mx-auto">' +
        '<div class="bg-white rounded-2xl shadow-lg border border-gray-200 p-8 text-center">' +
          (state.error ?
            '<div class="text-center">' +
              '<div class="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">' +
                '<i class="fas fa-exclamation-triangle text-red-500 text-2xl"></i>' +
              '</div>' +
              '<h3 class="text-lg font-bold text-gray-900 mb-2">Analysis Failed</h3>' +
              '<p class="text-gray-500 mb-4 text-sm">' + state.error + '</p>' +
              '<button onclick="window._hdBack(2)" class="px-6 py-2 bg-sky-600 text-white rounded-xl text-sm font-medium hover:bg-sky-700"><i class="fas fa-redo mr-1"></i>Try Again</button>' +
            '</div>'
          :
            '<div class="relative w-20 h-20 mx-auto mb-6">' +
              '<div class="absolute inset-0 rounded-full border-4 border-gray-200"></div>' +
              '<div class="absolute inset-0 rounded-full border-4 border-sky-500 border-t-transparent animate-spin"></div>' +
              '<div class="absolute inset-3 bg-gradient-to-br from-sky-500 to-blue-600 rounded-full flex items-center justify-center">' +
                '<i class="fas fa-brain text-white text-xl"></i>' +
              '</div>' +
            '</div>' +
            '<h3 class="text-lg font-bold text-gray-900 mb-2">AI Analyzing Your Photos</h3>' +
            '<p class="text-gray-500 text-sm mb-4">Our AI is detecting roof boundaries, identifying the current material, and preparing for visualization...</p>' +
            '<div class="space-y-2 text-left max-w-sm mx-auto">' +
              '<div class="flex items-center gap-2 text-sm text-gray-600"><div class="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center"><i class="fas fa-check text-green-500 text-[10px]"></i></div>Photos uploaded</div>' +
              '<div class="flex items-center gap-2 text-sm text-sky-600"><div class="w-5 h-5 rounded-full bg-sky-100 flex items-center justify-center animate-pulse"><i class="fas fa-cog fa-spin text-sky-500 text-[10px]"></i></div>Segmenting roof areas...</div>' +
              '<div class="flex items-center gap-2 text-sm text-gray-400"><div class="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center"><i class="fas fa-clock text-gray-300 text-[10px]"></i></div>Material selection</div>' +
              '<div class="flex items-center gap-2 text-sm text-gray-400"><div class="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center"><i class="fas fa-clock text-gray-300 text-[10px]"></i></div>Render generation</div>' +
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
      root.innerHTML = '<div class="text-center py-12"><div class="animate-spin text-sky-500 text-2xl"><i class="fas fa-spinner"></i></div><p class="text-gray-400 text-sm mt-2">Loading catalog...</p></div>';
      return;
    }

    var categories = Object.keys(state.catalog);
    var catTabs = categories.map(function (catId) {
      var cat = state.catalog[catId];
      var active = catId === state.selectedCategory;
      return '<button onclick="window._hdSelectCat(\'' + catId + '\')" class="px-4 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap ' +
        (active ? 'bg-sky-600 text-white shadow' : 'bg-gray-100 text-gray-600 hover:bg-gray-200') + '">' +
        '<i class="fas ' + cat.icon + ' mr-1"></i>' + cat.label +
      '</button>';
    }).join('');

    var activeCat = state.catalog[state.selectedCategory];
    var productsHtml = '';
    if (activeCat && activeCat.products) {
      productsHtml = activeCat.products.map(function (prod) {
        var selected = state.selectedProduct && state.selectedProduct.id === prod.id;
        return '<button onclick="window._hdSelectProduct(\'' + prod.id + '\')" class="p-3 rounded-xl border-2 transition-all text-left ' +
          (selected ? 'border-sky-500 bg-sky-50 ring-2 ring-sky-200 shadow-md' : 'border-gray-200 hover:border-gray-300 hover:shadow') + '">' +
          '<div class="flex items-center gap-3">' +
            '<div class="w-10 h-10 rounded-lg border border-gray-300 shadow-inner flex-shrink-0" style="background:' + prod.hex + '"></div>' +
            '<div class="min-w-0 flex-1">' +
              '<p class="text-sm font-semibold ' + (selected ? 'text-sky-700' : 'text-gray-800') + ' truncate">' + prod.name + '</p>' +
              '<p class="text-[10px] text-gray-400 truncate">' + prod.brand + ' &bull; ' + prod.type + '</p>' +
              '<p class="text-[10px] text-gray-400">' + prod.warranty + ' warranty &bull; $' + prod.price_per_sqft.toFixed(2) + '/sqft</p>' +
            '</div>' +
          '</div>' +
          (selected ? '<div class="mt-2 flex items-center gap-1"><i class="fas fa-check-circle text-sky-500 text-xs"></i><span class="text-sky-600 text-[10px] font-medium">Selected</span></div>' : '') +
        '</button>';
      }).join('');
    }

    // Segmentation summary
    var segSummary = '';
    if (state.segmentationResults.length > 0) {
      var roofTypes = state.segmentationResults.map(function (s) { return s.roof_type; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
      segSummary =
        '<div class="bg-green-50 border border-green-200 rounded-xl p-4 mb-6">' +
          '<h4 class="font-semibold text-green-800 text-sm mb-2"><i class="fas fa-check-circle mr-1 text-green-500"></i>Roof Analysis Complete</h4>' +
          '<div class="grid grid-cols-3 gap-3 text-center">' +
            '<div><p class="text-lg font-bold text-green-700">' + state.segmentationResults.length + '</p><p class="text-[10px] text-green-600">Photos Analyzed</p></div>' +
            '<div><p class="text-lg font-bold text-green-700">' + roofTypes.join(', ') + '</p><p class="text-[10px] text-green-600">Roof Type</p></div>' +
            '<div><p class="text-lg font-bold text-green-700">' + state.segmentationResults.filter(function (s) { return s.roof_detected; }).length + '</p><p class="text-[10px] text-green-600">Roofs Detected</p></div>' +
          '</div>' +
        '</div>';
    }

    root.innerHTML =
      '<div class="max-w-4xl mx-auto">' +
        '<div class="bg-white rounded-2xl shadow-lg border border-gray-200 p-6">' +

          '<div class="flex items-center justify-between mb-4">' +
            '<div>' +
              '<h3 class="text-lg font-bold text-gray-900"><i class="fas fa-palette text-sky-500 mr-2"></i>Choose Roofing Material</h3>' +
              '<p class="text-sm text-gray-500">Select the material and color to visualize on your home.</p>' +
            '</div>' +
            '<button onclick="window._hdBack(2)" class="text-sm text-gray-400 hover:text-gray-600"><i class="fas fa-arrow-left mr-1"></i>Back</button>' +
          '</div>' +

          segSummary +

          // Category tabs
          '<div class="flex gap-2 overflow-x-auto pb-2 mb-4 scrollbar-hide">' + catTabs + '</div>' +

          // Products grid
          '<div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6 max-h-[400px] overflow-y-auto">' + productsHtml + '</div>' +

          // Preview of selected
          (state.selectedProduct ?
            '<div class="bg-sky-50 border border-sky-200 rounded-xl p-4 mb-4">' +
              '<div class="flex items-center gap-4">' +
                '<div class="w-16 h-16 rounded-xl border-2 border-sky-300 shadow-lg" style="background:' + state.selectedProduct.hex + '"></div>' +
                '<div>' +
                  '<p class="font-bold text-gray-800">' + state.selectedProduct.name + '</p>' +
                  '<p class="text-sm text-gray-500">' + state.selectedProduct.brand + ' &bull; ' + state.selectedProduct.type + '</p>' +
                  '<p class="text-xs text-gray-400">' + state.selectedProduct.warranty + ' &bull; CAD $' + state.selectedProduct.price_per_sqft.toFixed(2) + '/sqft installed</p>' +
                '</div>' +
              '</div>' +
            '</div>'
          : '') +

          // Generate button
          '<button onclick="window._hdGenerate()" class="w-full py-3.5 bg-gradient-to-r from-sky-600 to-blue-600 text-white font-bold rounded-xl hover:from-sky-700 hover:to-blue-700 shadow-lg transition-all text-sm ' + (!state.selectedProduct ? 'opacity-50 cursor-not-allowed' : '') + '" ' + (!state.selectedProduct ? 'disabled' : '') + '>' +
            '<i class="fas fa-magic mr-2"></i>Generate Roof Visualization + 2D Diagram' +
          '</button>' +

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

    state.step = 3; // Show processing screen
    state.error = null;
    render();

    // Update the processing screen to show render step
    setTimeout(function () {
      var el = root.querySelector('.space-y-2');
      if (el) {
        el.innerHTML =
          '<div class="flex items-center gap-2 text-sm text-green-600"><div class="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center"><i class="fas fa-check text-green-500 text-[10px]"></i></div>Photos uploaded</div>' +
          '<div class="flex items-center gap-2 text-sm text-green-600"><div class="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center"><i class="fas fa-check text-green-500 text-[10px]"></i></div>Roofs segmented</div>' +
          '<div class="flex items-center gap-2 text-sm text-green-600"><div class="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center"><i class="fas fa-check text-green-500 text-[10px]"></i></div>Material selected: ' + state.selectedProduct.name + '</div>' +
          '<div class="flex items-center gap-2 text-sm text-sky-600"><div class="w-5 h-5 rounded-full bg-sky-100 flex items-center justify-center animate-pulse"><i class="fas fa-cog fa-spin text-sky-500 text-[10px]"></i></div>Generating visualizations...</div>';
      }
    }, 300);

    // Fire both requests in parallel: renders + diagram
    var prod = state.selectedProduct;
    var categoryName = state.catalog[state.selectedCategory]?.label || state.selectedCategory;

    Promise.all([
      // Generate recolored renders
      api('POST', '/projects/' + state.projectId + '/generate', {
        material_id: prod.id,
        material_name: prod.name + ' (' + prod.brand + ')',
        material_hex: prod.hex,
        material_type: categoryName,
      }),
      // Generate 2D diagram
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
  // STEP 5: Results — Before/After + 2D Diagram
  // ════════════════════════════════════════════════════════

  function renderResults() {
    var prod = state.selectedProduct;
    var prodName = prod ? prod.name : 'Selected Material';
    var prodHex = prod ? prod.hex : '#36454F';

    // Render cards for each photo
    var photoCards = '';
    for (var i = 0; i < state.photos.length; i++) {
      var photo = state.photos[i];
      var result = state.generateResults[i];
      var hasRender = result && result.render_description;

      photoCards +=
        '<div class="bg-gray-50 rounded-xl border border-gray-200 overflow-hidden">' +
          '<div class="grid grid-cols-2 gap-0">' +
            // Before
            '<div class="relative">' +
              (photo.preview ? '<img src="' + photo.preview + '" class="w-full aspect-[4/3] object-cover">' :
                '<div class="w-full aspect-[4/3] bg-gray-200 flex items-center justify-center"><i class="fas fa-image text-gray-300 text-xl"></i></div>') +
              '<span class="absolute top-2 left-2 px-2 py-0.5 bg-black/60 text-white text-[10px] rounded-lg font-medium">Before</span>' +
            '</div>' +
            // After (rendered visualization)
            '<div class="relative">' +
              '<div class="w-full aspect-[4/3] flex items-center justify-center" style="background: linear-gradient(135deg, ' + prodHex + '22, ' + prodHex + '44)">' +
                (hasRender ?
                  '<div class="p-3 text-center">' +
                    '<div class="w-12 h-12 rounded-lg mx-auto mb-2 border-2 border-white/30 shadow" style="background:' + prodHex + '"></div>' +
                    '<p class="text-xs font-medium text-gray-700">AI Visualization</p>' +
                    '<p class="text-[10px] text-gray-500 mt-1">Curb appeal: ' + (result.curb_appeal_rating || 'N/A') + '/10</p>' +
                  '</div>'
                :
                  '<div class="text-center"><i class="fas fa-magic text-gray-300 text-xl mb-1"></i><p class="text-[10px] text-gray-400">Processing...</p></div>'
                ) +
              '</div>' +
              '<span class="absolute top-2 left-2 px-2 py-0.5 bg-sky-600 text-white text-[10px] rounded-lg font-medium">After — ' + prodName + '</span>' +
            '</div>' +
          '</div>' +

          // Render details
          (hasRender ?
            '<div class="p-3 border-t border-gray-200">' +
              '<p class="text-xs text-gray-600 line-clamp-3">' + (result.render_description || '').substring(0, 200) + '...</p>' +
              (result.recommendations ?
                '<div class="mt-2 flex flex-wrap gap-1">' +
                  result.recommendations.slice(0, 3).map(function (r) {
                    return '<span class="px-2 py-0.5 bg-sky-100 text-sky-700 text-[9px] rounded-full">' + r + '</span>';
                  }).join('') +
                '</div>'
              : '') +
            '</div>'
          : '') +
        '</div>';
    }

    root.innerHTML =
      '<div class="max-w-5xl mx-auto space-y-6">' +

        // Header
        '<div class="bg-white rounded-2xl shadow-lg border border-gray-200 p-6">' +
          '<div class="flex items-center justify-between">' +
            '<div>' +
              '<h3 class="text-lg font-bold text-gray-900"><i class="fas fa-check-circle text-green-500 mr-2"></i>Design Complete — ' + (state.projectName || 'Your Home') + '</h3>' +
              '<p class="text-sm text-gray-500">' + prodName + ' &bull; ' + (state.propertyAddress || '') + '</p>' +
            '</div>' +
            '<div class="flex gap-2">' +
              '<button onclick="window._hdBack(4)" class="px-4 py-2 bg-gray-200 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-300"><i class="fas fa-palette mr-1"></i>Try Another Style</button>' +
              '<button onclick="window._hdBack(1)" class="px-4 py-2 bg-gray-100 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-200"><i class="fas fa-plus mr-1"></i>New Project</button>' +
              '<button onclick="window._hdPrint()" class="px-4 py-2 bg-sky-600 text-white rounded-xl text-sm font-medium hover:bg-sky-700"><i class="fas fa-print mr-1"></i>Print / PDF</button>' +
            '</div>' +
          '</div>' +
        '</div>' +

        // Photo comparisons
        '<div class="bg-white rounded-2xl shadow-lg border border-gray-200 p-6">' +
          '<h4 class="font-bold text-gray-800 text-sm mb-4"><i class="fas fa-images text-sky-500 mr-2"></i>Before & After Comparison</h4>' +
          '<div class="grid grid-cols-1 md:grid-cols-2 gap-4">' + photoCards + '</div>' +
        '</div>' +

        // 2D Diagram
        '<div class="bg-white rounded-2xl shadow-lg border border-gray-200 p-6">' +
          '<h4 class="font-bold text-gray-800 text-sm mb-4"><i class="fas fa-drafting-compass text-sky-500 mr-2"></i>2D Roof Diagram — Bird\'s Eye View</h4>' +
          '<div id="hd-diagram-container" class="bg-gray-50 rounded-xl border border-gray-200 p-4 min-h-[300px] flex items-center justify-center">' +
            (state.diagramSvg ?
              '<div class="w-full">' + state.diagramSvg + '</div>'
            :
              '<div class="text-center"><i class="fas fa-spinner fa-spin text-gray-300 text-xl mb-2"></i><p class="text-xs text-gray-400">Generating 2D diagram...</p></div>'
            ) +
          '</div>' +
          '<div class="mt-3 flex items-center justify-between">' +
            '<p class="text-[10px] text-gray-400"><i class="fas fa-info-circle mr-1"></i>AI-generated roof diagram. Measurements are estimates based on photo analysis.</p>' +
            (state.diagramSvg ?
              '<button onclick="window._hdDownloadDiagram()" class="px-3 py-1.5 bg-sky-600 text-white rounded-lg text-xs font-medium hover:bg-sky-700"><i class="fas fa-download mr-1"></i>Download SVG</button>'
            : '') +
          '</div>' +
        '</div>' +

        // Material spec card
        (prod ?
          '<div class="bg-white rounded-2xl shadow-lg border border-gray-200 p-6">' +
            '<h4 class="font-bold text-gray-800 text-sm mb-4"><i class="fas fa-clipboard-list text-sky-500 mr-2"></i>Selected Material Specification</h4>' +
            '<div class="grid grid-cols-2 md:grid-cols-4 gap-4">' +
              '<div class="text-center p-3 bg-gray-50 rounded-xl">' +
                '<div class="w-12 h-12 rounded-lg mx-auto mb-2 border border-gray-300 shadow-inner" style="background:' + prod.hex + '"></div>' +
                '<p class="text-sm font-bold text-gray-800">' + prod.name + '</p>' +
                '<p class="text-[10px] text-gray-400">' + prod.brand + '</p>' +
              '</div>' +
              '<div class="text-center p-3 bg-gray-50 rounded-xl">' +
                '<p class="text-xs text-gray-500 mb-1">Type</p>' +
                '<p class="text-sm font-bold text-gray-800">' + prod.type + '</p>' +
              '</div>' +
              '<div class="text-center p-3 bg-gray-50 rounded-xl">' +
                '<p class="text-xs text-gray-500 mb-1">Warranty</p>' +
                '<p class="text-sm font-bold text-gray-800">' + prod.warranty + '</p>' +
              '</div>' +
              '<div class="text-center p-3 bg-gray-50 rounded-xl">' +
                '<p class="text-xs text-gray-500 mb-1">Price / sq ft</p>' +
                '<p class="text-sm font-bold text-gray-800">CAD $' + prod.price_per_sqft.toFixed(2) + '</p>' +
              '</div>' +
            '</div>' +
          '</div>'
        : '') +

        // Disclaimer
        '<div class="text-center pb-4">' +
          '<p class="text-[10px] text-gray-400"><i class="fas fa-info-circle mr-1"></i>AI-generated visualization for presentation purposes only. Actual installed roofing may vary in appearance due to material, lighting, and installation. Pricing is estimated — contact for a detailed quote.</p>' +
        '</div>' +

      '</div>';
  }

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

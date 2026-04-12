// ============================================================
// Customer Order Page — Roof Pin + Trace + Pricing
// 3-Step flow: Pin Roof → Trace Outline → Review & Pay
// ============================================================

const orderState = {
  step: 'pin', // 'pin' | 'trace' | 'review'
  billing: null,
  packages: [],
  selectedTier: 'standard',
  lat: '',
  lng: '',
  address: '',
  city: '',
  province: '',
  postalCode: '',
  mapReady: false,
  loading: true,
  ordering: false,
  marker: null,
  map: null,
  pinPlaced: false,
  // Tracing state
  traceMap: null,
  traceMode: 'eaves',
  traceEavesPoints: [],
  traceRidgeLines: [],
  traceHipLines: [],
  traceValleyLines: [],
  traceCurrentLine: [],
  tracePolylines: [],
  traceEavesPolygon: null,
  traceEavesSections: [],          // [{points:[{lat,lng}]}] completed closed sections
  traceEavesSectionPolygons: [],   // [google.maps.Polygon] polygon objects for each section
  traceMarkers: [],
  // Annotation markers (vents, skylights, chimneys) — single-click point placement
  traceVents: [],
  traceSkylights: [],
  traceChimneys: [],
  traceAnnotationMarkers: [], // [{marker, type}] — separate from traceMarkers so clearTraceOverlays keeps them
  // Pricing
  pricePerBundle: null,
  roofTraceJson: null,
  // House size for cross-validation
  houseSqft: null, // Known house living area in sq ft
  liveFootprintSqft: null, // Computed live from eaves trace
  livePerimeterFt: null, // Computed live from eaves trace
  // Measurement engine results (calculated before order submission)
  measurementResult: null,
  measurementLoading: false,
  measurementError: null,
};

function getToken() { return localStorage.getItem('rc_customer_token') || localStorage.getItem('rc_token') || ''; }
function authHeaders() { return { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' }; }

document.addEventListener('DOMContentLoaded', async () => {
  await loadOrderData();
  renderOrderPage();
  initMap();
});

async function loadOrderData() {
  orderState.loading = true;
  try {
    const [billingRes, pkgRes] = await Promise.all([
      fetch('/api/square/billing', { headers: authHeaders() }),
      fetch('/api/square/packages')
    ]);
    if (billingRes.ok) {
      const bd = await billingRes.json();
      orderState.billing = bd.billing;
      const remaining = bd.billing.credits_remaining || 0;
      const badge = document.getElementById('creditsBadge');
      const countEl = document.getElementById('creditsCount');
      if (badge && countEl && remaining > 0) {
        countEl.textContent = remaining;
        badge.classList.remove('hidden');
      }
    }
    if (pkgRes.ok) {
      const pd = await pkgRes.json();
      orderState.packages = pd.packages || [];
    }
  } catch (e) {
    console.error('Failed to load order data:', e);
  }
  orderState.loading = false;
}

// ============================================================
// MAP INITIALIZATION — STEP 1: PIN
// ============================================================
let _mapInitAttempts = 0;
let _placesInitialized = false;

function initMap() {
  // 1) Wait for Google Maps API to be available
  if (typeof google === 'undefined' || !google.maps) {
    _mapInitAttempts++;
    if (_mapInitAttempts < 100) {
      setTimeout(initMap, 300);
    } else {
      console.error('[Maps] Google Maps API failed to load after 30s');
      const mapEl = document.getElementById('orderMap');
      if (mapEl) mapEl.innerHTML = '<div class="flex items-center justify-center h-full bg-red-500/10 rounded-xl"><p class="text-red-400 text-sm"><i class="fas fa-exclamation-triangle mr-2"></i>Map failed to load. Please refresh the page.</p></div>';
    }
    return;
  }

  // 2) Wait for the #orderMap DOM element to exist (may not be rendered yet)
  const mapEl = document.getElementById('orderMap');
  if (!mapEl) {
    _mapInitAttempts++;
    if (_mapInitAttempts < 100) {
      setTimeout(initMap, 300);
      console.log('[Maps] Waiting for #orderMap element... attempt', _mapInitAttempts);
    } else {
      console.error('[Maps] #orderMap element never appeared after 30s');
    }
    return;
  }

  // 3) If map already exists and is attached to THIS element, just restore marker
  if (orderState.map && orderState.mapReady && mapEl.children.length > 0) {
    if (orderState.pinPlaced && orderState.lat && orderState.lng) {
      placeMarker(parseFloat(orderState.lat), parseFloat(orderState.lng));
    }
    return;
  }

  // 4) Create a fresh map instance
  orderState.map = null;
  orderState.mapReady = false;
  _placesInitialized = false;

  const center = (orderState.lat && orderState.lng)
    ? { lat: parseFloat(orderState.lat), lng: parseFloat(orderState.lng) }
    : { lat: 53.5461, lng: -113.4938 };
  const zoom = (orderState.lat && orderState.lng) ? 18 : 13;

  orderState.map = new google.maps.Map(mapEl, {
    center: center,
    zoom: zoom,
    mapTypeId: 'hybrid',
    mapTypeControl: true,
    mapTypeControlOptions: {
      style: google.maps.MapTypeControlStyle.HORIZONTAL_BAR,
      position: google.maps.ControlPosition.TOP_RIGHT,
      mapTypeIds: ['roadmap', 'satellite', 'hybrid']
    },
    streetViewControl: false,
    fullscreenControl: true,
    zoomControl: true,
    gestureHandling: 'greedy',
  });

  orderState.map.addListener('click', (e) => {
    placeMarker(e.latLng.lat(), e.latLng.lng());
  });

  // Initialize Places autocomplete with retry
  initPlacesAutocomplete();

  // Restore marker if returning from a later step
  if (orderState.pinPlaced && orderState.lat && orderState.lng) {
    placeMarker(parseFloat(orderState.lat), parseFloat(orderState.lng));
  }

  orderState.mapReady = true;
  _mapInitAttempts = 0;
  console.log('[Maps] Map initialized successfully on #orderMap');
}

// Separate Places init with its own retry — Places library may load after google.maps
let _placesRetries = 0;
function initPlacesAutocomplete() {
  const searchInput = document.getElementById('mapSearchInput');
  if (!searchInput || _placesInitialized) return;

  if (!google.maps.places) {
    _placesRetries++;
    if (_placesRetries < 30) { // Up to ~9s of retries for Places
      setTimeout(initPlacesAutocomplete, 300);
    } else {
      console.error('[Maps] Places library failed to load');
    }
    return;
  }

  try {
    const autocomplete = new google.maps.places.Autocomplete(searchInput, {
      componentRestrictions: { country: 'ca' },
      fields: ['geometry', 'formatted_address', 'address_components']
    });
    if (orderState.map) autocomplete.bindTo('bounds', orderState.map);
    autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace();
      if (place.geometry && place.geometry.location) {
        const lat = place.geometry.location.lat();
        const lng = place.geometry.location.lng();
        if (orderState.map) {
          orderState.map.setCenter({ lat, lng });
          orderState.map.setZoom(19);
        }
        placeMarker(lat, lng);
        if (place.address_components) {
          parseAddressComponents(place.address_components, place.formatted_address);
        }
      }
    });
    _placesInitialized = true;
    _placesRetries = 0;
    console.log('[Maps] Places autocomplete initialized');
  } catch (e) {
    console.error('[Maps] Places autocomplete error:', e);
  }
}

function placeMarker(lat, lng) {
  lat = Math.round(lat * 10000000) / 10000000;
  lng = Math.round(lng * 10000000) / 10000000;
  orderState.lat = lat;
  orderState.lng = lng;
  orderState.pinPlaced = true;

  const latInput = document.getElementById('orderLat');
  const lngInput = document.getElementById('orderLng');
  if (latInput) latInput.value = lat;
  if (lngInput) lngInput.value = lng;

  if (orderState.marker) orderState.marker.setMap(null);
  orderState.marker = new google.maps.Marker({
    position: { lat, lng },
    map: orderState.map,
    draggable: true,
    animation: google.maps.Animation.DROP,
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 10,
      fillColor: '#EF4444',
      fillOpacity: 1,
      strokeColor: '#FFFFFF',
      strokeWeight: 3,
    }
  });

  orderState.marker.addListener('dragend', (e) => {
    placeMarker(e.latLng.lat(), e.latLng.lng());
  });

  orderState.map.panTo({ lat, lng });
  if (orderState.map.getZoom() < 17) orderState.map.setZoom(18);
  reverseGeocode(lat, lng);
  updateCoordDisplay(lat, lng);

  // Enable next button
  const nextBtn = document.getElementById('pinNextBtn');
  if (nextBtn) {
    nextBtn.disabled = false;
    nextBtn.className = 'flex-1 py-3 bg-emerald-600 hover:bg-brand-700 text-white font-bold rounded-xl transition-all shadow-lg text-base';
  }
  const adminBtn = document.getElementById('adminMeasureBtn');
  if (adminBtn) {
    adminBtn.disabled = false;
    adminBtn.style.background = '#f59e0b';
    adminBtn.style.cursor = 'pointer';
  }

  const msgEl = document.getElementById('orderMsg');
  if (msgEl) msgEl.classList.add('hidden');
}

function updateCoordDisplay(lat, lng) {
  const display = document.getElementById('coordDisplay');
  if (display) {
    display.innerHTML = `
      <div class="flex items-center gap-2 text-sm">
        <i class="fas fa-map-pin text-red-500"></i>
        <span class="font-mono font-semibold text-gray-100">${lat}, ${lng}</span>
        <span class="text-emerald-400 font-medium"><i class="fas fa-check-circle mr-1"></i>Pin placed</span>
      </div>`;
    display.classList.remove('hidden');
  }
  const addrDisplay = document.getElementById('resolvedAddress');
  if (addrDisplay) {
    addrDisplay.innerHTML = '<i class="fas fa-spinner fa-spin text-gray-400 mr-1"></i><span class="text-gray-400 text-sm">Looking up address...</span>';
    addrDisplay.classList.remove('hidden');
  }
}

async function reverseGeocode(lat, lng) {
  try {
    if (typeof google !== 'undefined' && google.maps && google.maps.Geocoder) {
      const geocoder = new google.maps.Geocoder();
      const result = await new Promise((resolve, reject) => {
        geocoder.geocode({ location: { lat, lng } }, (results, status) => {
          if (status === 'OK' && results[0]) resolve(results[0]);
          else reject(new Error(status));
        });
      });
      orderState.address = result.formatted_address || `${lat}, ${lng}`;
      parseAddressComponents(result.address_components, result.formatted_address);
      const addrDisplay = document.getElementById('resolvedAddress');
      if (addrDisplay) {
        addrDisplay.innerHTML = `<i class="fas fa-map-marker-alt text-emerald-400 mr-1"></i><span class="text-sm text-gray-300 font-medium">${orderState.address}</span>`;
      }
    }
  } catch (e) {
    orderState.address = `${lat}, ${lng}`;
  }
}

function parseAddressComponents(components, formattedAddress) {
  orderState.address = formattedAddress || orderState.address;
  for (const comp of components) {
    if (comp.types.includes('locality')) orderState.city = comp.long_name;
    if (comp.types.includes('administrative_area_level_1')) orderState.province = comp.short_name;
    if (comp.types.includes('postal_code')) orderState.postalCode = comp.long_name;
  }
}

function handleManualCoordInput() {
  const latEl = document.getElementById('orderLat');
  const lngEl = document.getElementById('orderLng');
  if (latEl) orderState.lat = parseFloat(latEl.value) || '';
  if (lngEl) orderState.lng = parseFloat(lngEl.value) || '';
}

function goToManualCoords() {
  const lat = parseFloat(orderState.lat);
  const lng = parseFloat(orderState.lng);
  if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    showMsg('error', '<i class="fas fa-exclamation-triangle mr-1"></i>Enter valid coordinates.');
    return;
  }
  placeMarker(lat, lng);
}

// ============================================================
// RENDER — Routes to current step
// ============================================================
function renderOrderPage() {
  const root = document.getElementById('order-root');
  if (!root) return;

  if (orderState.loading) {
    root.innerHTML = '<div class="flex items-center justify-center py-12"><div class="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-brand-500"></div><span class="ml-3 text-gray-500">Loading...</span></div>';
    return;
  }

  // Step progress bar
  const steps = [
    { id: 'pin', label: 'Pin Roof', icon: 'fa-crosshairs' },
    { id: 'trace', label: 'Trace Outline', icon: 'fa-draw-polygon' },
    { id: 'review', label: 'Review & Pay', icon: 'fa-credit-card' },
  ];
  const stepIdx = steps.findIndex(s => s.id === orderState.step);

  const progressBar = `
    <div class="flex items-center justify-center gap-2 mb-6">
      ${steps.map((s, i) => {
        const done = i < stepIdx;
        const active = i === stepIdx;
        const cls = done ? 'bg-brand-100 text-brand-700' : active ? 'bg-emerald-600 text-white' : 'bg-white/5 text-gray-400';
        return `
          <div class="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold ${cls}">
            <i class="fas ${done ? 'fa-check-circle' : s.icon}"></i> ${s.label}
          </div>
          ${i < steps.length - 1 ? '<i class="fas fa-arrow-right text-gray-300 text-xs"></i>' : ''}
        `;
      }).join('')}
    </div>
  `;

  if (orderState.step === 'pin') {
    renderPinStep(root, progressBar);
  } else if (orderState.step === 'trace') {
    renderTraceStep(root, progressBar);
  } else if (orderState.step === 'review') {
    renderReviewStep(root, progressBar);
  }
}

// ============================================================
// STEP 1: PIN THE ROOF
// ============================================================
function renderPinStep(root, progressBar) {
  const b = orderState.billing || {};
  const freeTrialRemaining = b.free_trial_remaining || 0;
  const paidCredits = b.paid_credits_remaining || 0;
  const isTrialAvailable = freeTrialRemaining > 0;
  const credits = b.credits_remaining || 0;

  root.innerHTML = `
    <div class="max-w-3xl mx-auto">
      ${progressBar}

      <!-- Credits Banner -->
      ${isTrialAvailable ? `
        <div class="bg-blue-500/10 border border-blue-200 rounded-xl p-4 mb-6">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center"><i class="fas fa-gift text-blue-400"></i></div>
              <div>
                <p class="font-semibold text-blue-800"><i class="fas fa-star text-gray-400 mr-1"></i>Free Trial: ${freeTrialRemaining} reports remaining!</p>
                <p class="text-sm text-blue-400">No credit card needed</p>
              </div>
            </div>
            <span class="bg-blue-600 text-white px-3 py-1.5 rounded-full text-lg font-bold">${freeTrialRemaining}</span>
          </div>
        </div>
      ` : paidCredits > 0 ? `
        <div class="bg-emerald-500/10 border border-green-200 rounded-xl p-4 mb-6">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center"><i class="fas fa-coins text-emerald-400"></i></div>
              <div>
                <p class="font-semibold text-green-800">You have ${paidCredits} paid credit${paidCredits !== 1 ? 's' : ''} remaining</p>
              </div>
            </div>
            <span class="bg-green-600 text-white px-3 py-1.5 rounded-full text-lg font-bold">${paidCredits}</span>
          </div>
        </div>
      ` : `
        <div class="bg-gradient-to-r from-brand-800 to-brand-900 rounded-xl p-5 mb-6 shadow-lg">
          <div class="flex items-center justify-between gap-4">
            <div class="flex items-center gap-4">
              <div class="w-12 h-12 bg-blue-500/15/100 rounded-xl flex items-center justify-center shadow"><i class="fas fa-crown text-white text-xl"></i></div>
              <div>
                <p class="font-bold text-white text-base">Your 3 Free Trials Are Used Up!</p>
                <p class="text-sm text-brand-200 mt-0.5">Subscribe to <strong class="text-emerald-300">Roof Manager Pro</strong> for just <strong class="text-white">$49/month</strong></p>
              </div>
            </div>
            <button onclick="showSubscriptionRequiredOverlay()" class="bg-emerald-500 hover:bg-emerald-600 text-white px-5 py-2.5 rounded-xl text-sm font-black transition-all shadow-lg border-0 cursor-pointer"><i class="fas fa-crown mr-1.5"></i>Subscribe</button>
          </div>
        </div>
      `}

      <!-- Order Form -->
      <div class="bg-[#111111] rounded-2xl border border-white/10 shadow-sm overflow-hidden">
        <div class="bg-gradient-to-r from-[#111111] to-[#1a1a1a] text-white p-6">
          <h2 class="text-xl font-bold"><i class="fas fa-crosshairs mr-2"></i>Step 1: Pin the Roof</h2>
          <p class="text-brand-200 text-sm mt-1">Click the map or search an address to place a pin on the exact roof</p>
        </div>

        <div class="p-6 space-y-5">
          <div>
            <label class="block text-sm font-semibold text-gray-300 mb-2"><i class="fas fa-search mr-1"></i>Search Address</label>
            <input type="text" id="mapSearchInput" placeholder="Search an address..."
              class="w-full px-4 py-3 border border-white/15 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm" style="color:var(--text-primary)">
          </div>

          <div>
            <label class="block text-sm font-semibold text-gray-300 mb-2"><i class="fas fa-map mr-1"></i>Click Map to Place Roof Pin *</label>
            <div id="orderMap" class="w-full h-80 rounded-xl border-2 border-white/15 overflow-hidden" style="min-height: 320px;"></div>
            <p class="text-xs text-gray-400 mt-1"><i class="fas fa-info-circle mr-1"></i>Click directly on the roof. Drag the pin to adjust.</p>
          </div>

          <div id="coordDisplay" class="hidden bg-[#0A0A0A] border border-white/10 rounded-xl px-4 py-3"></div>
          <div id="resolvedAddress" class="hidden bg-blue-500/10 border border-blue-100 rounded-xl px-4 py-2.5"></div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-semibold text-gray-300 mb-1"><i class="fas fa-arrows-alt-v mr-1 text-emerald-400"></i>Latitude *</label>
              <input type="number" step="any" id="orderLat" placeholder="e.g. 53.5461" value="${orderState.lat}"
                class="w-full px-4 py-3 border border-white/15 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm font-mono"
                oninput="handleManualCoordInput()">
            </div>
            <div>
              <label class="block text-sm font-semibold text-gray-300 mb-1"><i class="fas fa-arrows-alt-h mr-1 text-emerald-400"></i>Longitude *</label>
              <input type="number" step="any" id="orderLng" placeholder="e.g. -113.4938" value="${orderState.lng}"
                class="w-full px-4 py-3 border border-white/15 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm font-mono"
                oninput="handleManualCoordInput()">
            </div>
          </div>
          <button onclick="goToManualCoords()" class="text-xs bg-white/5 hover:bg-gray-200 text-gray-400 px-3 py-1.5 rounded-lg transition-colors -mt-2">
            <i class="fas fa-location-arrow mr-1"></i>Go to Coords
          </button>

          <!-- Known House Size (optional cross-validation) -->
          <div class="bg-gradient-to-r from-blue-600 to-blue-700 rounded-xl border border-blue-500/20 p-4">
            <h4 class="font-semibold text-gray-300 mb-1 flex items-center text-sm">
              <i class="fas fa-home text-blue-400 mr-2"></i>Known House Size (Optional)
            </h4>
            <p class="text-xs text-gray-500 mb-2">Enter your house living area so we can cross-check the roof trace. The roof footprint is typically 10-15% larger than house sq ft (eave overhangs).</p>
            <div class="flex items-center gap-3">
              <div class="relative flex-1">
                <input type="number" step="1" min="0" max="99999" id="houseSqftInput"
                  value="${orderState.houseSqft || ''}"
                  oninput="orderState.houseSqft = parseInt(this.value) || null;"
                  class="w-full px-4 py-2.5 border border-blue-500/20 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm font-medium"
                  placeholder="e.g. 1750" />
                <span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 font-medium">sq ft</span>
              </div>
              <div class="text-xs text-blue-400 font-medium whitespace-nowrap">
                ${orderState.houseSqft ? `Expected roof: ~${Math.round(orderState.houseSqft * 1.12)}–${Math.round(orderState.houseSqft * 1.18)} sq ft` : ''}
              </div>
            </div>
          </div>

          <div id="orderMsg" class="hidden p-4 rounded-xl text-sm"></div>

          <button onclick="goToTrace()" id="pinNextBtn"
            class="w-full py-3 ${orderState.pinPlaced ? 'bg-emerald-600 hover:bg-brand-700 text-white' : 'bg-gray-200 text-gray-400 cursor-not-allowed'} font-bold rounded-xl transition-all shadow-lg text-base"
            ${!orderState.pinPlaced ? 'disabled' : ''}>
            <i class="fas fa-arrow-right mr-2"></i>Next: Trace Roof Outline
          </button>
          <button onclick="skipTrace()" id="adminMeasureBtn"
            style="width:100%;padding:12px;font-size:15px;font-weight:700;border:none;border-radius:12px;cursor:${orderState.pinPlaced ? 'pointer' : 'not-allowed'};background:${orderState.pinPlaced ? '#f59e0b' : '#e5e7eb'};color:#ffffff;margin-top:2px;transition:background 0.2s"
            ${!orderState.pinPlaced ? 'disabled' : ''}>
            <i class="fas fa-hard-hat" style="margin-right:8px"></i>Order Measurement Report Now
            <span style="font-size:12px;font-weight:400;opacity:0.9">&nbsp;(1–2 hr arrival)</span>
          </button>
        </div>
      </div>
    </div>
  `;

  // After innerHTML replacement, the old map instance is detached.
  // Reset state and re-initialize on the fresh DOM element.
  orderState.map = null;
  orderState.mapReady = false;
  _placesInitialized = false;
  _mapInitAttempts = 0;
  setTimeout(initMap, 50);
}

// ============================================================
// STEP 2: TRACE THE ROOF
// ============================================================
function renderTraceStep(root, progressBar) {
  const modeInfo = {
    eaves:   { color: '#22c55e', icon: 'fa-draw-polygon', label: 'Eaves Outline', desc: 'Trace each eaves layer — click corners, click first point to close. Multi-story roofs can have multiple layers.' },
    ridge:   { color: '#3b82f6', icon: 'fa-grip-lines',   label: 'Ridges',     desc: 'Click start and end of each ridge line.' },
    hip:     { color: '#f59e0b', icon: 'fa-slash',         label: 'Hips',       desc: 'Click start and end of each hip line.' },
    valley:  { color: '#ef4444', icon: 'fa-angle-down',    label: 'Valleys',    desc: 'Click start and end of each valley.' },
    vent:    { color: '#a855f7', icon: 'fa-wind',           label: 'Vents',      desc: 'Click to mark each roof vent.' },
    skylight:{ color: '#06b6d4', icon: 'fa-sun',            label: 'Skylights',  desc: 'Click to mark each skylight.' },
    chimney: { color: '#d97706', icon: 'fa-fire',           label: 'Chimneys',   desc: 'Click to mark each chimney.' },
  };
  const m = modeInfo[orderState.traceMode] || modeInfo.eaves;
  const eavesCount = orderState.traceEavesPoints.length;
  const eavesSections = orderState.traceEavesSections.length;
  const ridgeCount = orderState.traceRidgeLines.length;
  const hipCount = orderState.traceHipLines.length;
  const valleyCount = orderState.traceValleyLines.length;
  const ventCount = orderState.traceVents.length;
  const skylightCount = orderState.traceSkylights.length;
  const chimneyCount = orderState.traceChimneys.length;
  const eavesClosed = eavesSections > 0;

  root.innerHTML = `
    <div class="max-w-5xl mx-auto">
      ${progressBar}

      <!-- Address bar -->
      <div class="bg-[#111111] rounded-lg border border-white/10 px-4 py-2 mb-3 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <i class="fas fa-map-marker-alt text-brand-600 text-sm"></i>
          <span class="text-sm font-medium text-gray-100">${orderState.address || orderState.lat + ', ' + orderState.lng}</span>
        </div>
        <button onclick="backToPin()" class="text-xs text-brand-600 hover:text-brand-700 font-medium"><i class="fas fa-edit mr-1"></i>Change</button>
      </div>


      <div class="grid lg:grid-cols-4 gap-4">
        <!-- Left: Mode selector -->
        <div class="lg:col-span-1 space-y-3">
          <div class="bg-[#111111] rounded-xl shadow-sm border border-white/10 p-4">
            <h4 class="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Drawing Mode</h4>
            <div class="space-y-2">
              ${Object.entries(modeInfo).map(([key, info]) => `
                <button onclick="setTraceMode('${key}')" data-trace-mode="${key}"
                  class="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all
                    ${orderState.traceMode === key ? 'bg-gray-800 text-white shadow-md' : 'bg-[#0A0A0A] text-gray-400 hover:bg-[#111111]/10'}">
                  <div class="w-3 h-3 rounded-full" style="background:${info.color}"></div>
                  <i class="fas ${info.icon} text-xs"></i>
                  <span>${info.label}</span>
                  <span class="ml-auto text-xs opacity-70" data-trace-count="${key}">
                    ${key === 'eaves' ? (eavesSections > 0 ? eavesSections + (eavesSections === 1 ? ' sect' : ' sects') + (eavesCount > 0 ? '+' : '') : eavesCount + ' pts') : key === 'ridge' ? ridgeCount : key === 'hip' ? hipCount : valleyCount}
                  </span>
                </button>
              `).join('')}
            </div>
          </div>

          <div class="bg-[#111111] rounded-xl shadow-sm border border-white/10 p-4">
            <h4 class="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Annotations</h4>
            <div class="space-y-2">
              ${[
                { key: 'vent',     color: '#a855f7', icon: 'fa-wind',  label: 'Vents',     count: ventCount },
                { key: 'skylight', color: '#06b6d4', icon: 'fa-sun',   label: 'Skylights', count: skylightCount },
                { key: 'chimney',  color: '#d97706', icon: 'fa-fire',  label: 'Chimneys',  count: chimneyCount },
              ].map(({ key, color, icon, label, count }) => `
                <button onclick="setTraceMode('${key}')" data-trace-mode="${key}"
                  class="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all
                    ${orderState.traceMode === key ? 'bg-gray-800 text-white shadow-md' : 'bg-[#0A0A0A] text-gray-400 hover:bg-white/10'}">
                  <div class="w-3 h-3 rounded-full" style="background:${color}"></div>
                  <i class="fas ${icon} text-xs"></i>
                  <span>${label}</span>
                  <span class="ml-auto text-xs opacity-70" data-trace-count="${key}">${count}</span>
                </button>
              `).join('')}
            </div>
          </div>

          <div class="bg-[#111111] rounded-xl shadow-sm border border-white/10 p-4">
            <h4 class="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Summary</h4>
            <div class="space-y-2 text-sm">
              <div class="flex justify-between"><span class="text-gray-500">Eaves</span><span id="summary-eaves" class="font-semibold ${eavesClosed ? 'text-emerald-400' : 'text-gray-400'}">${eavesClosed ? eavesSections + ' section' + (eavesSections > 1 ? 's' : '') + (eavesCount > 0 ? ' + drafting' : '') : eavesCount + ' pts'}</span></div>
              <div class="flex justify-between"><span class="text-gray-500">Ridges</span><span id="summary-ridges" class="font-semibold">${ridgeCount}</span></div>
              <div class="flex justify-between"><span class="text-gray-500">Hips</span><span id="summary-hips" class="font-semibold">${hipCount}</span></div>
              <div class="flex justify-between"><span class="text-gray-500">Valleys</span><span id="summary-valleys" class="font-semibold">${valleyCount}</span></div>
              <div class="flex justify-between"><span class="text-gray-500">Vents</span><span id="summary-vents" class="font-semibold text-gray-400">${ventCount}</span></div>
              <div class="flex justify-between"><span class="text-gray-500">Skylights</span><span id="summary-skylights" class="font-semibold text-gray-400">${skylightCount}</span></div>
              <div class="flex justify-between"><span class="text-gray-500">Chimneys</span><span id="summary-chimneys" class="font-semibold text-gray-400">${chimneyCount}</span></div>
            </div>
          </div>

          <!-- Live Metrics Panel — real-time area/perimeter from eaves trace -->
          <div id="liveMetricsPanel" class="bg-gradient-to-br from-emerald-50 to-emerald-600 rounded-xl shadow-sm border border-emerald-200 p-4">
            <h4 class="text-xs font-bold text-emerald-700 uppercase tracking-wide mb-2"><i class="fas fa-ruler-combined mr-1"></i>Live Measurements</h4>
            <p class="text-xs text-gray-400 text-center italic">Place 3+ eave points to see live measurements</p>
          </div>

          <div class="space-y-2">
            <button onclick="undoLastTrace()" class="w-full px-3 py-2 bg-white/5 hover:bg-gray-200 text-gray-400 rounded-lg text-sm font-medium"><i class="fas fa-undo mr-1"></i>Undo</button>
            <button onclick="clearAllTraces()" class="w-full px-3 py-2 bg-red-500/10 hover:bg-red-100 text-red-400 rounded-lg text-sm font-medium"><i class="fas fa-trash mr-1"></i>Clear All</button>
          </div>
        </div>

        <!-- Right: Trace Map -->
        <div class="lg:col-span-3 bg-[#111111] rounded-xl shadow-sm border border-white/10 overflow-hidden">
          <div class="bg-gray-800 px-4 py-2 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <div id="traceModeDot" class="w-3 h-3 rounded-full" style="background:${m.color}"></div>
              <span id="traceModeLabel" class="text-xs font-medium text-gray-300 uppercase">${m.label} Mode</span>
            </div>
            <span id="traceModeDesc" class="text-xs text-gray-400">${m.desc}</span>
          </div>
          <div id="traceMap" style="height: 480px; cursor: crosshair; background: #1a1a2e;"></div>
        </div>
      </div>

      <!-- Bottom nav -->
      <div class="mt-4 flex items-center justify-between">
        <div class="flex items-center gap-4 text-xs text-gray-500">
          <span><i class="fas fa-mouse-pointer mr-1"></i>Click = Add point</span>
          <span><i class="fas fa-draw-polygon mr-1" style="color:#22c55e"></i>Click 1st point to close a section — trace multiple eaves layers for multi-story roofs</span>
          <span><i class="fas fa-expand-arrows-alt mr-1 text-blue-400"></i>Trace the outermost roof edge (drip line), not the walls</span>
        </div>
        <div class="flex items-center gap-3">
          <button onclick="skipTrace()" class="px-4 py-2 text-sm font-medium" style="color:var(--text-secondary)">
            Order Report <i class="fas fa-file-alt ml-1"></i>
          </button>
          <button onclick="confirmTrace()" id="traceNextBtn"
            class="px-6 py-3 rounded-xl font-bold text-sm transition-all shadow-md flex items-center gap-2
              ${eavesClosed ? 'bg-emerald-600 hover:bg-brand-700 text-white' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}"
            ${!eavesClosed ? 'disabled' : ''}>
            <i class="fas fa-check-circle"></i>
            Confirm Trace & Continue
            <i class="fas fa-arrow-right"></i>
          </button>
        </div>
      </div>
    </div>
  `;

  setTimeout(initTraceMap, 100);
}

// ============================================================
// STEP 3: REVIEW + PRICING + PAY
// ============================================================
function renderReviewStep(root, progressBar) {
  const b = orderState.billing || {};
  const freeTrialRemaining = b.free_trial_remaining || 0;
  const paidCredits = b.paid_credits_remaining || 0;
  const isTrialAvailable = freeTrialRemaining > 0;
  const credits = b.credits_remaining || 0;
  const hasTrace = orderState.roofTraceJson !== null;
  const mLoading = orderState.measurementLoading;
  const mResult = orderState.measurementResult;
  const mError = orderState.measurementError;
  const canSubmit = !mLoading && (mResult || !hasTrace); // Block Send while engine is running

  // Trace summary counts for display
  const eaveCount = orderState.roofTraceJson?.eaves?.length || 0;
  const ridgeCount = orderState.roofTraceJson?.ridges?.length || 0;
  const hipCount = orderState.roofTraceJson?.hips?.length || 0;
  const valleyCount = orderState.roofTraceJson?.valleys?.length || 0;

  root.innerHTML = `
    <div class="max-w-3xl mx-auto">
      ${progressBar}

      <div class="bg-[#111111] rounded-2xl border border-white/10 shadow-sm overflow-hidden">
        <div class="bg-gradient-to-r from-[#111111] to-[#1a1a1a] text-white p-6">
          <h2 class="text-xl font-bold"><i class="fas fa-clipboard-check mr-2"></i>Step 3: Review & Order</h2>
          <p class="text-brand-200 text-sm mt-1">Confirm your property details and order your professional roof report</p>
        </div>

        <div class="p-6 space-y-5">
          <!-- Location summary -->
          <div class="bg-[#0A0A0A] rounded-xl border border-white/10 p-4">
            <h4 class="text-sm font-bold text-gray-300 mb-2"><i class="fas fa-map-marker-alt text-red-500 mr-1"></i>Property</h4>
            <p class="text-sm text-gray-100 font-medium">${orderState.address || orderState.lat + ', ' + orderState.lng}</p>
            <p class="text-xs text-gray-500 mt-1">Pin: ${orderState.lat}, ${orderState.lng}</p>
          </div>

          ${hasTrace ? `
          <!-- Trace confirmation — no detailed measurements shown here -->
          ${mLoading ? `
          <div class="bg-gradient-to-r from-blue-50 to-blue-700 rounded-xl border-2 border-blue-200 p-6">
            <div class="flex items-center justify-center gap-3">
              <div class="animate-spin rounded-full h-8 w-8 border-t-3 border-b-3 border-blue-600"></div>
              <div>
                <h4 class="font-bold text-blue-800">Processing Your Roof Trace...</h4>
                <p class="text-sm text-blue-400 mt-0.5">Preparing your report data. This only takes a moment.</p>
              </div>
            </div>
            <div class="mt-4 w-full bg-blue-200 rounded-full h-1.5">
              <div class="h-1.5 rounded-full bg-blue-600 animate-pulse" style="width: 60%"></div>
            </div>
          </div>
          ` : mError ? `
          <div class="bg-red-500/10 rounded-xl border border-red-200 p-5">
            <div class="flex items-center gap-2 mb-2">
              <i class="fas fa-exclamation-triangle text-red-500"></i>
              <h4 class="font-bold text-red-700">Processing Error</h4>
            </div>
            <p class="text-sm text-red-400">${mError}</p>
            <button onclick="retryMeasurement()" class="mt-3 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold">
              <i class="fas fa-redo mr-1"></i>Retry
            </button>
          </div>
          ` : mResult ? `
          <!-- Trace confirmed — measurements will appear in the report -->
          <div class="bg-gradient-to-br from-emerald-50 to-green-50 rounded-xl border-2 border-green-300 p-5">
            <div class="flex items-center gap-3 mb-3">
              <div class="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                <i class="fas fa-check-circle text-emerald-400 text-xl"></i>
              </div>
              <div>
                <h4 class="font-bold text-green-800">Roof Trace Captured Successfully</h4>
                <p class="text-sm text-emerald-400">Your trace data is ready. All detailed measurements, edge breakdowns, material estimates, and diagrams will be included in your professional report.</p>
              </div>
            </div>
            <div class="flex items-center gap-4 text-xs text-gray-500 pt-3 border-t border-green-200">
              <span><i class="fas fa-draw-polygon text-green-500 mr-1"></i>${eaveCount} eave points</span>
              <span><i class="fas fa-grip-lines text-blue-500 mr-1"></i>${ridgeCount} ridges</span>
              <span><i class="fas fa-slash text-gray-400 mr-1"></i>${hipCount} hips</span>
              <span><i class="fas fa-angle-down text-red-500 mr-1"></i>${valleyCount} valleys</span>
            </div>
          </div>
          ` : ''}
          ` : `
          <div class="bg-[#0A0A0A] rounded-xl border border-white/10 p-3">
            <p class="text-xs text-gray-400"><i class="fas fa-info-circle mr-1"></i>No trace — standard satellite analysis will be used</p>
          </div>
          `}

          <!-- What's Included in Your Report -->
          <div class="bg-gradient-to-r from-blue-600 to-blue-700 rounded-xl border border-blue-500/20 p-5">
            <h4 class="font-semibold text-blue-400 mb-3 flex items-center">
              <i class="fas fa-file-alt text-blue-400 mr-2"></i>What's Included in Your Report
            </h4>
            <div class="grid grid-cols-2 gap-3 text-sm">
              <div class="flex items-start gap-2"><i class="fas fa-check text-green-500 mt-0.5"></i><span class="text-gray-300">Professional roof diagram with all dimensions</span></div>
              <div class="flex items-start gap-2"><i class="fas fa-check text-green-500 mt-0.5"></i><span class="text-gray-300">Total roof area (footprint + true sloped)</span></div>
              <div class="flex items-start gap-2"><i class="fas fa-check text-green-500 mt-0.5"></i><span class="text-gray-300">Edge-by-edge length breakdown</span></div>
              <div class="flex items-start gap-2"><i class="fas fa-check text-green-500 mt-0.5"></i><span class="text-gray-300">Material estimates (bundles, rolls, etc.)</span></div>
              <div class="flex items-start gap-2"><i class="fas fa-check text-green-500 mt-0.5"></i><span class="text-gray-300">Pitch & slope analysis per plane</span></div>
              <div class="flex items-start gap-2"><i class="fas fa-check text-green-500 mt-0.5"></i><span class="text-gray-300">Waste calculations & advisory notes</span></div>
            </div>
          </div>

          <!-- Price per square input (optional) -->
          <div class="bg-gradient-to-r from-gray-50 to-emerald-50 rounded-xl border border-white/15 p-5">
            <h4 class="font-semibold text-gray-300 mb-2 flex items-center">
              <i class="fas fa-dollar-sign text-gray-400 mr-2"></i>Your Price Per Square (Optional)
            </h4>
            <p class="text-xs text-gray-500 mb-3">Enter your rate per roofing square (100 sq ft) to include a cost estimate in your report.</p>
            <div>
              <label class="block text-xs font-medium text-gray-400 mb-1">Price Per Square (CAD)</label>
              <div class="relative max-w-xs">
                <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">$</span>
                <input type="number" step="0.01" min="0" max="9999" id="pricePerBundleInput"
                  value="${orderState.pricePerBundle || ''}"
                  oninput="orderState.pricePerBundle = parseFloat(this.value) || null;"
                  class="w-full pl-8 pr-4 py-3 border border-white/15 rounded-lg focus:ring-2 focus:ring-gray-500 focus:border-white/15 text-sm font-medium"
                  placeholder="e.g. 350" />
              </div>
              <p class="text-xs text-gray-400 mt-1">This will appear on your report as an estimated job cost</p>
            </div>
          </div>

          <div id="orderMsg" class="hidden p-4 rounded-xl text-sm"></div>

          <!-- Action Buttons -->
          <div class="flex gap-3">
            <button onclick="backToTrace()" class="py-3 px-5 bg-gray-200 hover:bg-gray-300 text-gray-300 font-semibold rounded-xl transition-all text-sm">
              <i class="fas fa-arrow-left mr-1"></i>Back
            </button>
            ${!canSubmit ? `
              <button disabled class="flex-1 py-3 bg-gray-300 text-gray-500 font-bold rounded-xl cursor-not-allowed text-base">
                <i class="fas fa-spinner fa-spin mr-2"></i>Processing...
              </button>
            ` : isTrialAvailable ? `
              <button onclick="useCredit()" id="creditBtn" class="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-all shadow-lg text-base">
                <i class="fas fa-gift mr-2"></i>Use Free Trial (${freeTrialRemaining} left)
              </button>
            ` : (b.status === 'active') && paidCredits > 0 ? `
              <button onclick="useCredit()" id="creditBtn" class="flex-1 py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl transition-all shadow-lg text-base">
                <i class="fas fa-coins mr-2"></i>Use Credit (${paidCredits} left)
              </button>
            ` : (b.status === 'active') ? `
              <button onclick="useCredit()" id="creditBtn" class="flex-1 py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl transition-all shadow-lg text-base">
                <i class="fas fa-coins mr-2"></i>Generate Report
              </button>
            ` : `
              <button onclick="showSubscriptionRequiredOverlay()" class="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition-all shadow-lg text-base">
                <i class="fas fa-crown mr-2"></i>Subscribe to Generate Reports — $49/mo
              </button>
            `}
          </div>
        </div>
      </div>
    </div>
  `;
}

// ============================================================
// TRACE MAP — Drawing logic
// ============================================================
function initTraceMap() {
  const mapDiv = document.getElementById('traceMap');
  if (!mapDiv || typeof google === 'undefined' || !google.maps) return;

  const center = { lat: parseFloat(orderState.lat), lng: parseFloat(orderState.lng) };

  orderState.traceMap = new google.maps.Map(mapDiv, {
    center,
    zoom: 21,
    mapTypeId: 'satellite',
    tilt: 0,
    fullscreenControl: true,
    streetViewControl: false,
    zoomControl: true,
    mapTypeControl: true,
    mapTypeControlOptions: {
      style: google.maps.MapTypeControlStyle.DROPDOWN_MENU,
      mapTypeIds: ['satellite', 'hybrid']
    }
  });

  // Pin marker
  new google.maps.Marker({
    position: center,
    map: orderState.traceMap,
    icon: {
      url: 'data:image/svg+xml,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20"><circle cx="12" cy="12" r="4" fill="%23ef4444" stroke="white" stroke-width="2"/></svg>'
      ),
      scaledSize: new google.maps.Size(20, 20),
      anchor: new google.maps.Point(10, 10),
    }
  });

  restoreTraceOverlays();
  restoreAnnotationMarkers();

  orderState.traceMap.addListener('click', (e) => {
    handleTraceClick({ lat: e.latLng.lat(), lng: e.latLng.lng() });
  });

  orderState.traceMap.addListener('dblclick', (e) => {
    e.stop();
    finishCurrentLine();
  });
}

function handleTraceClick(pt) {
  const mode = orderState.traceMode;
  if (mode === 'eaves') {
    if (orderState.traceEavesPoints.length >= 3) {
      const first = orderState.traceEavesPoints[0];
      if (getDistanceM(pt, first) < 1.5) {
        closeEavesPolygon();
        return;
      }
    }
    orderState.traceEavesPoints.push(pt);
    addTraceMarker(pt, '#22c55e', orderState.traceEavesPoints.length);
    if (orderState.traceEavesPoints.length > 1) {
      drawPolyline(orderState.traceEavesPoints, '#22c55e', 3, false);
    }
  } else if (mode === 'vent' || mode === 'skylight' || mode === 'chimney') {
    const arrays = { vent: orderState.traceVents, skylight: orderState.traceSkylights, chimney: orderState.traceChimneys };
    arrays[mode].push(pt);
    addAnnotationMarker(pt, mode);
  } else {
    orderState.traceCurrentLine.push(pt);
    const colors = { ridge: '#3b82f6', hip: '#f59e0b', valley: '#ef4444' };
    addTraceMarker(pt, colors[mode], null);
    if (orderState.traceCurrentLine.length === 2) {
      finishCurrentLine();
    }
  }
  updateTraceUI();
}

function closeEavesPolygon() {
  if (orderState.traceEavesPoints.length < 3) return;

  // Remove in-progress markers/polylines for this section
  orderState.traceMarkers.forEach(m => m.setMap(null));
  orderState.traceMarkers = [];
  orderState.tracePolylines.forEach(p => p.setMap(null));
  orderState.tracePolylines = [];
  if (orderState.traceEavesPolygon) {
    orderState.traceEavesPolygon.setMap(null);
    orderState.traceEavesPolygon = null;
  }

  // Create closed section polygon (non-editable, faded when not in eaves mode)
  const polygon = new google.maps.Polygon({
    paths: orderState.traceEavesPoints.map(p => new google.maps.LatLng(p.lat, p.lng)),
    map: orderState.traceMap,
    strokeColor: '#22c55e',
    strokeWeight: 3,
    strokeOpacity: 0.9,
    fillColor: '#22c55e',
    fillOpacity: 0.15,
    editable: false,
    draggable: false,
    clickable: false,
    zIndex: 1
  });

  const sectionIdx = orderState.traceEavesSections.length;
  orderState.traceEavesSections.push({ points: [...orderState.traceEavesPoints] });
  orderState.traceEavesSectionPolygons.push(polygon);

  // Add section label at centroid
  const pts = orderState.traceEavesPoints;
  const cx = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
  addTraceMarker({ lat: cx, lng: cy }, '#22c55e', `S${sectionIdx + 1}`);

  // Reset current in-progress section
  orderState.traceEavesPoints = [];
  orderState.traceEavesPolygon = null;

  restoreLineOverlays();

  const n = orderState.traceEavesSections.length;
  showMsg('success', `<i class="fas fa-check-circle mr-1"></i>Section ${n} closed! Add another eaves layer or switch to Ridges.`);
  updateTraceUI();
}

function updateEavesFromPolygon() {
  if (!orderState.traceEavesPolygon) return;
  const path = orderState.traceEavesPolygon.getPath();
  orderState.traceEavesPoints = [];
  for (let i = 0; i < path.getLength(); i++) {
    const pt = path.getAt(i);
    orderState.traceEavesPoints.push({ lat: pt.lat(), lng: pt.lng() });
  }
  // Recompute live metrics when polygon vertices are dragged
  if (orderState.traceEavesPoints.length >= 3) {
    computeLiveTraceMetrics(orderState.traceEavesPoints);
    updateTraceUI();
  }
}

function finishCurrentLine() {
  if (orderState.traceCurrentLine.length < 2) {
    orderState.traceCurrentLine = [];
    return;
  }
  const line = [...orderState.traceCurrentLine];
  const mode = orderState.traceMode;
  const colors = { ridge: '#3b82f6', hip: '#f59e0b', valley: '#ef4444' };
  if (mode === 'ridge') orderState.traceRidgeLines.push(line);
  else if (mode === 'hip') orderState.traceHipLines.push(line);
  else if (mode === 'valley') orderState.traceValleyLines.push(line);
  drawPolyline(line, colors[mode], 2.5, false);
  orderState.traceCurrentLine = [];
  updateTraceUI();
}

function addTraceMarker(pt, color, label) {
  const marker = new google.maps.Marker({
    position: { lat: pt.lat, lng: pt.lng },
    map: orderState.traceMap,
    clickable: false,  // CRITICAL: Don't consume map clicks — let them pass through to the map
    zIndex: 10,        // Draw markers above polygon fill
    icon: {
      url: 'data:image/svg+xml,' + encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="16" height="16">
          <circle cx="10" cy="10" r="8" fill="${color}" stroke="white" stroke-width="2" opacity="0.9"/>
          ${label ? `<text x="10" y="14" text-anchor="middle" fill="white" font-size="9" font-weight="bold" font-family="Arial">${label}</text>` : ''}
        </svg>`
      ),
      scaledSize: new google.maps.Size(16, 16),
      anchor: new google.maps.Point(8, 8),
    }
  });
  orderState.traceMarkers.push(marker);
}

function addAnnotationMarker(pt, type) {
  const defs = {
    vent: {
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16">
        <circle cx="12" cy="12" r="11" fill="#a855f7" stroke="white" stroke-width="1.5"/>
        <line x1="5" y1="9"  x2="19" y2="9"  stroke="white" stroke-width="1.5"/>
        <line x1="5" y1="12" x2="19" y2="12" stroke="white" stroke-width="1.5"/>
        <line x1="5" y1="15" x2="19" y2="15" stroke="white" stroke-width="1.5"/>
      </svg>`
    },
    skylight: {
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16">
        <polygon points="12,1 23,12 12,23 1,12" fill="#06b6d4" stroke="white" stroke-width="1.5"/>
        <line x1="12" y1="5" x2="12" y2="19" stroke="white" stroke-width="1.2"/>
        <line x1="5"  y1="12" x2="19" y2="12" stroke="white" stroke-width="1.2"/>
      </svg>`
    },
    chimney: {
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16">
        <rect x="3" y="3" width="18" height="18" rx="3" fill="#d97706" stroke="white" stroke-width="1.5"/>
        <line x1="12" y1="3"  x2="12" y2="21" stroke="white" stroke-width="1.2"/>
        <line x1="3"  y1="12" x2="21" y2="12" stroke="white" stroke-width="1.2"/>
      </svg>`
    }
  };
  const marker = new google.maps.Marker({
    position: { lat: pt.lat, lng: pt.lng },
    map: orderState.traceMap,
    clickable: false,
    zIndex: 15,
    icon: {
      url: 'data:image/svg+xml,' + encodeURIComponent(defs[type].svg),
      scaledSize: new google.maps.Size(16, 16),
      anchor: new google.maps.Point(8, 8),
    }
  });
  orderState.traceAnnotationMarkers.push({ marker, type });
}

function restoreAnnotationMarkers() {
  // Called after initTraceMap creates a new map — old marker objects are orphaned, recreate from state
  orderState.traceAnnotationMarkers = [];
  orderState.traceVents.forEach(pt => addAnnotationMarker(pt, 'vent'));
  orderState.traceSkylights.forEach(pt => addAnnotationMarker(pt, 'skylight'));
  orderState.traceChimneys.forEach(pt => addAnnotationMarker(pt, 'chimney'));
}

function drawPolyline(points, color, weight, dashed) {
  const polyline = new google.maps.Polyline({
    path: points.map(p => new google.maps.LatLng(p.lat, p.lng)),
    map: orderState.traceMap,
    strokeColor: color,
    strokeWeight: weight,
    strokeOpacity: dashed ? 0.6 : 0.9,
    clickable: false,  // Let clicks pass through to map
    zIndex: 5          // Above polygon, below markers
  });
  orderState.tracePolylines.push(polyline);
}

// Clear visual overlays from the map.
// keepPolygon=true preserves eaves polygons (current + all sections) — used during undo in ridge/hip/valley mode
function clearTraceOverlays(keepPolygon) {
  orderState.traceMarkers.forEach(m => m.setMap(null));
  orderState.traceMarkers = [];
  orderState.tracePolylines.forEach(p => p.setMap(null));
  orderState.tracePolylines = [];
  if (!keepPolygon) {
    if (orderState.traceEavesPolygon) {
      orderState.traceEavesPolygon.setMap(null);
      orderState.traceEavesPolygon = null;
    }
    // Remove section polygon objects from map (does NOT clear traceEavesSections data)
    orderState.traceEavesSectionPolygons.forEach(p => { if (p) p.setMap(null); });
    orderState.traceEavesSectionPolygons = [];
  }
}

function restoreTraceOverlays() {
  // Remove old section polygon objects (may be bound to a stale map instance after re-render)
  orderState.traceEavesSectionPolygons.forEach(p => { if (p) p.setMap(null); });
  orderState.traceEavesSectionPolygons = [];

  const inEaves = orderState.traceMode === 'eaves';
  const fillOp = inEaves ? 0.15 : 0.04;
  const strokeOp = inEaves ? 0.9 : 0.2;

  // Recreate section polygons on the current map instance
  orderState.traceEavesSections.forEach((section, idx) => {
    const polygon = new google.maps.Polygon({
      paths: section.points.map(p => new google.maps.LatLng(p.lat, p.lng)),
      map: orderState.traceMap,
      strokeColor: '#22c55e',
      strokeWeight: 3,
      strokeOpacity: strokeOp,
      fillColor: '#22c55e',
      fillOpacity: fillOp,
      editable: false,
      draggable: false,
      clickable: false,
      zIndex: 1
    });
    orderState.traceEavesSectionPolygons.push(polygon);
    // Section label at centroid
    const cx = section.points.reduce((s, p) => s + p.lat, 0) / section.points.length;
    const cy = section.points.reduce((s, p) => s + p.lng, 0) / section.points.length;
    addTraceMarker({ lat: cx, lng: cy }, '#22c55e', `S${idx + 1}`);
  });

  // Restore current in-progress section points
  if (orderState.traceEavesPoints.length > 0) {
    orderState.traceEavesPoints.forEach((p, i) => addTraceMarker(p, '#22c55e', i + 1));
    if (orderState.traceEavesPoints.length > 1) drawPolyline(orderState.traceEavesPoints, '#22c55e', 3, false);
  }
  restoreLineOverlays();
}

function restoreLineOverlays() {
  orderState.traceRidgeLines.forEach(l => drawPolyline(l, '#3b82f6', 2.5, false));
  orderState.traceHipLines.forEach(l => drawPolyline(l, '#f59e0b', 2.5, false));
  orderState.traceValleyLines.forEach(l => drawPolyline(l, '#ef4444', 2.5, false));
}

function setTraceMode(mode) {
  if (orderState.traceCurrentLine.length > 0) finishCurrentLine();
  orderState.traceMode = mode;

  // Fade eaves section polygons when not in eaves mode so ridges/hips are easier to see
  const inEaves = mode === 'eaves';
  const fillOp = inEaves ? 0.15 : 0.04;
  const strokeOp = inEaves ? 0.9 : 0.2;
  orderState.traceEavesSectionPolygons.forEach(p => {
    if (p) p.setOptions({ fillOpacity: fillOp, strokeOpacity: strokeOp });
  });
  if (orderState.traceEavesPolygon) {
    orderState.traceEavesPolygon.setOptions({ fillOpacity: fillOp, strokeOpacity: strokeOp });
  }

  updateTraceUI();
}

function undoLastTrace() {
  const mode = orderState.traceMode;

  // ── Priority 1: If there's a partial in-progress line (1 point placed), undo that first ──
  if (mode !== 'eaves' && orderState.traceCurrentLine.length > 0) {
    // Remove the visual marker for the partial point
    if (orderState.traceMarkers.length > 0) {
      const lastMarker = orderState.traceMarkers.pop();
      lastMarker.setMap(null);
    }
    orderState.traceCurrentLine = [];
    updateTraceUI();
    return;
  }

  // ── Priority 2: Undo the last completed action for the current mode ──
  if (mode === 'eaves') {
    if (orderState.traceEavesPoints.length > 0) {
      // Undo last point in current in-progress section
      if (orderState.traceEavesPolygon) {
        orderState.traceEavesPolygon.setMap(null);
        orderState.traceEavesPolygon = null;
      }
      orderState.traceEavesPoints.pop();
      // Clear only markers/polylines — keep existing section polygons on map
      orderState.traceMarkers.forEach(m => m.setMap(null));
      orderState.traceMarkers = [];
      orderState.tracePolylines.forEach(p => p.setMap(null));
      orderState.tracePolylines = [];
      // Redraw section labels
      orderState.traceEavesSections.forEach((section, idx) => {
        const cx = section.points.reduce((s, p) => s + p.lat, 0) / section.points.length;
        const cy = section.points.reduce((s, p) => s + p.lng, 0) / section.points.length;
        addTraceMarker({ lat: cx, lng: cy }, '#22c55e', `S${idx + 1}`);
      });
      // Redraw in-progress section
      if (orderState.traceEavesPoints.length > 0) {
        orderState.traceEavesPoints.forEach((p, i) => addTraceMarker(p, '#22c55e', i + 1));
        if (orderState.traceEavesPoints.length > 1) drawPolyline(orderState.traceEavesPoints, '#22c55e', 3, false);
      }
      restoreLineOverlays();
    } else if (orderState.traceEavesSections.length > 0) {
      // Undo last closed section — pop it and restore as in-progress
      const lastSection = orderState.traceEavesSections.pop();
      const lastPolygon = orderState.traceEavesSectionPolygons.pop();
      if (lastPolygon) lastPolygon.setMap(null);
      orderState.traceEavesPoints = [...lastSection.points];
      // Clear markers/polylines and redraw
      orderState.traceMarkers.forEach(m => m.setMap(null));
      orderState.traceMarkers = [];
      orderState.tracePolylines.forEach(p => p.setMap(null));
      orderState.tracePolylines = [];
      orderState.traceEavesSections.forEach((section, idx) => {
        const cx = section.points.reduce((s, p) => s + p.lat, 0) / section.points.length;
        const cy = section.points.reduce((s, p) => s + p.lng, 0) / section.points.length;
        addTraceMarker({ lat: cx, lng: cy }, '#22c55e', `S${idx + 1}`);
      });
      orderState.traceEavesPoints.forEach((p, i) => addTraceMarker(p, '#22c55e', i + 1));
      if (orderState.traceEavesPoints.length > 1) drawPolyline(orderState.traceEavesPoints, '#22c55e', 3, false);
      restoreLineOverlays();
    }
  } else if (mode === 'ridge') {
    if (orderState.traceRidgeLines.length > 0) {
      orderState.traceRidgeLines.pop();
      // Polygon still exists — keep it; just redraw markers & lines
      clearTraceOverlays(true); // keepPolygon=true
      restoreTraceOverlays();
    } else if (orderState.traceEavesSections.length > 0 || orderState.traceEavesPolygon) {
      // No ridges to undo — undo the last eaves section closure
      if (orderState.traceEavesSections.length > 0) {
        const lastSection = orderState.traceEavesSections.pop();
        const lastPolygon = orderState.traceEavesSectionPolygons.pop();
        if (lastPolygon) lastPolygon.setMap(null);
        orderState.traceEavesPoints = [...lastSection.points];
      } else if (orderState.traceEavesPolygon) {
        orderState.traceEavesPolygon.setMap(null);
        orderState.traceEavesPolygon = null;
      }
      orderState.traceMode = 'eaves';
      // Clear markers/polylines and redraw
      orderState.traceMarkers.forEach(m => m.setMap(null));
      orderState.traceMarkers = [];
      orderState.tracePolylines.forEach(p => p.setMap(null));
      orderState.tracePolylines = [];
      // Redraw remaining section labels
      orderState.traceEavesSections.forEach((section, idx) => {
        const cx = section.points.reduce((s, p) => s + p.lat, 0) / section.points.length;
        const cy = section.points.reduce((s, p) => s + p.lng, 0) / section.points.length;
        addTraceMarker({ lat: cx, lng: cy }, '#22c55e', `S${idx + 1}`);
      });
      if (orderState.traceEavesPoints.length > 0) {
        orderState.traceEavesPoints.forEach((p, i) => addTraceMarker(p, '#22c55e', i + 1));
        if (orderState.traceEavesPoints.length > 1) drawPolyline(orderState.traceEavesPoints, '#22c55e', 3, false);
      }
      restoreLineOverlays();
    }
  } else if (mode === 'hip') {
    if (orderState.traceHipLines.length > 0) {
      orderState.traceHipLines.pop();
    }
    clearTraceOverlays(true); // keepPolygon=true
    restoreTraceOverlays();
  } else if (mode === 'valley') {
    if (orderState.traceValleyLines.length > 0) {
      orderState.traceValleyLines.pop();
    }
    clearTraceOverlays(true); // keepPolygon=true
    restoreTraceOverlays();
  } else if (mode === 'vent' || mode === 'skylight' || mode === 'chimney') {
    const arrays = { vent: orderState.traceVents, skylight: orderState.traceSkylights, chimney: orderState.traceChimneys };
    const arr = arrays[mode];
    if (arr.length > 0) {
      arr.pop();
      // Remove the last annotation marker of this type
      for (let i = orderState.traceAnnotationMarkers.length - 1; i >= 0; i--) {
        if (orderState.traceAnnotationMarkers[i].type === mode) {
          orderState.traceAnnotationMarkers[i].marker.setMap(null);
          orderState.traceAnnotationMarkers.splice(i, 1);
          break;
        }
      }
    }
  }
  orderState.traceCurrentLine = [];
  updateTraceUI();
}

async function clearAllTraces() {
  if (!(await window.rmConfirm('Clear all traces?'))) return
  orderState.traceEavesPoints = [];
  orderState.traceEavesSectionPolygons.forEach(p => { if (p) p.setMap(null); });
  orderState.traceEavesSectionPolygons = [];
  orderState.traceEavesSections = [];
  orderState.traceRidgeLines = [];
  orderState.traceHipLines = [];
  orderState.traceValleyLines = [];
  orderState.traceCurrentLine = [];
  orderState.traceVents = [];
  orderState.traceSkylights = [];
  orderState.traceChimneys = [];
  orderState.traceAnnotationMarkers.forEach(a => a.marker.setMap(null));
  orderState.traceAnnotationMarkers = [];
  clearTraceOverlays();
  orderState.roofTraceJson = null;
  updateTraceUI();
}

function updateTraceUI() {
  // DO NOT re-render the whole page — that destroys the trace map!
  // Instead, surgically update only the sidebar counters and button states.
  const eavesCount = orderState.traceEavesPoints.length;
  const eavesSections = orderState.traceEavesSections.length;
  const ridgeCount = orderState.traceRidgeLines.length;
  const hipCount = orderState.traceHipLines.length;
  const valleyCount = orderState.traceValleyLines.length;
  const ventCount = orderState.traceVents.length;
  const skylightCount = orderState.traceSkylights.length;
  const chimneyCount = orderState.traceChimneys.length;
  const eavesClosed = eavesSections > 0;

  // ── Live area/perimeter computation from eaves points ──
  const metricsPts = eavesCount >= 3 ? orderState.traceEavesPoints :
    (eavesSections > 0 ? orderState.traceEavesSections[0].points : null);
  if (metricsPts && metricsPts.length >= 3) {
    computeLiveTraceMetrics(metricsPts);
  } else {
    orderState.liveFootprintSqft = null;
    orderState.livePerimeterFt = null;
  }

  // Update mode button counts
  const modeCountMap = { eaves: eavesSections > 0 ? eavesSections + (eavesSections === 1 ? ' sect' : ' sects') + (eavesCount > 0 ? '+' : '') : eavesCount + ' pts', ridge: ridgeCount, hip: hipCount, valley: valleyCount, vent: ventCount, skylight: skylightCount, chimney: chimneyCount };
  document.querySelectorAll('[data-trace-count]').forEach(el => {
    const key = el.getAttribute('data-trace-count');
    if (modeCountMap[key] !== undefined) el.textContent = modeCountMap[key];
  });

  // Update summary panel
  const summaryMap = {
    'summary-eaves': eavesClosed ? eavesSections + ' section' + (eavesSections > 1 ? 's' : '') + (eavesCount > 0 ? ' + drafting' : '') : eavesCount + ' pts',
    'summary-ridges': ridgeCount,
    'summary-hips': hipCount,
    'summary-valleys': valleyCount,
    'summary-vents': ventCount,
    'summary-skylights': skylightCount,
    'summary-chimneys': chimneyCount,
  };
  Object.entries(summaryMap).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = val;
      if (id === 'summary-eaves') el.className = 'font-semibold ' + (eavesClosed ? 'text-emerald-400' : 'text-gray-400');
    }
  });

  // ── Update live metrics panel ──
  const metricsPanel = document.getElementById('liveMetricsPanel');
  if (metricsPanel) {
    if (orderState.liveFootprintSqft && orderState.liveFootprintSqft > 0) {
      const cv = getCrossValidation();
      const cvHtml = cv ? (
        cv.status === 'ok'
          ? `<div class="mt-2 px-2 py-1.5 bg-green-100 border border-green-300 rounded-lg text-xs text-green-800"><i class="fas fa-check-circle mr-1"></i>${cv.msg}</div>`
          : cv.status === 'large'
            ? `<div class="mt-2 px-2 py-1.5 bg-white/10 border border-white/15 rounded-lg text-xs text-gray-400"><i class="fas fa-exclamation-triangle mr-1"></i>${cv.msg}</div>`
            : `<div class="mt-2 px-2 py-1.5 bg-red-100 border border-red-300 rounded-lg text-xs text-red-800"><i class="fas fa-exclamation-triangle mr-1"></i>${cv.msg}</div>`
      ) : '';

      metricsPanel.innerHTML = `
        <div class="space-y-2">
          <div class="flex justify-between items-center">
            <span class="text-gray-500 text-xs"><i class="fas fa-vector-square mr-1"></i>Footprint</span>
            <span class="font-bold text-sm text-emerald-700">${orderState.liveFootprintSqft.toLocaleString()} sq ft</span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-gray-500 text-xs"><i class="fas fa-ruler mr-1"></i>Perimeter</span>
            <span class="font-bold text-sm text-gray-100">${orderState.livePerimeterFt.toLocaleString()} ft</span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-gray-500 text-xs"><i class="fas fa-th mr-1"></i>Est. Area</span>
            <span class="font-bold text-sm text-blue-700">${(orderState.liveFootprintSqft / 100).toFixed(1)}</span>
          </div>
          ${cvHtml}
        </div>
      `;
      metricsPanel.classList.remove('hidden');
    } else {
      metricsPanel.innerHTML = '<p class="text-xs text-gray-400 text-center italic">Place 3+ eave points to see live measurements</p>';
      metricsPanel.classList.remove('hidden');
    }
  }

  // Update mode bar text
  const modeInfo = {
    eaves:   { color: '#22c55e', label: 'Eaves Outline', desc: 'Trace each eaves layer — click corners, click first point to close. Multi-story roofs can have multiple layers.' },
    ridge:   { color: '#3b82f6', label: 'Ridges',   desc: 'Click start and end of each ridge line.' },
    hip:     { color: '#f59e0b', label: 'Hips',     desc: 'Click start and end of each hip line.' },
    valley:  { color: '#ef4444', label: 'Valleys',  desc: 'Click start and end of each valley.' },
    vent:    { color: '#a855f7', label: 'Vents',    desc: 'Click to mark each roof vent.' },
    skylight:{ color: '#06b6d4', label: 'Skylights',desc: 'Click to mark each skylight.' },
    chimney: { color: '#d97706', label: 'Chimneys', desc: 'Click to mark each chimney.' },
  };
  const mi = modeInfo[orderState.traceMode];
  const modeLabel = document.getElementById('traceModeLabel');
  const modeDesc = document.getElementById('traceModeDesc');
  const modeDot = document.getElementById('traceModeDot');
  if (modeLabel && mi) modeLabel.textContent = mi.label + ' Mode';
  if (modeDesc && mi) modeDesc.textContent = mi.desc;
  if (modeDot && mi) modeDot.style.background = mi.color;

  // Update mode buttons active state
  document.querySelectorAll('[data-trace-mode]').forEach(btn => {
    const key = btn.getAttribute('data-trace-mode');
    if (key === orderState.traceMode) {
      btn.className = btn.className.split('bg-[#0A0A0A]').join('').split('text-gray-400').join('').split('hover:bg-[#111111]').join('').split('bg-gray-800 text-white shadow-md').join('') + ' bg-gray-800 text-white shadow-md';
    } else {
      btn.className = btn.className.split('bg-gray-800 text-white shadow-md').join('').split('bg-[#0A0A0A]').join('').split('text-gray-400').join('') + ' bg-[#0A0A0A] text-gray-400 hover:bg-white/10';
    }
  });

  // Update confirm button
  const nextBtn = document.getElementById('traceNextBtn');
  if (nextBtn) {
    nextBtn.disabled = !eavesClosed;
    if (eavesClosed) {
      nextBtn.className = nextBtn.className.replace('bg-gray-200 text-gray-400 cursor-not-allowed', 'bg-emerald-600 hover:bg-brand-700 text-white');
    } else {
      nextBtn.className = nextBtn.className.replace('bg-emerald-600 hover:bg-brand-700 text-white', 'bg-gray-200 text-gray-400 cursor-not-allowed');
    }
  }
}

function getDistanceM(a, b) {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const x = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
}

// ============================================================
// LIVE AREA & PERIMETER CALCULATION (client-side Shoelace)
// Computes footprint area and perimeter from eaves lat/lng in real-time.
// Uses WGS84 → local Cartesian projection (same as server engine).
// ============================================================
function computeLiveTraceMetrics(pts) {
  if (!pts || pts.length < 3) return { areaFt2: 0, perimeterFt: 0 };

  const DEG2RAD = Math.PI / 180;
  const EARTH_R = 6371000; // metres
  const M2_TO_FT2 = 10.7639;
  const M_TO_FT = 3.28084;

  // Centroid for projection origin
  const cLat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const cLng = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
  const cosLat = Math.cos(cLat * DEG2RAD);
  const mPerDegLat = DEG2RAD * EARTH_R;
  const mPerDegLng = DEG2RAD * EARTH_R * cosLat;

  // Project to local XY metres
  const xy = pts.map(p => ({
    x: (p.lng - cLng) * mPerDegLng,
    y: (p.lat - cLat) * mPerDegLat
  }));

  // Shoelace area (m²)
  let area = 0;
  for (let i = 0; i < xy.length; i++) {
    const j = (i + 1) % xy.length;
    area += xy[i].x * xy[j].y;
    area -= xy[j].x * xy[i].y;
  }
  area = Math.abs(area) / 2;

  // Perimeter (m)
  let perim = 0;
  for (let i = 0; i < xy.length; i++) {
    const j = (i + 1) % xy.length;
    perim += Math.sqrt((xy[j].x - xy[i].x)**2 + (xy[j].y - xy[i].y)**2);
  }

  const areaFt2 = area * M2_TO_FT2;
  const perimeterFt = perim * M_TO_FT;

  // Store in orderState for cross-validation display
  orderState.liveFootprintSqft = Math.round(areaFt2);
  orderState.livePerimeterFt = Math.round(perimeterFt);

  return { areaFt2: Math.round(areaFt2), perimeterFt: Math.round(perimeterFt) };
}

// Cross-validation: check traced area vs. known house size
function getCrossValidation() {
  if (!orderState.houseSqft || !orderState.liveFootprintSqft) return null;
  const house = orderState.houseSqft;
  const traced = orderState.liveFootprintSqft;
  // Expected roof footprint = house sq ft + 10-15% for eave overhangs
  const expectedMin = house * 1.05; // tight, minimal overhangs
  const expectedMax = house * 1.25; // generous overhangs, covered porch
  const ratio = traced / house;

  if (traced < expectedMin) {
    return { status: 'small', ratio, msg: `Traced footprint (${traced.toLocaleString()} sq ft) seems small for a ${house.toLocaleString()} sq ft house. Expected ~${Math.round(expectedMin).toLocaleString()}-${Math.round(expectedMax).toLocaleString()} sq ft with overhangs. Check that you traced the EAVE edges (roof drip edge), not the wall line.` };
  }
  if (traced > expectedMax) {
    return { status: 'large', ratio, msg: `Traced footprint (${traced.toLocaleString()} sq ft) seems large for a ${house.toLocaleString()} sq ft house. Expected ~${Math.round(expectedMin).toLocaleString()}-${Math.round(expectedMax).toLocaleString()} sq ft. Make sure you traced only the ROOF edges, not the yard or driveway.` };
  }
  return { status: 'ok', ratio, msg: `Traced footprint (${traced.toLocaleString()} sq ft) matches expected range for a ${house.toLocaleString()} sq ft house.` };
}

// ============================================================
// NAVIGATION
// ============================================================
function goToTrace() {
  if (!orderState.pinPlaced) {
    showMsg('error', '<i class="fas fa-exclamation-triangle mr-1"></i>Please place a pin on the map first.');
    return;
  }
  orderState.step = 'trace';
  renderOrderPage();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function skipTrace() {
  // Show warning modal before skipping — this order will be manually traced by admin
  var overlay = document.createElement('div');
  overlay.id = 'skip-trace-modal';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;padding:16px';
  overlay.innerHTML =
    '<div style="background:#111827;border:1px solid #374151;border-radius:16px;padding:28px;max-width:440px;width:100%;box-shadow:0 25px 60px rgba(0,0,0,0.5)">' +
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">' +
        '<div style="width:44px;height:44px;background:rgba(245,158,11,0.15);border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="fas fa-clock" style="color:#f59e0b;font-size:20px"></i></div>' +
        '<div><h3 style="color:#f9fafb;font-size:17px;font-weight:700;margin:0">Manual Trace Required</h3><p style="color:#9ca3af;font-size:12px;margin:2px 0 0">Our team will trace this roof for you</p></div>' +
      '</div>' +
      '<p style="color:#d1d5db;font-size:14px;line-height:1.6;margin-bottom:8px">Since you\'re skipping the trace, <strong style="color:#f9fafb">our team will manually trace this roof</strong> to ensure accurate measurements.</p>' +
      '<p style="color:#d1d5db;font-size:14px;line-height:1.6;margin-bottom:20px">Your report will be ready within <strong style="color:#f59e0b">1–2 hours</strong>. You\'ll receive a notification when it\'s done.</p>' +
      '<div style="background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);border-radius:8px;padding:10px 12px;margin-bottom:20px;font-size:12px;color:#fbbf24">' +
        '<i class="fas fa-info-circle mr-1.5"></i>This uses one report credit. Manual trace ensures the highest accuracy.' +
      '</div>' +
      '<div style="display:flex;gap:10px">' +
        '<button onclick="document.getElementById(\'skip-trace-modal\').remove()" style="flex:1;padding:11px;background:#1f2937;color:#9ca3af;border:1px solid #374151;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer">Cancel</button>' +
        '<button onclick="confirmSkipTrace()" style="flex:1;padding:11px;background:#f59e0b;color:#111;border:none;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer"><i class="fas fa-check mr-1.5"></i>Yes, Submit for Manual Trace</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);
}

function confirmSkipTrace() {
  document.getElementById('skip-trace-modal')?.remove();
  orderState.needsAdminTrace = true;
  orderState.roofTraceJson = null;
  orderState.measurementResult = null;
  orderState.measurementError = null;
  orderState.measurementLoading = false;
  orderState.step = 'review';
  renderOrderPage();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function confirmTrace() {
  const eavesClosed = orderState.traceEavesSections.length > 0;
  if (!eavesClosed) {
    showMsg('error', '<i class="fas fa-exclamation-triangle mr-1"></i>Close the eaves polygon by clicking the first point.');
    return;
  }
  orderState.roofTraceJson = {
    eaves: orderState.traceEavesSections.length > 0 ? orderState.traceEavesSections[0].points : orderState.traceEavesPoints,
    eaves_sections: orderState.traceEavesSections.map(s => s.points),
    ridges: orderState.traceRidgeLines,
    hips: orderState.traceHipLines,
    valleys: orderState.traceValleyLines,
    annotations: {
      vents: orderState.traceVents,
      skylights: orderState.traceSkylights,
      chimneys: orderState.traceChimneys,
    },
    traced_at: new Date().toISOString()
  };

  // ── Run the measurement engine BEFORE going to review ──
  orderState.measurementLoading = true;
  orderState.measurementResult = null;
  orderState.measurementError = null;
  orderState.step = 'review';
  renderOrderPage();
  window.scrollTo({ top: 0, behavior: 'smooth' });

  try {
    const res = await fetch('/api/reports/calculate-from-trace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trace: orderState.roofTraceJson,
        address: orderState.address || `${orderState.lat}, ${orderState.lng}`,
        house_sqft: orderState.houseSqft || null
      })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      orderState.measurementResult = data;
      orderState.measurementError = null;
      console.log('[Measurement] Engine completed:', data.measurements.true_area_sqft, 'sqft true area');
    } else {
      orderState.measurementError = data.error || 'Measurement calculation failed';
      console.error('[Measurement] Error:', data.error);
    }
  } catch (e) {
    orderState.measurementError = 'Network error during measurement calculation';
    console.error('[Measurement] Network error:', e);
  }

  orderState.measurementLoading = false;
  renderOrderPage();
}

function backToPin() {
  orderState.step = 'pin';
  renderOrderPage();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function backToTrace() {
  // Clear measurement results since trace may change
  orderState.measurementResult = null;
  orderState.measurementError = null;
  orderState.measurementLoading = false;
  orderState.step = 'trace';
  renderOrderPage();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ============================================================
// PAYMENT
// ============================================================
function showMsg(type, msg) {
  const el = document.getElementById('orderMsg');
  if (!el) return;
  el.className = type === 'error'
    ? 'p-4 rounded-xl text-sm bg-red-500/10 text-red-700 border border-red-200'
    : 'p-4 rounded-xl text-sm bg-emerald-500/10 text-green-700 border border-green-200';
  el.innerHTML = msg;
  el.classList.remove('hidden');
}

function buildOrderPayload() {
  const payload = {
    property_address: orderState.address || `${orderState.lat}, ${orderState.lng}`,
    property_city: orderState.city || '',
    property_province: orderState.province || '',
    property_postal_code: orderState.postalCode || '',
    service_tier: orderState.selectedTier,
    latitude: parseFloat(orderState.lat),
    longitude: parseFloat(orderState.lng),
    roof_trace_json: orderState.roofTraceJson ? JSON.stringify(orderState.roofTraceJson) : null,
    price_per_bundle: orderState.pricePerBundle || null,
    house_sqft: orderState.houseSqft || null,
  };
  // Attach pre-calculated measurement data so the report engine can use it
  if (orderState.measurementResult) {
    payload.trace_measurement_json = JSON.stringify(orderState.measurementResult.full_report);
  }
  if (orderState.needsAdminTrace) {
    payload.needs_admin_trace = 1;
  }
  return payload;
}

// Live price estimate update when user types price per square
function updatePriceEstimate() {
  const m = orderState.measurementResult?.measurements || {};
  const grossSquares = m.gross_squares || 0;
  const pricePerSq = orderState.pricePerBundle;
  const valueEl = document.getElementById('priceEstimateValue');
  const boxEl = document.getElementById('priceEstimateBox');
  if (!valueEl) return;
  if (pricePerSq && grossSquares) {
    const estimate = grossSquares * pricePerSq;
    valueEl.textContent = '$' + estimate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    valueEl.className = 'text-2xl font-black mt-1 text-blue-400';
    if (boxEl) {
      const subEl = boxEl.querySelector('p:last-child');
      if (subEl) subEl.textContent = Math.round(grossSquares * 100).toLocaleString() + ' gross SF x $' + pricePerSq + '/sq';
    }
  } else {
    valueEl.textContent = '--';
    valueEl.className = 'text-2xl font-black mt-1 text-gray-300';
  }
}

// Retry measurement calculation if it failed
async function retryMeasurement() {
  if (!orderState.roofTraceJson) return;
  orderState.measurementLoading = true;
  orderState.measurementError = null;
  renderOrderPage();

  try {
    const res = await fetch('/api/reports/calculate-from-trace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trace: orderState.roofTraceJson,
        address: orderState.address || `${orderState.lat}, ${orderState.lng}`,
        house_sqft: orderState.houseSqft || null
      })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      orderState.measurementResult = data;
      orderState.measurementError = null;
    } else {
      orderState.measurementError = data.error || 'Measurement calculation failed';
    }
  } catch (e) {
    orderState.measurementError = 'Network error during measurement calculation';
  }

  orderState.measurementLoading = false;
  renderOrderPage();
}


function drawAutoTraceOnMap(trace) {
  if (!window.traceMap || !window.google) return;

  if (window.traceOverlays) {
    window.traceOverlays.forEach(o => o.setMap(null));
  }
  window.traceOverlays = [];

  // Draw eaves outline (blue polygon)
  if (trace.eaves && trace.eaves.length >= 3) {
    const eavePoly = new google.maps.Polygon({
      paths: trace.eaves,
      strokeColor: '#3B82F6',
      strokeWeight: 2,
      fillColor: '#3B82F6',
      fillOpacity: 0.15,
      map: window.traceMap
    });
    window.traceOverlays.push(eavePoly);
  }

  // Draw ridges (red lines)
  (trace.ridges || []).forEach(ridge => {
    const line = new google.maps.Polyline({
      path: ridge,
      strokeColor: '#EF4444',
      strokeWeight: 2,
      map: window.traceMap
    });
    window.traceOverlays.push(line);
  });

  // Draw hips (orange lines)
  (trace.hips || []).forEach(hip => {
    const line = new google.maps.Polyline({
      path: hip,
      strokeColor: '#F97316',
      strokeWeight: 2,
      map: window.traceMap
    });
    window.traceOverlays.push(line);
  });

  // Draw valleys (purple lines)
  (trace.valleys || []).forEach(valley => {
    const line = new google.maps.Polyline({
      path: valley,
      strokeColor: '#8B5CF6',
      strokeWeight: 2,
      map: window.traceMap
    });
    window.traceOverlays.push(line);
  });
}

function selectTier(tier) {
  orderState.selectedTier = tier;
}

async function useCredit() {
  const lat = parseFloat(orderState.lat);
  const lng = parseFloat(orderState.lng);
  if (isNaN(lat) || isNaN(lng)) { showMsg('error', 'No coordinates.'); return; }

  const btn = document.getElementById('creditBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Placing Order...'; }

  try {
    const res = await fetch('/api/square/use-credit', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(buildOrderPayload())
    });
    const data = await res.json();
    if (res.ok && data.success) {
      // Order placed! Backend generates report in background via waitUntil.
      // Redirect to dashboard IMMEDIATELY — polling will show the report when ready.
      showOrderSuccessOverlay(data.order);
    } else if (data.subscription_required) {
      // Free trials exhausted — must subscribe
      showSubscriptionRequiredOverlay();
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-coins mr-2"></i>Use Credit'; }
    } else {
      showMsg('error', '<i class="fas fa-exclamation-triangle mr-1"></i>' + (data.error || 'Failed to use credit'));
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-coins mr-2"></i>Use Credit'; }
    }
  } catch (e) {
    showMsg('error', '<i class="fas fa-exclamation-triangle mr-1"></i>Network error.');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-coins mr-2"></i>Use Credit'; }
  }
}

// ============================================================
// SUCCESS OVERLAY — Show animated confirmation then redirect
// User sees a polished success screen for 1.5s, then goes to dashboard
// ============================================================
function showOrderSuccessOverlay(order) {
  const address = order?.property_address || orderState.address || 'your property';
  const orderNum = order?.order_number || '';
  
  // Create full-screen overlay
  const overlay = document.createElement('div');
  overlay.id = 'orderSuccessOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);backdrop-filter:blur(8px);animation:fadeIn 0.3s ease-out';
  overlay.innerHTML = `
    <div style="background:white;border-radius:24px;padding:48px 40px;max-width:440px;width:90%;text-align:center;box-shadow:0 25px 60px rgba(0,0,0,0.3);animation:scaleIn 0.4s ease-out">
      <div style="width:80px;height:80px;margin:0 auto 20px;background:linear-gradient(135deg,#22c55e,#16a34a);border-radius:50%;display:flex;align-items:center;justify-content:center;animation:popIn 0.5s ease-out 0.2s both">
        <i class="fas fa-check" style="color:white;font-size:36px"></i>
      </div>
      <h2 style="font-size:22px;font-weight:800;color:#111;margin-bottom:8px">Order Placed!</h2>
      <p style="color:#6b7280;font-size:14px;margin-bottom:4px">${orderNum ? '<span style="font-family:monospace;background:#f3f4f6;padding:2px 8px;border-radius:6px;font-size:12px">' + orderNum + '</span><br>' : ''}
        ${address}</p>
      <div style="margin:20px auto;padding:16px;background:linear-gradient(135deg,#eff6ff,#dbeafe);border-radius:16px;border:1px solid #bfdbfe">
        <div style="display:flex;align-items:center;justify-content:center;gap:8px">
          <div class="animate-spin" style="width:20px;height:20px;border:3px solid #93c5fd;border-top-color:#2563eb;border-radius:50%"></div>
          <span style="font-size:14px;font-weight:600;color:#1d4ed8">Generating your roof report...</span>
        </div>
        <p style="color:#3b82f6;font-size:12px;margin-top:6px">This takes 20-40 seconds. You'll see it on your dashboard.</p>
      </div>
      <p style="color:#9ca3af;font-size:12px;margin-top:12px"><i class="fas fa-arrow-right mr-1"></i>Redirecting to dashboard...</p>
    </div>
    <style>
      @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
      @keyframes scaleIn { from { transform: scale(0.8); opacity: 0 } to { transform: scale(1); opacity: 1 } }
      @keyframes popIn { from { transform: scale(0); opacity: 0 } to { transform: scale(1); opacity: 1 } }
    </style>
  `;
  document.body.appendChild(overlay);

  // Redirect to dashboard after 1.5 seconds
  setTimeout(() => { window.location.href = '/customer/dashboard'; }, 1500);
}

// ============================================================
// SUBSCRIPTION REQUIRED OVERLAY — Shown when free trials are used up
// ============================================================
function showSubscriptionRequiredOverlay() {
  const existing = document.getElementById('subscriptionOverlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'subscriptionOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);backdrop-filter:blur(8px);animation:fadeIn 0.3s ease-out;overflow-y:auto;padding:20px';
  overlay.innerHTML = `
    <div style="background:white;border-radius:24px;padding:36px 28px;max-width:820px;width:95%;box-shadow:0 25px 60px rgba(0,0,0,0.3);animation:scaleIn 0.4s ease-out">
      <div style="text-align:center;margin-bottom:24px">
        <div style="width:64px;height:64px;margin:0 auto 16px;background:linear-gradient(135deg,#f59e0b,#d97706);border-radius:50%;display:flex;align-items:center;justify-content:center;animation:popIn 0.5s ease-out 0.2s both">
          <i class="fas fa-crown" style="color:white;font-size:28px"></i>
        </div>
        <h2 style="font-size:22px;font-weight:800;color:#111;margin-bottom:6px">Choose Your Membership</h2>
        <p style="color:#6b7280;font-size:14px">Your 3 free trial reports have been used. Subscribe to continue generating reports.</p>
      </div>

      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:20px">
        <!-- Starter -->
        <div style="border:2px solid #e5e7eb;border-radius:16px;padding:20px 16px;text-align:center;transition:border-color 0.2s">
          <div style="font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Starter</div>
          <div style="font-size:32px;font-weight:900;color:#111">$49<span style="font-size:14px;font-weight:500;color:#6b7280">.99/mo</span></div>
          <div style="margin:12px 0;font-size:13px;color:#374151">
            <div style="padding:4px 0"><i class="fas fa-users" style="color:#10b981;margin-right:6px;width:14px"></i>Up to <strong>5</strong> team members</div>
            <div style="padding:4px 0"><i class="fas fa-chart-line" style="color:#10b981;margin-right:6px;width:14px"></i>Full CRM access</div>
            <div style="padding:4px 0"><i class="fas fa-robot" style="color:#10b981;margin-right:6px;width:14px"></i>AI roof analysis</div>
            <div style="padding:4px 0"><i class="fas fa-times" style="color:#d1d5db;margin-right:6px;width:14px"></i><span style="color:#9ca3af">Reports sold separately</span></div>
          </div>
          <button onclick="subscribeFromOrder('starter')" class="sub-tier-btn" data-tier="starter" style="width:100%;background:#10b981;color:white;border:none;padding:12px;border-radius:12px;font-size:14px;font-weight:700;cursor:pointer;transition:background 0.2s">
            Subscribe
          </button>
        </div>

        <!-- Professional -->
        <div style="border:2px solid #10b981;border-radius:16px;padding:20px 16px;text-align:center;position:relative;box-shadow:0 4px 20px rgba(16,185,129,0.15)">
          <div style="position:absolute;top:-11px;left:50%;transform:translateX(-50%);background:#10b981;color:white;font-size:10px;font-weight:800;padding:3px 12px;border-radius:20px;text-transform:uppercase;letter-spacing:0.5px">Most Popular</div>
          <div style="font-size:12px;font-weight:700;color:#059669;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Professional</div>
          <div style="font-size:32px;font-weight:900;color:#111">$99<span style="font-size:14px;font-weight:500;color:#6b7280">.99/mo</span></div>
          <div style="margin:12px 0;font-size:13px;color:#374151">
            <div style="padding:4px 0"><i class="fas fa-users" style="color:#10b981;margin-right:6px;width:14px"></i>Up to <strong>10</strong> team members</div>
            <div style="padding:4px 0"><i class="fas fa-chart-line" style="color:#10b981;margin-right:6px;width:14px"></i>Full CRM access</div>
            <div style="padding:4px 0"><i class="fas fa-robot" style="color:#10b981;margin-right:6px;width:14px"></i>AI roof analysis</div>
            <div style="padding:4px 0"><i class="fas fa-times" style="color:#d1d5db;margin-right:6px;width:14px"></i><span style="color:#9ca3af">Reports sold separately</span></div>
          </div>
          <button onclick="subscribeFromOrder('professional')" class="sub-tier-btn" data-tier="professional" style="width:100%;background:linear-gradient(135deg,#10b981,#059669);color:white;border:none;padding:12px;border-radius:12px;font-size:14px;font-weight:700;cursor:pointer;transition:background 0.2s">
            Subscribe
          </button>
        </div>

        <!-- Enterprise -->
        <div style="border:2px solid #e5e7eb;border-radius:16px;padding:20px 16px;text-align:center;transition:border-color 0.2s">
          <div style="font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Enterprise</div>
          <div style="font-size:32px;font-weight:900;color:#111">$199<span style="font-size:14px;font-weight:500;color:#6b7280">.99/mo</span></div>
          <div style="margin:12px 0;font-size:13px;color:#374151">
            <div style="padding:4px 0"><i class="fas fa-users" style="color:#10b981;margin-right:6px;width:14px"></i>Up to <strong>25</strong> team members</div>
            <div style="padding:4px 0"><i class="fas fa-chart-line" style="color:#10b981;margin-right:6px;width:14px"></i>Full CRM access</div>
            <div style="padding:4px 0"><i class="fas fa-robot" style="color:#10b981;margin-right:6px;width:14px"></i>AI roof analysis</div>
            <div style="padding:4px 0"><i class="fas fa-times" style="color:#d1d5db;margin-right:6px;width:14px"></i><span style="color:#9ca3af">Reports sold separately</span></div>
          </div>
          <button onclick="subscribeFromOrder('enterprise')" class="sub-tier-btn" data-tier="enterprise" style="width:100%;background:#10b981;color:white;border:none;padding:12px;border-radius:12px;font-size:14px;font-weight:700;cursor:pointer;transition:background 0.2s">
            Subscribe
          </button>
        </div>
      </div>

      <!-- Enterprise contact -->
      <div style="text-align:center;padding:12px;background:#f9fafb;border-radius:12px;margin-bottom:16px">
        <p style="font-size:13px;color:#6b7280;margin:0">Need more than 25 team members? <a href="mailto:sales@roofmanager.ca" style="color:#059669;font-weight:700;text-decoration:none">Contact sales@roofmanager.ca</a></p>
      </div>

      <button onclick="document.getElementById('subscriptionOverlay').remove()" style="width:100%;background:none;border:1px solid #e5e7eb;padding:10px;border-radius:12px;font-size:13px;color:#6b7280;cursor:pointer">
        Maybe Later
      </button>
    </div>
    <style>
      @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
      @keyframes scaleIn { from { transform: scale(0.8); opacity: 0 } to { transform: scale(1); opacity: 1 } }
      @keyframes popIn { from { transform: scale(0); opacity: 0 } to { transform: scale(1); opacity: 1 } }
      @media (max-width: 640px) {
        #subscriptionOverlay > div > div:nth-child(2) { grid-template-columns: 1fr !important; }
      }
    </style>
  `;
  document.body.appendChild(overlay);
}

async function subscribeFromOrder(tier) {
  tier = tier || 'starter';
  var btns = document.querySelectorAll('.sub-tier-btn');
  btns.forEach(function(b) { b.disabled = true; });
  var btn = document.querySelector('[data-tier="' + tier + '"]');
  if (btn) btn.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:6px"></i>Redirecting...';
  try {
    const res = await fetch('/api/square/checkout/subscription', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ tier: tier })
    });
    const data = await res.json();
    if (data.checkout_url) {
      window.location.href = data.checkout_url;
    } else {
      showMsg('error', data.error || 'Subscription checkout failed.');
      btns.forEach(function(b) { b.disabled = false; });
      if (btn) btn.innerHTML = 'Subscribe';
    }
  } catch (e) {
    showMsg('error', 'Network error. Please try again.');
    btns.forEach(function(b) { b.disabled = false; });
    if (btn) btn.innerHTML = 'Subscribe';
  }
}

async function payWithSquare() {
  const lat = parseFloat(orderState.lat);
  const lng = parseFloat(orderState.lng);
  if (isNaN(lat) || isNaN(lng)) { showMsg('error', 'No coordinates.'); return; }

  const btn = document.getElementById('squareBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Redirecting to Square...'; }

  try {
    const res = await fetch('/api/square/checkout/report', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(buildOrderPayload())
    });
    const data = await res.json();
    if (data.subscription_required) {
      showSubscriptionRequiredOverlay();
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-credit-card mr-2"></i>Pay with Square'; }
    } else if (data.checkout_url) {
      window.location.href = data.checkout_url;
    } else {
      showMsg('error', '<i class="fas fa-exclamation-triangle mr-1"></i>' + (data.error || 'Checkout failed'));
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-credit-card mr-2"></i>Pay with Square'; }
    }
  } catch (e) {
    showMsg('error', '<i class="fas fa-exclamation-triangle mr-1"></i>Network error.');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-credit-card mr-2"></i>Pay with Square'; }
  }
}

async function buyPackage(pkgId) {
  try {
    const res = await fetch('/api/square/checkout', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ package_id: pkgId })
    });
    const data = await res.json();
    if (data.checkout_url) window.location.href = data.checkout_url;
    else showMsg('error', data.error || 'Checkout failed. Please try again.');
  } catch (e) {
    showMsg('error', 'Network error. Please check your connection and try again.');
  }
}

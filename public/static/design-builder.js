// ============================================================
// Roof Manager — Design Builder (Solar)
// Step 1: pick a completed roof measurement report
// Step 2+: redirect into /customer/solar-design?report_id=...
// ============================================================

(function () {
  'use strict';

  var root = document.getElementById('design-builder-root');
  function tok() { return localStorage.getItem('rc_customer_token') || ''; }
  function authHeaders() { return { 'Authorization': 'Bearer ' + tok() }; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]; }); }

  document.addEventListener('DOMContentLoaded', function () {
    // Guard: solar customers only
    try {
      var c = JSON.parse(localStorage.getItem('rc_customer') || '{}');
      if (c.company_type !== 'solar') {
        root.innerHTML = '<div class="max-w-xl mx-auto mt-16 bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center">' +
          '<i class="fas fa-solar-panel text-amber-500 text-4xl mb-3"></i>' +
          '<h2 class="text-xl font-bold text-gray-800 mb-2">Design Builder is for Solar Sales Companies</h2>' +
          '<p class="text-gray-600 mb-5">Switch your company type to <strong>Solar Sales Company</strong> in your account settings to unlock the Design Builder.</p>' +
          '<a href="/customer/profile" class="inline-block px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-white rounded-lg font-semibold"><i class="fas fa-cog mr-2"></i>Open Account Settings</a>' +
          '</div>';
        return;
      }
    } catch (e) {}
    load();
  });

  async function load() {
    root.innerHTML = '<div class="flex items-center justify-center py-20"><div class="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-amber-500"></div></div>';
    try {
      var res = await fetch('/api/customer/orders', { headers: authHeaders() });
      if (!res.ok) { window.location.href = '/customer/login'; return; }
      var data = await res.json();
      var orders = (data.orders || []).filter(function (o) {
        return (o.report_status === 'completed' || o.status === 'completed');
      });
      render(orders);
    } catch (e) {
      root.innerHTML = '<p class="text-center text-red-500 py-12">Failed to load reports. Please refresh.</p>';
    }
  }

  function stepper() {
    return '<div class="max-w-4xl mx-auto mb-6">' +
      '<div class="flex items-center justify-between bg-white rounded-2xl border border-gray-200 shadow-sm p-4">' +
        // Step 1 active
        '<div class="flex items-center gap-3 flex-1">' +
          '<div class="w-9 h-9 rounded-full bg-amber-500 text-white flex items-center justify-center font-bold">1</div>' +
          '<div><p class="text-sm font-bold text-gray-800">Select Report</p><p class="text-xs text-gray-500">Pick a completed roof measurement</p></div>' +
        '</div>' +
        '<div class="flex-1 h-0.5 bg-gray-200 mx-4"></div>' +
        // Step 2
        '<div class="flex items-center gap-3 flex-1 opacity-60">' +
          '<div class="w-9 h-9 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center font-bold">2</div>' +
          '<div><p class="text-sm font-bold text-gray-800">Design Panels</p><p class="text-xs text-gray-500">Auto-fill, obstructions, equipment</p></div>' +
        '</div>' +
        '<div class="flex-1 h-0.5 bg-gray-200 mx-4"></div>' +
        // Step 3
        '<div class="flex items-center gap-3 flex-1 opacity-60">' +
          '<div class="w-9 h-9 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center font-bold">3</div>' +
          '<div><p class="text-sm font-bold text-gray-800">Generate Proposal</p><p class="text-xs text-gray-500">Branded PDF for the homeowner</p></div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function render(orders) {
    var header = stepper() +
      '<div class="max-w-4xl mx-auto mb-4 flex items-center justify-between">' +
        '<div>' +
          '<h1 class="text-2xl font-bold text-gray-800"><i class="fas fa-solar-panel text-amber-500 mr-2"></i>Design Builder</h1>' +
          '<p class="text-sm text-gray-500 mt-1">Step 1 · Select the roof measurement report you want to design panels for.</p>' +
        '</div>' +
        '<a href="/customer/order" class="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-white rounded-lg text-sm font-semibold"><i class="fas fa-plus mr-1.5"></i>Order New Report</a>' +
      '</div>';

    if (!orders || orders.length === 0) {
      root.innerHTML = header +
        '<div class="max-w-4xl mx-auto bg-white rounded-2xl border border-gray-200 shadow-sm p-10 text-center">' +
          '<i class="fas fa-file-alt text-gray-300 text-5xl mb-3"></i>' +
          '<h2 class="text-lg font-bold text-gray-700 mb-1">No completed reports yet</h2>' +
          '<p class="text-sm text-gray-500 mb-5">Order a roof measurement report first, then return here to design your solar layout.</p>' +
          '<a href="/customer/order" class="inline-block px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-white rounded-lg font-semibold"><i class="fas fa-plus mr-2"></i>Order New Report</a>' +
        '</div>';
      return;
    }

    var cards = '<div class="max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">';
    for (var i = 0; i < orders.length; i++) {
      var o = orders[i];
      var thumb = o.satellite_image_url
        ? '<img src="' + esc(o.satellite_image_url) + '" alt="" class="w-full h-40 object-cover" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">'
        : '';
      var fallback = '<div class="w-full h-40 bg-gradient-to-br from-amber-100 to-orange-100 flex items-center justify-center"' + (o.satellite_image_url ? ' style="display:none"' : '') + '><i class="fas fa-home text-amber-500 text-4xl"></i></div>';
      var hasLayout = !!o.solar_panel_layout;
      var date = o.created_at ? new Date(o.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
      cards +=
        '<button onclick="window.location.href=\'/customer/solar-design?report_id=' + o.id + '\'" class="group text-left bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden hover:border-amber-400 hover:shadow-lg transition-all">' +
          '<div class="relative">' + thumb + fallback +
            (hasLayout ? '<span class="absolute top-2 right-2 bg-emerald-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full"><i class="fas fa-check mr-1"></i>DESIGN SAVED</span>' : '') +
          '</div>' +
          '<div class="p-4">' +
            '<p class="text-sm font-bold text-gray-800 truncate"><i class="fas fa-map-marker-alt text-red-400 mr-1.5 text-xs"></i>' + esc(o.property_address || 'Unknown address') + '</p>' +
            '<div class="flex items-center justify-between mt-2 text-xs text-gray-500">' +
              '<span><i class="far fa-calendar mr-1"></i>' + esc(date) + '</span>' +
              (o.roof_area_sqft ? '<span><i class="fas fa-ruler-combined mr-1"></i>' + Math.round(o.roof_area_sqft) + ' sq ft</span>' : '') +
            '</div>' +
            '<div class="mt-4 flex items-center justify-between">' +
              '<span class="text-xs font-semibold text-amber-600 group-hover:text-amber-700">' + (hasLayout ? 'Continue Design' : 'Start Designing') + ' <i class="fas fa-arrow-right ml-1"></i></span>' +
            '</div>' +
          '</div>' +
        '</button>';
    }
    cards += '</div>';
    root.innerHTML = header + cards;
  }
})();

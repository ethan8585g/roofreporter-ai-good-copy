// ============================================================
// Solar Sizing Calculator — Modal triggered from report cards
// Calculates system size and panel count from 12-month kWh usage
// ============================================================

(function() {
  function getToken() { return localStorage.getItem('rc_customer_token') || ''; }
  function authHeaders() { return { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' }; }

  function getCustomer() {
    try { return JSON.parse(localStorage.getItem('rc_customer') || '{}'); } catch(e) { return {}; }
  }

  var PEAK_SUN_HOURS = 4.5;
  var OFFSET_RATIO = 1.10; // 110% offset

  function calcSizing(monthlyKwh, panelWattage) {
    var annual = monthlyKwh.reduce(function(a, b) { return a + b; }, 0);
    var target = annual * OFFSET_RATIO;
    var systemKw = target / (PEAK_SUN_HOURS * 365);
    var panelCount = Math.ceil(systemKw * 1000 / panelWattage);
    var annualProduction = systemKw * PEAK_SUN_HOURS * 365;
    var offsetPct = Math.round((annualProduction / annual) * 100);
    return { annual: annual, target: target, systemKw: systemKw, panelCount: panelCount, annualProduction: annualProduction, offsetPct: offsetPct };
  }

  function monthName(i) {
    return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][i];
  }

  function renderModal(reportId) {
    var cust = getCustomer();
    var wattage = cust.solar_panel_wattage_w || 400;

    var monthInputs = '';
    for (var i = 0; i < 12; i++) {
      monthInputs +=
        '<div>' +
          '<label class="block text-xs font-medium text-gray-500 mb-1">' + monthName(i) + '</label>' +
          '<input type="number" id="scMonth' + i + '" min="0" placeholder="0" class="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm text-center focus:ring-2 focus:ring-amber-400">' +
        '</div>';
    }

    var html =
      '<div id="solarCalcModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">' +
        '<div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">' +
          '<div class="bg-gradient-to-r from-amber-400 to-orange-500 px-6 py-4 rounded-t-2xl flex items-center justify-between">' +
            '<div>' +
              '<h2 class="text-lg font-bold text-white"><i class="fas fa-sun mr-2"></i>Solar Sizing Calculator</h2>' +
              '<p class="text-amber-100 text-xs mt-0.5">Enter monthly electricity usage (kWh)</p>' +
            '</div>' +
            '<button onclick="window._closeSolarCalc()" class="text-white hover:text-amber-200 text-xl leading-none">&times;</button>' +
          '</div>' +
          '<div class="px-6 py-5">' +
            // Panel wattage setting
            '<div class="flex items-center gap-3 mb-5 p-3 bg-amber-50 rounded-xl border border-amber-200">' +
              '<i class="fas fa-solar-panel text-amber-500"></i>' +
              '<label class="text-sm font-medium text-gray-700 whitespace-nowrap">Panel Wattage (W):</label>' +
              '<input type="number" id="scWattage" value="' + wattage + '" min="100" max="800" step="5" class="flex-1 px-3 py-1.5 border border-amber-300 rounded-lg text-sm text-center focus:ring-2 focus:ring-amber-400">' +
              '<button onclick="window._saveSolarWattage()" class="text-xs font-semibold text-amber-600 hover:text-amber-800 whitespace-nowrap">Save</button>' +
            '</div>' +
            // 12-month grid
            '<div class="grid grid-cols-4 gap-2 mb-5">' + monthInputs + '</div>' +
            // Calculate button
            '<button onclick="window._calcSolar()" class="w-full bg-amber-500 hover:bg-amber-600 text-white font-bold py-3 rounded-xl text-sm transition-colors">' +
              '<i class="fas fa-calculator mr-2"></i>Calculate System Size' +
            '</button>' +
            // Results
            '<div id="scResults" class="mt-5 hidden">' +
              '<div class="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl border border-amber-200 p-5">' +
                '<h3 class="text-sm font-bold text-gray-700 mb-4 uppercase tracking-wide">Results</h3>' +
                '<div class="grid grid-cols-2 gap-4">' +
                  '<div class="text-center">' +
                    '<p class="text-3xl font-bold text-amber-600" id="scSystemKw">—</p>' +
                    '<p class="text-xs text-gray-500 mt-1">System Size (kW)</p>' +
                  '</div>' +
                  '<div class="text-center">' +
                    '<p class="text-3xl font-bold text-orange-600" id="scPanelCount">—</p>' +
                    '<p class="text-xs text-gray-500 mt-1">Panels Required</p>' +
                  '</div>' +
                  '<div class="text-center">' +
                    '<p class="text-2xl font-bold text-green-600" id="scAnnualProd">—</p>' +
                    '<p class="text-xs text-gray-500 mt-1">Annual Production (kWh)</p>' +
                  '</div>' +
                  '<div class="text-center">' +
                    '<p class="text-2xl font-bold text-blue-600" id="scOffset">—</p>' +
                    '<p class="text-xs text-gray-500 mt-1">Energy Offset</p>' +
                  '</div>' +
                '</div>' +
                '<p class="text-xs text-gray-400 mt-4 text-center">Based on ' + PEAK_SUN_HOURS + ' peak sun hours/day · 110% offset target</p>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    var el = document.createElement('div');
    el.id = 'solarCalcWrapper';
    el.innerHTML = html;
    document.body.appendChild(el);
  }

  window._openSolarCalculator = function(reportId) {
    var existing = document.getElementById('solarCalcWrapper');
    if (existing) existing.remove();
    renderModal(reportId);
  };

  window._closeSolarCalc = function() {
    var el = document.getElementById('solarCalcWrapper');
    if (el) el.remove();
  };

  window._calcSolar = function() {
    var monthlyKwh = [];
    for (var i = 0; i < 12; i++) {
      var val = parseFloat(document.getElementById('scMonth' + i).value) || 0;
      monthlyKwh.push(val);
    }
    var wattage = parseFloat(document.getElementById('scWattage').value) || 400;
    var r = calcSizing(monthlyKwh, wattage);

    document.getElementById('scSystemKw').textContent = r.systemKw.toFixed(2);
    document.getElementById('scPanelCount').textContent = r.panelCount;
    document.getElementById('scAnnualProd').textContent = Math.round(r.annualProduction).toLocaleString();
    document.getElementById('scOffset').textContent = r.offsetPct + '%';
    document.getElementById('scResults').classList.remove('hidden');
  };

  window._saveSolarWattage = function() {
    var wattage = parseInt(document.getElementById('scWattage').value) || 400;
    fetch('/api/customer/solar-settings', {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ solar_panel_wattage_w: wattage })
    }).then(function(r) { return r.json(); }).then(function(data) {
      if (data.success) {
        var cust = getCustomer();
        cust.solar_panel_wattage_w = wattage;
        localStorage.setItem('rc_customer', JSON.stringify(cust));
        var btn = document.querySelector('#solarCalcWrapper button[onclick="window._saveSolarWattage()"]');
        if (btn) { btn.textContent = 'Saved!'; setTimeout(function() { btn.textContent = 'Save'; }, 1500); }
      }
    }).catch(function() {});
  };

})();

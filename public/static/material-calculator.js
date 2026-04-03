// ============================================================
// Material Calculator — reads existing report.materials data
// No recalculation needed — all data is pre-computed in reports
// ============================================================

// ---- State ----
var mcState = {
  orders: [],
  selectedOrderId: null,
  report: null,          // parsed full RoofReport from api_response_raw
  currentWastePct: null,
  iceShieldEnabled: true,
  ventilationEnabled: true
};

// ---- Auth helpers ----
function mcToken() { return localStorage.getItem('rc_customer_token') || ''; }
function mcAuthHeaders() { return { 'Authorization': 'Bearer ' + mcToken(), 'Content-Type': 'application/json' }; }
function mcAuthOnly() { return { 'Authorization': 'Bearer ' + mcToken() }; }

// ---- Init ----
document.addEventListener('DOMContentLoaded', async function() {
  var root = document.getElementById('mat-calc-root');
  if (!root) return;
  root.innerHTML = mcSpinner();

  var res = await fetch('/api/customer/orders', { headers: mcAuthOnly() });
  if (!res.ok) { window.location.href = '/customer/login'; return; }
  var data = await res.json();

  mcState.orders = (data.orders || []).filter(function(o) {
    return o.report_status === 'completed';
  });

  renderOrderPicker();

  // Auto-select from URL param ?order_id=
  var params = new URLSearchParams(window.location.search);
  var autoId = params.get('order_id');
  if (autoId) mcSelectOrder(autoId);
});

// ---- Order Picker ----
function renderOrderPicker() {
  var root = document.getElementById('mat-calc-root');
  if (!root) return;

  if (mcState.orders.length === 0) {
    root.innerHTML =
      '<div class="bg-white rounded-2xl border border-gray-200 p-12 text-center shadow-sm">' +
        '<i class="fas fa-calculator text-gray-300 text-5xl mb-4 block"></i>' +
        '<h2 class="text-xl font-bold text-gray-700 mb-2">No Completed Reports</h2>' +
        '<p class="text-gray-500 mb-6">Complete a roof measurement report to use the Material Calculator.</p>' +
        '<a href="/customer/order" class="inline-block px-6 py-3 bg-sky-600 hover:bg-sky-700 text-white font-semibold rounded-xl text-sm transition-colors">Order a Report</a>' +
      '</div>';
    return;
  }

  var options = '<option value="">Select a completed report...</option>';
  mcState.orders.forEach(function(o) {
    var label = (o.property_address || 'Order #' + o.id);
    if (o.roof_area_sqft) label += ' — ' + Math.round(o.roof_area_sqft) + ' sq ft';
    var sel = String(o.id) === String(mcState.selectedOrderId) ? ' selected' : '';
    options += '<option value="' + o.id + '"' + sel + '>' + label + '</option>';
  });

  var pickerHtml =
    '<div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 mb-4">' +
      '<div class="flex items-center gap-3 mb-3">' +
        '<i class="fas fa-calculator text-sky-500 text-xl"></i>' +
        '<h1 class="text-lg font-bold text-gray-800">Material Calculator</h1>' +
      '</div>' +
      '<select id="mc-report-select" onchange="mcSelectOrder(this.value)" class="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm text-gray-700 bg-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500">' +
        options +
      '</select>' +
    '</div>' +
    '<div id="mc-report-area">' +
      (mcState.selectedOrderId ? mcSpinner() : '<div class="text-center py-12 text-gray-400"><i class="fas fa-arrow-up text-2xl mb-2 block"></i><p class="text-sm">Select a report above to view its material list</p></div>') +
    '</div>';

  root.innerHTML = pickerHtml;
}

// ---- Load Report ----
async function mcSelectOrder(orderId) {
  if (!orderId) return;
  mcState.selectedOrderId = orderId;
  mcState.report = null;

  // Update dropdown selection
  var sel = document.getElementById('mc-report-select');
  if (sel) sel.value = orderId;

  var area = document.getElementById('mc-report-area');
  if (area) area.innerHTML = mcSpinner();

  var res = await fetch('/api/reports/' + orderId, { headers: mcAuthOnly() });
  if (!res.ok) { mcToast('Failed to load report data', 'error'); return; }
  var data = await res.json();
  var row = data.report;

  var fullReport = null;
  if (row && row.api_response_raw) {
    try { fullReport = JSON.parse(row.api_response_raw); } catch(e) {}
  }

  // Generate waste_table client-side for old reports that don't have one
  if (fullReport && fullReport.materials && fullReport.materials.line_items && (!fullReport.materials.waste_table || !fullReport.materials.waste_table.length)) {
    var netArea = fullReport.materials.net_area_sqft || fullReport.total_true_area_sqft || 0;
    var complexity = fullReport.materials.complexity_class || 'moderate';
    var baseWaste = complexity === 'simple' ? 15 : complexity === 'moderate' ? 17 : complexity === 'complex' ? 19 : 20;
    var pcts = [0, 10, 12, 15, 17, 20];
    fullReport.materials.waste_table = pcts.map(function(pct) {
      var area = Math.round(netArea * (1 + pct / 100));
      var sq = Math.ceil(area / 100 * 10) / 10;
      return { waste_pct: pct, area_sqft: area, squares: sq, bundles: Math.ceil(sq * 3), label: pct === 0 ? 'Measured' : pct === baseWaste ? 'Suggested' : '', is_suggested: pct === baseWaste };
    });
  }

  if (!fullReport || !fullReport.materials || !fullReport.materials.line_items) {
    if (area) area.innerHTML =
      '<div class="bg-white rounded-2xl border border-gray-200 p-8 text-center">' +
        '<i class="fas fa-exclamation-circle text-amber-400 text-3xl mb-3 block"></i>' +
        '<p class="text-gray-600">Material data is not available for this report. It may have been generated before material tracking was enabled.</p>' +
      '</div>';
    return;
  }

  mcState.report = fullReport;

  // Fetch user's catalog to overlay custom prices
  try {
    var catRes = await fetch('/api/crm/catalog', { headers: mcAuthOnly() });
    if (catRes.ok) {
      var catData = await catRes.json();
      var catalogProducts = catData.products || [];
      if (catalogProducts.length > 0 && fullReport.materials && fullReport.materials.line_items) {
        // Build lookup: category → first matching catalog product
        var catPrices = {};
        catalogProducts.forEach(function(cp) {
          if (cp.is_default && cp.unit_price > 0 && !catPrices[cp.category]) {
            catPrices[cp.category] = cp;
          }
        });
        // Overlay catalog prices onto report line items
        fullReport.materials.line_items.forEach(function(item) {
          var match = catPrices[item.category];
          if (match) {
            item.unit_price_cad = match.unit_price;
            item._catalog_price = true;
            item._catalog_name = match.name;
          }
        });
      }
    }
  } catch(e) {}

  // Set default waste % to suggested
  var wt = fullReport.materials.waste_table || [];
  var suggested = wt.find(function(r) { return r.is_suggested; });
  mcState.currentWastePct = suggested ? suggested.waste_pct : (fullReport.materials.waste_pct || 15);
  mcState.iceShieldEnabled = true;
  mcState.ventilationEnabled = true;

  renderCalculator();
}

// ---- Full Calculator Render ----
function renderCalculator() {
  var area = document.getElementById('mc-report-area');
  if (!area || !mcState.report) return;

  area.innerHTML =
    renderRoofSummaryCard() +
    '<div id="mc-waste-controls">' + renderWasteControlsInner() + '</div>' +
    '<div id="mc-material-table">' + renderMaterialTableInner() + '</div>' +
    '<div id="mc-cost-footer">' + renderCostFooterInner() + '</div>' +
    renderActionBar();
}

// ---- Roof Summary Card ----
function renderRoofSummaryCard() {
  var r = mcState.report;
  var m = r.materials;
  var es = r.edge_summary || {};
  var addr = (r.property && r.property.address) ? r.property.address : '';

  return '<div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 mb-4">' +
    (addr ? '<h2 class="font-semibold text-gray-700 mb-3 text-sm"><i class="fas fa-map-marker-alt text-sky-400 mr-1.5"></i>' + addr + '</h2>' : '') +
    '<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">' +
      '<div class="text-center p-3 bg-sky-50 rounded-xl">' +
        '<p class="text-2xl font-black text-sky-700">' + Math.round(r.total_true_area_sqft || 0) + '</p>' +
        '<p class="text-xs text-gray-500 mt-0.5">True Area (sq ft)</p>' +
      '</div>' +
      '<div class="text-center p-3 bg-indigo-50 rounded-xl">' +
        '<p class="text-2xl font-black text-indigo-700">' + (r.roof_pitch_ratio || '—') + '</p>' +
        '<p class="text-xs text-gray-500 mt-0.5">Pitch</p>' +
      '</div>' +
      '<div class="text-center p-3 bg-emerald-50 rounded-xl">' +
        '<p class="text-2xl font-black text-emerald-700">' + (m.gross_squares ? m.gross_squares.toFixed(1) : '—') + '</p>' +
        '<p class="text-xs text-gray-500 mt-0.5">Squares</p>' +
      '</div>' +
      '<div class="text-center p-3 bg-amber-50 rounded-xl">' +
        '<p class="text-xl font-black text-amber-700 capitalize">' + (m.complexity_class || '—') + '</p>' +
        '<p class="text-xs text-gray-500 mt-0.5">Complexity</p>' +
      '</div>' +
    '</div>' +
    '<div class="grid grid-cols-5 gap-2 text-center text-xs text-gray-500 bg-gray-50 rounded-xl p-3">' +
      '<div><span class="font-bold text-gray-700 block text-sm">' + Math.round(es.total_ridge_ft || 0) + ' ft</span>Ridge</div>' +
      '<div><span class="font-bold text-gray-700 block text-sm">' + Math.round(es.total_hip_ft || 0) + ' ft</span>Hip</div>' +
      '<div><span class="font-bold text-gray-700 block text-sm">' + Math.round(es.total_valley_ft || 0) + ' ft</span>Valley</div>' +
      '<div><span class="font-bold text-gray-700 block text-sm">' + Math.round(es.total_eave_ft || 0) + ' ft</span>Eave</div>' +
      '<div><span class="font-bold text-gray-700 block text-sm">' + Math.round(es.total_rake_ft || 0) + ' ft</span>Rake</div>' +
    '</div>' +
  '</div>';
}

// ---- Waste Controls ----
function renderWasteControlsInner() {
  var wt = (mcState.report && mcState.report.materials.waste_table) || [];
  if (!wt.length) return '';

  var buttons = wt.map(function(row) {
    var isSelected = row.waste_pct === mcState.currentWastePct;
    var label = row.waste_pct === 0 ? '0% Measured' : row.waste_pct + '%';
    if (row.is_suggested) label += ' ★';
    var cls = isSelected
      ? 'px-4 py-2 bg-sky-600 text-white rounded-lg text-sm font-bold shadow-sm'
      : 'px-4 py-2 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg text-sm font-medium transition-colors';
    return '<button class="' + cls + '" onclick="mcSetWaste(' + row.waste_pct + ')">' + label + '</button>';
  }).join('');

  return '<div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 mb-4">' +
    '<h3 class="font-bold text-gray-800 mb-3 text-sm"><i class="fas fa-percent text-amber-500 mr-2"></i>Waste Factor</h3>' +
    '<div class="flex flex-wrap gap-2">' + buttons + '</div>' +
    '<p class="text-xs text-gray-400 mt-2">★ = Suggested for <span class="capitalize">' + (mcState.report.materials.complexity_class || '') + '</span> complexity roof</p>' +
  '</div>';
}

function mcSetWaste(pct) {
  mcState.currentWastePct = pct;
  var wc = document.getElementById('mc-waste-controls');
  if (wc) wc.innerHTML = renderWasteControlsInner();
  var mt = document.getElementById('mc-material-table');
  if (mt) mt.innerHTML = renderMaterialTableInner();
  var cf = document.getElementById('mc-cost-footer');
  if (cf) cf.innerHTML = renderCostFooterInner();
}

// ---- Get current waste row ----
function mcGetWasteRow() {
  var wt = (mcState.report && mcState.report.materials.waste_table) || [];
  for (var i = 0; i < wt.length; i++) {
    if (wt[i].waste_pct === mcState.currentWastePct) return wt[i];
  }
  return wt[0] || null;
}

// ---- Material Table ----
function renderMaterialTableInner() {
  var items = (mcState.report && mcState.report.materials.line_items) || [];
  var wasteRow = mcGetWasteRow();

  var categoryLabels = {
    shingles: 'Shingles',
    underlayment: 'Underlayment',
    ice_shield: 'Ice & Water Shield',
    starter_strip: 'Starter Strip',
    ridge_cap: 'Ridge Cap',
    drip_edge: 'Drip Edge',
    valley_metal: 'Valley Metal',
    step_flashing: 'Step Flashing',
    wall_flashing: 'Wall Flashing',
    nails: 'Nails / Fasteners',
    ventilation: 'Ventilation'
  };

  // Build filtered items with their original index for price editing
  var filteredItems = [];
  for (var fi = 0; fi < items.length; fi++) {
    var item = items[fi];
    if (item.category === 'ice_shield' && !mcState.iceShieldEnabled) continue;
    if (item.category === 'ventilation' && !mcState.ventilationEnabled) continue;
    filteredItems.push({ item: item, idx: fi });
  }

  var rows = filteredItems.map(function(entry) {
    var item = entry.item;
    var idx = entry.idx;
    var qty = item.order_quantity;
    // Shingles scale with waste — only override if user hasn't manually edited
    if (item.category === 'shingles' && wasteRow && wasteRow.bundles && !item._manualQtyEdit) {
      qty = wasteRow.bundles;
      item.order_quantity = qty;
    }
    var price = item.unit_price_cad || 0;
    var lineTotal = '$' + (qty * price).toFixed(2);
    var catLabel = categoryLabels[item.category] || item.category.replace(/_/g, ' ');

    return '<tr class="border-b border-gray-50 hover:bg-gray-50 transition-colors">' +
      '<td class="px-4 py-3 text-sm font-medium text-gray-800">' + catLabel + (item._catalog_price ? ' <span class="px-1 py-0.5 bg-blue-100 text-blue-700 rounded text-[9px] font-bold ml-1">CATALOG</span>' : '') + '</td>' +
      '<td class="px-4 py-3 text-sm text-gray-500 hidden sm:table-cell">' + (item._catalog_name || item.description || '') + '</td>' +
      '<td class="px-4 py-3 text-center"><input type="number" step="1" min="0" value="' + qty + '" onchange="mcUpdateQty(' + idx + ',this.value)" class="w-16 px-2 py-1 border border-gray-300 rounded-lg text-sm text-center font-bold focus:ring-2 focus:ring-sky-400 focus:border-sky-400"></td>' +
      '<td class="px-4 py-3 text-center text-gray-400 text-xs">' + (item.order_unit || '') + '</td>' +
      '<td class="px-4 py-3 text-right hidden sm:table-cell"><input type="number" step="0.01" min="0" value="' + price.toFixed(2) + '" onchange="mcUpdatePrice(' + idx + ',this.value)" class="w-20 px-2 py-1 border border-gray-300 rounded-lg text-sm text-right focus:ring-2 focus:ring-sky-400 focus:border-sky-400"></td>' +
      '<td class="px-4 py-3 text-right font-semibold text-gray-800 text-sm" id="mc-line-total-' + idx + '">' + lineTotal + '</td>' +
    '</tr>';
  });

  var toggleRow =
    '<div class="flex items-center gap-4">' +
      '<label class="flex items-center gap-1.5 text-xs cursor-pointer text-gray-600">' +
        '<input type="checkbox" ' + (mcState.iceShieldEnabled ? 'checked' : '') + ' onchange="mcToggleIce(this.checked)" class="rounded">' +
        'Ice Shield' +
      '</label>' +
      '<label class="flex items-center gap-1.5 text-xs cursor-pointer text-gray-600">' +
        '<input type="checkbox" ' + (mcState.ventilationEnabled ? 'checked' : '') + ' onchange="mcToggleVent(this.checked)" class="rounded">' +
        'Ventilation' +
      '</label>' +
    '</div>';

  return '<div class="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden mb-4">' +
    '<div class="px-5 py-4 border-b border-gray-100 flex items-center justify-between">' +
      '<h3 class="font-bold text-gray-800 text-sm"><i class="fas fa-boxes text-indigo-500 mr-2"></i>Material List</h3>' +
      toggleRow +
    '</div>' +
    '<div class="overflow-x-auto">' +
    '<table class="w-full">' +
      '<thead class="bg-gray-50">' +
        '<tr>' +
          '<th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Item</th>' +
          '<th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide hidden sm:table-cell">Description</th>' +
          '<th class="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Qty</th>' +
          '<th class="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Unit</th>' +
          '<th class="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide hidden sm:table-cell">Unit Price</th>' +
          '<th class="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Total</th>' +
        '</tr>' +
      '</thead>' +
      '<tbody>' + rows.join('') + '</tbody>' +
    '</table>' +
    '</div>' +
  '</div>';
}

function mcToggleIce(val) {
  mcState.iceShieldEnabled = val;
  mcRefreshDynamic();
}
function mcToggleVent(val) {
  mcState.ventilationEnabled = val;
  mcRefreshDynamic();
}
function mcRefreshDynamic() {
  var mt = document.getElementById('mc-material-table');
  if (mt) mt.innerHTML = renderMaterialTableInner();
  var cf = document.getElementById('mc-cost-footer');
  if (cf) cf.innerHTML = renderCostFooterInner();
}

function mcUpdateQty(itemIdx, newVal) {
  var items = (mcState.report && mcState.report.materials.line_items) || [];
  if (!items[itemIdx]) return;
  var qty = parseInt(newVal) || 0;
  items[itemIdx].order_quantity = qty;
  items[itemIdx]._manualQtyEdit = true; // Prevent waste factor from overriding
  // Update line total inline
  var price = items[itemIdx].unit_price_cad || 0;
  var cell = document.getElementById('mc-line-total-' + itemIdx);
  if (cell) cell.textContent = '$' + (qty * price).toFixed(2);
  // Update cost footer
  var cf = document.getElementById('mc-cost-footer');
  if (cf) cf.innerHTML = renderCostFooterInner();
}

function mcUpdatePrice(itemIdx, newVal) {
  var items = (mcState.report && mcState.report.materials.line_items) || [];
  if (!items[itemIdx]) return;
  var price = parseFloat(newVal) || 0;
  items[itemIdx].unit_price_cad = price;
  // Update line total inline
  var item = items[itemIdx];
  var qty = item.order_quantity;
  var cell = document.getElementById('mc-line-total-' + itemIdx);
  if (cell) cell.textContent = '$' + (qty * price).toFixed(2);
  // Update cost footer
  var cf = document.getElementById('mc-cost-footer');
  if (cf) cf.innerHTML = renderCostFooterInner();
}

// ---- Cost Footer ----
function renderCostFooterInner() {
  var items = (mcState.report && mcState.report.materials.line_items) || [];
  var total = 0;

  items.forEach(function(item) {
    if (item.category === 'ice_shield' && !mcState.iceShieldEnabled) return;
    if (item.category === 'ventilation' && !mcState.ventilationEnabled) return;
    if (!item.unit_price_cad) return;
    total += item.order_quantity * item.unit_price_cad;
  });

  return '<div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 mb-4">' +
    '<div class="flex flex-wrap items-center justify-between gap-3">' +
      '<div>' +
        '<p class="text-sm font-semibold text-gray-700">Estimated Material Cost</p>' +
        '<p class="text-xs text-gray-400 mt-0.5">' + mcState.currentWastePct + '% waste factor · editable pricing · excludes labour</p>' +
      '</div>' +
      '<p class="text-3xl font-black text-sky-700">$' + total.toFixed(2) + ' <span class="text-lg font-normal text-gray-400">CAD</span></p>' +
    '</div>' +
  '</div>';
}

// ---- Action Bar ----
function renderActionBar() {
  return '<div id="mc-action-bar" class="flex flex-wrap gap-3 mb-8">' +
    '<button onclick="mcAddToInvoice()" class="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl text-sm transition-colors shadow-sm">' +
      '<i class="fas fa-file-invoice-dollar"></i>Add to Invoice' +
    '</button>' +
    '<button onclick="mcCreateProposal()" class="flex items-center gap-2 px-5 py-2.5 bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-xl text-sm transition-colors shadow-sm">' +
      '<i class="fas fa-file-invoice mr-1"></i>Go to Proposals <i class="fas fa-arrow-right text-xs ml-1"></i>' +
    '</button>' +
    '<button onclick="window.print()" class="flex items-center gap-2 px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-xl text-sm transition-colors">' +
      '<i class="fas fa-print"></i>Print' +
    '</button>' +
    '<button onclick="mcCopyList()" class="flex items-center gap-2 px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-xl text-sm transition-colors">' +
      '<i class="fas fa-copy"></i>Copy List' +
    '</button>' +
    '<button onclick="mcExportCSV()" class="flex items-center gap-2 px-5 py-2.5 bg-sky-600 hover:bg-sky-700 text-white font-semibold rounded-xl text-sm transition-colors shadow-sm">' +
      '<i class="fas fa-file-csv"></i>Export CSV' +
    '</button>' +
    '<button onclick="mcExportXactimate()" class="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl text-sm transition-colors shadow-sm">' +
      '<i class="fas fa-file-code"></i>Xactimate XML' +
    '</button>' +
  '</div>';
}

// ---- Add to Invoice ----
function mcAddToInvoice() {
  var items = mcBuildInvoiceItems();
  if (!items.length) { mcToast('No items to add', 'error'); return; }

  fetch('/api/crm/customers', { headers: mcAuthOnly() })
    .then(function(r) { return r.json(); })
    .then(function(data) { mcShowInvoiceModal(data.customers || [], items); })
    .catch(function() { mcToast('Failed to load customers', 'error'); });
}

function mcBuildInvoiceItems() {
  var items = (mcState.report && mcState.report.materials.line_items) || [];
  var wasteRow = mcGetWasteRow();
  var result = [];
  items.forEach(function(item) {
    if (item.category === 'ice_shield' && !mcState.iceShieldEnabled) return;
    if (item.category === 'ventilation' && !mcState.ventilationEnabled) return;
    if (!item.unit_price_cad) return; // skip items with no pricing
    var qty = item.order_quantity;
    result.push({
      description: item.description || item.category,
      quantity: qty,
      unit_price: item.unit_price_cad
    });
  });
  return result;
}

function mcShowInvoiceModal(customers, items) {
  var addr = (mcState.report.property && mcState.report.property.address) || '';

  var custOptions = '<option value="">Select a customer...</option>';
  customers.forEach(function(c) {
    custOptions += '<option value="' + c.id + '">' + (c.name || '') + (c.email ? ' — ' + c.email : '') + '</option>';
  });

  var totalAmt = 0;
  items.forEach(function(i) { totalAmt += (i.quantity || 0) * (i.unit_price || 0); });

  var modal =
    '<div id="mc-invoice-modal" class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">' +
    '<div class="bg-white rounded-2xl shadow-2xl w-full max-w-md">' +
      '<div class="px-6 py-4 border-b border-gray-100 flex items-center justify-between">' +
        '<h3 class="font-bold text-gray-800">Create Invoice from Materials</h3>' +
        '<button onclick="document.getElementById(\'mc-invoice-modal\').remove()" class="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>' +
      '</div>' +
      '<div class="p-6 space-y-4">' +
        '<div>' +
          '<label class="block text-xs font-semibold text-gray-600 mb-1.5">Customer <span class="text-red-500">*</span></label>' +
          '<select id="mc-inv-customer" class="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm">' + custOptions + '</select>' +
        '</div>' +
        '<div>' +
          '<label class="block text-xs font-semibold text-gray-600 mb-1.5">Property Address</label>' +
          '<input type="text" id="mc-inv-address" value="' + addr + '" placeholder="123 Main St..." class="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm">' +
        '</div>' +
        '<div class="grid grid-cols-2 gap-3">' +
          '<div>' +
            '<label class="block text-xs font-semibold text-gray-600 mb-1.5">Tax Rate (%)</label>' +
            '<input type="number" id="mc-inv-tax" value="5" step="0.1" min="0" max="30" class="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm">' +
          '</div>' +
          '<div>' +
            '<label class="block text-xs font-semibold text-gray-600 mb-1.5">Notes (optional)</label>' +
            '<input type="text" id="mc-inv-notes" placeholder="Material estimate..." class="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm">' +
          '</div>' +
        '</div>' +
        '<div class="bg-gray-50 rounded-xl p-3 text-sm text-gray-600">' +
          '<span class="font-semibold">' + items.length + '</span> line items &nbsp;·&nbsp; ' +
          'Est. subtotal <span class="font-semibold">$' + totalAmt.toFixed(2) + ' CAD</span> &nbsp;·&nbsp; ' +
          mcState.currentWastePct + '% waste' +
        '</div>' +
      '</div>' +
      '<div class="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">' +
        '<button onclick="document.getElementById(\'mc-invoice-modal\').remove()" class="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm">Cancel</button>' +
        '<button onclick="mcSubmitInvoice()" class="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold transition-colors">Create Invoice</button>' +
      '</div>' +
    '</div></div>';

  document.body.insertAdjacentHTML('beforeend', modal);
  window._mcPendingItems = items;
}

function mcSubmitInvoice() {
  var custId = document.getElementById('mc-inv-customer').value;
  if (!custId) { mcToast('Please select a customer', 'error'); return; }

  var addr = (mcState.report.property && mcState.report.property.address) || '';
  var payload = {
    crm_customer_id: parseInt(custId),
    property_address: document.getElementById('mc-inv-address').value.trim() || addr || null,
    tax_rate: parseFloat(document.getElementById('mc-inv-tax').value) || 5,
    notes: document.getElementById('mc-inv-notes').value.trim() || null,
    title: 'Material Estimate' + (addr ? ' — ' + addr : ''),
    items: window._mcPendingItems || []
  };

  fetch('/api/crm/invoices', {
    method: 'POST',
    headers: mcAuthHeaders(),
    body: JSON.stringify(payload)
  })
  .then(function(r) { return r.json(); })
  .then(function(res) {
    var modal = document.getElementById('mc-invoice-modal');
    if (modal) modal.remove();
    if (res.success || res.invoice) {
      mcToast('Invoice created! Redirecting...');
      setTimeout(function() { window.location.href = '/customer/invoices'; }, 1500);
    } else {
      mcToast(res.error || 'Failed to create invoice', 'error');
    }
  })
  .catch(function(e) { mcToast('Network error — please try again', 'error'); });
}

// ---- Create Proposal — redirect to Proposals dashboard with material data ----
function mcCreateProposal() {
  var items = mcBuildInvoiceItems();
  var addr = (mcState.report && mcState.report.property && mcState.report.property.address) || '';
  localStorage.setItem('mc_proposal_materials', JSON.stringify({
    items: items,
    address: addr,
    source_report_id: mcState.selectedOrderId,
    waste_pct: mcState.currentWastePct,
    total_area_sqft: Math.round(mcState.report.total_true_area_sqft || 0),
    pitch: mcState.report.roof_pitch_ratio || ''
  }));
  mcToast('Redirecting to Proposals...');
  window.location.href = '/customer/proposals';
}

// ---- Export CSV ----
function mcExportCSV() {
  if (!mcState.report) return;
  var r = mcState.report;
  var items = (r.materials && r.materials.line_items) || [];
  var addr = (r.property && r.property.address) || '';
  var rows = ['Category,Description,Quantity,Unit,Unit Price (CAD),Total (CAD)'];
  items.forEach(function(item) {
    if (item.category === 'ice_shield' && !mcState.iceShieldEnabled) return;
    if (item.category === 'ventilation' && !mcState.ventilationEnabled) return;
    var qty = item.order_quantity;
    var price = item.unit_price_cad || 0;
    var desc = (item.description || '').replace(/"/g, '""');
    rows.push('"' + item.category + '","' + desc + '",' + qty + ',"' + (item.order_unit || '') + '",' + price.toFixed(2) + ',' + (qty * price).toFixed(2));
  });
  var csv = rows.join('\n');
  var blob = new Blob([csv], { type: 'text/csv' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'material-estimate' + (addr ? '-' + addr.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30) : '') + '.csv';
  a.click();
  URL.revokeObjectURL(url);
  mcToast('CSV exported!');
}

// ---- Export Xactimate XML ----
function mcExportXactimate() {
  if (!mcState.report) return;
  var r = mcState.report;
  var items = (r.materials && r.materials.line_items) || [];
  var addr = (r.property && r.property.address) || '';
  var es = r.edge_summary || {};
  var xml = '<?xml version="1.0" encoding="UTF-8"?>\n<RoofEstimate>\n';
  xml += '  <ProjectInfo>\n    <Address>' + addr + '</Address>\n    <Date>' + new Date().toISOString().substring(0, 10) + '</Date>\n    <WasteFactor>' + mcState.currentWastePct + '</WasteFactor>\n    <TotalArea>' + Math.round(r.total_true_area_sqft || 0) + '</TotalArea>\n    <Pitch>' + (r.roof_pitch_ratio || '') + '</Pitch>\n  </ProjectInfo>\n';
  xml += '  <Measurements>\n    <RidgeLF>' + Math.round(es.total_ridge_ft || 0) + '</RidgeLF>\n    <HipLF>' + Math.round(es.total_hip_ft || 0) + '</HipLF>\n    <ValleyLF>' + Math.round(es.total_valley_ft || 0) + '</ValleyLF>\n    <EaveLF>' + Math.round(es.total_eave_ft || 0) + '</EaveLF>\n    <RakeLF>' + Math.round(es.total_rake_ft || 0) + '</RakeLF>\n  </Measurements>\n';
  xml += '  <Materials>\n';
  items.forEach(function(item) {
    if (item.category === 'ice_shield' && !mcState.iceShieldEnabled) return;
    if (item.category === 'ventilation' && !mcState.ventilationEnabled) return;
    var qty = item.order_quantity;
    xml += '    <Item category="' + item.category + '">\n      <Description>' + (item.description || '') + '</Description>\n      <Quantity>' + qty + '</Quantity>\n      <Unit>' + (item.order_unit || '') + '</Unit>\n      <UnitPrice>' + (item.unit_price_cad || 0).toFixed(2) + '</UnitPrice>\n      <Total>' + (qty * (item.unit_price_cad || 0)).toFixed(2) + '</Total>\n    </Item>\n';
  });
  xml += '  </Materials>\n</RoofEstimate>';
  var blob = new Blob([xml], { type: 'application/xml' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'xactimate-estimate' + (addr ? '-' + addr.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30) : '') + '.xml';
  a.click();
  URL.revokeObjectURL(url);
  mcToast('Xactimate XML exported!');
}

// ---- Copy List ----
function mcCopyList() {
  if (!mcState.report) return;
  var r = mcState.report;
  var items = (r.materials && r.materials.line_items) || [];
  var wasteRow = mcGetWasteRow();
  var addr = (r.property && r.property.address) || '';

  var lines = [
    'MATERIAL ESTIMATE — ' + addr.toUpperCase(),
    'True Area: ' + Math.round(r.total_true_area_sqft || 0) + ' sq ft  |  Pitch: ' + (r.roof_pitch_ratio || '—') + '  |  Waste: ' + mcState.currentWastePct + '%',
    '',
    'ITEM                          QTY    UNIT'
  ];
  lines.push('─'.repeat(46));

  items.forEach(function(item) {
    if (item.category === 'ice_shield' && !mcState.iceShieldEnabled) return;
    if (item.category === 'ventilation' && !mcState.ventilationEnabled) return;
    var qty = item.order_quantity;
    var name = (item.description || item.category).substring(0, 29).padEnd(30);
    lines.push(name + String(qty).padStart(4) + '   ' + (item.order_unit || ''));
  });

  lines.push('─'.repeat(46));

  var total = 0;
  items.forEach(function(item) {
    if (item.category === 'ice_shield' && !mcState.iceShieldEnabled) return;
    if (item.category === 'ventilation' && !mcState.ventilationEnabled) return;
    if (!item.unit_price_cad) return;
    var qty = item.order_quantity;
    total += qty * item.unit_price_cad;
  });
  lines.push('Est. Material Total: $' + total.toFixed(2) + ' CAD');

  navigator.clipboard.writeText(lines.join('\n'))
    .then(function() { mcToast('Copied to clipboard!'); })
    .catch(function() { mcToast('Copy failed — use Print instead', 'error'); });
}

// ---- Toast ----
function mcToast(msg, type) {
  var existing = document.getElementById('mc-toast');
  if (existing) existing.remove();
  var bg = type === 'error' ? 'bg-red-600' : 'bg-gray-900';
  var t = document.createElement('div');
  t.id = 'mc-toast';
  t.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 ' + bg + ' text-white px-5 py-3 rounded-xl shadow-2xl text-sm font-medium z-50 transition-all';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(function() { if (t.parentNode) t.remove(); }, 3000);
}

// ---- Spinner ----
function mcSpinner() {
  return '<div class="flex items-center justify-center py-12"><div class="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-sky-500"></div></div>';
}

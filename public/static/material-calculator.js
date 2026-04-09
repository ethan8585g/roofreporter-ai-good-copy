// ============================================================
// Material Calculator — Enhanced Job Costing Workspace
// Markup pricing, dual contractor/client views,
// custom line items, labour section, draft autosave
// ============================================================

// ---- State ----
var mcState = {
  orders: [],
  selectedOrderId: null,
  report: null,
  currentWastePct: null,
  iceShieldEnabled: true,
  ventilationEnabled: true,
  viewMode: 'contractor',       // 'contractor' | 'client'
  hiddenItems: {},              // { 'mat-{idx}': true }
  customItems: [],              // custom line items
  labourItems: [],              // labour entries
  includeLabourInTotal: true,
  invoiceMeta: {
    jobName: '', address: '', invoiceNumber: '',
    invoiceDate: '', dueDate: '', poNumber: '',
    terms: 'Net 30', depositCollected: 0
  }
};

// ---- Auth ----
function mcToken() { return localStorage.getItem('rc_customer_token') || ''; }
function mcAuthHeaders() { return { 'Authorization': 'Bearer ' + mcToken(), 'Content-Type': 'application/json' }; }
function mcAuthOnly() { return { 'Authorization': 'Bearer ' + mcToken() }; }

// ---- Helpers ----
function mcEsc(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function mcGenEstNum() {
  var d = new Date().toISOString().slice(0,10).replace(/-/g,'');
  return 'EST-' + d + '-' + Math.floor(Math.random()*9999).toString().padStart(4,'0');
}
function mcFmt(n) { return '$' + (n||0).toFixed(2); }

// ---- Init ----
document.addEventListener('DOMContentLoaded', async function() {
  var root = document.getElementById('mat-calc-root');
  if (!root) return;
  root.innerHTML = mcSpinner();
  mcInjectPrintCSS();

  var res = await fetch('/api/customer/orders', { headers: mcAuthOnly() });
  if (!res.ok) { window.location.href = '/customer/login'; return; }
  var data = await res.json();
  mcState.orders = (data.orders || []).filter(function(o) { return o.report_status === 'completed'; });
  renderOrderPicker();

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
      '<div style="background:var(--bg-card);border:1px solid var(--border-color)" class="rounded-2xl p-12 text-center">' +
        '<i class="fas fa-calculator text-4xl mb-4 block" style="color:var(--text-muted)"></i>' +
        '<h2 class="text-xl font-bold mb-2" style="color:var(--text-primary)">No Completed Reports</h2>' +
        '<p class="mb-6 text-sm" style="color:var(--text-muted)">Complete a roof measurement to use the Material Calculator.</p>' +
        '<a href="/customer/order" class="inline-block px-6 py-3 bg-sky-600 text-white font-semibold rounded-xl text-sm">Order a Report</a>' +
      '</div>';
    return;
  }

  var options = '<option value="">Select a completed report...</option>';
  mcState.orders.forEach(function(o) {
    var label = o.property_address || 'Order #' + o.id;
    if (o.roof_area_sqft) label += ' — ' + Math.round(o.roof_area_sqft) + ' sq ft';
    options += '<option value="' + o.id + '"' + (String(o.id) === String(mcState.selectedOrderId) ? ' selected' : '') + '>' + label + '</option>';
  });

  root.innerHTML =
    '<div style="background:var(--bg-card);border:1px solid var(--border-color)" class="rounded-2xl p-5 mb-4">' +
      '<div class="flex items-center gap-3 mb-3"><i class="fas fa-calculator text-sky-500 text-xl"></i>' +
      '<h1 class="text-lg font-bold" style="color:var(--text-primary)">Material Calculator</h1></div>' +
      '<select id="mc-report-select" onchange="mcSelectOrder(this.value)" class="w-full px-3 py-2.5 rounded-xl text-sm" style="border:1px solid var(--border-color);background:var(--bg-elevated);color:var(--text-primary)">' + options + '</select>' +
    '</div>' +
    '<div id="mc-report-area">' +
      (mcState.selectedOrderId ? mcSpinner() : '<div class="text-center py-12 text-sm" style="color:var(--text-muted)"><i class="fas fa-arrow-up text-2xl mb-2 block"></i>Select a report above</div>') +
    '</div>';
}

// ---- Load Report ----
async function mcSelectOrder(orderId) {
  if (!orderId) return;
  mcState.selectedOrderId = orderId;
  mcState.report = null;
  mcState.hiddenItems = {};
  mcState.customItems = [];
  mcState.labourItems = [];
  mcState.includeLabourInTotal = true;
  mcState.viewMode = 'contractor';
  mcState.invoiceMeta = {
    jobName: '', address: '', invoiceNumber: mcGenEstNum(),
    invoiceDate: new Date().toISOString().slice(0,10),
    dueDate: '', poNumber: '', terms: 'Net 30', depositCollected: 0
  };

  var sel = document.getElementById('mc-report-select');
  if (sel) sel.value = orderId;
  var area = document.getElementById('mc-report-area');
  if (area) area.innerHTML = mcSpinner();

  var res = await fetch('/api/reports/' + orderId, { headers: mcAuthOnly() });
  if (!res.ok) { mcToast('Failed to load report', 'error'); return; }
  var data = await res.json();
  var row = data.report;

  var fullReport = null;
  if (row && row.api_response_raw) {
    try { fullReport = JSON.parse(row.api_response_raw); } catch(e) {}
  }

  // Generate waste_table if missing
  if (fullReport && fullReport.materials && fullReport.materials.line_items &&
      (!fullReport.materials.waste_table || !fullReport.materials.waste_table.length)) {
    var netArea = fullReport.materials.net_area_sqft || fullReport.total_true_area_sqft || 0;
    var complexity = fullReport.materials.complexity_class || 'moderate';
    var baseWaste = complexity === 'simple' ? 15 : complexity === 'complex' ? 19 : 17;
    fullReport.materials.waste_table = [0,10,12,15,17,20].map(function(pct) {
      var a = Math.round(netArea * (1 + pct/100));
      var sq = Math.ceil(a/100*10)/10;
      return { waste_pct: pct, area_sqft: a, squares: sq, bundles: Math.ceil(sq*3),
               is_suggested: pct === baseWaste };
    });
  }

  if (!fullReport || !fullReport.materials || !fullReport.materials.line_items) {
    if (area) area.innerHTML = '<div style="background:var(--bg-card);border:1px solid var(--border-color)" class="rounded-2xl p-8 text-center"><p style="color:var(--text-muted)">Material data not available for this report.</p></div>';
    return;
  }

  mcState.report = fullReport;

  // Overlay catalog prices
  try {
    var catRes = await fetch('/api/crm/catalog', { headers: mcAuthOnly() });
    if (catRes.ok) {
      var catData = await catRes.json();
      var catPrices = {};
      (catData.products || []).forEach(function(cp) {
        if (cp.is_default && cp.unit_price > 0 && !catPrices[cp.category]) catPrices[cp.category] = cp;
      });
      fullReport.materials.line_items.forEach(function(item) {
        var match = catPrices[item.category];
        if (match) { item.unit_price_cad = match.unit_price; item._catalog_price = true; item._catalog_name = match.name; }
      });
    }
  } catch(e) {}

  // Init per-item state
  fullReport.materials.line_items.forEach(function(item) {
    if (item._markupPct === undefined) item._markupPct = 0;
    if (item._visible === undefined) item._visible = true;
  });

  var wt = fullReport.materials.waste_table || [];
  var suggested = wt.find(function(r) { return r.is_suggested; });
  mcState.currentWastePct = suggested ? suggested.waste_pct : (fullReport.materials.waste_pct || 15);
  mcState.iceShieldEnabled = true;
  mcState.ventilationEnabled = true;

  var addr = (fullReport.property && fullReport.property.address) || '';
  mcState.invoiceMeta.address = addr;
  mcState.invoiceMeta.jobName = addr ? addr.split(',')[0] : '';

  mcLoadDraft(orderId);
  renderCalculator();
}

// ---- Full Render ----
function renderCalculator() {
  var area = document.getElementById('mc-report-area');
  if (!area || !mcState.report) return;
  area.innerHTML =
    renderRoofSummaryCard() +
    renderViewModeToggle() +
    renderInvoiceHeader() +
    '<div id="mc-waste-controls">' + renderWasteControlsInner() + '</div>' +
    '<div id="mc-material-table">' + renderMaterialTableInner() + '</div>' +
    '<div id="mc-custom-items">' + renderCustomLineItems() + '</div>' +
    '<div id="mc-labour-section">' + renderLabourSection() + '</div>' +
    '<div id="mc-cost-footer">' + renderCostFooterInner() + '</div>' +
    renderActionBar();
}

// ---- Roof Summary Card ----
function renderRoofSummaryCard() {
  var r = mcState.report, m = r.materials, es = r.edge_summary || {};
  var addr = r.property && r.property.address ? r.property.address : '';
  var card = function(val, label) {
    return '<div class="text-center p-3 rounded-xl" style="background:var(--bg-elevated);border:1px solid var(--border-color)">' +
      '<p class="text-2xl font-black" style="color:var(--text-primary)">' + val + '</p>' +
      '<p class="text-xs mt-0.5" style="color:var(--text-muted)">' + label + '</p></div>';
  };
  return '<div style="background:var(--bg-card);border:1px solid var(--border-color)" class="rounded-2xl p-5 mb-4 mc-no-print">' +
    (addr ? '<h2 class="font-semibold mb-3 text-sm" style="color:var(--text-secondary)"><i class="fas fa-map-marker-alt text-sky-400 mr-1.5"></i>' + addr + '</h2>' : '') +
    '<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">' +
      card(Math.round(r.total_true_area_sqft||0), 'True Area (sq ft)') +
      card(r.roof_pitch_ratio||'—', 'Pitch') +
      card(m.gross_squares ? m.gross_squares.toFixed(1) : '—', 'Squares') +
      card('<span class="text-xl capitalize">' + (m.complexity_class||'—') + '</span>', 'Complexity') +
    '</div>' +
    '<div class="grid grid-cols-5 gap-2 text-center text-xs rounded-xl p-3" style="background:var(--bg-elevated)">' +
      ['Ridge','Hip','Valley','Eave','Rake'].map(function(name, i) {
        var vals = [es.total_ridge_ft, es.total_hip_ft, es.total_valley_ft, es.total_eave_ft, es.total_rake_ft];
        return '<div><span class="font-bold block text-sm" style="color:var(--text-primary)">' + Math.round(vals[i]||0) + ' ft</span><span style="color:var(--text-muted)">' + name + '</span></div>';
      }).join('') +
    '</div>' +
  '</div>';
}

// ---- View Mode Toggle ----
function renderViewModeToggle() {
  var isC = mcState.viewMode === 'contractor';
  var btnStyle = function(active) {
    return 'padding:8px 16px;font-size:13px;font-weight:600;cursor:pointer;border:none;transition:all 0.15s;' +
      (active ? 'background:#0ea5e9;color:#fff;' : 'background:var(--bg-elevated);color:var(--text-muted);');
  };
  return '<div class="flex flex-wrap items-center justify-between gap-3 mb-4 mc-no-print">' +
    '<div class="flex rounded-xl overflow-hidden" style="border:1px solid var(--border-color)">' +
      '<button onclick="mcSetViewMode(\'contractor\')" style="' + btnStyle(isC) + '">' +
        '<i class="fas fa-hard-hat mr-1.5"></i>Contractor View</button>' +
      '<button onclick="mcSetViewMode(\'client\')" style="' + btnStyle(!isC) + 'border-left:1px solid var(--border-color);">' +
        '<i class="fas fa-user mr-1.5"></i>Client View</button>' +
    '</div>' +
    '<div class="flex gap-2">' +
      '<button onclick="mcSaveClientPDF()" style="padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer;background:#6366f1;color:#fff;border:none;border-radius:8px">' +
        '<i class="fas fa-file-pdf mr-1.5"></i>Client PDF</button>' +
      '<button onclick="mcSaveInternalPDF()" style="padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer;background:var(--bg-elevated);color:var(--text-primary);border:1px solid var(--border-color);border-radius:8px">' +
        '<i class="fas fa-clipboard-list mr-1.5"></i>Internal PDF</button>' +
    '</div>' +
  '</div>';
}

// ---- Invoice Header ----
function renderInvoiceHeader() {
  var m = mcState.invoiceMeta;
  var isClient = mcState.viewMode === 'client';

  if (isClient) {
    return '<div style="background:var(--bg-card);border:1px solid var(--border-color)" class="rounded-2xl p-5 mb-4">' +
      '<div class="flex justify-between items-start flex-wrap gap-3">' +
        '<div><h2 class="text-xl font-black" style="color:var(--text-primary)">' + mcEsc(m.jobName||'Material Estimate') + '</h2>' +
          (m.address ? '<p class="text-sm mt-1" style="color:var(--text-muted)"><i class="fas fa-map-marker-alt mr-1"></i>' + mcEsc(m.address) + '</p>' : '') + '</div>' +
        '<div class="text-right text-sm" style="color:var(--text-muted)">' +
          '<p class="font-bold font-mono" style="color:var(--text-primary)">' + mcEsc(m.invoiceNumber) + '</p>' +
          (m.invoiceDate ? '<p>Date: ' + m.invoiceDate + '</p>' : '') +
          (m.dueDate ? '<p>Due: ' + m.dueDate + '</p>' : '') +
          (m.poNumber ? '<p>PO#: ' + mcEsc(m.poNumber) + '</p>' : '') +
          (m.terms ? '<p>Terms: ' + m.terms + '</p>' : '') +
        '</div>' +
      '</div>' +
    '</div>';
  }

  var inp = function(label, id, val, extra) {
    return '<div><label class="block text-xs font-semibold mb-1" style="color:var(--text-muted)">' + label + '</label>' +
      '<input type="text" value="' + mcEsc(val) + '" ' + (extra||'') +
      ' style="width:100%;padding:8px 10px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-elevated);color:var(--text-primary);font-size:13px;box-sizing:border-box"></div>';
  };
  var inpDate = function(label, val, handler) {
    return '<div><label class="block text-xs font-semibold mb-1" style="color:var(--text-muted)">' + label + '</label>' +
      '<input type="date" value="' + (val||'') + '" oninput="' + handler + '" ' +
      'style="width:100%;padding:8px 10px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-elevated);color:var(--text-primary);font-size:13px;box-sizing:border-box"></div>';
  };
  var termOpts = ['Due on Receipt','Net 15','Net 30','Net 45','Net 60'].map(function(t) {
    return '<option' + (m.terms===t?' selected':'') + '>' + t + '</option>';
  }).join('');

  return '<div style="background:var(--bg-card);border:1px solid var(--border-color)" class="rounded-2xl p-5 mb-4 mc-no-print">' +
    '<h3 class="text-xs font-semibold uppercase mb-3" style="color:var(--text-muted);letter-spacing:1px"><i class="fas fa-file-invoice mr-1.5"></i>Job / Estimate Details</h3>' +
    '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">' +
      inp('Job Name', '', m.jobName, 'oninput="mcState.invoiceMeta.jobName=this.value;mcSaveDraft()"') +
      inp('Job Address', '', m.address, 'oninput="mcState.invoiceMeta.address=this.value;mcSaveDraft()"') +
    '</div>' +
    '<div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">' +
      inp('Estimate #', '', m.invoiceNumber, 'oninput="mcState.invoiceMeta.invoiceNumber=this.value;mcSaveDraft()" style="font-family:monospace"') +
      inpDate('Date', m.invoiceDate, 'mcState.invoiceMeta.invoiceDate=this.value;mcSaveDraft()') +
      inpDate('Due Date', m.dueDate, 'mcState.invoiceMeta.dueDate=this.value;mcSaveDraft()') +
      inp('PO # (optional)', '', m.poNumber, 'oninput="mcState.invoiceMeta.poNumber=this.value;mcSaveDraft()"') +
    '</div>' +
    '<div class="grid grid-cols-2 gap-3">' +
      '<div><label class="block text-xs font-semibold mb-1" style="color:var(--text-muted)">Terms</label>' +
        '<select oninput="mcState.invoiceMeta.terms=this.value;mcSaveDraft()" style="width:100%;padding:8px 10px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-elevated);color:var(--text-primary);font-size:13px">' + termOpts + '</select></div>' +
      '<div><label class="block text-xs font-semibold mb-1" style="color:var(--text-muted)">Deposit Collected ($)</label>' +
        '<input type="number" step="0.01" min="0" value="' + (m.depositCollected||0) + '" oninput="mcState.invoiceMeta.depositCollected=parseFloat(this.value)||0;mcUpdateFooter();mcSaveDraft()" style="width:100%;padding:8px 10px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-elevated);color:var(--text-primary);font-size:13px;box-sizing:border-box"></div>' +
    '</div>' +
  '</div>';
}

// ---- Waste Controls ----
function renderWasteControlsInner() {
  var wt = (mcState.report && mcState.report.materials.waste_table) || [];
  if (!wt.length) return '';
  var buttons = wt.map(function(row) {
    var sel = row.waste_pct === mcState.currentWastePct;
    var label = row.waste_pct === 0 ? '0% Measured' : row.waste_pct + '%' + (row.is_suggested ? ' ★' : '');
    var style = sel
      ? 'padding:8px 16px;background:#0ea5e9;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer'
      : 'padding:8px 16px;background:var(--bg-elevated);color:var(--text-muted);border:1px solid var(--border-color);border-radius:8px;font-size:13px;font-weight:500;cursor:pointer';
    return '<button style="' + style + '" onclick="mcSetWaste(' + row.waste_pct + ')">' + label + '</button>';
  }).join('');
  return '<div style="background:var(--bg-card);border:1px solid var(--border-color)" class="rounded-2xl p-5 mb-4 mc-no-print">' +
    '<h3 class="font-bold mb-3 text-sm" style="color:var(--text-primary)"><i class="fas fa-percent mr-2" style="color:var(--text-muted)"></i>Waste Factor</h3>' +
    '<div class="flex flex-wrap gap-2">' + buttons + '</div>' +
    '<p class="text-xs mt-2" style="color:var(--text-muted)">★ = Suggested for <span class="capitalize">' + (mcState.report.materials.complexity_class||'') + '</span> complexity</p>' +
  '</div>';
}

function mcSetWaste(pct) {
  mcState.currentWastePct = pct;
  var items = (mcState.report && mcState.report.materials.line_items) || [];
  items.forEach(function(item) { if (item.category === 'shingles') item._manualQtyEdit = false; });
  var wc = document.getElementById('mc-waste-controls');
  if (wc) wc.innerHTML = renderWasteControlsInner();
  var mt = document.getElementById('mc-material-table');
  if (mt) mt.innerHTML = renderMaterialTableInner();
  mcUpdateFooter();
  mcSaveDraft();
}

function mcGetWasteRow() {
  var wt = (mcState.report && mcState.report.materials.waste_table) || [];
  return wt.find(function(r) { return r.waste_pct === mcState.currentWastePct; }) || wt[0] || null;
}
function mcGetBaseRow() {
  var wt = (mcState.report && mcState.report.materials.waste_table) || [];
  return wt.find(function(r) { return r.waste_pct === 0; }) || wt[0] || null;
}

// ---- Category Labels ----
var mcCategoryLabels = {
  shingles:'Shingles', underlayment:'Underlayment', ice_shield:'Ice & Water Shield',
  starter_strip:'Starter Strip', ridge_cap:'Ridge Cap', drip_edge:'Drip Edge',
  valley_metal:'Valley Metal', step_flashing:'Step Flashing', wall_flashing:'Wall Flashing',
  nails:'Nails / Fasteners', ventilation:'Ventilation'
};

// ---- Material Table ----
function renderMaterialTableInner() {
  var items = (mcState.report && mcState.report.materials.line_items) || [];
  var wasteRow = mcGetWasteRow();
  var baseRow = mcGetBaseRow();
  var isC = mcState.viewMode === 'contractor';

  var filtered = [];
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (item.category === 'ice_shield' && !mcState.iceShieldEnabled) continue;
    if (item.category === 'ventilation' && !mcState.ventilationEnabled) continue;
    if (!isC && !item._visible) continue;
    filtered.push({ item: item, idx: i });
  }

  var toggles = isC ? (
    '<div class="flex items-center gap-4">' +
      '<label class="flex items-center gap-1.5 text-xs cursor-pointer" style="color:var(--text-muted)">' +
        '<input type="checkbox" ' + (mcState.iceShieldEnabled?'checked':'') + ' onchange="mcToggleIce(this.checked)"> Ice Shield</label>' +
      '<label class="flex items-center gap-1.5 text-xs cursor-pointer" style="color:var(--text-muted)">' +
        '<input type="checkbox" ' + (mcState.ventilationEnabled?'checked':'') + ' onchange="mcToggleVent(this.checked)"> Ventilation</label>' +
    '</div>'
  ) : '';

  var thead = isC
    ? ('<tr>' +
        th('Item','left') + th('Description','left','hidden sm:table-cell') +
        th('Base','center') + th('+Waste','center') + th('Unit','center') +
        th('Cost $','right','hidden sm:table-cell') + th('Markup%','right','hidden sm:table-cell') +
        th('Sell $','right','hidden sm:table-cell') + th('Total','right') + th('👁','center') +
      '</tr>')
    : ('<tr>' + th('Description','left') + th('Qty','center') + th('Unit','center') + th('Price','right') + th('Total','right') + '</tr>');

  var rows = filtered.map(function(entry) {
    var item = entry.item, idx = entry.idx;
    var isHidden = !item._visible;
    var rowOpacity = (isC && isHidden) ? 'opacity:0.4' : '';

    var isShingle = item.category === 'shingles';
    var totalQty = item.order_quantity;
    if (isShingle && wasteRow && wasteRow.bundles && !item._manualQtyEdit) {
      totalQty = wasteRow.bundles; item.order_quantity = totalQty;
    }
    var baseQty = (isShingle && baseRow) ? baseRow.bundles : totalQty;
    var wasteQty = isShingle ? Math.max(0, totalQty - baseQty) : 0;
    var costPrice = item.unit_price_cad || 0;
    var markup = item._markupPct || 0;
    var sellPrice = costPrice * (1 + markup / 100);
    var lineTotal = totalQty * sellPrice;
    var catLabel = mcCategoryLabels[item.category] || item.category.replace(/_/g,' ');
    var eye = isHidden ? '🚫' : '👁';

    if (isC) {
      return '<tr style="border-top:1px solid var(--border-color);' + rowOpacity + '">' +
        td(catLabel + (item._catalog_price ? ' <span style="font-size:9px;background:#1d4ed8;color:#fff;padding:1px 4px;border-radius:3px">CAT</span>' : ''), 'left', 'font-size:13px;font-weight:500;color:var(--text-primary)') +
        td(mcEsc(item._catalog_name || item.description || ''), 'left', 'font-size:13px;color:var(--text-muted)', 'hidden sm:table-cell') +
        // Base qty
        '<td style="padding:8px 10px;text-align:center">' + (isShingle
          ? '<span style="font-size:13px;color:var(--text-muted)">' + baseQty + '</span>'
          : numInput(totalQty, 'mcUpdateQty('+idx+',this.value)', 50)) + '</td>' +
        // +Waste
        '<td style="padding:8px 10px;text-align:center">' + (isShingle && wasteQty > 0
          ? '<span style="font-size:12px;font-weight:600;color:#f59e0b" title="Waste: ' + wasteQty + ' bundles (' + mcState.currentWastePct + '%)">+' + wasteQty + '</span>'
          : '<span style="color:var(--text-muted);font-size:12px">—</span>') + '</td>' +
        td(mcEsc(item.order_unit||''), 'center', 'font-size:12px;color:var(--text-muted)') +
        '<td style="padding:8px 6px;text-align:right" class="hidden sm:table-cell">' + numInput(costPrice.toFixed(2), 'mcUpdatePrice('+idx+',this.value)', 65, '0.01') + '</td>' +
        '<td style="padding:8px 6px;text-align:right" class="hidden sm:table-cell">' +
          '<div style="display:flex;align-items:center;justify-content:flex-end;gap:2px">' +
            numInput(markup, 'mcUpdateMarkup('+idx+',this.value)', 50, '1') +
            '<span style="font-size:11px;color:var(--text-muted)">%</span>' +
          '</div></td>' +
        '<td style="padding:8px 10px;text-align:right" class="hidden sm:table-cell">' +
          '<span id="mc-sell-' + idx + '" style="font-size:13px;font-weight:600;color:#22c55e">' + mcFmt(sellPrice) + '</span></td>' +
        '<td style="padding:8px 10px;text-align:right;font-weight:600;font-size:13px;color:var(--text-primary)" id="mc-line-total-' + idx + '">' + mcFmt(lineTotal) + '</td>' +
        '<td style="padding:8px 10px;text-align:center">' +
          '<button onclick="mcToggleMaterialVis(' + idx + ')" style="background:none;border:none;cursor:pointer;font-size:14px" title="' + (isHidden?'Show':'Hide') + ' from client view">' + eye + '</button></td>' +
      '</tr>';
    } else {
      return '<tr style="border-top:1px solid var(--border-color)">' +
        td(mcEsc(item._catalog_name || catLabel), 'left', 'font-size:13px;color:var(--text-primary)') +
        td('<b>' + totalQty + '</b>', 'center', 'font-size:13px;color:var(--text-primary)') +
        td(mcEsc(item.order_unit||''), 'center', 'font-size:12px;color:var(--text-muted)') +
        td(mcFmt(sellPrice), 'right', 'font-size:13px;color:var(--text-primary)') +
        td('<b>' + mcFmt(lineTotal) + '</b>', 'right', 'font-size:13px;color:var(--text-primary)') +
      '</tr>';
    }
  });

  return '<div style="background:var(--bg-card);border:1px solid var(--border-color)" class="rounded-2xl overflow-hidden mb-4">' +
    '<div class="px-5 py-4 flex items-center justify-between" style="border-bottom:1px solid var(--border-color)">' +
      '<h3 class="font-bold text-sm" style="color:var(--text-primary)"><i class="fas fa-boxes text-blue-400 mr-2"></i>Material List</h3>' +
      toggles +
    '</div>' +
    '<div class="overflow-x-auto"><table class="w-full">' +
      '<thead style="background:var(--bg-elevated)">' + thead + '</thead>' +
      '<tbody>' + rows.join('') + '</tbody>' +
    '</table></div>' +
  '</div>';
}

function mcToggleMaterialVis(idx) {
  var items = (mcState.report && mcState.report.materials.line_items) || [];
  if (items[idx]) items[idx]._visible = !items[idx]._visible;
  var mt = document.getElementById('mc-material-table');
  if (mt) mt.innerHTML = renderMaterialTableInner();
  mcUpdateFooter(); mcSaveDraft();
}

function mcToggleIce(val) { mcState.iceShieldEnabled = val; mcRefreshDynamic(); }
function mcToggleVent(val) { mcState.ventilationEnabled = val; mcRefreshDynamic(); }
function mcRefreshDynamic() {
  var mt = document.getElementById('mc-material-table');
  if (mt) mt.innerHTML = renderMaterialTableInner();
  mcUpdateFooter();
}

function mcUpdateQty(idx, val) {
  var items = (mcState.report && mcState.report.materials.line_items) || [];
  if (!items[idx]) return;
  var qty = Math.max(0, parseInt(val)||0);
  items[idx].order_quantity = qty; items[idx]._manualQtyEdit = true;
  var sell = (items[idx].unit_price_cad||0) * (1 + (items[idx]._markupPct||0)/100);
  var c = document.getElementById('mc-line-total-' + idx);
  if (c) c.textContent = mcFmt(qty * sell);
  mcUpdateFooter(); mcSaveDraft();
}

function mcUpdatePrice(idx, val) {
  var items = (mcState.report && mcState.report.materials.line_items) || [];
  if (!items[idx]) return;
  var price = Math.max(0, parseFloat(val)||0);
  items[idx].unit_price_cad = price;
  var sell = price * (1 + (items[idx]._markupPct||0)/100);
  var qty = items[idx].order_quantity;
  var sc = document.getElementById('mc-sell-' + idx);
  if (sc) sc.textContent = mcFmt(sell);
  var c = document.getElementById('mc-line-total-' + idx);
  if (c) c.textContent = mcFmt(qty * sell);
  mcUpdateFooter(); mcSaveDraft();
}

function mcUpdateMarkup(idx, val) {
  var items = (mcState.report && mcState.report.materials.line_items) || [];
  if (!items[idx]) return;
  var pct = Math.max(0, parseFloat(val)||0);
  items[idx]._markupPct = pct;
  var sell = (items[idx].unit_price_cad||0) * (1 + pct/100);
  var qty = items[idx].order_quantity;
  var sc = document.getElementById('mc-sell-' + idx);
  if (sc) sc.textContent = mcFmt(sell);
  var c = document.getElementById('mc-line-total-' + idx);
  if (c) c.textContent = mcFmt(qty * sell);
  mcUpdateFooter(); mcSaveDraft();
}

// ---- Custom Line Items ----
var MC_UNITS = ['each','lump sum','hour','day','sq ft','linear ft','bundle','roll','box'];

function renderCustomLineItems() {
  var its = mcState.customItems;
  var isC = mcState.viewMode === 'contractor';
  var visible = isC ? its : its.filter(function(it) { return it.visible !== false; });

  if (!isC && visible.length === 0) return '';

  var rows = visible.map(function(it) {
    var isHidden = it.visible === false;
    var sell = (it.costPrice||0) * (1 + (it.markupPct||0)/100);
    var total = (it.qty||1) * sell;
    var id = it.id;

    if (isC) {
      var uOpts = MC_UNITS.map(function(u) { return '<option' + (it.unit===u?' selected':'') + '>' + u + '</option>'; }).join('');
      return '<tr style="border-top:1px solid var(--border-color)' + (isHidden?';opacity:0.4':'') + '">' +
        '<td style="padding:6px 10px" colspan="2">' +
          '<input type="text" value="' + mcEsc(it.description) + '" placeholder="Description..." ' +
          'oninput="mcUpdateCI(\'' + id + '\',\'description\',this.value)" ' + ciInpStyle() + '>' +
        '</td>' +
        '<td style="padding:6px 8px;text-align:center">' + numInput(it.qty||1, 'mcUpdateCI(\''+id+'\',\'qty\',this.value)', 50) + '</td>' +
        '<td style="padding:6px 8px;text-align:center"><span style="font-size:12px;color:var(--text-muted)">—</span></td>' +
        '<td style="padding:6px 8px;text-align:center">' +
          '<select onchange="mcUpdateCI(\'' + id + '\',\'unit\',this.value)" style="padding:4px 6px;border:1px solid var(--border-color);border-radius:6px;font-size:12px;background:var(--bg-elevated);color:var(--text-primary)">' + uOpts + '</select></td>' +
        '<td style="padding:6px 8px;text-align:right" class="hidden sm:table-cell">' + numInput((it.costPrice||0).toFixed(2), 'mcUpdateCI(\''+id+'\',\'costPrice\',this.value)', 65, '0.01') + '</td>' +
        '<td style="padding:6px 8px;text-align:right" class="hidden sm:table-cell">' +
          '<div style="display:flex;align-items:center;justify-content:flex-end;gap:2px">' +
            numInput(it.markupPct||0, 'mcUpdateCI(\''+id+'\',\'markupPct\',this.value)', 50) +
            '<span style="font-size:11px;color:var(--text-muted)">%</span>' +
          '</div></td>' +
        '<td style="padding:6px 10px;text-align:right" class="hidden sm:table-cell"><span style="color:#22c55e;font-weight:600;font-size:13px">' + mcFmt(sell) + '</span></td>' +
        '<td style="padding:6px 10px;text-align:right;font-weight:600;font-size:13px;color:var(--text-primary)">' + mcFmt(total) + '</td>' +
        '<td style="padding:6px 8px;text-align:center">' +
          '<button onclick="mcToggleCI(\'' + id + '\')" style="background:none;border:none;cursor:pointer;font-size:14px" title="' + (isHidden?'Show':'Hide') + '">' + (isHidden?'🚫':'👁') + '</button></td>' +
        '<td style="padding:6px 8px;text-align:center">' +
          '<button onclick="mcRemoveCI(\'' + id + '\')" style="background:none;border:none;cursor:pointer;color:#ef4444;font-size:14px;font-weight:700">✕</button></td>' +
      '</tr>';
    } else {
      return '<tr style="border-top:1px solid var(--border-color)">' +
        td(mcEsc(it.description||''), 'left', 'font-size:13px;color:var(--text-primary)') +
        td('<b>' + (it.qty||1) + '</b>', 'center', 'font-size:13px;color:var(--text-primary)') +
        td(mcEsc(it.unit||'each'), 'center', 'font-size:12px;color:var(--text-muted)') +
        td(mcFmt(sell), 'right', 'font-size:13px;color:var(--text-primary)') +
        td('<b>' + mcFmt(total) + '</b>', 'right', 'font-size:13px;color:var(--text-primary)') +
      '</tr>';
    }
  });

  var thead = isC
    ? ('<tr>' + th('Description','left','','','',2) + th('Qty','center') + th('Waste','center') + th('Unit','center') + th('Cost','right','hidden sm:table-cell') + th('Markup%','right','hidden sm:table-cell') + th('Sell','right','hidden sm:table-cell') + th('Total','right') + th('👁','center') + th('','center') + '</tr>')
    : ('<tr>' + th('Description','left') + th('Qty','center') + th('Unit','center') + th('Price','right') + th('Total','right') + '</tr>');

  var addBtn = isC
    ? '<div class="px-5 py-3" style="border-top:1px solid var(--border-color)">' +
        '<button onclick="mcAddCI()" style="font-size:13px;color:#0ea5e9;background:none;border:none;cursor:pointer;font-weight:600"><i class="fas fa-plus mr-1"></i>Add custom line item</button>' +
      '</div>'
    : '';

  return '<div style="background:var(--bg-card);border:1px solid var(--border-color)" class="rounded-2xl overflow-hidden mb-4">' +
    '<div class="px-5 py-3" style="border-bottom:1px solid var(--border-color)">' +
      '<h3 class="font-bold text-sm" style="color:var(--text-primary)"><i class="fas fa-list-ul mr-2" style="color:var(--text-muted)"></i>Custom Items</h3></div>' +
    (visible.length > 0
      ? '<div class="overflow-x-auto"><table class="w-full"><thead style="background:var(--bg-elevated)">' + thead + '</thead><tbody>' + rows.join('') + '</tbody></table></div>'
      : (isC ? '<div class="px-5 py-3 text-sm" style="color:var(--text-muted)">No custom items yet.</div>' : '')) +
    addBtn +
  '</div>';
}

function mcAddCI() {
  mcState.customItems.push({ id:'ci-'+Date.now(), description:'', qty:1, unit:'each', costPrice:0, markupPct:0, visible:true });
  var ci = document.getElementById('mc-custom-items');
  if (ci) ci.innerHTML = renderCustomLineItems();
  mcUpdateFooter(); mcSaveDraft();
}
function mcRemoveCI(id) {
  mcState.customItems = mcState.customItems.filter(function(it) { return it.id!==id; });
  var ci = document.getElementById('mc-custom-items');
  if (ci) ci.innerHTML = renderCustomLineItems();
  mcUpdateFooter(); mcSaveDraft();
}
function mcUpdateCI(id, field, val) {
  var it = mcState.customItems.find(function(x) { return x.id===id; });
  if (!it) return;
  it[field] = ['qty','costPrice','markupPct'].indexOf(field)>=0 ? Math.max(0,parseFloat(val)||0) : val;
  mcUpdateFooter(); mcSaveDraft();
}
function mcToggleCI(id) {
  var it = mcState.customItems.find(function(x) { return x.id===id; });
  if (it) it.visible = !it.visible;
  var ci = document.getElementById('mc-custom-items');
  if (ci) ci.innerHTML = renderCustomLineItems();
  mcUpdateFooter(); mcSaveDraft();
}

// ---- Labour Section ----
function renderLabourSection() {
  var its = mcState.labourItems;
  var isC = mcState.viewMode === 'contractor';
  if (!isC && !mcState.includeLabourInTotal) return '';
  if (!isC && its.length === 0) return '';

  var rows = its.map(function(it) {
    var est = (it.crewSize||0)*(it.hoursPerCrew||0)*(it.ratePerHour||0);
    var act = (it.actualCrew||0)*(it.actualHours||0)*(it.ratePerHour||0);
    var diff = act - est;
    var id = it.id;

    if (isC) {
      return '<tr style="border-top:1px solid var(--border-color)">' +
        '<td style="padding:6px 10px">' +
          '<input type="text" value="' + mcEsc(it.description) + '" placeholder="e.g. Install crew" oninput="mcUpdateLab(\'' + id + '\',\'description\',this.value)" ' + ciInpStyle() + '></td>' +
        '<td style="padding:6px 8px;text-align:center">' + numInput(it.crewSize||2, 'mcUpdateLab(\''+id+'\',\'crewSize\',this.value)', 50) + '</td>' +
        '<td style="padding:6px 8px;text-align:center">' + numInput(it.hoursPerCrew||0, 'mcUpdateLab(\''+id+'\',\'hoursPerCrew\',this.value)', 55, '0.5') + '</td>' +
        '<td style="padding:6px 8px;text-align:right">' + numInput((it.ratePerHour||0).toFixed(2), 'mcUpdateLab(\''+id+'\',\'ratePerHour\',this.value)', 65, '0.01') + '</td>' +
        '<td style="padding:6px 10px;text-align:right;font-weight:600;color:#22c55e;font-size:13px">' + mcFmt(est) + '</td>' +
        '<td style="padding:6px 8px;text-align:center" class="hidden sm:table-cell">' + numInput(it.actualHours||'', 'mcUpdateLab(\''+id+'\',\'actualHours\',this.value)', 55, '0.5', 'placeholder="—"') + '</td>' +
        '<td style="padding:6px 8px;text-align:center" class="hidden sm:table-cell">' + numInput(it.actualCrew||'', 'mcUpdateLab(\''+id+'\',\'actualCrew\',this.value)', 50, '1', 'placeholder="—"') + '</td>' +
        '<td style="padding:6px 10px;text-align:right;font-size:12px" class="hidden sm:table-cell">' +
          (act > 0 ? '<span style="color:' + (diff>0?'#ef4444':'#22c55e') + ';font-weight:600">' + mcFmt(act) + ' (' + (diff>=0?'+':'') + mcFmt(diff) + ')</span>' : '<span style="color:var(--text-muted)">—</span>') +
        '</td>' +
        '<td style="padding:6px 8px;text-align:center"><button onclick="mcRemoveLab(\'' + id + '\')" style="background:none;border:none;cursor:pointer;color:#ef4444;font-size:14px;font-weight:700">✕</button></td>' +
      '</tr>';
    } else {
      return '<tr style="border-top:1px solid var(--border-color)">' +
        td(mcEsc(it.description||'Labour'), 'left', 'font-size:13px;color:var(--text-primary)') +
        td((it.crewSize||0) + ' × ' + (it.hoursPerCrew||0) + 'h', 'center', 'font-size:13px;color:var(--text-primary)') +
        td('hour', 'center', 'font-size:12px;color:var(--text-muted)') +
        td(mcFmt(it.ratePerHour||0), 'right', 'font-size:13px;color:var(--text-primary)') +
        td('<b>' + mcFmt(est) + '</b>', 'right', 'font-size:13px;color:var(--text-primary)') +
      '</tr>';
    }
  });

  var thead = isC
    ? ('<tr>' + th('Description','left') + th('Crew','center') + th('Est Hrs','center') + th('Rate/hr','right') + th('Est Total','right') + th('Act Hrs','center','hidden sm:table-cell') + th('Act Crew','center','hidden sm:table-cell') + th('Actual Total','right','hidden sm:table-cell') + th('','center') + '</tr>')
    : ('<tr>' + th('Description','left') + th('Crew × Hours','center') + th('Unit','center') + th('Rate','right') + th('Total','right') + '</tr>');

  var header = isC
    ? ('<div class="px-5 py-3 flex items-center justify-between flex-wrap gap-2" style="border-bottom:1px solid var(--border-color)">' +
        '<div class="flex items-center gap-3">' +
          '<h3 class="font-bold text-sm" style="color:var(--text-primary)"><i class="fas fa-hard-hat mr-2" style="color:#f59e0b"></i>Labour</h3>' +
          '<label class="flex items-center gap-1.5 text-xs cursor-pointer" style="color:var(--text-muted)">' +
            '<input type="checkbox" ' + (mcState.includeLabourInTotal?'checked':'') + ' onchange="mcState.includeLabourInTotal=this.checked;mcUpdateFooter();mcSaveDraft()"> Include in totals</label>' +
        '</div>' +
        '<button onclick="mcAddLab()" style="font-size:13px;color:#0ea5e9;background:none;border:none;cursor:pointer;font-weight:600"><i class="fas fa-plus mr-1"></i>Add Labour</button>' +
      '</div>')
    : ('<div class="px-5 py-3" style="border-bottom:1px solid var(--border-color)"><h3 class="font-bold text-sm" style="color:var(--text-primary)"><i class="fas fa-hard-hat mr-2" style="color:#f59e0b"></i>Labour</h3></div>');

  return '<div style="background:var(--bg-card);border:1px solid var(--border-color)" class="rounded-2xl overflow-hidden mb-4">' +
    header +
    (its.length > 0
      ? '<div class="overflow-x-auto"><table class="w-full"><thead style="background:var(--bg-elevated)">' + thead + '</thead><tbody>' + rows.join('') + '</tbody></table></div>'
      : (isC ? '<div class="px-5 py-4 text-sm" style="color:var(--text-muted)">No labour entries yet.</div>' : '')) +
  '</div>';
}

function mcAddLab() {
  mcState.labourItems.push({ id:'lab-'+Date.now(), description:'', crewSize:2, hoursPerCrew:8, ratePerHour:45, actualHours:null, actualCrew:null });
  var ls = document.getElementById('mc-labour-section');
  if (ls) ls.innerHTML = renderLabourSection();
  mcUpdateFooter(); mcSaveDraft();
}
function mcRemoveLab(id) {
  mcState.labourItems = mcState.labourItems.filter(function(it) { return it.id!==id; });
  var ls = document.getElementById('mc-labour-section');
  if (ls) ls.innerHTML = renderLabourSection();
  mcUpdateFooter(); mcSaveDraft();
}
function mcUpdateLab(id, field, val) {
  var it = mcState.labourItems.find(function(x) { return x.id===id; });
  if (!it) return;
  var numFields = ['crewSize','hoursPerCrew','ratePerHour','actualHours','actualCrew'];
  it[field] = numFields.indexOf(field)>=0 ? (val===''?null:Math.max(0,parseFloat(val)||0)) : val;
  mcUpdateFooter(); mcSaveDraft();
}

// ---- Cost Footer ----
function mcCalcTotals() {
  var items = (mcState.report && mcState.report.materials.line_items) || [];
  var isClient = mcState.viewMode === 'client';
  var matTotal = 0;

  items.forEach(function(item) {
    if (item.category === 'ice_shield' && !mcState.iceShieldEnabled) return;
    if (item.category === 'ventilation' && !mcState.ventilationEnabled) return;
    if (isClient && !item._visible) return;
    var sell = (item.unit_price_cad||0) * (1 + (item._markupPct||0)/100);
    matTotal += item.order_quantity * sell;
  });
  mcState.customItems.forEach(function(it) {
    if (isClient && it.visible===false) return;
    var sell = (it.costPrice||0) * (1 + (it.markupPct||0)/100);
    matTotal += (it.qty||1) * sell;
  });

  var labourTotal = 0;
  if (mcState.includeLabourInTotal) {
    mcState.labourItems.forEach(function(it) {
      labourTotal += (it.crewSize||0)*(it.hoursPerCrew||0)*(it.ratePerHour||0);
    });
  }
  var subtotal = matTotal + labourTotal;
  var taxRate = 5;
  var taxAmt = Math.round(subtotal * taxRate / 100 * 100) / 100;
  var total = subtotal + taxAmt;
  var deposit = mcState.invoiceMeta.depositCollected || 0;
  return { matTotal:matTotal, labourTotal:labourTotal, subtotal:subtotal, taxRate:taxRate, taxAmt:taxAmt, total:total, deposit:deposit, balanceDue:Math.max(0,total-deposit) };
}

function renderCostFooterInner() {
  var t = mcCalcTotals();
  var isC = mcState.viewMode === 'contractor';
  var row = function(label, val, bold, color) {
    return '<div style="display:flex;justify-content:space-between;padding:5px 0;font-size:' + (bold?'15px':'13px') + ';' + (bold?'border-top:1px solid var(--border-color);margin-top:4px;':'') + '">' +
      '<span style="color:var(--text-muted)">' + label + '</span>' +
      '<span style="font-weight:' + (bold?800:500) + ';color:' + (color||'var(--text-primary)') + '">' + val + '</span></div>';
  };

  var html = row('Material Subtotal', mcFmt(t.matTotal));
  if (mcState.includeLabourInTotal && t.labourTotal > 0) html += row('Labour (estimated)', mcFmt(t.labourTotal));
  html += '<div style="border-top:1px solid var(--border-color);margin-top:4px">' + row('Subtotal', mcFmt(t.subtotal)) + '</div>';
  html += row('Tax (' + t.taxRate + '%)', mcFmt(t.taxAmt));
  html += '<div style="border-top:2px solid var(--border-color);margin-top:4px">' +
    '<div style="display:flex;justify-content:space-between;padding:8px 0;font-size:20px;font-weight:800">' +
      '<span style="color:var(--text-primary)">Total</span>' +
      '<span style="color:var(--text-primary)">' + mcFmt(t.total) + ' <span style="font-size:13px;font-weight:400;color:var(--text-muted)">CAD</span></span>' +
    '</div></div>';

  if (t.deposit > 0 || isC) {
    html += row('Deposit Collected', '−' + mcFmt(t.deposit), false, '#22c55e');
    html += '<div style="border-top:2px solid var(--border-color);margin-top:4px">' +
      '<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:17px;font-weight:800">' +
        '<span style="color:var(--text-primary)">Balance Due</span>' +
        '<span style="color:#f59e0b">' + mcFmt(t.balanceDue) + ' <span style="font-size:12px;font-weight:400;color:var(--text-muted)">CAD</span></span>' +
      '</div></div>';
  }

  return '<div style="background:var(--bg-card);border:1px solid var(--border-color)" class="rounded-2xl p-5 mb-4">' +
    '<h3 class="font-bold text-sm mb-4" style="color:var(--text-primary)"><i class="fas fa-receipt mr-2" style="color:var(--text-muted)"></i>' + (isC?'Contractor':'Client') + ' Summary</h3>' +
    html +
    '<p class="text-xs mt-3" style="color:var(--text-muted)">' + (isC ? mcState.currentWastePct + '% waste · contractor view' : 'Client view · prices include markup') + '</p>' +
  '</div>';
}

function mcUpdateFooter() {
  var cf = document.getElementById('mc-cost-footer');
  if (cf) cf.innerHTML = renderCostFooterInner();
}

// ---- Action Bar ----
function renderActionBar() {
  return '<div id="mc-action-bar" class="mb-8 mc-no-print">' +
    '<div class="flex flex-wrap gap-2 mb-2">' +
      btn('mcAddToInvoice()', '#059669', '<i class="fas fa-file-invoice-dollar"></i> Add to Invoice') +
      btn('mcCreateProposal()', '#059669', '<i class="fas fa-file-signature"></i> Create Proposal') +
      btn('mcSaveClientPDF()', '#6366f1', '<i class="fas fa-file-pdf"></i> Client PDF') +
      btn('mcSaveInternalPDF()', null, '<i class="fas fa-clipboard-list"></i> Internal PDF', true) +
    '</div>' +
    '<div class="flex flex-wrap gap-2" style="position:relative">' +
      '<div style="position:relative;display:inline-block">' +
        '<button id="mc-export-btn" onclick="mcToggleExportMenu()" style="display:flex;align-items:center;gap:6px;padding:8px 14px;background:var(--bg-elevated);color:var(--text-primary);font-size:13px;font-weight:600;border:1px solid var(--border-color);border-radius:10px;cursor:pointer">' +
          '<i class="fas fa-download"></i>Export <i class="fas fa-caret-down ml-1"></i></button>' +
        '<div id="mc-export-menu" style="display:none;position:absolute;top:calc(100% + 4px);left:0;z-index:200;min-width:210px;background:var(--bg-card);border:1px solid var(--border-color);border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,0.4);overflow:hidden">' +
          menuItem('mcExportCSV();mcToggleExportMenu()', 'fa-file-csv', '#22c55e', 'Export CSV (full detail)') +
          menuItem('mcExportXactimate();mcToggleExportMenu()', 'fa-file-code', '#0ea5e9', 'Xactimate XML') +
          menuItem('mcCopyList();mcToggleExportMenu()', 'fa-copy', 'var(--text-muted)', 'Copy to clipboard') +
        '</div>' +
      '</div>' +
    '</div>' +
  '</div>';
}

function mcToggleExportMenu() {
  var m = document.getElementById('mc-export-menu');
  if (!m) return;
  var isOpen = m.style.display !== 'none';
  m.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) {
    setTimeout(function() {
      document.addEventListener('click', function h(e) {
        var btn = document.getElementById('mc-export-btn');
        var menu = document.getElementById('mc-export-menu');
        if (menu && btn && !btn.contains(e.target) && !menu.contains(e.target)) {
          menu.style.display = 'none';
          document.removeEventListener('click', h);
        }
      });
    }, 0);
  }
}

// ---- View Mode + PDF ----
function mcSetViewMode(mode) {
  mcState.viewMode = mode;
  mcInjectPrintCSS();
  renderCalculator();
}

function mcSaveClientPDF() {
  var prev = mcState.viewMode;
  mcState.viewMode = 'client'; mcInjectPrintCSS(); renderCalculator();
  setTimeout(function() {
    window.print();
    setTimeout(function() { mcState.viewMode = prev; mcInjectPrintCSS(); renderCalculator(); }, 500);
  }, 300);
}

function mcSaveInternalPDF() {
  var prev = mcState.viewMode;
  mcState.viewMode = 'contractor'; mcInjectPrintCSS(); renderCalculator();
  setTimeout(function() {
    window.print();
    setTimeout(function() { mcState.viewMode = prev; mcInjectPrintCSS(); renderCalculator(); }, 500);
  }, 300);
}

function mcSavePDF() { mcSaveClientPDF(); }

// ---- Add to Invoice ----
function mcAddToInvoice() {
  var items = mcBuildInvoiceItems();
  if (!items.length) { mcToast('No priced items to add — enter unit prices first', 'error'); return; }
  fetch('/api/crm/customers', { headers: mcAuthOnly() })
    .then(function(r) { return r.json(); })
    .then(function(data) { mcShowInvoiceModal(data.customers||[], items); })
    .catch(function() { mcToast('Failed to load customers', 'error'); });
}

function mcBuildInvoiceItems() {
  var items = (mcState.report && mcState.report.materials.line_items) || [];
  var result = [];
  items.forEach(function(item) {
    if (item.category === 'ice_shield' && !mcState.iceShieldEnabled) return;
    if (item.category === 'ventilation' && !mcState.ventilationEnabled) return;
    if (!item.unit_price_cad) return;
    var sell = item.unit_price_cad * (1 + (item._markupPct||0)/100);
    result.push({ description: item.description||item.category, quantity: item.order_quantity, unit_price: Math.round(sell*100)/100 });
  });
  mcState.customItems.forEach(function(it) {
    if (!it.description) return;
    var sell = (it.costPrice||0) * (1 + (it.markupPct||0)/100);
    result.push({ description: it.description, quantity: it.qty||1, unit_price: Math.round(sell*100)/100 });
  });
  if (mcState.includeLabourInTotal) {
    mcState.labourItems.forEach(function(it) {
      var total = (it.crewSize||0)*(it.hoursPerCrew||0)*(it.ratePerHour||0);
      if (!total) return;
      result.push({ description: (it.description||'Labour') + ' (' + it.crewSize + ' crew × ' + it.hoursPerCrew + 'h)', quantity: 1, unit_price: Math.round(total*100)/100 });
    });
  }
  return result;
}

function mcShowInvoiceModal(customers, items) {
  var m = mcState.invoiceMeta;
  var addr = m.address || '';
  var t = mcCalcTotals();
  var custOpts = '<option value="">Select a customer...</option>' +
    customers.map(function(c) { return '<option value="' + c.id + '">' + mcEsc(c.name||'') + (c.email?' — '+c.email:'') + '</option>'; }).join('');

  document.body.insertAdjacentHTML('beforeend',
    '<div id="mc-invoice-modal" style="position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px">' +
    '<div style="background:var(--bg-card);border:1px solid var(--border-color);border-radius:16px;box-shadow:0 25px 60px rgba(0,0,0,0.4);width:100%;max-width:440px">' +
      '<div style="padding:20px 24px;border-bottom:1px solid var(--border-color);display:flex;justify-content:space-between;align-items:center">' +
        '<h3 style="font-weight:700;color:#fff;margin:0">Create Invoice from Materials</h3>' +
        '<button onclick="document.getElementById(\'mc-invoice-modal\').remove()" style="background:none;border:none;color:var(--text-muted);font-size:22px;cursor:pointer;line-height:1">&times;</button>' +
      '</div>' +
      '<div style="padding:20px 24px">' +
        mLabel('Customer *') + '<select id="mc-inv-cust" style="' + selStyle() + '">' + custOpts + '</select>' +
        mLabel('Property Address') + '<input id="mc-inv-addr" type="text" value="' + mcEsc(addr) + '" style="' + inpStyle() + '">' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
          '<div>' + mLabel('Tax Rate (%)') + '<input id="mc-inv-tax" type="number" value="5" step="0.1" min="0" max="30" style="' + inpStyle() + '"></div>' +
          '<div>' + mLabel('Notes') + '<input id="mc-inv-notes" type="text" placeholder="Optional..." style="' + inpStyle() + '"></div>' +
        '</div>' +
        '<div style="background:var(--bg-elevated);border-radius:10px;padding:12px;font-size:13px;margin-top:4px">' +
          '<span style="color:var(--text-primary);font-weight:700">' + items.length + '</span> <span style="color:var(--text-muted)">items · Subtotal </span>' +
          '<span style="color:var(--text-primary);font-weight:700">' + mcFmt(t.total) + ' CAD</span>' +
        '</div>' +
      '</div>' +
      '<div style="padding:16px 24px;border-top:1px solid var(--border-color);display:flex;justify-content:flex-end;gap:10px">' +
        '<button onclick="document.getElementById(\'mc-invoice-modal\').remove()" style="padding:8px 16px;background:none;border:none;color:var(--text-muted);font-size:13px;cursor:pointer">Cancel</button>' +
        '<button onclick="mcSubmitInvoice()" style="padding:10px 22px;background:#059669;color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer">Create Invoice</button>' +
      '</div>' +
    '</div></div>'
  );
  window._mcPendingItems = items;
}

function mcSubmitInvoice() {
  var custId = document.getElementById('mc-inv-cust').value;
  if (!custId) { mcToast('Please select a customer', 'error'); return; }
  var m = mcState.invoiceMeta;
  var addr = document.getElementById('mc-inv-addr').value.trim() || m.address || '';
  fetch('/api/crm/invoices', {
    method: 'POST', headers: mcAuthHeaders(),
    body: JSON.stringify({
      crm_customer_id: parseInt(custId),
      property_address: addr||null,
      tax_rate: parseFloat(document.getElementById('mc-inv-tax').value)||5,
      notes: document.getElementById('mc-inv-notes').value.trim()||null,
      title: (m.jobName||'Material Estimate') + (addr?' — '+addr:''),
      items: window._mcPendingItems||[]
    })
  })
  .then(function(r) { return r.json(); })
  .then(function(res) {
    var modal = document.getElementById('mc-invoice-modal');
    if (modal) modal.remove();
    if (res.success || res.invoice) {
      mcToast('Invoice created! Redirecting...');
      setTimeout(function() { window.location.href = '/customer/invoices'; }, 1500);
    } else { mcToast(res.error||'Failed to create invoice', 'error'); }
  })
  .catch(function() { mcToast('Network error', 'error'); });
}

// ---- Create Proposal ----
function mcCreateProposal() {
  var items = mcBuildInvoiceItems();
  var addr = mcState.invoiceMeta.address || (mcState.report && mcState.report.property && mcState.report.property.address) || '';
  localStorage.setItem('mc_proposal_materials', JSON.stringify({
    items: items, address: addr, source_report_id: mcState.selectedOrderId,
    waste_pct: mcState.currentWastePct,
    total_area_sqft: Math.round(mcState.report.total_true_area_sqft||0),
    pitch: mcState.report.roof_pitch_ratio||''
  }));
  mcToast('Materials saved! Redirecting to Proposals...');
  window.location.href = '/customer/proposals';
}

// ---- Export CSV ----
function mcExportCSV() {
  if (!mcState.report) return;
  var r = mcState.report;
  var items = (r.materials && r.materials.line_items) || [];
  var addr = mcState.invoiceMeta.address || (r.property && r.property.address) || '';
  var wasteRow = mcGetWasteRow(), baseRow = mcGetBaseRow();
  var rows = ['Category,Description,Base Qty,Waste Qty,Total Qty,Unit,Cost Price,Markup %,Sell Price,Line Total'];

  items.forEach(function(item) {
    if (item.category === 'ice_shield' && !mcState.iceShieldEnabled) return;
    if (item.category === 'ventilation' && !mcState.ventilationEnabled) return;
    var isS = item.category === 'shingles';
    var total = item.order_quantity;
    var base = (isS && baseRow) ? baseRow.bundles : total;
    var waste = isS ? Math.max(0, total - base) : 0;
    var cost = item.unit_price_cad||0;
    var mu = item._markupPct||0;
    var sell = cost * (1 + mu/100);
    rows.push('"'+item.category+'","'+(item.description||'').replace(/"/g,'""')+'",'+base+','+waste+','+total+',"'+(item.order_unit||'')+'",'+cost.toFixed(2)+','+mu+','+sell.toFixed(2)+','+(total*sell).toFixed(2));
  });

  if (mcState.customItems.length) {
    rows.push(''); rows.push('"CUSTOM ITEMS","","","","","","","","",""');
    mcState.customItems.forEach(function(it) {
      var sell = (it.costPrice||0) * (1 + (it.markupPct||0)/100);
      rows.push('"custom","'+(it.description||'').replace(/"/g,'""')+'",0,0,'+(it.qty||1)+',"'+(it.unit||'each')+'",'+(it.costPrice||0).toFixed(2)+','+(it.markupPct||0)+','+sell.toFixed(2)+','+((it.qty||1)*sell).toFixed(2));
    });
  }
  if (mcState.labourItems.length) {
    rows.push(''); rows.push('"LABOUR","","","","","","","","",""');
    mcState.labourItems.forEach(function(it) {
      var total = (it.crewSize||0)*(it.hoursPerCrew||0)*(it.ratePerHour||0);
      rows.push('"labour","'+(it.description||'Labour').replace(/"/g,'""')+'",0,0,'+((it.crewSize||0)*(it.hoursPerCrew||0))+',"hour",'+(it.ratePerHour||0).toFixed(2)+',0,'+(it.ratePerHour||0).toFixed(2)+','+total.toFixed(2));
    });
  }

  mcDownload(rows.join('\n'), 'text/csv', 'material-estimate' + (addr ? '-' + addr.replace(/[^a-zA-Z0-9]/g,'_').substring(0,30) : '') + '.csv');
  mcToast('CSV exported!');
}

// ---- Export Xactimate XML ----
function mcExportXactimate() {
  if (!mcState.report) return;
  var r = mcState.report, es = r.edge_summary||{};
  var items = (r.materials && r.materials.line_items) || [];
  var addr = mcState.invoiceMeta.address || (r.property && r.property.address) || '';
  var xml = '<?xml version="1.0" encoding="UTF-8"?>\n<RoofEstimate>\n' +
    '  <ProjectInfo><Address>' + addr + '</Address><Date>' + new Date().toISOString().slice(0,10) + '</Date>' +
    '<WasteFactor>' + mcState.currentWastePct + '</WasteFactor><TotalArea>' + Math.round(r.total_true_area_sqft||0) + '</TotalArea><Pitch>' + (r.roof_pitch_ratio||'') + '</Pitch></ProjectInfo>\n' +
    '  <Measurements><RidgeLF>'+Math.round(es.total_ridge_ft||0)+'</RidgeLF><HipLF>'+Math.round(es.total_hip_ft||0)+'</HipLF><ValleyLF>'+Math.round(es.total_valley_ft||0)+'</ValleyLF><EaveLF>'+Math.round(es.total_eave_ft||0)+'</EaveLF><RakeLF>'+Math.round(es.total_rake_ft||0)+'</RakeLF></Measurements>\n' +
    '  <Materials>\n';
  items.forEach(function(item) {
    if (item.category==='ice_shield' && !mcState.iceShieldEnabled) return;
    if (item.category==='ventilation' && !mcState.ventilationEnabled) return;
    var sell = (item.unit_price_cad||0) * (1 + (item._markupPct||0)/100);
    xml += '    <Item category="'+item.category+'"><Description>'+(item.description||'')+'</Description><Quantity>'+item.order_quantity+'</Quantity><Unit>'+(item.order_unit||'')+'</Unit><UnitPrice>'+sell.toFixed(2)+'</UnitPrice><Total>'+(item.order_quantity*sell).toFixed(2)+'</Total></Item>\n';
  });
  xml += '  </Materials>\n</RoofEstimate>';
  mcDownload(xml, 'application/xml', 'xactimate-estimate' + (addr ? '-' + addr.replace(/[^a-zA-Z0-9]/g,'_').substring(0,30) : '') + '.xml');
  mcToast('Xactimate XML exported!');
}

// ---- Copy List ----
function mcCopyList() {
  if (!mcState.report) return;
  var r = mcState.report;
  var items = (r.materials && r.materials.line_items) || [];
  var addr = mcState.invoiceMeta.address || (r.property && r.property.address) || '';
  var t = mcCalcTotals();
  var lines = [
    'MATERIAL ESTIMATE — ' + addr.toUpperCase(),
    'True Area: '+Math.round(r.total_true_area_sqft||0)+' sq ft  |  Pitch: '+(r.roof_pitch_ratio||'—')+'  |  Waste: '+mcState.currentWastePct+'%',
    '', 'ITEM                          QTY    UNIT', '─'.repeat(46)
  ];
  items.forEach(function(item) {
    if (item.category==='ice_shield' && !mcState.iceShieldEnabled) return;
    if (item.category==='ventilation' && !mcState.ventilationEnabled) return;
    lines.push((item.description||item.category).substring(0,29).padEnd(30) + String(item.order_quantity).padStart(4) + '   ' + (item.order_unit||''));
  });
  lines.push('─'.repeat(46));
  lines.push('Est. Total: ' + mcFmt(t.total) + ' CAD');
  navigator.clipboard.writeText(lines.join('\n'))
    .then(function() { mcToast('Copied to clipboard!'); })
    .catch(function() { mcToast('Copy failed — try Print instead', 'error'); });
}

// ---- localStorage Draft ----
function mcSaveDraft() {
  if (!mcState.selectedOrderId || !mcState.report) return;
  try {
    var items = mcState.report.materials.line_items || [];
    var draft = {
      invoiceMeta: mcState.invoiceMeta,
      customItems: mcState.customItems,
      labourItems: mcState.labourItems,
      includeLabourInTotal: mcState.includeLabourInTotal,
      itemMarkups: {}, itemPrices: {}, itemVisible: {}
    };
    items.forEach(function(item, i) {
      draft.itemMarkups[i] = item._markupPct||0;
      draft.itemPrices[i] = item.unit_price_cad||0;
      draft.itemVisible[i] = item._visible!==false;
    });
    localStorage.setItem('mc_draft_' + mcState.selectedOrderId, JSON.stringify(draft));
  } catch(e) {}
}

function mcLoadDraft(orderId) {
  try {
    var raw = localStorage.getItem('mc_draft_' + orderId);
    if (!raw) return;
    var draft = JSON.parse(raw);
    if (draft.invoiceMeta) Object.assign(mcState.invoiceMeta, draft.invoiceMeta);
    if (draft.customItems) mcState.customItems = draft.customItems;
    if (draft.labourItems) mcState.labourItems = draft.labourItems;
    if (draft.includeLabourInTotal !== undefined) mcState.includeLabourInTotal = draft.includeLabourInTotal;
    var items = (mcState.report && mcState.report.materials.line_items) || [];
    items.forEach(function(item, i) {
      if (draft.itemMarkups && draft.itemMarkups[i] !== undefined) item._markupPct = draft.itemMarkups[i];
      if (draft.itemPrices && draft.itemPrices[i] !== undefined) item.unit_price_cad = draft.itemPrices[i];
      if (draft.itemVisible && draft.itemVisible[i] !== undefined) item._visible = draft.itemVisible[i];
    });
    mcToast('Draft restored');
  } catch(e) {}
}

// ---- Print CSS ----
function mcInjectPrintCSS() {
  var el = document.getElementById('mc-print-css');
  if (el) el.remove();
  var style = document.createElement('style');
  style.id = 'mc-print-css';
  style.textContent = '@media print{.mc-no-print{display:none!important}body{background:#fff!important;color:#000!important}input,select{border:1px solid #ccc!important;background:transparent!important}}';
  document.head.appendChild(style);
}

// ---- Render Helpers ----
function th(label, align, cls, style, title, colspan) {
  return '<th ' + (colspan ? 'colspan="'+colspan+'"' : '') + ' class="' + (cls||'') + '" style="padding:10px 10px;text-align:' + align + ';font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);' + (style||'') + '" ' + (title?'title="'+title+'"':'') + '>' + label + '</th>';
}
function td(content, align, style, cls) {
  return '<td class="' + (cls||'') + '" style="padding:10px 10px;text-align:' + align + ';' + (style||'') + '">' + content + '</td>';
}
function numInput(val, handler, width, step, extra) {
  return '<input type="number" step="' + (step||'1') + '" min="0" value="' + (val||0) + '" onchange="' + handler + '" ' + (extra||'') + ' style="width:' + (width||60) + 'px;padding:4px 6px;border:1px solid var(--border-color);border-radius:6px;font-size:13px;text-align:right;background:var(--bg-elevated);color:var(--text-primary)">';
}
function btn(handler, bg, label, outline) {
  var s = outline
    ? 'background:var(--bg-elevated);color:var(--text-primary);border:1px solid var(--border-color)'
    : 'background:' + bg + ';color:#fff;border:none';
  return '<button onclick="' + handler + '" style="display:inline-flex;align-items:center;gap:6px;padding:10px 18px;' + s + ';font-size:13px;font-weight:600;border-radius:10px;cursor:pointer">' + label + '</button>';
}
function menuItem(handler, icon, color, label) {
  return '<button onclick="' + handler + '" style="display:block;width:100%;padding:10px 14px;text-align:left;background:none;border:none;border-top:1px solid var(--border-color);font-size:13px;color:var(--text-primary);cursor:pointer"><i class="fas ' + icon + ' mr-2" style="color:' + color + '"></i>' + label + '</button>';
}
function ciInpStyle() {
  return 'style="width:100%;padding:4px 8px;border:1px solid var(--border-color);border-radius:6px;font-size:13px;background:var(--bg-elevated);color:var(--text-primary);box-sizing:border-box"';
}
function inpStyle() { return 'width:100%;padding:8px 10px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-elevated);color:var(--text-primary);font-size:13px;box-sizing:border-box;margin-bottom:12px'; }
function selStyle() { return 'width:100%;padding:8px 10px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-elevated);color:var(--text-primary);font-size:13px;margin-bottom:12px'; }
function mLabel(label) { return '<label style="display:block;font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:5px;text-transform:uppercase;letter-spacing:0.5px">' + label + '</label>'; }

// ---- Download Helper ----
function mcDownload(content, mime, filename) {
  var blob = new Blob([content], { type: mime });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ---- Toast ----
function mcToast(msg, type) {
  var el = document.getElementById('mc-toast');
  if (el) el.remove();
  var t = document.createElement('div');
  t.id = 'mc-toast';
  t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:' + (type==='error'?'#dc2626':'#111827') + ';color:#fff;padding:12px 20px;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.4);font-size:14px;font-weight:500;z-index:9999';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(function() { if (t.parentNode) t.remove(); }, 3000);
}

// ---- Spinner ----
function mcSpinner() {
  return '<div style="display:flex;align-items:center;justify-content:center;padding:48px 0"><div style="width:40px;height:40px;border-radius:50%;border:3px solid var(--border-color);border-top-color:#0ea5e9;animation:spin 0.8s linear infinite"></div></div>';
}

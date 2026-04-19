// ============================================================
// PROPOSAL BUILDER — Enhanced Professional Proposal Creator
// Customer selector, Google Places, line items, rich text,
// warranty/payment terms, file attachments, share links
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  const root = document.getElementById('proposal-root');
  if (!root) return;

  const token = localStorage.getItem('rc_customer_token') || localStorage.getItem('rc_token') || '';
  const headers = () => ({ 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' });

  // State
  let state = {
    mode: 'list', // list | create | edit | preview
    proposals: [],
    customers: [],
    itemLibrary: [],
    reports: [],
    suppliers: [],
    supplierSetup: false,
    supplierOrdersList: [],
    materialEstimates: [],
    loading: true,
    editId: null,
    filter: 'all',
    searchTerm: '',
    createStep: 1,
    pricingMethod: 'line_item',  // 'line_item' or 'per_square'
    pricePerSquare: 0,
    catalog: [],
    catalogLoaded: false,
    selectedReport: null,
    reportSearch: '',
    selectedReportMaterials: null,
    materialsExpanded: false,
    markupPercent: 30,
    marginPercent: 30,
    pricingEngineMode: 'markup',
    customerPricePerSquare: 0,
    showReportToCustomer: 'partial',
    showMaterialsToCustomer: false,
    showEdgesToCustomer: false,
    showSolarToCustomer: false,
    showPitchToCustomer: true,
    showAreaToCustomer: true,
    showLineItemsToCustomer: false,
    customerPriceOverride: null,
    myCost: null,
    accentColor: '#0ea5e9',
    manualSquares: null,
    attachments: {
      includeRoofReport: true,
      includeMaterialBOM: true,
      insuranceCert: '',
      warrantyDoc: '',
      wcbCoverage: '',
      customAttachment: ''
    },
    gmailStatus: null,
    autoSendCertificate: false,
    certLicenseNumber: '',
    certAccentColor: '#1a5c38',
    certSettingsDirty: false,
    pricingPresets: null, // loaded from settings — auto-apply on report select
    presetsApplied: false, // flag so presets only apply once per proposal
    pricePerBundle: 0, // $/bundle for per-bundle pricing mode
    // Form state
    form: resetForm()
  };

  function pbShareModal(title, message, url) {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;animation:fadeIn 0.2s ease-out';
    overlay.innerHTML = '<div style="background:white;border-radius:16px;padding:32px;max-width:480px;width:90%;box-shadow:0 25px 50px rgba(0,0,0,0.25)">' +
      '<div style="text-align:center;margin-bottom:16px"><div style="width:48px;height:48px;border-radius:50%;background:#f0fdf4;display:inline-flex;align-items:center;justify-content:center;margin-bottom:12px"><i class="fas fa-check-circle" style="color:#16a34a;font-size:24px"></i></div>' +
      '<h3 style="font-size:18px;font-weight:700;color:#111;margin:0">' + title + '</h3>' +
      '<p style="font-size:13px;color:#6b7280;margin:6px 0 0">' + message + '</p></div>' +
      '<div style="display:flex;gap:8px;margin-bottom:16px"><input type="text" readonly value="' + url.replace(/"/g, '&quot;') + '" style="flex:1;padding:10px 12px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;color:#374151;background:#f9fafb;outline:none" id="pb-share-url">' +
      '<button onclick="navigator.clipboard.writeText(document.getElementById(\'pb-share-url\').value).then(function(){this.innerHTML=\'<i class=\\\'fas fa-check\\\'></i>\';this.style.background=\'#16a34a\'}.bind(this)).catch(function(){})" style="padding:10px 16px;background:#0ea5e9;color:white;border:none;border-radius:8px;font-weight:600;font-size:13px;cursor:pointer;white-space:nowrap"><i class="fas fa-copy" style="margin-right:4px"></i>Copy</button></div>' +
      '<button onclick="this.closest(\'div\').parentElement.remove()" style="width:100%;padding:10px;background:#f3f4f6;border:none;border-radius:8px;font-weight:600;font-size:13px;color:#374151;cursor:pointer">Close</button></div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
    var input = overlay.querySelector('#pb-share-url');
    if (input) { input.focus(); input.select(); }
  }

  function pbToast(msg, type) {
    var existing = document.getElementById('pb-toast');
    if (existing) existing.remove();
    var toast = document.createElement('div');
    toast.id = 'pb-toast';
    toast.style.cssText = 'position:fixed;top:20px;right:20px;z-index:99999;padding:14px 20px;border-radius:10px;font-size:14px;font-weight:600;max-width:400px;box-shadow:0 4px 20px rgba(0,0,0,0.15);animation:slideIn 0.3s ease-out;';
    toast.style.background = type === 'error' ? '#fef2f2' : type === 'success' ? '#f0fdf4' : '#eff6ff';
    toast.style.color = type === 'error' ? '#991b1b' : type === 'success' ? '#166534' : '#1e40af';
    toast.style.border = '1px solid ' + (type === 'error' ? '#fecaca' : type === 'success' ? '#bbf7d0' : '#bfdbfe');
    toast.innerHTML = (type === 'error' ? '<i class="fas fa-exclamation-circle" style="margin-right:8px"></i>' : type === 'success' ? '<i class="fas fa-check-circle" style="margin-right:8px"></i>' : '<i class="fas fa-info-circle" style="margin-right:8px"></i>') + msg;
    document.body.appendChild(toast);
    setTimeout(function() { toast.remove(); }, 4000);
  }

  function resetForm() {
    const today = new Date();
    const validUntil = new Date(today);
    validUntil.setDate(validUntil.getDate() + 30);
    return {
      customer_id: '',
      crm_customer_id: '',
      customer_name: '',
      customer_email: '',
      customer_phone: '',
      property_address: '',
      newCustomer: { name: '', email: '', phone: '', company_name: '', address: '' },
      isNewCustomer: false,
      proposal_number: 'PROP-' + today.toISOString().slice(0, 10).replace(/-/g, '') + '-' + Math.floor(Math.random() * 9999).toString().padStart(4, '0'),
      created_date: today.toISOString().slice(0, 10),
      valid_until: validUntil.toISOString().slice(0, 10),
      scope_of_work: '',
      items: [{ description: '', quantity: 1, unit: 'sq ft', unit_price: 0, is_taxable: true, category: '' }],
      discount_type: 'fixed',
      discount_amount: 0,
      tax_rate: 5.0,
      warranty_terms: 'All workmanship is warranted for a period of 5 years from the date of completion. Manufacturer warranties apply separately to all materials installed.',
      payment_terms_text: 'A 30% deposit is required to schedule the work. Balance due upon completion. Payment accepted via cheque, e-transfer, or credit card.',
      notes: '',
      attached_report_id: null,
      order_id: null,
      proposal_title: 'Roof Replacement Proposal',
      proposal_description: '',
      company_logo_url: ''
    };
  }

  // Expose state and render on window so inline onclick/onchange handlers can access them
  window.__pbState = state;
  window.__pbRender = function() { render(); };

  // ============================================================
  // DRAFT PERSISTENCE — sessionStorage so back-navigation restores form
  // ============================================================
  var PB_DRAFT_KEY = 'pb_form_draft';

  function pbSaveDraft() {
    try {
      sessionStorage.setItem(PB_DRAFT_KEY, JSON.stringify({
        form: state.form,
        createStep: state.createStep,
        pricingMethod: state.pricingMethod,
        pricePerSquare: state.pricePerSquare,
        selectedReport: state.selectedReport,
        selectedReportMaterials: state.selectedReportMaterials,
        markupPercent: state.markupPercent,
        marginPercent: state.marginPercent,
        pricingEngineMode: state.pricingEngineMode,
        customerPricePerSquare: state.customerPricePerSquare,
        customerPriceOverride: state.customerPriceOverride,
        showLineItemsToCustomer: state.showLineItemsToCustomer,
        showMaterialsToCustomer: state.showMaterialsToCustomer,
        showEdgesToCustomer: state.showEdgesToCustomer,
        showSolarToCustomer: state.showSolarToCustomer,
        showPitchToCustomer: state.showPitchToCustomer,
        showAreaToCustomer: state.showAreaToCustomer,
        attachments: state.attachments,
        editId: state.editId
      }));
    } catch(e) {}
  }

  function pbClearDraft() {
    try { sessionStorage.removeItem(PB_DRAFT_KEY); } catch(e) {}
  }

  function pbRestoreDraft() {
    try {
      var saved = sessionStorage.getItem(PB_DRAFT_KEY);
      if (!saved) return false;
      var d = JSON.parse(saved);
      if (d.form) Object.assign(state.form, d.form);
      state.createStep = d.createStep || 3;
      state.pricingMethod = d.pricingMethod || 'line_item';
      state.pricePerSquare = d.pricePerSquare || 0;
      state.selectedReport = d.selectedReport || null;
      state.selectedReportMaterials = d.selectedReportMaterials || null;
      state.markupPercent = d.markupPercent != null ? d.markupPercent : 30;
      state.marginPercent = d.marginPercent != null ? d.marginPercent : 30;
      state.pricingEngineMode = d.pricingEngineMode || 'markup';
      state.customerPricePerSquare = d.customerPricePerSquare || 0;
      state.customerPriceOverride = d.customerPriceOverride != null ? d.customerPriceOverride : null;
      state.showLineItemsToCustomer = !!d.showLineItemsToCustomer;
      state.showMaterialsToCustomer = !!d.showMaterialsToCustomer;
      state.showEdgesToCustomer = !!d.showEdgesToCustomer;
      state.showSolarToCustomer = !!d.showSolarToCustomer;
      state.showPitchToCustomer = d.showPitchToCustomer != null ? d.showPitchToCustomer : true;
      state.showAreaToCustomer = d.showAreaToCustomer != null ? d.showAreaToCustomer : true;
      if (d.attachments) state.attachments = d.attachments;
      state.editId = d.editId || null;
      state.mode = 'create';
      return true;
    } catch(e) { return false; }
  }

  pbRestoreDraft();

  load();
  checkPrereqs();

  // Check if material calculator sent us data
  (function checkMaterialData() {
    try {
      var saved = localStorage.getItem('mc_proposal_materials');
      if (saved) {
        var data = JSON.parse(saved);
        localStorage.removeItem('mc_proposal_materials'); // consume it
        state.pendingMaterialData = data;
        // Auto-start proposal creation with this material data
        setTimeout(function() {
          if (state.pendingMaterialData) {
            var md = state.pendingMaterialData;
            state.mode = 'create';
            state.createStep = 1; // start at report selection
            // Pre-fill items from material calc
            if (md.items && md.items.length > 0) {
              state.form.items = md.items.map(function(item) {
                return { description: item.description || '', quantity: item.quantity || 1, unit: item.unit || 'each', unit_price: item.unit_price || 0, is_taxable: true };
              });
            }
            if (md.address) state.form.property_address = md.address;
            state.pendingMaterialData = null;
            // Pre-select the report — use pickReport so the full api_response_raw is fetched
            if (md.source_report_id) {
              window._pb.pickReport(md.source_report_id); // async: fetches full report + renders
            } else {
              render();
            }
          }
        }, 1500); // wait for load() to finish fetching reports
      }
    } catch(e) {}
  })();

  function renderMaterialPanel() {
    var m = state.selectedReportMaterials;
    if (typeof m === 'string') { try { m = JSON.parse(m); } catch(e) { m = null; } }
    var hasItems = m && m.items && Array.isArray(m.items) && m.items.length > 0;
    var expanded = state.materialsExpanded;
    // Auto-expand when materials first become available
    if (hasItems && !state._materialsWasExpanded) { state.materialsExpanded = true; state._materialsWasExpanded = true; expanded = true; }

    var headerHtml =
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:' + (expanded && hasItems ? '12px' : '0') + '">' +
        '<div style="display:flex;align-items:center;gap:8px">' +
          '<div style="width:28px;height:28px;background:rgba(16,185,129,0.15);border-radius:6px;display:flex;align-items:center;justify-content:center"><i class="fas fa-calculator" style="color:#10b981;font-size:13px"></i></div>' +
          '<div>' +
            '<div style="color:var(--text-primary);font-weight:700;font-size:13px">Material Take-Off</div>' +
            '<div style="color:var(--text-muted);font-size:11px">' + (hasItems ? m.items.length + ' items' + (m.total_area_sqft ? ' · ' + m.total_area_sqft + ' sq ft' : '') + (m.waste_pct ? ' · ' + m.waste_pct + '% waste' : '') : 'No material data loaded') + '</div>' +
          '</div>' +
        '</div>' +
        '<button onclick="window._pb.toggleMaterials()" style="background:var(--bg-elevated);border:1px solid var(--border-color);border-radius:6px;padding:4px 10px;cursor:pointer;color:var(--text-muted);font-size:11px">' +
          (expanded ? '<i class="fas fa-chevron-up"></i>' : '<i class="fas fa-chevron-down"></i>') +
        '</button>' +
      '</div>';

    var bodyHtml = '';
    if (expanded) {
      if (hasItems) {
        var rows = m.items.map(function(item) {
          var total = (parseFloat(item.quantity) || 0) * (parseFloat(item.unit_price) || 0);
          return '<tr style="border-bottom:1px solid var(--border-color)">' +
            '<td style="padding:6px 8px;color:var(--text-primary);font-size:12px">' + (item.description || '') + '</td>' +
            '<td style="padding:6px 8px;text-align:center;color:var(--text-secondary);font-size:12px">' + (item.quantity || '') + '</td>' +
            '<td style="padding:6px 8px;text-align:center;color:var(--text-muted);font-size:11px">' + (item.unit || '') + '</td>' +
            '<td style="padding:6px 8px;text-align:right;color:var(--text-secondary);font-size:12px">$' + (parseFloat(item.unit_price) || 0).toFixed(2) + '</td>' +
            '<td style="padding:6px 8px;text-align:right;color:var(--text-primary);font-weight:600;font-size:12px">$' + total.toFixed(2) + '</td>' +
          '</tr>';
        }).join('');
        var grandTotal = m.items.reduce(function(s, item) { return s + (parseFloat(item.quantity) || 0) * (parseFloat(item.unit_price) || 0); }, 0);
        bodyHtml =
          '<div style="overflow-x:auto">' +
            '<table style="width:100%;border-collapse:collapse">' +
              '<thead><tr style="background:var(--bg-elevated)">' +
                '<th style="padding:6px 8px;text-align:left;color:var(--text-muted);font-size:10px;text-transform:uppercase;letter-spacing:0.5px">Description</th>' +
                '<th style="padding:6px 8px;text-align:center;color:var(--text-muted);font-size:10px;text-transform:uppercase;letter-spacing:0.5px">Qty</th>' +
                '<th style="padding:6px 8px;text-align:center;color:var(--text-muted);font-size:10px;text-transform:uppercase;letter-spacing:0.5px">Unit</th>' +
                '<th style="padding:6px 8px;text-align:right;color:var(--text-muted);font-size:10px;text-transform:uppercase;letter-spacing:0.5px">Unit Price</th>' +
                '<th style="padding:6px 8px;text-align:right;color:var(--text-muted);font-size:10px;text-transform:uppercase;letter-spacing:0.5px">Total</th>' +
              '</tr></thead>' +
              '<tbody>' + rows + '</tbody>' +
              '<tfoot><tr style="border-top:2px solid var(--border-color)">' +
                '<td colspan="4" style="padding:8px;text-align:right;color:var(--text-muted);font-size:12px;font-weight:700">Material Subtotal</td>' +
                '<td style="padding:8px;text-align:right;color:#10b981;font-size:14px;font-weight:800">$' + grandTotal.toFixed(2) + '</td>' +
              '</tr></tfoot>' +
            '</table>' +
          '</div>';
      } else if (m) {
        // Aggregate stats only (non-items format)
        bodyHtml = '<div style="color:var(--text-muted);font-size:12px;padding:8px 0">Material summary data is available but items list is not structured. Open the calculator to view full breakdown.</div>';
      } else {
        bodyHtml =
          '<div style="display:flex;align-items:center;gap:10px;padding:8px 0">' +
            '<span style="color:var(--text-muted);font-size:12px">No material data loaded.</span>' +
            '<a href="/customer/material-calculator" target="_blank" style="color:var(--accent);font-size:12px;font-weight:600">Open Calculator →</a>' +
          '</div>';
      }
    }

    return '<div style="background:var(--bg-card);border:1px solid var(--border-color);border-radius:12px;padding:14px 16px;margin-bottom:16px">' +
      headerHtml + bodyHtml +
    '</div>';
  }

  function ensurePreviewModal() {
    var modal = document.getElementById('pb-preview-modal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'pb-preview-modal';
    modal.style.cssText = 'display:none;position:fixed;top:0;left:0;width:100%;height:100%;overflow-y:auto;z-index:9999;background:white';
    document.body.appendChild(modal);
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') { var m = document.getElementById('pb-preview-modal'); if (m) m.style.display = 'none'; }
    });
    return modal;
  }

  async function load() {
    state.loading = true;
    render();
    try {
      const [propRes, custRes, libRes, repRes, gmailRes, certAutoRes, profileRes] = await Promise.all([
        fetch('/api/invoices?document_type=proposal', { headers: headers() }),
        fetch('/api/invoices/customers/list', { headers: headers() }),
        fetch('/api/customer/item-library', { headers: headers() }).catch(() => ({ ok: false })),
        fetch('/api/customer/reports-list', { headers: headers() }).catch(() => ({ ok: false })),
        fetch('/api/auth/gmail/status', { headers: headers() }).catch(() => ({ ok: false })),
        fetch('/api/crm/proposals/automation/settings', { headers: headers() }).catch(() => ({ ok: false })),
        fetch('/api/customer/profile', { headers: headers() }).catch(() => ({ ok: false }))
      ]);
      if (propRes.ok) { const d = await propRes.json(); state.proposals = d.invoices || []; }
      if (custRes.ok) { const d = await custRes.json(); state.customers = d.customers || []; }
      if (libRes.ok) { const d = await libRes.json(); state.itemLibrary = d.items || []; }
      if (gmailRes.ok) { const d = await gmailRes.json(); state.gmailStatus = d.gmail_oauth2 || null; }
      if (certAutoRes.ok) { const d = await certAutoRes.json(); state.autoSendCertificate = !!d.auto_send_certificate; }
      if (profileRes.ok) {
        const d = await profileRes.json();
        state.certLicenseNumber = d.brand_license_number || '';
        state.certAccentColor = d.brand_primary_color || '#1a5c38';
      }
      if (repRes.ok) {
        const d = await repRes.json();
        state.reports = d.reports || [];
      }
      // Fallback: if customer endpoint returned no reports (admin user or session mismatch),
      // try the admin reports list endpoint which has no customer filtering
      if (state.reports.length === 0) {
        try {
          const adminRepRes = await fetch('/api/reports/list', { headers: headers() });
          if (adminRepRes.ok) { const d = await adminRepRes.json(); state.reports = d.reports || []; }
        } catch(e) {}
      }
      // Load proposal pricing presets
      try {
        const ppRes = await fetch('/api/admin/proposal-pricing', { headers: headers() });
        if (ppRes.ok) { const ppData = await ppRes.json(); state.pricingPresets = ppData.presets || null; }
      } catch(e) {}
    } catch (e) { console.warn('Load error', e); }
    state.loading = false;
    // If a draft was restored with an attached report but no full measurement data, fetch it now
    var needsFullReport = state.form.attached_report_id &&
      state.selectedReport && !state.selectedReport.total_true_area_sqft;
    if (needsFullReport) {
      window._pb.pickReport(state.form.attached_report_id);
    } else {
      render();
    }
  }

  function render() {
    if (state.loading) { root.innerHTML = '<div style="text-align:center;padding:60px;color:#6b7280"><i class="fas fa-spinner fa-spin" style="font-size:32px;margin-bottom:12px"></i><p>Loading...</p></div>'; return; }

    if (state.mode === 'create' && !state.editId) {
      switch (state.createStep) {
        case 1: root.innerHTML = renderSelectReport(); return;
        case 2: root.innerHTML = renderConfirmSupplier(); return;
        case 3: root.innerHTML = renderProposalDashboard(); return;
      }
    }

    switch (state.mode) {
      case 'list': root.innerHTML = renderList(); break;
      case 'edit': root.innerHTML = renderEditor(); break;
      case 'preview': root.innerHTML = renderPreview(); break;
      case 'supplier-orders': root.innerHTML = renderSupplierOrders(); break;
    }
  }

  // renderStepBar removed — replaced by 3-step flow

  // renderPricingMethod removed — merged into dashboard

  // renderReportCustomer removed — replaced by renderSelectReport

  // ============================================================
  // NEW STEP 1: Select Report
  // ============================================================
  function renderSelectReport() {
    var all = state.reports;
    var term = (state.reportSearch || '').toLowerCase().trim();
    var filtered = term
      ? all.filter(function(r) { return (r.property_address || '').toLowerCase().includes(term); })
      : all;
    var visible = term ? filtered : filtered.slice(0, 5);
    var hasMore = !term && all.length > 5;

    var searchBar = all.length > 0
      ? '<div style="margin-bottom:12px">' +
          '<input id="pb-report-search" type="text" placeholder="Search address\u2026" value="' + (term || '') + '" ' +
            'oninput="window._pb.setReportSearch(this.value)" ' +
            'style="width:100%;padding:10px 14px;border-radius:8px;border:1px solid var(--border-color);background:var(--bg-card);color:var(--text-primary);font-size:14px;box-sizing:border-box">' +
        '</div>'
      : '';

    var hint = hasMore
      ? '<p style="font-size:13px;color:var(--text-muted);margin:0 0 12px">Showing 5 of ' + all.length + ' reports \u2014 type an address to find others</p>'
      : (term && filtered.length === 0
          ? '<p style="font-size:14px;color:var(--text-muted);margin:0 0 12px">No reports match \u201c' + term + '\u201d</p>'
          : '');

    var cards = visible.length > 0
      ? '<div style="display:flex;flex-direction:column;gap:12px">' +
          visible.map(function(r) {
            var isSelected = state.form.attached_report_id == r.id;
            return '<div onclick="window._pb.pickReport(\'' + r.id + '\')" style="background:var(--bg-card);border:2px solid ' + (isSelected ? 'var(--accent)' : 'var(--border-color)') + ';border-radius:12px;padding:16px;cursor:pointer;transition:all 0.2s;display:flex;align-items:center;justify-content:space-between">' +
              '<div>' +
                '<div style="color:var(--text-primary);font-weight:700;font-size:15px">' + (r.property_address || 'Report #' + r.id) + '</div>' +
                '<div style="color:var(--text-muted);font-size:12px;margin-top:4px">' +
                  '<span style="margin-right:12px"><i class="fas fa-calendar" style="margin-right:4px"></i>' + (r.created_at || '').slice(0, 10) + '</span>' +
                  (r.roof_area_sqft ? '<span style="margin-right:12px"><i class="fas fa-ruler-combined" style="margin-right:4px"></i>' + Math.round(r.roof_area_sqft) + ' sq ft</span>' : '') +
                  (r.roof_pitch ? '<span><i class="fas fa-angle-up" style="margin-right:4px"></i>' + r.roof_pitch + '</span>' : '') +
                '</div>' +
              '</div>' +
              (isSelected ? '<i class="fas fa-check-circle" style="color:var(--accent);font-size:20px"></i>' : '<i class="fas fa-circle" style="color:var(--border-color);font-size:20px"></i>') +
            '</div>';
          }).join('') +
        '</div>'
      : '';

    return '<div style="max-width:700px;margin:40px auto;padding:0 20px">' +
      '<div style="text-align:center;margin-bottom:32px">' +
        '<h2 style="color:var(--text-primary);font-size:24px;font-weight:800;margin-bottom:8px">Select a Roof Report</h2>' +
        '<p style="color:var(--text-muted);font-size:14px">Choose the measurement report for this proposal</p>' +
      '</div>' +

      (all.length > 0
        ? searchBar + hint + cards +

          '<div style="margin-top:20px;display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap">' +
            (state.form.attached_report_id ?
              '<button onclick="window._pb.goToSupplier()" style="background:var(--accent);color:#0a0a0a;border:none;padding:14px 40px;border-radius:999px;font-weight:800;font-size:15px;cursor:pointer">Continue &rarr;</button>' : ''
            ) +
            '<a href="/customer/order" style="color:var(--text-muted);font-size:13px;text-decoration:none;border:1px solid var(--border-color);padding:10px 20px;border-radius:8px;background:var(--bg-card)" onmouseover="this.style.borderColor=\'var(--accent)\'" onmouseout="this.style.borderColor=\'var(--border-color)\'">' +
              '<i class="fas fa-plus" style="margin-right:6px"></i>Order a New Report' +
            '</a>' +
          '</div>'

        : '<div style="text-align:center;padding:40px;color:var(--text-muted)">' +
            '<i class="fas fa-file-alt" style="font-size:48px;margin-bottom:16px;opacity:0.3"></i>' +
            '<p style="font-weight:600;margin-bottom:8px">No completed reports found</p>' +
            '<a href="/customer/order" style="color:var(--accent);font-weight:600">Order a roof report first &rarr;</a>' +
          '</div>'
      ) +

      '<div style="margin-top:24px;text-align:center">' +
        '<button onclick="window._pb.backToList()" style="color:var(--text-muted);background:none;border:none;cursor:pointer;font-size:13px">&larr; Back to Proposals</button>' +
      '</div>' +
    '</div>';
  }

  // ============================================================
  // NEW STEP 2: Confirm Supplier
  // ============================================================
  function renderConfirmSupplier() {
    if (state.suppliers.length > 0) {
      // Build supplier selector if multiple suppliers exist
      var selectedIdx = state.selectedSupplierIdx || 0;
      if (selectedIdx >= state.suppliers.length) selectedIdx = 0;
      var s = state.suppliers[selectedIdx];

      var selectorHtml = '';
      if (state.suppliers.length > 1) {
        selectorHtml = '<div style="margin-bottom:16px"><label style="display:block;color:var(--text-muted);font-size:12px;font-weight:600;margin-bottom:6px">Select Supplier</label>' +
          '<select id="pbSupplierSelect" onchange="window.__pbState.selectedSupplierIdx=parseInt(this.value);window.__pbRender()" style="width:100%;background:var(--bg-elevated);border:1px solid var(--border-color);border-radius:8px;padding:10px;color:var(--text-primary);font-size:14px">';
        for (var si = 0; si < state.suppliers.length; si++) {
          selectorHtml += '<option value="' + si + '"' + (si === selectedIdx ? ' selected' : '') + '>' + (state.suppliers[si].name || 'Supplier') + (state.suppliers[si].branch_name ? ' — ' + state.suppliers[si].branch_name : '') + '</option>';
        }
        selectorHtml += '</select></div>';
      }

      return '<div style="max-width:600px;margin:40px auto;padding:0 20px">' +
        '<div style="text-align:center;margin-bottom:32px">' +
          '<h2 style="color:var(--text-primary);font-size:24px;font-weight:800;margin-bottom:8px">Confirm Your Supplier</h2>' +
          '<p style="color:var(--text-muted);font-size:14px">Material orders will be sent to this supplier</p>' +
        '</div>' +
        selectorHtml +
        '<div style="background:var(--bg-card);border:2px solid var(--accent);border-radius:16px;padding:24px;margin-bottom:24px">' +
          '<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">' +
            '<div style="width:48px;height:48px;background:var(--accent);border-radius:12px;display:flex;align-items:center;justify-content:center"><i class="fas fa-store" style="color:#0a0a0a;font-size:20px"></i></div>' +
            '<div>' +
              '<div style="color:var(--text-primary);font-weight:700;font-size:18px">' + (s.name || 'Supplier') + '</div>' +
              (s.branch_name ? '<div style="color:var(--text-muted);font-size:13px">' + s.branch_name + '</div>' : '') +
            '</div>' +
          '</div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px">' +
            (s.account_number ? '<div style="color:var(--text-secondary)"><span style="color:var(--text-muted)">Account:</span> ' + s.account_number + '</div>' : '') +
            (s.phone ? '<div style="color:var(--text-secondary)"><span style="color:var(--text-muted)">Phone:</span> ' + s.phone + '</div>' : '') +
            (s.rep_name ? '<div style="color:var(--text-secondary)"><span style="color:var(--text-muted)">Rep:</span> ' + s.rep_name + '</div>' : '') +
            (s.rep_phone ? '<div style="color:var(--text-secondary)"><span style="color:var(--text-muted)">Rep Phone:</span> ' + s.rep_phone + '</div>' : '') +
          '</div>' +
        '</div>' +
        '<div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">' +
          '<button onclick="window.__pbState.createStep=1;window.__pbRender()" style="color:var(--text-muted);background:var(--bg-card);border:1px solid var(--border-color);padding:12px 24px;border-radius:999px;cursor:pointer;font-weight:600">&larr; Back</button>' +
          '<button onclick="window.__pbState.showNewSupplierForm=true;window.__pbRender()" style="color:var(--text-primary);background:var(--bg-card);border:1px solid var(--border-color);padding:12px 24px;border-radius:999px;cursor:pointer;font-weight:600"><i class="fas fa-plus" style="margin-right:6px"></i>New Supplier</button>' +
          '<button onclick="window.__pbState.createStep=3;window.__pbState.form.isNewCustomer=true;window.__pbRender()" style="background:var(--accent);color:#0a0a0a;border:none;padding:12px 40px;border-radius:999px;font-weight:800;font-size:15px;cursor:pointer">Confirm & Build Proposal &rarr;</button>' +
        '</div>' +
        (state.showNewSupplierForm ? '<div style="margin-top:24px">' + renderSupplierSetup() + '</div>' : '') +
      '</div>';
    } else {
      return renderSupplierSetup();
    }
  }

  // ============================================================
  // NEW STEP 3: Proposal Dashboard (all-in-one workspace)
  // ============================================================
  function renderProposalDashboard() {
    var f = state.form;
    // Build customer dropdown HTML for existing-customer mode
    var custDropdownHtml = (function() {
      var html = '';
      var portal = state.customers.filter(function(c) { return c.source !== 'crm'; });
      var crm = state.customers.filter(function(c) { return c.source === 'crm'; });
      if (portal.length) {
        html += '<optgroup label="Portal Customers">' +
          portal.map(function(c) { return '<option value="' + c.id + '" ' + (f.customer_id == c.id ? 'selected' : '') + '>' + (c.name || c.email || '').replace(/</g,'&lt;').replace(/>/g,'&gt;') + (c.company_name ? ' (' + c.company_name + ')' : '') + '</option>'; }).join('') +
          '</optgroup>';
      }
      if (crm.length) {
        html += '<optgroup label="CRM Contacts">' +
          crm.map(function(c) { return '<option value="crm:' + c.id + '" ' + (f.crm_customer_id == c.id ? 'selected' : '') + '>' + (c.name || c.email || '').replace(/</g,'&lt;').replace(/>/g,'&gt;') + (c.company_name ? ' (' + c.company_name + ')' : '') + '</option>'; }).join('') +
          '</optgroup>';
      }
      return html || '<option value="" disabled>No customers yet</option>';
    })();
    var items = f.items || [];
    var totalCost = items.reduce(function(s,i) { return s + (Number(i.quantity||0) * Number(i.unit_price||0)); }, 0);
    var markup = state.markupPercent || 30;
    var reportSquares = state.selectedReport ? Math.ceil((state.selectedReport.roof_area_sqft || 0) / 100) : 0;
    var squares = state.manualSquares !== null ? state.manualSquares : reportSquares;
    var marginPct = state.marginPercent || 30;
    var customerTotal = state.pricingEngineMode === 'per_square_customer' ?
      squares * (state.customerPricePerSquare || 0) :
      state.pricingEngineMode === 'margin' ?
        (marginPct < 100 ? totalCost / (1 - marginPct / 100) : totalCost) :
        totalCost * (1 + markup / 100);
    // Apply manual override if set
    if (state.customerPriceOverride !== null && state.customerPriceOverride > 0) {
      customerTotal = state.customerPriceOverride;
    }
    var effectiveCost = state.myCost !== null ? state.myCost : totalCost;
    var profit = customerTotal - effectiveCost;
    var margin = customerTotal > 0 ? (profit / customerTotal * 100) : 0;

    return '<div style="max-width:1100px;margin:0 auto;padding:20px">' +

      // Header with job info
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px">' +
        '<div>' +
          '<h2 style="color:var(--text-primary);font-size:22px;font-weight:800;margin-bottom:4px"><i class="fas fa-file-signature" style="color:var(--accent);margin-right:8px"></i>Proposal Builder</h2>' +
          '<p style="color:var(--text-muted);font-size:13px">' + (state.selectedReport ? state.selectedReport.property_address : 'New Proposal') + '</p>' +
        '</div>' +
        '<button onclick="window._pb.backToList()" style="color:var(--text-muted);background:var(--bg-card);border:1px solid var(--border-color);padding:8px 16px;border-radius:8px;cursor:pointer;font-size:13px">&larr; Back to Proposals</button>' +
      '</div>' +

      // Report link card — always visible at top of dashboard
      '<div style="background:var(--bg-card);border:2px solid ' + (state.selectedReport ? '#22c55e' : 'var(--accent)') + ';border-radius:12px;padding:14px 16px;margin-bottom:16px;display:flex;align-items:center;gap:12px">' +
        '<div style="width:36px;height:36px;background:' + (state.selectedReport ? 'rgba(34,197,94,0.15)' : 'rgba(0,255,136,0.1)') + ';border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0">' +
          '<i class="fas fa-satellite" style="color:' + (state.selectedReport ? '#22c55e' : 'var(--accent)') + ';font-size:15px"></i>' +
        '</div>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="color:var(--text-muted);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px">Roof Report</div>' +
          (state.selectedReport
            ? '<div style="display:flex;align-items:center;gap:10px">' +
                '<span style="color:#22c55e;font-weight:700;font-size:13px"><i class="fas fa-check-circle mr-1"></i>' + (state.selectedReport.property_address || 'Report linked') + '</span>' +
                '<button onclick="window.__pbState.selectedReport=null;window.__pbState.form.attached_report_id=null;window.__pbRender()" style="font-size:11px;color:var(--text-muted);background:none;border:none;cursor:pointer;text-decoration:underline">Change</button>' +
              '</div>'
            : '<select onchange="if(this.value)window._pb.pickReport(this.value)" style="width:100%;padding:8px 10px;background:var(--bg-elevated);border:1px solid var(--accent);border-radius:8px;color:var(--text-primary);font-size:13px">' +
                '<option value="">— Select a completed roof report to link —</option>' +
                state.reports.map(function(r) {
                  return '<option value="' + r.id + '">' + (r.property_address || 'Report #' + r.id) + (r.created_at ? ' — ' + r.created_at.slice(0, 10) : '') + '</option>';
                }).join('') +
              '</select>'
          ) +
        '</div>' +
      '</div>' +

      // Quick access: Report + Materials
      (state.selectedReport ?
        '<div style="display:flex;gap:12px;margin-bottom:16px">' +
          '<a href="/customer/reports" target="_blank" style="flex:1;display:flex;align-items:center;gap:10px;background:var(--bg-card);border:1px solid var(--border-color);border-radius:10px;padding:12px 16px;text-decoration:none;transition:all 0.2s" onmouseover="this.style.borderColor=\'var(--accent)\'" onmouseout="this.style.borderColor=\'var(--border-color)\'">' +
            '<div style="width:36px;height:36px;background:rgba(37,99,235,0.15);border-radius:8px;display:flex;align-items:center;justify-content:center"><i class="fas fa-file-alt" style="color:#3b82f6"></i></div>' +
            '<div><div style="color:var(--text-primary);font-weight:600;font-size:13px">View Roof Report</div><div style="color:var(--text-muted);font-size:11px">' + (state.selectedReport.property_address || 'Attached report').substring(0, 35) + '</div></div>' +
          '</a>' +
          '<button onclick="window._pb.toggleMaterials()" style="flex:1;display:flex;align-items:center;gap:10px;background:var(--bg-card);border:1px solid var(--border-color);border-radius:10px;padding:12px 16px;cursor:pointer;transition:all 0.2s;text-align:left" onmouseover="this.style.borderColor=\'var(--accent)\'" onmouseout="this.style.borderColor=\'var(--border-color)\'">' +
            '<div style="width:36px;height:36px;background:rgba(16,185,129,0.15);border-radius:8px;display:flex;align-items:center;justify-content:center"><i class="fas fa-calculator" style="color:#10b981"></i></div>' +
            '<div style="flex:1"><div style="color:var(--text-primary);font-weight:600;font-size:13px">Material Take-Off</div><div style="color:var(--text-muted);font-size:11px">' + (state.selectedReportMaterials ? 'Materials loaded — click to expand' : 'Open calculator to load') + '</div></div>' +
            '<i class="fas ' + (state.materialsExpanded ? 'fa-chevron-up' : 'fa-chevron-down') + '" style="color:var(--text-muted);font-size:11px"></i>' +
          '</button>' +
          '<div style="flex:1;display:flex;align-items:center;gap:10px;background:var(--bg-card);border:1px solid var(--border-color);border-radius:10px;padding:12px 16px">' +
            '<div style="width:36px;height:36px;background:rgba(139,92,246,0.15);border-radius:8px;display:flex;align-items:center;justify-content:center"><i class="fas fa-store" style="color:#8b5cf6"></i></div>' +
            '<div><div style="color:var(--text-primary);font-weight:600;font-size:13px">Supplier</div><div style="color:var(--text-muted);font-size:11px">' + (state.suppliers.length > 0 ? state.suppliers[0].name : 'Not set') + '</div></div>' +
          '</div>' +
        '</div>'
      : '') +

      // Inline material take-off panel
      renderMaterialPanel() +

      // Profit summary bar
      '<div style="background:var(--bg-card);border:1px solid var(--border-color);border-radius:12px;padding:16px;margin-bottom:20px;display:grid;grid-template-columns:1fr 1fr 1fr 1fr 1fr;gap:12px;text-align:center">' +
        '<div><div style="color:var(--text-muted);font-size:10px;text-transform:uppercase;letter-spacing:1px">Line Item Cost</div><div style="color:var(--text-muted);font-size:18px;font-weight:700">$' + totalCost.toFixed(2) + '</div></div>' +
        '<div><div style="color:var(--text-muted);font-size:10px;text-transform:uppercase;letter-spacing:1px">My Cost <span style="font-size:8px;opacity:0.6">(editable)</span></div><div style="display:flex;align-items:center;justify-content:center;gap:2px"><span style="color:#ef4444;font-size:20px;font-weight:800">$</span><input type="number" value="' + (state.myCost !== null ? state.myCost : totalCost).toFixed(2) + '" onchange="window.__pbState.myCost=parseFloat(this.value)||null;window.__pbRender()" style="width:90px;background:transparent;border:none;border-bottom:2px solid #ef4444;color:#ef4444;font-size:20px;font-weight:800;text-align:center;padding:0"></div></div>' +
        '<div><div style="color:var(--text-muted);font-size:10px;text-transform:uppercase;letter-spacing:1px">Customer Price <span style="font-size:8px;opacity:0.6">(editable)</span></div><div style="display:flex;align-items:center;justify-content:center;gap:2px"><span style="color:var(--text-primary);font-size:20px;font-weight:800">$</span><input type="number" value="' + (state.customerPriceOverride !== null ? state.customerPriceOverride : customerTotal).toFixed(2) + '" onchange="window.__pbState.customerPriceOverride=parseFloat(this.value)||null;window.__pbRender()" style="width:90px;background:transparent;border:none;border-bottom:2px solid var(--accent);color:var(--text-primary);font-size:20px;font-weight:800;text-align:center;padding:0"></div></div>' +
        '<div><div style="color:var(--text-muted);font-size:10px;text-transform:uppercase;letter-spacing:1px">Your Profit</div><div style="color:#22c55e;font-size:20px;font-weight:800">$' + profit.toFixed(2) + '</div></div>' +
        '<div><div style="color:var(--text-muted);font-size:10px;text-transform:uppercase;letter-spacing:1px">Margin</div><div style="color:#22c55e;font-size:20px;font-weight:800">' + margin.toFixed(1) + '%</div></div>' +
      '</div>' +

      // Quick Templates
      '<div style="background:var(--bg-card);border:1px solid var(--border-color);border-radius:12px;padding:16px;margin-bottom:20px">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">' +
          '<h4 style="color:var(--text-primary);font-size:14px;font-weight:700;margin:0"><i class="fas fa-layer-group" style="color:var(--accent);margin-right:6px"></i>Quick Templates</h4>' +
          '<span style="color:var(--text-muted);font-size:11px">Click to pre-fill proposal text</span>' +
        '</div>' +
        '<div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:4px">' +
          PROPOSAL_TEMPLATES.map(function(t) {
            return '<button onclick="window._pb.applyTemplate(\'' + t.id + '\')" style="flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:4px;padding:10px 14px;background:var(--bg-elevated);border:1px solid var(--border-color);border-radius:10px;cursor:pointer;min-width:100px" onmouseover="this.style.borderColor=\'var(--accent)\'" onmouseout="this.style.borderColor=\'var(--border-color)\'">' +
              '<i class="fas ' + t.icon + '" style="color:var(--accent);font-size:16px"></i>' +
              '<span style="color:var(--text-primary);font-size:11px;font-weight:600;text-align:center;white-space:nowrap">' + t.label + '</span>' +
            '</button>';
          }).join('') +
        '</div>' +
      '</div>' +

      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">' +

        // LEFT COLUMN: Costs + Line Items
        '<div>' +
          // Pricing mode toggle
          '<div style="background:var(--bg-card);border:1px solid var(--border-color);border-radius:12px;padding:16px;margin-bottom:16px">' +
            '<div style="display:flex;gap:8px;margin-bottom:12px">' +
              '<button onclick="window.__pbState.pricingMethod=\'line_item\';window.__pbRender()" style="flex:1;padding:8px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid ' + (state.pricingMethod === 'line_item' ? 'var(--accent)' : 'var(--border-color)') + ';background:' + (state.pricingMethod === 'line_item' ? 'rgba(0,255,136,0.1)' : 'transparent') + ';color:' + (state.pricingMethod === 'line_item' ? 'var(--accent)' : 'var(--text-muted)') + '">Line Item</button>' +
              '<button onclick="window.__pbState.pricingMethod=\'per_square\';window.__pbRender()" style="flex:1;padding:8px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid ' + (state.pricingMethod === 'per_square' ? 'var(--accent)' : 'var(--border-color)') + ';background:' + (state.pricingMethod === 'per_square' ? 'rgba(0,255,136,0.1)' : 'transparent') + ';color:' + (state.pricingMethod === 'per_square' ? 'var(--accent)' : 'var(--text-muted)') + '">Per Square</button>' +
            '</div>' +

            (state.pricingMethod === 'per_square' ?
              '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
                '<div><label style="color:var(--text-muted);font-size:11px;display:block;margin-bottom:4px">Your Cost/Sq</label><input type="number" value="' + (state.pricePerSquare || 0) + '" onchange="window.__pbState.pricePerSquare=Number(this.value);window.__pbRender()" style="width:100%;background:var(--bg-elevated);border:1px solid var(--border-color);border-radius:8px;padding:8px;color:var(--text-primary);font-weight:700"></div>' +
                '<div><label style="color:var(--text-muted);font-size:11px;display:block;margin-bottom:4px">Roof Squares</label><input type="number" value="' + squares + '" oninput="window.__pbState.manualSquares=Number(this.value)||0;window.__pbRender()" style="width:100%;background:var(--bg-elevated);border:1px solid var(--border-color);border-radius:8px;padding:8px;color:var(--text-primary);font-weight:700;font-size:16px" min="0" step="0.5"></div>' +
              '</div>'
            :
              // Line items
              '<div style="max-height:300px;overflow-y:auto">' +
                '<table style="width:100%;font-size:12px;border-collapse:collapse">' +
                  '<thead><tr><th style="text-align:left;padding:6px;color:var(--text-muted);font-size:10px">Description</th><th style="text-align:center;padding:6px;color:var(--text-muted);font-size:10px">Qty</th><th style="text-align:right;padding:6px;color:var(--text-muted);font-size:10px">Your Cost</th><th style="width:30px"></th></tr></thead>' +
                  '<tbody>' +
                    items.map(function(item, i) {
                      return '<tr style="border-bottom:1px solid var(--border-color)">' +
                        '<td style="padding:4px"><input value="' + (item.description||'').replace(/"/g,'&quot;') + '" onchange="window._pb.updateItem(' + i + ',\'description\',this.value)" style="width:100%;background:transparent;border:none;color:var(--text-primary);font-size:12px;padding:4px"></td>' +
                        '<td style="text-align:center;padding:4px"><input type="number" value="' + (item.quantity||1) + '" onchange="window._pb.updateItem(' + i + ',\'quantity\',this.value)" style="width:50px;background:transparent;border:1px solid var(--border-color);border-radius:4px;color:var(--text-primary);font-size:12px;text-align:center;padding:4px"></td>' +
                        '<td style="text-align:right;padding:4px"><input type="number" value="' + (item.unit_price||0) + '" onchange="window._pb.updateItem(' + i + ',\'unit_price\',this.value)" style="width:80px;background:transparent;border:1px solid var(--border-color);border-radius:4px;color:var(--text-primary);font-size:12px;text-align:right;padding:4px"></td>' +
                        '<td style="padding:4px"><button onclick="window._pb.removeItem(' + i + ')" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:11px"><i class="fas fa-times"></i></button></td>' +
                      '</tr>';
                    }).join('') +
                  '</tbody>' +
                '</table>' +
                '<button onclick="window._pb.addItem()" style="color:var(--accent);background:none;border:none;cursor:pointer;font-size:12px;padding:8px 0"><i class="fas fa-plus" style="margin-right:4px"></i>Add Item</button>' +
              '</div>'
            ) +
          '</div>' +

          // Customer pricing
          '<div style="background:var(--bg-card);border:1px solid var(--border-color);border-radius:12px;padding:16px">' +
            '<h4 style="color:var(--text-primary);font-size:14px;font-weight:700;margin-bottom:12px"><i class="fas fa-tags" style="color:var(--accent);margin-right:6px"></i>Customer Pricing</h4>' +
            '<div style="display:flex;gap:8px;margin-bottom:12px">' +
              '<button onclick="window.__pbState.pricingEngineMode=\'markup\';window.__pbRender()" style="flex:1;padding:6px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;border:1px solid ' + (state.pricingEngineMode === 'markup' ? 'var(--accent)' : 'var(--border-color)') + ';color:' + (state.pricingEngineMode === 'markup' ? 'var(--accent)' : 'var(--text-muted)') + ';background:transparent">Markup %</button>' +
              '<button onclick="window.__pbState.pricingEngineMode=\'margin\';window.__pbRender()" style="flex:1;padding:6px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;border:1px solid ' + (state.pricingEngineMode === 'margin' ? 'var(--accent)' : 'var(--border-color)') + ';color:' + (state.pricingEngineMode === 'margin' ? 'var(--accent)' : 'var(--text-muted)') + ';background:transparent">Margin %</button>' +
              '<button onclick="window.__pbState.pricingEngineMode=\'per_square_customer\';window.__pbRender()" style="flex:1;padding:6px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;border:1px solid ' + (state.pricingEngineMode === 'per_square_customer' ? 'var(--accent)' : 'var(--border-color)') + ';color:' + (state.pricingEngineMode === 'per_square_customer' ? 'var(--accent)' : 'var(--text-muted)') + ';background:transparent">$/Square</button>' +
              '<button onclick="window.__pbState.pricingEngineMode=\'per_bundle\';window.__pbRender()" style="flex:1;padding:6px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;border:1px solid ' + (state.pricingEngineMode === 'per_bundle' ? 'var(--accent)' : 'var(--border-color)') + ';color:' + (state.pricingEngineMode === 'per_bundle' ? 'var(--accent)' : 'var(--text-muted)') + ';background:transparent">$/Bundle</button>' +
            '</div>' +
            (state.pricingEngineMode === 'markup' ?
              '<div><label style="color:var(--text-muted);font-size:11px">Markup % <span style="opacity:0.6">(on cost)</span></label><input type="number" value="' + markup + '" onchange="window.__pbState.markupPercent=Number(this.value);window.__pbRender()" style="width:100%;background:var(--bg-elevated);border:1px solid var(--border-color);border-radius:8px;padding:8px;color:var(--text-primary);font-weight:700;font-size:18px;margin-top:4px" min="0" max="1000" step="1"></div>'
            : state.pricingEngineMode === 'margin' ?
              '<div><label style="color:var(--text-muted);font-size:11px">Target Margin % <span style="opacity:0.6">(gross profit / revenue)</span></label><input type="number" value="' + marginPct + '" onchange="window.__pbState.marginPercent=Math.min(99,Math.max(0,Number(this.value)));window.__pbRender()" style="width:100%;background:var(--bg-elevated);border:1px solid var(--border-color);border-radius:8px;padding:8px;color:var(--text-primary);font-weight:700;font-size:18px;margin-top:4px" min="0" max="99" step="1"></div>'
            : state.pricingEngineMode === 'per_bundle' ?
              (function() {
                var bCount = 0;
                var mats = state.selectedReportMaterials;
                if (mats && mats.items && Array.isArray(mats.items)) {
                  for (var bi = 0; bi < mats.items.length; bi++) {
                    if (mats.items[bi].unit === 'bundles' && /shingle/i.test(mats.items[bi].description || '')) bCount += (parseFloat(mats.items[bi].quantity) || 0);
                  }
                }
                if (bCount === 0 && squares > 0) bCount = squares * 3;
                var ppb = state.pricePerBundle || (state.pricingPresets && state.pricingPresets.price_per_bundle) || 125;
                var bundleTotal = bCount * ppb;
                return '<div><label style="color:var(--text-muted);font-size:11px">Price per Bundle ($)</label><input type="number" value="' + ppb + '" onchange="window.__pbState.pricePerBundle=Number(this.value);window.__pbState.customerPriceOverride=' + bCount + '*Number(this.value);window.__pbRender()" style="width:100%;background:var(--bg-elevated);border:1px solid var(--border-color);border-radius:8px;padding:8px;color:var(--text-primary);font-weight:700;font-size:18px;margin-top:4px"></div>' +
                  '<div style="margin-top:8px;padding:8px;background:var(--bg-elevated);border-radius:8px;display:flex;justify-content:space-between;font-size:12px">' +
                    '<span style="color:var(--text-muted)">' + bCount + ' bundles x $' + ppb + '</span>' +
                    '<span style="color:var(--text-primary);font-weight:700">= $' + bundleTotal.toLocaleString() + '</span>' +
                  '</div>';
              })()
            :
              '<div><label style="color:var(--text-muted);font-size:11px">Customer $/Square</label><input type="number" value="' + (state.customerPricePerSquare || 0) + '" onchange="window.__pbState.customerPricePerSquare=Number(this.value);window.__pbRender()" style="width:100%;background:var(--bg-elevated);border:1px solid var(--border-color);border-radius:8px;padding:8px;color:var(--text-primary);font-weight:700;font-size:18px;margin-top:4px"></div>'
            ) +
          '</div>' +
        '</div>' +

        // RIGHT COLUMN: Report Toggles + Details + Certs
        '<div>' +
          // Report page toggles
          '<div style="background:var(--bg-card);border:1px solid var(--border-color);border-radius:12px;padding:16px;margin-bottom:16px">' +
            '<h4 style="color:var(--text-primary);font-size:14px;font-weight:700;margin-bottom:12px"><i class="fas fa-file-alt" style="color:var(--accent);margin-right:6px"></i>Include in Customer Proposal</h4>' +
            '<div style="display:flex;flex-direction:column;gap:8px">' +
              '<label style="display:flex;align-items:center;gap:8px;padding:8px;background:var(--bg-elevated);border-radius:8px;cursor:pointer;font-size:13px;color:var(--text-secondary)"><input type="checkbox" ' + (state.showAreaToCustomer ? 'checked' : '') + ' onchange="window.__pbState.showAreaToCustomer=this.checked;window.__pbRender()"> Page 1: Project Summary & Satellite Image</label>' +
              '<label style="display:flex;align-items:center;gap:8px;padding:8px;background:var(--bg-elevated);border-radius:8px;cursor:pointer;font-size:13px;color:var(--text-secondary)"><input type="checkbox" ' + (state.showPitchToCustomer ? 'checked' : '') + ' onchange="window.__pbState.showPitchToCustomer=this.checked;window.__pbRender()"> Page 2: Roof Diagram & Measurements</label>' +
              '<label style="display:flex;align-items:center;gap:8px;padding:8px;background:var(--bg-elevated);border-radius:8px;cursor:pointer;font-size:13px;color:var(--text-secondary)"><input type="checkbox" ' + (state.showMaterialsToCustomer ? 'checked' : '') + ' onchange="window.__pbState.showMaterialsToCustomer=this.checked;window.__pbRender()"> Page 3: Material Take-Off (BOM)</label>' +
              '<label style="display:flex;align-items:center;gap:8px;padding:8px;background:var(--bg-elevated);border-radius:8px;cursor:pointer;font-size:13px;color:var(--text-secondary)"><input type="checkbox" ' + (state.showEdgesToCustomer ? 'checked' : '') + ' onchange="window.__pbState.showEdgesToCustomer=this.checked;window.__pbRender()"> Page 4: Edge Breakdown Details</label>' +
              '<label style="display:flex;align-items:center;gap:8px;padding:8px;background:var(--bg-elevated);border-radius:8px;cursor:pointer;font-size:13px;color:var(--text-secondary)"><input type="checkbox" ' + (state.showSolarToCustomer ? 'checked' : '') + ' onchange="window.__pbState.showSolarToCustomer=this.checked;window.__pbRender()"> Page 5: Quality & Validation Notes</label>' +
            '</div>' +
          '</div>' +

          // Proposal customization
          '<div style="background:var(--bg-card);border:1px solid var(--border-color);border-radius:12px;padding:16px;margin-bottom:16px">' +
            '<h4 style="color:var(--text-primary);font-size:14px;font-weight:700;margin-bottom:12px"><i class="fas fa-paint-brush" style="color:var(--accent);margin-right:6px"></i>Customize Proposal</h4>' +
            '<div style="display:flex;flex-direction:column;gap:10px">' +
              '<div><label style="color:var(--text-muted);font-size:11px;display:block;margin-bottom:3px">Proposal Title</label><input id="dash-prop-title" value="' + (f.proposal_title || 'Roof Replacement Proposal').replace(/"/g, '&quot;') + '" placeholder="Roof Replacement Proposal" style="width:100%;background:var(--bg-elevated);border:1px solid var(--border-color);border-radius:8px;padding:8px;color:var(--text-primary);font-size:14px;font-weight:600"></div>' +
              '<div><label style="color:var(--text-muted);font-size:11px;display:block;margin-bottom:3px">Proposal Description / Intro</label><textarea id="dash-prop-desc" placeholder="Thank you for the opportunity to provide this estimate for your roofing project..." style="width:100%;background:var(--bg-elevated);border:1px solid var(--border-color);border-radius:8px;padding:8px;color:var(--text-primary);font-size:13px;height:60px;resize:vertical">' + (f.proposal_description || '') + '</textarea></div>' +
              '<div><label style="color:var(--text-muted);font-size:11px;display:block;margin-bottom:3px">Company Logo URL <span style="opacity:0.5">(optional)</span></label>' +
                '<div style="display:flex;gap:8px;align-items:center">' +
                  '<input id="dash-logo-url" value="' + (f.company_logo_url || '').replace(/"/g, '&quot;') + '" placeholder="https://yoursite.com/logo.png" style="flex:1;background:var(--bg-elevated);border:1px solid var(--border-color);border-radius:8px;padding:8px;color:var(--text-primary);font-size:12px">' +
                  (f.company_logo_url ? '<img src="' + f.company_logo_url + '" style="width:36px;height:36px;border-radius:6px;object-fit:contain;border:1px solid var(--border-color)" onerror="this.style.display=\'none\'">' : '') +
                '</div>' +
              '</div>' +
              '<div><label style="color:var(--text-muted);font-size:11px;display:block;margin-bottom:6px"><i class="fas fa-palette" style="margin-right:4px"></i>Proposal Header Color</label>' +
                '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
                  ['#0ea5e9','#2563eb','#7c3aed','#16a34a','#dc2626','#f97316','#0d9488','#1e293b'].map(function(c) {
                    var isSelected = (state.accentColor || '#0ea5e9') === c;
                    return '<button onclick="window.__pbState.accentColor=\'' + c + '\';window.__pbRender()" title="' + c + '" style="width:28px;height:28px;border-radius:50%;background:' + c + ';border:' + (isSelected ? '3px solid white;box-shadow:0 0 0 2px ' + c : '2px solid transparent') + ';cursor:pointer;transition:all 0.15s"></button>';
                  }).join('') +
                  '<input type="color" id="dash-accent-color" value="' + (state.accentColor || '#0ea5e9') + '" oninput="window.__pbState.accentColor=this.value;window.__pbRender()" title="Custom color" style="width:28px;height:28px;border:1px solid var(--border-color);border-radius:50%;cursor:pointer;padding:2px;background:none">' +
                  '<div style="width:48px;height:28px;border-radius:6px;background:' + (state.accentColor || '#0ea5e9') + ';display:flex;align-items:center;justify-content:center"><span style="color:white;font-size:9px;font-weight:700">Preview</span></div>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>' +

          // Customer details
          '<div style="background:var(--bg-card);border:1px solid var(--border-color);border-radius:12px;padding:16px;margin-bottom:16px">' +
            '<h4 style="color:var(--text-primary);font-size:14px;font-weight:700;margin-bottom:10px"><i class="fas fa-user" style="color:var(--accent);margin-right:6px"></i>Customer Info</h4>' +
            // Mode toggle
            '<div style="display:flex;gap:6px;margin-bottom:12px">' +
              '<button onclick="window.__pbState.form.isNewCustomer=true;window.__pbRender()" style="flex:1;padding:6px 8px;border-radius:7px;font-size:11px;font-weight:600;cursor:pointer;border:1px solid ' + (f.isNewCustomer !== false ? 'var(--accent)' : 'var(--border-color)') + ';background:' + (f.isNewCustomer !== false ? 'rgba(0,255,136,0.08)' : 'transparent') + ';color:' + (f.isNewCustomer !== false ? 'var(--accent)' : 'var(--text-muted)') + '"><i class="fas fa-user-plus" style="margin-right:4px"></i>New Customer</button>' +
              '<button onclick="window.__pbState.form.isNewCustomer=false;window.__pbRender()" style="flex:1;padding:6px 8px;border-radius:7px;font-size:11px;font-weight:600;cursor:pointer;border:1px solid ' + (f.isNewCustomer === false ? 'var(--accent)' : 'var(--border-color)') + ';background:' + (f.isNewCustomer === false ? 'rgba(0,255,136,0.08)' : 'transparent') + ';color:' + (f.isNewCustomer === false ? 'var(--accent)' : 'var(--text-muted)') + '"><i class="fas fa-users" style="margin-right:4px"></i>Existing Customer</button>' +
            '</div>' +
            (f.isNewCustomer === false
              ? // Existing customer dropdown
                '<select onchange="window._pb.selectCustomer(this.value)" style="width:100%;background:var(--bg-elevated);border:1px solid var(--border-color);border-radius:8px;padding:9px 10px;color:var(--text-primary);font-size:13px;margin-bottom:8px">' +
                  '<option value="">— Select a customer —</option>' +
                  custDropdownHtml +
                '</select>'
              : // New customer text fields
                '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
                  '<input id="dash-cust-name" type="text" value="' + (f.customer_name||'').replace(/"/g,'&quot;') + '" placeholder="Customer Name" oninput="window.__pbState.form.customer_name=this.value" style="background:var(--bg-elevated);border:1px solid var(--border-color);border-radius:8px;padding:8px;color:var(--text-primary);font-size:13px">' +
                  '<input id="dash-cust-email" type="email" value="' + (f.customer_email||'').replace(/"/g,'&quot;') + '" placeholder="Email" oninput="window.__pbState.form.customer_email=this.value" style="background:var(--bg-elevated);border:1px solid var(--border-color);border-radius:8px;padding:8px;color:var(--text-primary);font-size:13px">' +
                  '<input id="dash-cust-phone" type="tel" value="' + (f.customer_phone||'').replace(/"/g,'&quot;') + '" placeholder="Phone" oninput="window.__pbState.form.customer_phone=this.value" style="background:var(--bg-elevated);border:1px solid var(--border-color);border-radius:8px;padding:8px;color:var(--text-primary);font-size:13px">' +
                  '<input id="dash-cust-address" type="text" value="' + (f.property_address||'').replace(/"/g,'&quot;') + '" placeholder="Address" oninput="window.__pbState.form.property_address=this.value" style="background:var(--bg-elevated);border:1px solid var(--border-color);border-radius:8px;padding:8px;color:var(--text-primary);font-size:13px">' +
                '</div>'
            ) +
            '<textarea id="dash-scope" placeholder="Scope of work..." oninput="window.__pbState.form.scope_of_work=this.value" style="width:100%;margin-top:8px;background:var(--bg-elevated);border:1px solid var(--border-color);border-radius:8px;padding:8px;color:var(--text-primary);font-size:13px;height:60px;resize:vertical">' + (f.scope_of_work||'') + '</textarea>' +
          '</div>' +

          // Certifications
          '<div style="background:var(--bg-card);border:1px solid var(--border-color);border-radius:12px;padding:16px">' +
            '<h4 style="color:var(--text-primary);font-size:14px;font-weight:700;margin-bottom:12px"><i class="fas fa-shield-alt" style="color:var(--accent);margin-right:6px"></i>Certifications</h4>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
              '<input id="dash-insurance" value="' + (state.attachments.insuranceCert||'') + '" placeholder="Insurance Cert #" style="background:var(--bg-elevated);border:1px solid var(--border-color);border-radius:8px;padding:8px;color:var(--text-primary);font-size:13px">' +
              '<input id="dash-warranty" value="' + (state.attachments.warrantyDoc||'') + '" placeholder="Warranty Document" style="background:var(--bg-elevated);border:1px solid var(--border-color);border-radius:8px;padding:8px;color:var(--text-primary);font-size:13px">' +
              '<input id="dash-wcb" value="' + (state.attachments.wcbCoverage||'') + '" placeholder="WCB Coverage #" style="background:var(--bg-elevated);border:1px solid var(--border-color);border-radius:8px;padding:8px;color:var(--text-primary);font-size:13px">' +
              '<input id="dash-custom" value="' + (state.attachments.customAttachment||'') + '" placeholder="Custom Cert" style="background:var(--bg-elevated);border:1px solid var(--border-color);border-radius:8px;padding:8px;color:var(--text-primary);font-size:13px">' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      // STICKY ACTION BAR at bottom
      '<div style="position:sticky;bottom:0;background:var(--bg-card);border:1px solid var(--border-color);border-radius:12px;padding:16px;margin-top:20px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">' +
        '<div style="display:flex;gap:8px">' +
          '<button onclick="window._pb.saveDraft()" style="background:var(--bg-elevated);color:var(--text-secondary);border:1px solid var(--border-color);padding:10px 20px;border-radius:8px;font-weight:600;font-size:13px;cursor:pointer"><i class="fas fa-save" style="margin-right:6px"></i>Save Draft</button>' +
          '<button onclick="window._pb.previewProposal()" style="background:var(--bg-elevated);color:var(--text-secondary);border:1px solid var(--border-color);padding:10px 20px;border-radius:8px;font-weight:600;font-size:13px;cursor:pointer"><i class="fas fa-eye" style="margin-right:6px"></i>Preview</button>' +
        '</div>' +
        '<div style="display:flex;gap:8px">' +
          '<button onclick="window._pb.saveAndCreateSupplierOrder()" style="background:#0ea5e9;color:white;border:none;padding:10px 20px;border-radius:8px;font-weight:600;font-size:13px;cursor:pointer"><i class="fas fa-truck" style="margin-right:6px"></i>Supplier Order PDF</button>' +
          '<button onclick="window._pb.downloadCustomerPDF()" style="background:var(--bg-elevated);color:var(--text-secondary);border:1px solid var(--border-color);padding:10px 20px;border-radius:8px;font-weight:600;font-size:13px;cursor:pointer"><i class="fas fa-download" style="margin-right:6px"></i>Customer PDF</button>' +
          '<button onclick="window._pb.collectDashboardAndSend()" style="background:var(--accent);color:#0a0a0a;border:none;padding:10px 24px;border-radius:8px;font-weight:800;font-size:13px;cursor:pointer"><i class="fas fa-paper-plane" style="margin-right:6px"></i>Send to Customer</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  // ============================================================
  // LIST VIEW
  // ============================================================
  function renderGmailConnectBanner() {
    const gm = state.gmailStatus;
    if (gm && gm.ready) {
      return `<div class="rounded-xl border border-emerald-200 p-3 mb-5 flex items-center gap-2 bg-white">
        <i class="fas fa-check-circle text-emerald-500"></i>
        <span class="text-emerald-600 text-sm font-medium">Gmail Connected${gm.sender_email ? ' — ' + gm.sender_email : ''}</span>
        <span class="text-xs text-gray-400">— Proposals will be sent from your Gmail account</span>
      </div>`;
    }
    return `<div class="rounded-xl border border-amber-200 p-4 mb-5 flex items-center justify-between bg-white">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 bg-amber-50 rounded-lg flex items-center justify-center"><i class="fab fa-google text-amber-500 text-lg"></i></div>
        <div>
          <div class="font-semibold text-sm text-gray-800">Connect Gmail to Send Proposals</div>
          <div class="text-xs text-gray-500">Link your Gmail account so proposals are delivered from your address</div>
        </div>
      </div>
      <a href="${gm ? (gm.authorize_url || '/api/auth/gmail') : '/api/auth/gmail'}" class="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-semibold transition-colors">
        <i class="fab fa-google mr-1.5"></i>Connect Gmail
      </a>
    </div>`;
  }

  function renderList() {
    const allProposals = state.proposals;
    const filter = state.filter || 'all';
    const searchTerm = (state.searchTerm || '').toLowerCase();
    let proposals = allProposals;
    if (filter !== 'all') proposals = proposals.filter(p => p.status === filter || (filter === 'active' && ['sent','viewed'].includes(p.status)));
    if (searchTerm) proposals = proposals.filter(p =>
      (p.invoice_number || '').toLowerCase().includes(searchTerm) ||
      (p.customer_name || '').toLowerCase().includes(searchTerm) ||
      (p.customer_company || '').toLowerCase().includes(searchTerm)
    );
    const stats = {
      total: allProposals.length,
      draft: allProposals.filter(p => p.status === 'draft').length,
      sent: allProposals.filter(p => p.status === 'sent' || p.status === 'viewed').length,
      accepted: allProposals.filter(p => p.status === 'accepted').length,
      declined: allProposals.filter(p => p.status === 'declined').length,
      paid: allProposals.filter(p => p.status === 'paid').length,
      totalValue: allProposals.reduce((s, p) => s + (p.total || 0), 0)
    };

    return `
    <div class="mb-6 flex items-center justify-between">
      <div>
        <h2 class="text-2xl font-bold text-gray-900"><i class="fas fa-file-signature text-brand-500 mr-2"></i>Proposals & Estimates</h2>
        <p class="text-gray-500 text-sm mt-1">Create professional roofing proposals with detailed line items</p>
      </div>
      <div class="flex gap-2">
        <button onclick="window._pb.showSupplierOrders()" class="px-4 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-xl font-semibold text-sm hover:bg-gray-50 transition-all">
          <i class="fas fa-truck mr-1.5"></i>Supplier Orders
        </button>
        <button onclick="window._pb.create()" class="px-5 py-2.5 bg-gradient-to-r from-sky-500 to-blue-600 text-white rounded-xl font-semibold text-sm hover:shadow-lg transition-all">
          <i class="fas fa-plus mr-1.5"></i>New Proposal
        </button>
      </div>
    </div>

    <!-- Gmail Connect Banner -->
    ${renderGmailConnectBanner()}

    <!-- Certificate Automation — Quick Toggle + Link to Full Page -->
    <div class="bg-white rounded-xl border border-gray-200 mb-5 overflow-hidden">
      <div class="p-4 flex items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <div style="width:40px;height:40px;border-radius:10px;background:#f0fdf4;display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <i class="fas fa-certificate" style="color:#16a34a;font-size:18px"></i>
          </div>
          <div>
            <p class="text-sm font-semibold text-gray-900">Auto-Send Certificate of Installation</p>
            <p class="text-xs text-gray-500 mt-0.5">Automatically email a professional certificate when customers sign — for insurance documentation</p>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <button onclick="window._pb.toggleAutoSendCertificate()" class="flex-shrink-0 relative inline-flex items-center h-6 rounded-full w-11 transition-colors focus:outline-none ${state.autoSendCertificate ? 'bg-green-500' : 'bg-gray-200'}" title="${state.autoSendCertificate ? 'Automation ON — click to disable' : 'Click to enable auto-send'}">
            <span class="inline-block w-4 h-4 transform rounded-full bg-white shadow transition-transform ${state.autoSendCertificate ? 'translate-x-6' : 'translate-x-1'}"></span>
          </button>
        </div>
      </div>
      <div style="border-top:1px solid #f1f5f9;background:#fafafa;padding:12px 20px;display:flex;align-items:center;justify-content:space-between">
        <p class="text-xs text-gray-500"><i class="fas fa-palette mr-1"></i>Choose from 4 templates, customize colors, fonts & branding</p>
        <a href="/customer/certificate-automations" class="px-4 py-2 text-xs font-semibold rounded-lg bg-gray-900 text-white hover:bg-gray-700 transition-all">
          <i class="fas fa-arrow-right mr-1.5"></i>Open Certificate Designer
        </a>
      </div>
    </div>

    <!-- Stats -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <div class="bg-white rounded-xl p-4 border border-gray-200"><p class="text-xs text-gray-500">Total Proposals</p><p class="text-2xl font-bold text-gray-900">${stats.total}</p></div>
      <div class="bg-white rounded-xl p-4 border border-gray-200"><p class="text-xs text-gray-500">Drafts</p><p class="text-2xl font-bold text-emerald-500">${stats.draft}</p></div>
      <div class="bg-white rounded-xl p-4 border border-gray-200"><p class="text-xs text-gray-500">Sent / Viewed</p><p class="text-2xl font-bold text-blue-600">${stats.sent}</p></div>
      <div class="bg-white rounded-xl p-4 border border-gray-200"><p class="text-xs text-gray-500">Total Value</p><p class="text-2xl font-bold text-green-600">$${stats.totalValue.toFixed(2)}</p></div>
    </div>

    <!-- Proposals Table -->
    <div class="bg-white rounded-xl border border-gray-200 p-3 mb-4 flex items-center gap-3 flex-wrap">
      <div class="relative flex-1 min-w-[200px]">
        <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
        <input type="text" placeholder="Search proposals..." value="${searchTerm}"
          oninput="window._pb.setSearch(this.value)"
          class="w-full pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none">
      </div>
      <div class="flex gap-1 flex-wrap">
        <button onclick="window._pb.setFilter('all')" class="px-3 py-1.5 rounded-lg text-xs font-medium ${filter === 'all' ? 'bg-gray-100 text-gray-700 ring-1 ring-gray-300' : 'text-gray-500 hover:bg-gray-100'}">All ${stats.total}</button>
        <button onclick="window._pb.setFilter('draft')" class="px-3 py-1.5 rounded-lg text-xs font-medium ${filter === 'draft' ? 'bg-emerald-100 text-emerald-600 ring-1 ring-emerald-300' : 'text-gray-500 hover:bg-gray-100'}">Draft ${stats.draft}</button>
        <button onclick="window._pb.setFilter('active')" class="px-3 py-1.5 rounded-lg text-xs font-medium ${filter === 'active' ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-300' : 'text-gray-500 hover:bg-gray-100'}">Active ${stats.sent}</button>
        <button onclick="window._pb.setFilter('accepted')" class="px-3 py-1.5 rounded-lg text-xs font-medium ${filter === 'accepted' ? 'bg-green-100 text-green-700 ring-1 ring-green-300' : 'text-gray-500 hover:bg-gray-100'}">Accepted ${stats.accepted}</button>
        <button onclick="window._pb.setFilter('declined')" class="px-3 py-1.5 rounded-lg text-xs font-medium ${filter === 'declined' ? 'bg-red-100 text-red-700 ring-1 ring-red-300' : 'text-gray-500 hover:bg-gray-100'}">Declined ${stats.declined}</button>
      </div>
    </div>

    <div class="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
      ${proposals.length === 0 ? `
        <div class="py-16 text-center">
          <i class="fas fa-file-signature text-gray-300 text-5xl mb-4"></i>
          <p class="text-gray-500 font-medium">No proposals yet</p>
          <p class="text-gray-400 text-sm mt-1">Create your first professional roofing proposal</p>
          <button onclick="window._pb.create()" class="mt-4 px-5 py-2 bg-brand-500 text-white rounded-lg text-sm font-medium hover:bg-brand-600">Create Proposal</button>
        </div>
      ` : `
        <table class="w-full text-sm">
          <thead class="bg-gray-50 border-b border-gray-200">
            <tr>
              <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Number</th>
              <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Customer</th>
              <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Date</th>
              <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Total</th>
              <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
              <th class="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            ${proposals.map(p => {
              const sc = { draft: 'bg-gray-100 text-gray-700', sent: 'bg-blue-100 text-blue-700', viewed: 'bg-indigo-100 text-indigo-700', accepted: 'bg-green-100 text-green-700', declined: 'bg-red-100 text-red-700', paid: 'bg-green-100 text-green-700', overdue: 'bg-red-100 text-red-700', cancelled: 'bg-gray-100 text-gray-500' }[p.status] || 'bg-gray-100 text-gray-600';
              return `<tr class="hover:bg-gray-50">
                <td class="px-4 py-3 font-mono text-xs font-medium">${p.invoice_number}</td>
                <td class="px-4 py-3">${p.customer_name || 'Unknown'}<br><span class="text-xs text-gray-400">${p.customer_company || ''}</span></td>
                <td class="px-4 py-3 text-gray-500">${(p.created_at || '').slice(0, 10)}</td>
                <td class="px-4 py-3 font-semibold">$${(p.total || 0).toFixed(2)}</td>
                <td class="px-4 py-3"><span class="px-2 py-0.5 rounded-full text-xs font-medium ${sc}">${p.status}</span>${p.viewed_count > 0 ? '<span class="text-[10px] text-gray-500 ml-2" title="Viewed ' + p.viewed_count + ' times"><i class="fas fa-eye text-gray-600"></i> ' + p.viewed_count + '</span>' : ''}</td>
                <td class="px-4 py-3 text-right" style="white-space:nowrap">
                  ${p.share_token ? `<a href="/proposal/view/${p.share_token}" target="_blank" style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0;border-radius:6px;font-size:11px;font-weight:600;text-decoration:none;margin-right:4px" title="Preview as customer"><i class="fas fa-eye"></i> Preview</a>` : ''}
                  ${p.status === 'accepted' ? `
                    <a href="/api/invoices/${p.id}/certificate" target="_blank" style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;background:#fefce8;color:#713f12;border:1px solid #fde68a;border-radius:6px;font-size:11px;font-weight:600;text-decoration:none;margin-right:4px" title="View Certificate of Installation"><i class="fas fa-certificate"></i> Certificate</a>
                    <button onclick="window._pb.sendCertificate(${p.id})" style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;background:#f0fdf4;color:#166534;border:1px solid #86efac;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;margin-right:4px;border-width:1px" title="${p.certificate_sent_at ? 'Certificate sent ' + (p.certificate_sent_at || '').slice(0,10) + ' — click to resend' : 'Send certificate to customer'}"><i class="fas fa-paper-plane"></i>${p.certificate_sent_at ? ' Resend' : ' Send Cert'}</button>
                    ${p.certificate_sent_at ? `<span style="font-size:10px;color:#16a34a;margin-right:4px" title="Certificate sent ${(p.certificate_sent_at||'').slice(0,10)}"><i class="fas fa-check-circle"></i> Sent</span>` : ''}
                  ` : ''}
                  ${p.status === 'draft' ? `<button onclick="window._pb.edit(${p.id})" class="text-gray-500 hover:text-gray-700 text-xs mr-2" title="Edit"><i class="fas fa-edit"></i></button>` : ''}
                  <button onclick="window._pb.send(${p.id})" class="text-green-500 hover:text-green-700 text-xs mr-2" title="Send"><i class="fas fa-paper-plane"></i></button>
                  <button onclick="window._pb.shareLink(${p.id}, '${p.share_token || ''}')" class="text-purple-500 hover:text-purple-700 text-xs mr-2" title="Share Link"><i class="fas fa-link"></i></button>
                  <button onclick="window._pb.convertToInvoice(${p.id})" class="text-emerald-500 hover:text-emerald-600 text-xs mr-2" title="Convert to Invoice"><i class="fas fa-file-invoice-dollar"></i></button>
                  ${p.status === 'draft' ? `<button onclick="window._pb.del(${p.id})" class="text-red-400 hover:text-red-600 text-xs" title="Delete"><i class="fas fa-trash"></i></button>` : ''}
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      `}
    </div>`;
  }

  // ============================================================
  // SUPPLIER ORDERS VIEW
  // ============================================================
  function renderSupplierOrders() {
    var orders = state.supplierOrdersList || [];
    return `
    <div class="mb-6 flex items-center justify-between">
      <div>
        <h2 class="text-2xl font-bold text-gray-900"><i class="fas fa-truck text-blue-500 mr-2"></i>Supplier Material Orders</h2>
        <p class="text-gray-500 text-sm mt-1">Material orders generated from your proposals — print or email to your supplier</p>
      </div>
      <button onclick="window._pb.backToList()" class="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-xl font-semibold text-sm hover:bg-gray-50">
        <i class="fas fa-arrow-left mr-1.5"></i>Back to Proposals
      </button>
    </div>

    ${orders.length === 0 ? `
      <div class="bg-white rounded-xl border border-gray-200 py-16 text-center">
        <i class="fas fa-truck text-gray-300 text-5xl mb-4"></i>
        <p class="text-gray-500 font-medium">No supplier orders yet</p>
        <p class="text-gray-400 text-sm mt-1">When you create a proposal and generate a supplier order, it will appear here</p>
      </div>
    ` : `
      <div class="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <table class="w-full text-sm">
          <thead>
            <tr class="bg-gray-50 border-b border-gray-200">
              <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Order #</th>
              <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Supplier</th>
              <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Job Address</th>
              <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Customer</th>
              <th class="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Total</th>
              <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
              <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Date</th>
              <th class="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${orders.map(function(o) {
              var statusColor = o.status === 'sent' ? 'text-green-600 bg-green-50' : o.status === 'draft' ? 'text-emerald-500 bg-emerald-50' : 'text-gray-600 bg-gray-50';
              return '<tr class="border-b border-gray-100 hover:bg-gray-50">' +
                '<td class="px-4 py-3 font-medium text-gray-900">' + (o.order_number || '—') + '</td>' +
                '<td class="px-4 py-3 text-gray-700">' + (o.supplier_name || 'N/A') + '</td>' +
                '<td class="px-4 py-3 text-gray-600 text-xs">' + (o.job_address || '—') + '</td>' +
                '<td class="px-4 py-3 text-gray-600">' + (o.customer_name || '—') + '</td>' +
                '<td class="px-4 py-3 text-right font-semibold text-gray-900">$' + Number(o.total_amount || 0).toFixed(2) + '</td>' +
                '<td class="px-4 py-3"><span class="px-2 py-1 rounded-full text-xs font-semibold ' + statusColor + '">' + (o.status || 'draft') + '</span></td>' +
                '<td class="px-4 py-3 text-gray-500 text-xs">' + (o.created_at || '').slice(0, 10) + '</td>' +
                '<td class="px-4 py-3 text-right">' +
                  '<button onclick="window.open(\'/api/crm/supplier-orders/' + o.id + '/print\',\'_blank\')" class="px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-xs font-semibold hover:bg-blue-100 mr-1"><i class="fas fa-print mr-1"></i>Print</button>' +
                  '<button onclick="window.open(\'/api/crm/supplier-orders/' + o.id + '/print\',\'_blank\')" class="px-3 py-1.5 bg-gray-50 text-gray-600 rounded-lg text-xs font-semibold hover:bg-gray-100"><i class="fas fa-download mr-1"></i>PDF</button>' +
                '</td>' +
              '</tr>';
            }).join('')}
          </tbody>
        </table>
      </div>
    `}

    <!-- Supplier Info Card -->
    ${state.suppliers.length > 0 ? `
      <div class="mt-6 bg-white rounded-xl border border-gray-200 p-5">
        <h3 class="text-sm font-semibold text-gray-900 mb-3"><i class="fas fa-store text-blue-500 mr-2"></i>Your Preferred Supplier</h3>
        <div class="grid md:grid-cols-3 gap-4 text-sm">
          <div>
            <span class="text-gray-500">Name:</span>
            <span class="text-gray-900 font-medium ml-2">${state.suppliers[0].name || '—'}</span>
            ${state.suppliers[0].branch_name ? '<br><span class="text-gray-500">Branch:</span><span class="text-gray-700 ml-2">' + state.suppliers[0].branch_name + '</span>' : ''}
            ${state.suppliers[0].account_number ? '<br><span class="text-gray-500">Account #:</span><span class="text-gray-700 ml-2">' + state.suppliers[0].account_number + '</span>' : ''}
          </div>
          <div>
            ${state.suppliers[0].address ? '<span class="text-gray-500">Address:</span><span class="text-gray-700 ml-2">' + state.suppliers[0].address + '</span><br>' : ''}
            ${state.suppliers[0].city ? '<span class="text-gray-700">' + state.suppliers[0].city + ', ' + (state.suppliers[0].province || '') + '</span><br>' : ''}
            ${state.suppliers[0].phone ? '<span class="text-gray-500">Phone:</span><span class="text-gray-700 ml-2">' + state.suppliers[0].phone + '</span>' : ''}
          </div>
          <div>
            ${state.suppliers[0].rep_name ? '<span class="text-gray-500">Rep:</span><span class="text-gray-700 ml-2">' + state.suppliers[0].rep_name + '</span><br>' : ''}
            ${state.suppliers[0].rep_phone ? '<span class="text-gray-500">Rep Phone:</span><span class="text-gray-700 ml-2">' + state.suppliers[0].rep_phone + '</span><br>' : ''}
            ${state.suppliers[0].rep_email ? '<span class="text-gray-500">Rep Email:</span><span class="text-gray-700 ml-2">' + state.suppliers[0].rep_email + '</span>' : ''}
          </div>
        </div>
      </div>
    ` : ''}
    `;
  }

  // ============================================================
  // EDITOR VIEW
  // ============================================================
  function renderEditor() {
    const f = state.form;
    const isEdit = state.mode === 'edit';

    return `
    <div class="mb-4 flex items-center justify-between">
      <button onclick="window._pb.backToList()" class="text-gray-500 hover:text-gray-700 text-sm"><i class="fas fa-arrow-left mr-1"></i>Back to Proposals</button>
      <div class="flex gap-2">
        <button onclick="window._pb.saveDraft()" class="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-300"><i class="fas fa-save mr-1"></i>Save Draft</button>
        <button onclick="window._pb.previewCurrent()" class="px-4 py-2 bg-brand-500 text-white rounded-lg text-sm font-medium hover:bg-brand-600"><i class="fas fa-eye mr-1"></i>Preview</button>
      </div>
    </div>

    <!-- Proposal Header -->
    <div class="bg-white rounded-xl border border-gray-200 p-6 mb-6">
      <h3 class="text-lg font-bold text-gray-900 mb-4"><i class="fas fa-file-signature text-brand-500 mr-2"></i>${isEdit ? 'Edit' : 'New'} Proposal</h3>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label class="block text-xs font-semibold text-gray-500 mb-1">Proposal Number</label>
          <input type="text" id="pb-number" value="${f.proposal_number}" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-gray-50" readonly>
        </div>
        <div>
          <label class="block text-xs font-semibold text-gray-500 mb-1">Created Date</label>
          <input type="date" id="pb-date" value="${f.created_date}" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
        </div>
        <div>
          <label class="block text-xs font-semibold text-gray-500 mb-1">Valid Until</label>
          <input type="date" id="pb-valid" value="${f.valid_until}" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
        </div>
      </div>
    </div>

    <!-- Customer Selection -->
    <div class="bg-white rounded-xl border border-gray-200 p-6 mb-6">
      <h3 class="text-lg font-bold text-gray-900 mb-4"><i class="fas fa-user text-brand-500 mr-2"></i>Customer</h3>
      <div class="flex items-center gap-4 mb-4">
        <label class="flex items-center gap-2 cursor-pointer">
          <input type="radio" name="custMode" value="existing" ${!f.isNewCustomer ? 'checked' : ''} onchange="window._pb.toggleCustMode(false)">
          <span class="text-sm font-medium">Existing Customer</span>
        </label>
        <label class="flex items-center gap-2 cursor-pointer">
          <input type="radio" name="custMode" value="new" ${f.isNewCustomer ? 'checked' : ''} onchange="window._pb.toggleCustMode(true)">
          <span class="text-sm font-medium">New Customer</span>
        </label>
      </div>
      ${!f.isNewCustomer ? `
        <select id="pb-customer" onchange="window._pb.selectCustomer(this.value)" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
          <option value="">Select a customer...</option>
          ${(() => {
            const portal = state.customers.filter(c => c.source !== 'crm');
            const crm = state.customers.filter(c => c.source === 'crm');
            let html = '';
            if (portal.length) {
              html += '<optgroup label="Portal Customers">' +
                portal.map(c => `<option value="${c.id}" ${f.customer_id == c.id ? 'selected' : ''}>${c.name || c.email}${c.company_name ? ' (' + c.company_name + ')' : ''}</option>`).join('') +
                '</optgroup>';
            }
            if (crm.length) {
              html += '<optgroup label="My CRM Contacts">' +
                crm.map(c => `<option value="crm:${c.id}" ${f.crm_customer_id == c.id ? 'selected' : ''}>${c.name || c.email}${c.company_name ? ' (' + c.company_name + ')' : ''}</option>`).join('') +
                '</optgroup>';
            }
            return html;
          })()}
        </select>
      ` : `
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><label class="block text-xs font-semibold text-gray-500 mb-1">Name *</label><input type="text" id="pb-nc-name" value="${f.newCustomer.name}" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="John Smith"></div>
          <div><label class="block text-xs font-semibold text-gray-500 mb-1">Email *</label><input type="email" id="pb-nc-email" value="${f.newCustomer.email}" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="john@example.com"></div>
          <div><label class="block text-xs font-semibold text-gray-500 mb-1">Phone</label><input type="tel" id="pb-nc-phone" value="${f.newCustomer.phone}" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="(780) 555-1234"></div>
          <div><label class="block text-xs font-semibold text-gray-500 mb-1">Company</label><input type="text" id="pb-nc-company" value="${f.newCustomer.company_name}" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="Smith Roofing Ltd."></div>
          <div class="md:col-span-2"><label class="block text-xs font-semibold text-gray-500 mb-1">Address</label><input type="text" id="pb-nc-address" value="${f.newCustomer.address}" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="123 Main St, Edmonton, AB"></div>
        </div>
      `}
    </div>

    <!-- Scope of Work -->
    <div class="bg-white rounded-xl border border-gray-200 p-6 mb-6">
      <h3 class="text-lg font-bold text-gray-900 mb-4"><i class="fas fa-clipboard-list text-brand-500 mr-2"></i>Scope of Work</h3>
      <textarea id="pb-scope" rows="5" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="Describe the scope of work for this roofing proposal...">${f.scope_of_work}</textarea>
    </div>

    <!-- Attach Roof Report -->
    <div class="bg-white rounded-xl border border-gray-200 p-6 mb-6">
      <h3 class="text-lg font-bold text-gray-900 mb-4"><i class="fas fa-file-pdf text-brand-500 mr-2"></i>Attach Roof Report</h3>
      <select id="pb-report" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" onchange="window._pb.selectReport(this.value)">
        <option value="">No report attached</option>
        ${state.reports.map(r => `<option value="${r.id}" ${f.attached_report_id == r.id ? 'selected' : ''}>${r.property_address || 'Report #' + r.id} — ${(r.created_at || '').slice(0, 10)}</option>`).join('')}
      </select>
      <p class="text-xs text-gray-400 mt-2"><i class="fas fa-info-circle mr-1"></i>Attach a completed roof measurement report to this proposal. The report will be viewable by the customer.</p>
    </div>

    <!-- Header Color -->
    <div class="bg-white rounded-xl border border-gray-200 p-6 mb-6">
      <h3 class="text-lg font-bold text-gray-900 mb-4"><i class="fas fa-palette text-brand-500 mr-2"></i>Proposal Header Color</h3>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        ${['#0ea5e9','#2563eb','#7c3aed','#16a34a','#dc2626','#f97316','#0d9488','#1e293b'].map(c => {
          const isSel = (state.accentColor || '#0ea5e9') === c;
          return `<button onclick="window.__pbState.accentColor='${c}';window.__pbRender()" title="${c}" style="width:28px;height:28px;border-radius:50%;background:${c};border:${isSel ? '3px solid white;box-shadow:0 0 0 2px ' + c : '2px solid transparent'};cursor:pointer;transition:all 0.15s"></button>`;
        }).join('')}
        <input type="color" value="${state.accentColor || '#0ea5e9'}" oninput="window.__pbState.accentColor=this.value;window.__pbRender()" title="Custom color" style="width:28px;height:28px;border:1px solid #d1d5db;border-radius:50%;cursor:pointer;padding:2px;background:none">
        <div style="width:48px;height:28px;border-radius:6px;background:${state.accentColor || '#0ea5e9'};display:flex;align-items:center;justify-content:center"><span style="color:white;font-size:9px;font-weight:700">Preview</span></div>
      </div>
    </div>

    <!-- Per Square Pricing (if selected) -->
    ${state.pricingMethod === 'per_square' ?
      '<div class="bg-white rounded-xl border border-gray-200 p-6 mb-6">' +
        '<h3 class="text-lg font-bold text-gray-900 mb-4"><i class="fas fa-th text-brand-500 mr-2"></i>Per Square Pricing</h3>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;text-align:center">' +
          (function() {
            var edSq = state.manualSquares !== null ? state.manualSquares : (state.selectedReport ? Math.ceil((state.selectedReport.roof_area_sqft || 0) / 100) : 0);
            return '<div style="background:white;border:1px solid #e5e7eb;border-radius:8px;padding:16px"><div style="color:#6b7280;font-size:11px;text-transform:uppercase;margin-bottom:4px">Roof Squares</div><input type="number" value="' + edSq + '" oninput="window.__pbState.manualSquares=Number(this.value)||0;window._pb.updatePerSquare()" style="width:100%;background:transparent;border:none;border-bottom:2px solid #1a1a2e;color:#1a1a2e;font-size:28px;font-weight:800;text-align:center;padding:0" min="0" step="0.5"></div>' +
              '<div style="background:white;border:1px solid #e5e7eb;border-radius:8px;padding:16px"><div style="color:#6b7280;font-size:11px;text-transform:uppercase;margin-bottom:4px">Your Cost Per Square</div><div>$<input id="pps-price" type="number" value="' + (state.pricePerSquare || 350) + '" oninput="window.__pbState.pricePerSquare=Number(this.value);window._pb.updatePerSquare()" style="width:80px;background:transparent;border:none;border-bottom:2px solid #2563eb;color:#1a1a2e;font-size:28px;font-weight:800;text-align:center" min="0" step="0.01"></div></div>' +
              '<div style="background:#eef2ff;border:1px solid #c7d2fe;border-radius:8px;padding:16px"><div style="color:#2563eb;font-size:11px;text-transform:uppercase;margin-bottom:4px">Total Estimate</div><div style="color:#2563eb;font-size:28px;font-weight:800">$' + (edSq * (state.pricePerSquare || 350)).toLocaleString() + '</div></div>';
          })() +
        '</div>' +
      '</div>'
    : ''}

    <!-- Line Items -->
    <div class="bg-white rounded-xl border border-gray-200 p-6 mb-6">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-lg font-bold text-gray-900"><i class="fas fa-list text-brand-500 mr-2"></i>Line Items</h3>
        <div class="flex items-center gap-2">
          <button onclick="window._pb.addItem()" class="px-3 py-1.5 bg-brand-50 text-brand-600 rounded-lg text-xs font-medium hover:bg-brand-100"><i class="fas fa-plus mr-1"></i>Add Row</button>
          <button onclick="window._pb.addSectionHeader()" class="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-200"><i class="fas fa-heading mr-1"></i>Section</button>
          <div style="position:relative">
            <button onclick="window._pb.toggleLibrary()" class="px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg text-xs font-medium hover:bg-indigo-100"><i class="fas fa-book-open mr-1"></i>Library</button>
            <div id="pb-lib-picker" style="display:none;position:absolute;right:0;top:calc(100% + 6px);width:310px;background:white;border:1px solid #e5e7eb;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.12);z-index:200;overflow:hidden">
              <div style="padding:10px 12px;border-bottom:1px solid #f3f4f6;display:flex;align-items:center;justify-content:space-between">
                <span style="font-size:12px;font-weight:700;color:#374151">Saved Line Items</span>
                <button onclick="window._pb.openNewLibraryItemModal();event.stopPropagation()" style="font-size:11px;color:#4f46e5;background:#eef2ff;border:none;cursor:pointer;font-weight:600;padding:3px 8px;border-radius:4px">+ New Item</button>
              </div>
              <div style="max-height:240px;overflow-y:auto">
                ${state.itemLibrary.length === 0
                  ? '<div style="padding:20px;text-align:center;color:#9ca3af;font-size:13px">No saved items yet.<br><span style="font-size:12px">Click <strong>+ New Item</strong> to add one.</span></div>'
                  : state.itemLibrary.map((item, li) => '<div onclick="window._pb.addFromLibrary(' + li + ');event.stopPropagation()" style="padding:10px 12px;cursor:pointer;border-bottom:1px solid #f9fafb" onmouseover="this.style.background=\'#f5f3ff\'" onmouseout="this.style.background=\'\'"><div style="font-size:13px;font-weight:600;color:#1f2937">' + item.name + '</div><div style="font-size:11px;color:#9ca3af;margin-top:2px">' + (item.category || 'general') + ' &middot; ' + (item.default_unit || 'each') + ' &middot; $' + parseFloat(item.default_unit_price||0).toFixed(2) + '</div></div>').join('')
                }
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-3 py-2 text-left text-xs font-semibold text-gray-500 w-2/5">Description</th>
              <th class="px-3 py-2 text-center text-xs font-semibold text-gray-500 w-16">Qty</th>
              <th class="px-3 py-2 text-center text-xs font-semibold text-gray-500 w-20">Unit</th>
              <th class="px-3 py-2 text-right text-xs font-semibold text-gray-500 w-24">Your Cost</th>
              <th class="px-3 py-2 text-right text-xs font-semibold text-gray-500 w-24">Amount</th>
              <th class="px-3 py-2 text-center text-xs font-semibold text-gray-500 w-12">Tax</th>
              <th class="px-3 py-2 w-10"></th>
            </tr>
          </thead>
          <tbody id="pb-items-body">
            ${f.items.map((item, i) => renderItemRow(item, i)).join('')}
          </tbody>
        </table>
      </div>

      <!-- Summary -->
      <div class="mt-4 border-t border-gray-200 pt-4">
        <div class="flex justify-end">
          <div class="w-72 space-y-2">
            <div class="flex justify-between text-sm"><span class="text-gray-500">Subtotal</span><span class="font-medium" id="pb-subtotal">$${calcSubtotal().toFixed(2)}</span></div>
            <div class="flex justify-between text-sm items-center gap-2">
              <span class="text-gray-500">Discount</span>
              <div class="flex items-center gap-1">
                <select id="pb-disc-type" onchange="window._pb.updateDiscount()" class="border border-gray-300 rounded px-1 py-0.5 text-xs">
                  <option value="fixed" ${f.discount_type === 'fixed' ? 'selected' : ''}>$</option>
                  <option value="percentage" ${f.discount_type === 'percentage' ? 'selected' : ''}>%</option>
                </select>
                <input type="number" id="pb-discount" value="${f.discount_amount}" onchange="window._pb.updateDiscount()" class="border border-gray-300 rounded px-2 py-0.5 text-xs w-20 text-right" step="0.01">
              </div>
            </div>
            <div class="flex justify-between text-sm"><span class="text-gray-500">Tax (${f.tax_rate}% GST)</span><span id="pb-tax">$${calcTax().toFixed(2)}</span></div>
            <div class="flex justify-between text-lg font-bold border-t border-gray-200 pt-2"><span>Total (CAD)</span><span class="text-green-600" id="pb-total">$${calcTotal().toFixed(2)}</span></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Warranty & Payment Terms -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
      <div class="bg-white rounded-xl border border-gray-200 p-6">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-lg font-bold text-gray-900"><i class="fas fa-shield-alt text-brand-500 mr-2"></i>Warranty Terms</h3>
          <button onclick="window._pb.templateWarranty()" class="text-xs text-brand-500 hover:text-brand-700"><i class="fas fa-magic mr-1"></i>Template</button>
        </div>
        <textarea id="pb-warranty" rows="4" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">${f.warranty_terms}</textarea>
      </div>
      <div class="bg-white rounded-xl border border-gray-200 p-6">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-lg font-bold text-gray-900"><i class="fas fa-money-check-alt text-brand-500 mr-2"></i>Payment Terms</h3>
          <button onclick="window._pb.templatePayment()" class="text-xs text-brand-500 hover:text-brand-700"><i class="fas fa-magic mr-1"></i>Template</button>
        </div>
        <textarea id="pb-payment" rows="4" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">${f.payment_terms_text}</textarea>
      </div>
    </div>

    <!-- Attachments & Certifications -->
    <div class="bg-white rounded-xl border border-gray-200 p-6 mb-6">
      <h3 class="text-lg font-bold text-gray-900 mb-4"><i class="fas fa-paperclip text-purple-500 mr-2"></i>Proposal Attachments & Certifications</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <label style="display:flex;align-items:center;gap:8px;color:#374151;font-size:13px;cursor:pointer;padding:10px;background:#f3f4f6;border-radius:8px"><input type="checkbox" id="att-report" ${state.attachments.includeRoofReport ? 'checked' : ''} onchange="window.__pbState.attachments.includeRoofReport=this.checked"> Include Roof Report with Proposal</label>
        <label style="display:flex;align-items:center;gap:8px;color:#374151;font-size:13px;cursor:pointer;padding:10px;background:#f3f4f6;border-radius:8px"><input type="checkbox" id="att-bom" ${state.attachments.includeMaterialBOM ? 'checked' : ''} onchange="window.__pbState.attachments.includeMaterialBOM=this.checked"> Include Material BOM with Proposal</label>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
        <div><label class="block text-xs font-semibold text-gray-500 mb-1"><i class="fas fa-shield-alt text-green-500 mr-1"></i>Insurance Certificate #</label><input id="att-insurance" value="${state.attachments.insuranceCert || ''}" onchange="window.__pbState.attachments.insuranceCert=this.value" placeholder="e.g. INS-2026-12345" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"></div>
        <div><label class="block text-xs font-semibold text-gray-500 mb-1"><i class="fas fa-file-contract text-cyan-500 mr-1"></i>Warranty Document</label><input id="att-warranty" value="${state.attachments.warrantyDoc || ''}" onchange="window.__pbState.attachments.warrantyDoc=this.value" placeholder="e.g. 10-Year Manufacturer Warranty" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"></div>
        <div><label class="block text-xs font-semibold text-gray-500 mb-1"><i class="fas fa-hard-hat text-emerald-500 mr-1"></i>WCB Coverage #</label><input id="att-wcb" value="${state.attachments.wcbCoverage || ''}" onchange="window.__pbState.attachments.wcbCoverage=this.value" placeholder="e.g. WCB-AB-987654" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"></div>
        <div><label class="block text-xs font-semibold text-gray-500 mb-1"><i class="fas fa-plus-circle text-purple-500 mr-1"></i>Custom Attachment</label><input id="att-custom" value="${state.attachments.customAttachment || ''}" onchange="window.__pbState.attachments.customAttachment=this.value" placeholder="e.g. Business License, BBB Accreditation" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"></div>
      </div>
    </div>

    <!-- Notes -->
    <div class="bg-white rounded-xl border border-gray-200 p-6 mb-6">
      <h3 class="text-lg font-bold text-gray-900 mb-3"><i class="fas fa-sticky-note text-brand-500 mr-2"></i>Additional Notes</h3>
      <textarea id="pb-notes" rows="3" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="Any additional notes for the customer...">${f.notes}</textarea>
    </div>

    <!-- Actions -->
    <div class="flex justify-end gap-3 mb-8">
      <button onclick="window._pb.backToList()" class="px-5 py-2.5 bg-gray-200 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-300">Cancel</button>
      <button onclick="window._pb.saveDraft()" class="px-5 py-2.5 bg-gray-700 text-white rounded-xl text-sm font-medium hover:bg-gray-800"><i class="fas fa-save mr-1"></i>Save Draft</button>
      <button onclick="window._pb.saveAndSend()" class="px-5 py-2.5 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-xl text-sm font-medium hover:shadow-lg"><i class="fas fa-paper-plane mr-1"></i>Save & Send</button>
    </div>`;
  }

  function renderItemRow(item, i) {
    if (item._isHeader) {
      return `<tr style="background:#f8fafc;border-bottom:2px solid #e5e7eb">
        <td colspan="6" class="px-2 py-1.5">
          <input type="text" value="${item.description || ''}" onchange="window._pb.updateItem(${i},'description',this.value)" style="width:100%;background:transparent;border:none;outline:none;font-size:13px;font-weight:700;color:#374151;letter-spacing:0.03em;text-transform:uppercase" placeholder="SECTION NAME (e.g. MATERIALS, LABOUR)">
        </td>
        <td class="px-2 py-1 text-center"><button onclick="window._pb.removeItem(${i})" class="text-red-300 hover:text-red-500 text-xs"><i class="fas fa-times"></i></button></td>
      </tr>`;
    }
    const amt = (item.quantity || 0) * (item.unit_price || 0);
    return `<tr class="border-b border-gray-100">
      <td class="px-2 py-1"><input type="text" value="${item.description || ''}" onchange="window._pb.updateItem(${i},'description',this.value)" class="w-full border border-gray-200 rounded px-2 py-1.5 text-sm" placeholder="Shingle installation"></td>
      <td class="px-2 py-1"><input type="number" value="${item.quantity}" onchange="window._pb.updateItem(${i},'quantity',this.value)" class="w-full border border-gray-200 rounded px-2 py-1.5 text-sm text-center" min="0" step="0.01"></td>
      <td class="px-2 py-1"><select onchange="window._pb.updateItem(${i},'unit',this.value)" class="w-full border border-gray-200 rounded px-1 py-1.5 text-xs">
        ${['each','pcs','sq ft','m²','sq','LF','m','bundle','roll','box','hour','day','lot'].map(u => `<option value="${u}" ${item.unit === u ? 'selected' : ''}>${u}</option>`).join('')}
      </select></td>
      <td class="px-2 py-1"><input type="number" value="${item.unit_price}" onchange="window._pb.updateItem(${i},'unit_price',this.value)" class="w-full border border-gray-200 rounded px-2 py-1.5 text-sm text-right" min="0" step="0.01"></td>
      <td class="px-2 py-1 text-right font-medium text-sm">$${amt.toFixed(2)}</td>
      <td class="px-2 py-1 text-center"><input type="checkbox" ${item.is_taxable ? 'checked' : ''} onchange="window._pb.updateItem(${i},'is_taxable',this.checked)"></td>
      <td class="px-2 py-1"><button onclick="window._pb.removeItem(${i})" class="text-red-400 hover:text-red-600 text-xs ${state.form.items.length <= 1 ? 'invisible' : ''}"><i class="fas fa-times"></i></button></td>
    </tr>`;
  }

  // renderPricingEngine removed — merged into dashboard

  // ============================================================
  // PREVIEW VIEW
  // ============================================================
  function renderPreview() {
    const f = state.form;
    const cust = f.isNewCustomer ? f.newCustomer : state.customers.find(c => c.id == f.customer_id) || {};
    const sub = calcSubtotal();
    const disc = calcDiscountAmount();
    const tax = calcTax();
    const total = calcTotal();

    return `
    <div class="mb-4 flex items-center justify-between print:hidden">
      <button onclick="window._pb.backToEditor()" class="text-gray-500 hover:text-gray-700 text-sm"><i class="fas fa-arrow-left mr-1"></i>Back to Editor</button>
      <div class="flex gap-2 flex-wrap">
        <button onclick="window.print()" class="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-300"><i class="fas fa-print mr-1"></i>Print</button>
        <button onclick="window._pb.saveDraft()" class="px-4 py-2 bg-gray-700 text-white rounded-lg text-sm font-medium hover:bg-gray-800"><i class="fas fa-save mr-1"></i>Save Draft</button>
        <button onclick="window._pb.saveAndSend()" class="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700"><i class="fas fa-paper-plane mr-1"></i>Save &amp; Send</button>
      </div>
    </div>

    <div style="background:linear-gradient(135deg,#eef2ff,#e0e7ff);border:1px solid #c7d2fe;border-radius:12px;padding:16px;margin-bottom:20px;display:flex;align-items:center;justify-content:space-between;max-width:56rem;margin-left:auto;margin-right:auto" class="no-print">
      <div style="display:flex;align-items:center;gap:8px"><i class="fas fa-lock" style="color:#2563eb"></i><span style="color:#2563eb;font-weight:700;font-size:13px">For Your Eyes Only — Not shown to customer</span></div>
      <div style="display:flex;gap:20px;font-size:13px">
        <span style="color:#6b7280">Your Cost: <strong style="color:#dc2626">$${(state.form.items||[]).reduce(function(s,i){return s+Number(i.quantity||0)*Number(i.unit_price||0)},0).toFixed(2)}</strong></span>
        <span style="color:#6b7280">Customer Price: <strong style="color:#1a1a2e">$${(function(){ var tc=(state.form.items||[]).reduce(function(s,i){return s+Number(i.quantity||0)*Number(i.unit_price||0)},0); return state.pricingEngineMode==="per_square_customer"&&state.selectedReport ? (Math.ceil((state.selectedReport.roof_area_sqft||0)/100)*(state.customerPricePerSquare||0)).toFixed(2) : (tc*(1+(state.markupPercent||30)/100)).toFixed(2); })()}</strong></span>
        <span style="color:#16a34a;font-weight:700">Profit: $${(function(){ var tc=(state.form.items||[]).reduce(function(s,i){return s+Number(i.quantity||0)*Number(i.unit_price||0)},0); var cp=state.pricingEngineMode==="per_square_customer"&&state.selectedReport ? Math.ceil((state.selectedReport.roof_area_sqft||0)/100)*(state.customerPricePerSquare||0) : tc*(1+(state.markupPercent||30)/100); return (cp-tc).toFixed(2); })()}</span>
      </div>
    </div>

    <div class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden max-w-4xl mx-auto print:shadow-none print:border-none">
      ${state.form.company_logo_url ? '<div style="text-align:center;padding:24px 24px 0"><img src="' + state.form.company_logo_url + '" style="max-height:60px;max-width:200px;object-fit:contain" onerror="this.style.display=\'none\'"></div>' : ''}
      <h1 style="text-align:center;color:#1a1a2e;font-size:22px;font-weight:800;margin:16px 0 8px">${state.form.proposal_title || 'Roof Replacement Proposal'}</h1>
      ${state.form.proposal_description ? '<p style="text-align:center;color:#6b7280;font-size:13px;max-width:500px;margin:0 auto 20px;line-height:1.6">' + state.form.proposal_description + '</p>' : ''}
      <!-- Header -->
      <div style="background:${state.accentColor||'#0ea5e9'}" class="text-white p-8">
        <div class="flex justify-between items-start">
          <div>
            <div class="flex items-center gap-3 mb-2">
              <div class="w-10 h-10 rounded-lg flex items-center justify-center" style="background:rgba(255,255,255,0.2)"><i class="fas fa-home text-white text-lg"></i></div>
              <div><h1 class="text-xl font-bold">Roof Manager</h1><p class="text-xs" style="color:rgba(255,255,255,0.75)">Professional Roof Measurement Reports</p></div>
            </div>
            <p class="text-sm" style="color:rgba(255,255,255,0.75)">Alberta, Canada</p>
            <p class="text-xs" style="color:rgba(255,255,255,0.75)">sales@roofmanager.ca</p>
          </div>
          <div class="text-right">
            <h2 class="text-2xl font-bold">PROPOSAL</h2>
            <p class="text-sm mt-1" style="color:rgba(255,255,255,0.75)">${f.proposal_number}</p>
            <p class="text-xs mt-2" style="color:rgba(255,255,255,0.75)">Date: ${f.created_date}</p>
            <p class="text-xs" style="color:rgba(255,255,255,0.75)">Valid Until: ${f.valid_until}</p>
          </div>
        </div>
      </div>

      <!-- Customer Info -->
      <div class="p-8 border-b border-gray-200">
        <h3 class="text-xs font-semibold text-gray-500 uppercase mb-2">Prepared For</h3>
        <p class="font-bold text-gray-900">${cust.name || cust.email || 'Customer'}</p>
        ${cust.company_name ? `<p class="text-gray-600 text-sm">${cust.company_name}</p>` : ''}
        ${cust.address || cust.customer_address ? `<p class="text-gray-500 text-sm">${cust.address || cust.customer_address}</p>` : ''}
        ${cust.phone || cust.customer_phone ? `<p class="text-gray-500 text-sm">${cust.phone || cust.customer_phone}</p>` : ''}
        ${cust.email || cust.customer_email ? `<p class="text-gray-500 text-sm">${cust.email || cust.customer_email}</p>` : ''}
      </div>

      ${f.scope_of_work ? `
      <div class="p-8 border-b border-gray-200">
        <h3 class="text-xs font-semibold text-gray-500 uppercase mb-2">Scope of Work</h3>
        <div class="text-gray-700 text-sm whitespace-pre-wrap">${f.scope_of_work}</div>
      </div>` : ''}

      ${(function() {
        var r = state.selectedReport;
        if (!r) return '';
        var sections = '';
        var m = r.materials || {};
        var es = r.edge_summary || {};
        var accentColor = state.accentColor || '#0ea5e9';

        // Page 1: Project Summary & Satellite Image
        if (state.showAreaToCustomer) {
          var satUrl = (r.imagery && (r.imagery.satellite_overhead_url || r.imagery.satellite_url)) || r.satellite_image_url || '';
          var propAddr = r.property_address || (r.property && r.property.address) || '';
          sections += '<div class="p-8 border-b border-gray-200">' +
            '<h3 class="text-xs font-semibold text-gray-500 uppercase mb-4"><i class="fas fa-satellite-dish mr-1"></i>Roof Measurement Summary</h3>' +
            (propAddr ? '<p class="text-sm text-gray-600 mb-4"><i class="fas fa-map-marker-alt mr-1 text-gray-400"></i>' + propAddr + '</p>' : '') +
            (satUrl ? '<img src="' + satUrl + '" alt="Satellite roof view" style="width:100%;max-height:320px;object-fit:cover;border-radius:12px;margin-bottom:16px;border:1px solid #e5e7eb" onerror="this.style.display=\'none\'">' : '') +
            '<div class="grid grid-cols-2 sm:grid-cols-4 gap-3">' +
              '<div class="text-center p-4 rounded-xl bg-gray-50 border border-gray-100"><p class="text-2xl font-black text-gray-800">' + Math.round(r.total_true_area_sqft||0) + '</p><p class="text-xs text-gray-500 mt-1">True Area (sq ft)</p></div>' +
              '<div class="text-center p-4 rounded-xl bg-gray-50 border border-gray-100"><p class="text-2xl font-black text-gray-800">' + (r.roof_pitch_ratio||'—') + '</p><p class="text-xs text-gray-500 mt-1">Roof Pitch</p></div>' +
              '<div class="text-center p-4 rounded-xl bg-gray-50 border border-gray-100"><p class="text-2xl font-black text-gray-800">' + (m.gross_squares ? m.gross_squares.toFixed(1) : '—') + '</p><p class="text-xs text-gray-500 mt-1">Squares</p></div>' +
              '<div class="text-center p-4 rounded-xl bg-gray-50 border border-gray-100"><p class="text-xl font-black text-gray-800 capitalize">' + (m.complexity_class||'—') + '</p><p class="text-xs text-gray-500 mt-1">Complexity</p></div>' +
            '</div>' +
          '</div>';
        }

        // Page 2: Edge Measurements
        if (state.showPitchToCustomer && (es.total_ridge_ft || es.total_eave_ft)) {
          sections += '<div class="p-8 border-b border-gray-200">' +
            '<h3 class="text-xs font-semibold text-gray-500 uppercase mb-4"><i class="fas fa-ruler-combined mr-1"></i>Roof Edge Measurements</h3>' +
            '<div class="grid grid-cols-3 sm:grid-cols-5 gap-3">' +
              [['Ridge', es.total_ridge_ft], ['Hip', es.total_hip_ft], ['Valley', es.total_valley_ft], ['Eave', es.total_eave_ft], ['Rake', es.total_rake_ft]].map(function(e) {
                return '<div class="text-center p-3 rounded-xl bg-gray-50 border border-gray-100"><p class="text-lg font-bold text-gray-800">' + Math.round(e[1]||0) + ' ft</p><p class="text-xs text-gray-500">' + e[0] + '</p></div>';
              }).join('') +
            '</div>' +
          '</div>';
        }

        // Page 3: Material Take-Off
        if (state.showMaterialsToCustomer && m.line_items && m.line_items.length) {
          var matRows = m.line_items.slice(0, 10).map(function(item) {
            return '<tr class="border-b border-gray-100"><td class="py-2 px-3 text-sm text-gray-700">' + (item.description||item.category||'') + '</td><td class="py-2 px-3 text-center text-sm font-semibold">' + (item.order_quantity||0) + '</td><td class="py-2 px-3 text-center text-sm text-gray-500">' + (item.order_unit||'') + '</td></tr>';
          }).join('');
          sections += '<div class="p-8 border-b border-gray-200">' +
            '<h3 class="text-xs font-semibold text-gray-500 uppercase mb-4"><i class="fas fa-boxes mr-1"></i>Material Take-Off</h3>' +
            '<table class="w-full text-sm"><thead><tr class="bg-gray-50"><th class="py-2 px-3 text-left font-semibold text-gray-600 text-xs uppercase">Material</th><th class="py-2 px-3 text-center font-semibold text-gray-600 text-xs uppercase">Qty</th><th class="py-2 px-3 text-center font-semibold text-gray-600 text-xs uppercase">Unit</th></tr></thead><tbody>' + matRows + '</tbody></table>' +
          '</div>';
        }

        // Page 4: Edge Breakdown Details
        if (state.showEdgesToCustomer && r.edges && r.edges.length) {
          var edgeRows = r.edges.slice(0, 8).map(function(e) {
            return '<tr class="border-b border-gray-100"><td class="py-2 px-3 text-sm text-gray-700 capitalize">' + (e.type||'edge') + '</td><td class="py-2 px-3 text-center text-sm font-semibold">' + Math.round(e.length_ft||0) + ' ft</td><td class="py-2 px-3 text-center text-sm text-gray-500">' + (e.pitch||'') + '</td></tr>';
          }).join('');
          sections += '<div class="p-8 border-b border-gray-200">' +
            '<h3 class="text-xs font-semibold text-gray-500 uppercase mb-4"><i class="fas fa-draw-polygon mr-1"></i>Edge Breakdown</h3>' +
            '<table class="w-full text-sm"><thead><tr class="bg-gray-50"><th class="py-2 px-3 text-left font-semibold text-gray-600 text-xs uppercase">Type</th><th class="py-2 px-3 text-center font-semibold text-gray-600 text-xs uppercase">Length</th><th class="py-2 px-3 text-center font-semibold text-gray-600 text-xs uppercase">Pitch</th></tr></thead><tbody>' + edgeRows + '</tbody></table>' +
          '</div>';
        }

        // Page 5: Quality / Validation
        if (state.showSolarToCustomer) {
          sections += '<div class="p-8 border-b border-gray-200">' +
            '<h3 class="text-xs font-semibold text-gray-500 uppercase mb-4"><i class="fas fa-shield-check mr-1"></i>Quality & Validation</h3>' +
            '<div class="grid grid-cols-1 sm:grid-cols-3 gap-3">' +
              '<div class="p-4 rounded-xl border border-gray-100 bg-gray-50 flex items-center gap-3"><i class="fas fa-satellite" style="color:' + accentColor + '"></i><div><p class="text-sm font-semibold text-gray-800">Satellite Verified</p><p class="text-xs text-gray-500">GPS-accurate measurements</p></div></div>' +
              '<div class="p-4 rounded-xl border border-gray-100 bg-gray-50 flex items-center gap-3"><i class="fas fa-brain" style="color:' + accentColor + '"></i><div><p class="text-sm font-semibold text-gray-800">AI-Enhanced</p><p class="text-xs text-gray-500">Machine learning validation</p></div></div>' +
              '<div class="p-4 rounded-xl border border-gray-100 bg-gray-50 flex items-center gap-3"><i class="fas fa-certificate" style="color:' + accentColor + '"></i><div><p class="text-sm font-semibold text-gray-800">Professional Grade</p><p class="text-xs text-gray-500">Industry-standard accuracy</p></div></div>' +
            '</div>' +
          '</div>';
        }

        return sections;
      })()}

      <!-- Line Items -->
      <div class="p-8 border-b border-gray-200">
        <table class="w-full text-sm">
          <thead class="bg-gray-50 border-b-2 border-gray-200">
            <tr>
              <th class="px-4 py-2 text-left font-semibold text-gray-600">Description</th>
              <th class="px-4 py-2 text-center font-semibold text-gray-600">Qty</th>
              <th class="px-4 py-2 text-center font-semibold text-gray-600">Unit</th>
              <th class="px-4 py-2 text-right font-semibold text-gray-600">Price</th>
              <th class="px-4 py-2 text-right font-semibold text-gray-600">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${f.items.map(item => {
              if (item._isHeader) {
                return `<tr style="background:#f8fafc"><td colspan="5" style="padding:10px 16px;font-size:11px;font-weight:700;color:#6b7280;letter-spacing:0.08em;text-transform:uppercase;border-bottom:1px solid #e5e7eb">${item.description || ''}</td></tr>`;
              }
              var markupPct = state.markupPercent || 30;
              var custUnitPrice, custAmount;
              if (state.pricingEngineMode === 'per_square_customer') {
                // In per-square mode, the customer price is the per-square rate, not line item cost
                var squares = state.manualSquares !== null ? state.manualSquares : (state.selectedReport ? Math.ceil((state.selectedReport.roof_area_sqft || 0) / 100) : 1);
                var perSquareCustomerPrice = state.customerPricePerSquare || 0;
                custUnitPrice = perSquareCustomerPrice;
                custAmount = squares * perSquareCustomerPrice;
              } else {
                custUnitPrice = Number(item.unit_price || 0) * (1 + markupPct / 100);
                custAmount = Number(item.quantity || 0) * custUnitPrice;
              }
              var displayQty = state.pricingEngineMode === 'per_square_customer' ? squares : item.quantity;
              var displayUnit = state.pricingEngineMode === 'per_square_customer' ? 'sq' : item.unit;
              return `<tr class="border-b border-gray-100">
                <td class="px-4 py-2">${item.description || ''}</td>
                <td class="px-4 py-2 text-center">${displayQty}</td>
                <td class="px-4 py-2 text-center">${displayUnit}</td>
                <td class="px-4 py-2 text-right">$${custUnitPrice.toFixed(2)}</td>
                <td class="px-4 py-2 text-right font-medium">$${custAmount.toFixed(2)}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>

        ${(() => {
          var markupPct = state.markupPercent || 30;
          var costTotal = (state.form.items || []).reduce((s, i) => s + Number(i.quantity || 0) * Number(i.unit_price || 0), 0);
          var custSubtotal;
          if (state.pricingEngineMode === 'per_square_customer' && state.selectedReport) {
            custSubtotal = Math.ceil((state.selectedReport.roof_area_sqft || 0) / 100) * (state.customerPricePerSquare || 0);
          } else {
            custSubtotal = costTotal * (1 + markupPct / 100);
          }
          var custDisc = f.discount_type === 'percentage' ? custSubtotal * (f.discount_amount / 100) : (f.discount_amount || 0);
          var custTaxable = custSubtotal; // simplified — apply tax on full customer subtotal
          var custTax = Math.round((custSubtotal - custDisc) * (f.tax_rate / 100) * 100) / 100;
          var custTotal = Math.round((custSubtotal - custDisc + custTax) * 100) / 100;
          return `<div class="mt-4 flex justify-end">
          <div class="w-72 space-y-1">
            <div class="flex justify-between text-sm"><span class="text-gray-500">Subtotal</span><span>$${custSubtotal.toFixed(2)}</span></div>
            ${custDisc > 0 ? `<div class="flex justify-between text-sm text-red-600"><span>Discount</span><span>-$${custDisc.toFixed(2)}</span></div>` : ''}
            <div class="flex justify-between text-sm"><span class="text-gray-500">GST (${f.tax_rate}%)</span><span>$${custTax.toFixed(2)}</span></div>
            <div class="flex justify-between text-lg font-bold border-t-2 border-gray-300 pt-2 mt-1"><span>Total (CAD)</span><span class="text-green-600">$${custTotal.toFixed(2)}</span></div>
          </div>
        </div>`;
        })()}
      </div>

      ${f.warranty_terms ? `<div class="p-8 border-b border-gray-200"><h3 class="text-xs font-semibold text-gray-500 uppercase mb-2">Warranty Terms</h3><div class="text-gray-700 text-sm whitespace-pre-wrap">${f.warranty_terms}</div></div>` : ''}
      ${f.payment_terms_text ? `<div class="p-8 border-b border-gray-200"><h3 class="text-xs font-semibold text-gray-500 uppercase mb-2">Payment Terms</h3><div class="text-gray-700 text-sm whitespace-pre-wrap">${f.payment_terms_text}</div></div>` : ''}
      ${f.notes ? `<div class="p-8 border-b border-gray-200"><h3 class="text-xs font-semibold text-gray-500 uppercase mb-2">Notes</h3><div class="text-gray-700 text-sm whitespace-pre-wrap">${f.notes}</div></div>` : ''}

      ${state.attachments.insuranceCert || state.attachments.warrantyDoc || state.attachments.wcbCoverage || state.attachments.customAttachment ?
        '<div class="p-8" style="border-top:1px solid #e5e7eb">' +
          '<h3 class="text-xs font-semibold uppercase mb-3" style="color:#1a1a2e"><i class="fas fa-paperclip" style="color:#7c3aed;margin-right:4px"></i>Certifications & Documentation</h3>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
            (state.attachments.insuranceCert ? '<div style="background:#f8f9fa;padding:10px;border-radius:6px;font-size:12px"><span style="color:#6b7280">Insurance Certificate:</span> <span style="color:#1a1a2e;font-weight:600">' + state.attachments.insuranceCert + '</span></div>' : '') +
            (state.attachments.warrantyDoc ? '<div style="background:#f8f9fa;padding:10px;border-radius:6px;font-size:12px"><span style="color:#6b7280">Warranty:</span> <span style="color:#1a1a2e;font-weight:600">' + state.attachments.warrantyDoc + '</span></div>' : '') +
            (state.attachments.wcbCoverage ? '<div style="background:#f8f9fa;padding:10px;border-radius:6px;font-size:12px"><span style="color:#6b7280">WCB Coverage:</span> <span style="color:#1a1a2e;font-weight:600">' + state.attachments.wcbCoverage + '</span></div>' : '') +
            (state.attachments.customAttachment ? '<div style="background:#f8f9fa;padding:10px;border-radius:6px;font-size:12px"><span style="color:#6b7280">Additional:</span> <span style="color:#1a1a2e;font-weight:600">' + state.attachments.customAttachment + '</span></div>' : '') +
          '</div>' +
        '</div>'
      : ''}

      <div class="p-8 text-center text-gray-400 text-xs">
        <p>Thank you for considering our services. We look forward to working with you.</p>
        <p class="mt-1">Roof Manager | Professional Roof Measurement Reports | sales@roofmanager.ca</p>
      </div>
    </div>`;
  }

  // ============================================================
  // SUPPLIER SETUP & PREREQ CHECK
  // ============================================================
  function renderSupplierSetup() {
    return '<div style="max-width:600px;margin:0 auto;padding:20px">' +
      '<div style="background:white;border:1px solid #e5e7eb;border-radius:16px;padding:32px;box-shadow:0 4px 24px rgba(0,0,0,0.08)">' +
      '<h2 style="color:#1a1a2e;font-size:22px;font-weight:800;margin-bottom:8px"><i class="fas fa-store" style="color:#2563eb;margin-right:8px"></i>Set Up Your Supplier First</h2>' +
      '<p style="color:#6b7280;font-size:14px;margin-bottom:24px">Before creating proposals, set up your preferred material supplier so you can generate supplier orders with your estimates.</p>' +
      '<div style="display:grid;gap:16px">' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
          '<div><label style="display:block;color:#374151;font-size:12px;font-weight:600;margin-bottom:4px">Supplier Name *</label><input id="sup-name" placeholder="e.g. Roof Mart" style="width:100%;background:white;border:1px solid #d1d5db;border-radius:8px;padding:10px;color:#1a1a2e;font-size:14px"></div>' +
          '<div><label style="display:block;color:#374151;font-size:12px;font-weight:600;margin-bottom:4px">Branch Name</label><input id="sup-branch" placeholder="e.g. South Edmonton" style="width:100%;background:white;border:1px solid #d1d5db;border-radius:8px;padding:10px;color:#1a1a2e;font-size:14px"></div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
          '<div><label style="display:block;color:#374151;font-size:12px;font-weight:600;margin-bottom:4px">Account Number</label><input id="sup-account" placeholder="Your account #" style="width:100%;background:white;border:1px solid #d1d5db;border-radius:8px;padding:10px;color:#1a1a2e;font-size:14px"></div>' +
          '<div><label style="display:block;color:#374151;font-size:12px;font-weight:600;margin-bottom:4px">Store Address</label><input id="sup-address" placeholder="123 Supply Dr" style="width:100%;background:white;border:1px solid #d1d5db;border-radius:8px;padding:10px;color:#1a1a2e;font-size:14px"></div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
          '<div><label style="display:block;color:#374151;font-size:12px;font-weight:600;margin-bottom:4px">City</label><input id="sup-city" placeholder="Edmonton" style="width:100%;background:white;border:1px solid #d1d5db;border-radius:8px;padding:10px;color:#1a1a2e;font-size:14px"></div>' +
          '<div><label style="display:block;color:#374151;font-size:12px;font-weight:600;margin-bottom:4px">Province</label><input id="sup-province" placeholder="Alberta" style="width:100%;background:white;border:1px solid #d1d5db;border-radius:8px;padding:10px;color:#1a1a2e;font-size:14px"></div>' +
        '</div>' +
        '<h3 style="color:#1a1a2e;font-size:16px;font-weight:700;margin-top:8px"><i class="fas fa-user-tie" style="color:#2563eb;margin-right:6px"></i>Store Representative</h3>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">' +
          '<div><label style="display:block;color:#374151;font-size:12px;font-weight:600;margin-bottom:4px">Rep Name</label><input id="sup-rep-name" placeholder="John Smith" style="width:100%;background:white;border:1px solid #d1d5db;border-radius:8px;padding:10px;color:#1a1a2e;font-size:14px"></div>' +
          '<div><label style="display:block;color:#374151;font-size:12px;font-weight:600;margin-bottom:4px">Rep Phone</label><input id="sup-rep-phone" placeholder="780-555-1234" style="width:100%;background:white;border:1px solid #d1d5db;border-radius:8px;padding:10px;color:#1a1a2e;font-size:14px"></div>' +
          '<div><label style="display:block;color:#374151;font-size:12px;font-weight:600;margin-bottom:4px">Rep Email</label><input id="sup-rep-email" placeholder="john@roofmart.ca" style="width:100%;background:white;border:1px solid #d1d5db;border-radius:8px;padding:10px;color:#1a1a2e;font-size:14px"></div>' +
        '</div>' +
        '<div style="display:flex;gap:12px;margin-top:16px">' +
          '<button onclick="saveSupplier()" style="flex:1;background:#2563eb;color:white;border:none;padding:14px;border-radius:10px;font-weight:800;font-size:15px;cursor:pointer">Save Supplier & Continue</button>' +
          (state.suppliers.length > 0 ? '<button onclick="window.__pbState.showNewSupplierForm=false;window.__pbRender()" style="flex:0.5;background:transparent;color:#9ca3af;border:1px solid #374151;padding:14px;border-radius:10px;font-weight:600;font-size:14px;cursor:pointer">Cancel</button>' : '<button onclick="window.skipSupplier()" style="flex:0.5;background:transparent;color:#9ca3af;border:1px solid #374151;padding:14px;border-radius:10px;font-weight:600;font-size:14px;cursor:pointer">Skip for Now</button>') +
          '</div>' +
          (state.suppliers.length === 0 ? '<p style="color:#9ca3af;font-size:12px;text-align:center;margin-top:8px">Set up a supplier to generate material orders with your proposals</p>' : '') +
          '<div style="display:none">' + // hidden placeholder
        '</div>' +
      '</div>' +
    '</div></div>';
  }

  async function checkPrereqs() {
    try {
      var supRes = await fetch('/api/crm/suppliers', { headers: headers() });
      if (supRes.ok) {
        var supData = await supRes.json();
        state.suppliers = supData?.suppliers || [];
        state.supplierSetup = state.suppliers.length > 0;
      }
    } catch (e) { console.warn('Supplier prereq check failed', e); }

    // Load catalog
    try {
      var catRes = await fetch('/api/crm/catalog', { headers: headers() });
      if (catRes.ok) {
        var catData = await catRes.json();
        state.catalog = catData.items || catData.catalog || [];
        state.catalogLoaded = true;
      }
    } catch (e) { console.warn('Catalog load failed', e); }

    render();
  }

  window.saveSupplier = async function() {
    var data = {
      name: document.getElementById('sup-name')?.value?.trim(),
      branch_name: document.getElementById('sup-branch')?.value?.trim(),
      account_number: document.getElementById('sup-account')?.value?.trim(),
      address: document.getElementById('sup-address')?.value?.trim(),
      city: document.getElementById('sup-city')?.value?.trim(),
      province: document.getElementById('sup-province')?.value?.trim(),
      rep_name: document.getElementById('sup-rep-name')?.value?.trim(),
      rep_phone: document.getElementById('sup-rep-phone')?.value?.trim(),
      rep_email: document.getElementById('sup-rep-email')?.value?.trim(),
      preferred: true
    };
    if (!data.name) { pbToast('Supplier name is required', 'error'); return; }
    try {
      var res = await fetch('/api/crm/suppliers', { method: 'POST', headers: headers(), body: JSON.stringify(data) });
      if (!res.ok) {
        pbToast('Failed to save supplier. Server returned error ' + res.status, 'error');
        return;
      }
      var result = await res.json();
      if (result?.success) {
        state.supplierSetup = true;
        state.suppliers.push(Object.assign({ id: result.supplier_id }, data));
        state.selectedSupplierIdx = state.suppliers.length - 1;
        state.showNewSupplierForm = false;
        pbToast('Supplier added!', 'success');
        render();
      } else {
        pbToast('Failed to save supplier: ' + (result?.error || 'Unknown error'), 'error');
      }
    } catch (e) { pbToast('Failed to save supplier', 'error'); }
  };

  window.skipSupplier = function() {
    state.supplierSetup = true;
    render();
  };

  window.createSupplierOrder = async function(proposalId) {
    var proposal = state.form;
    if (!proposal) return;

    var items;
    if (state.selectedReportMaterials) {
      var m = state.selectedReportMaterials;
      items = [];
      if (m.shingle_bundles) items.push({ description: 'Shingle Bundles (3-tab/Architectural)', quantity: m.shingle_bundles, unit: 'bundle', unit_price: 0 });
      if (m.underlayment_rolls) items.push({ description: 'Synthetic Underlayment', quantity: m.underlayment_rolls, unit: 'roll', unit_price: 0 });
      if (m.ridge_cap_bundles) items.push({ description: 'Ridge Cap Shingles', quantity: m.ridge_cap_bundles, unit: 'bundle', unit_price: 0 });
      if (m.ice_water_rolls) items.push({ description: 'Ice & Water Shield', quantity: m.ice_water_rolls, unit: 'roll', unit_price: 0 });
      if (m.drip_edge_pcs) items.push({ description: 'Drip Edge', quantity: m.drip_edge_pcs, unit: 'piece', unit_price: 0 });
      if (m.starter_strip_pcs) items.push({ description: 'Starter Strip', quantity: m.starter_strip_pcs, unit: 'piece', unit_price: 0 });
      if (m.nail_boxes) items.push({ description: 'Roofing Nails', quantity: m.nail_boxes, unit: 'box', unit_price: 0 });
      if (m.caulk_tubes) items.push({ description: 'Roofing Caulk/Sealant', quantity: m.caulk_tubes, unit: 'tube', unit_price: 0 });
      if (m.pipe_boots) items.push({ description: 'Pipe Boot Flashings', quantity: m.pipe_boots, unit: 'piece', unit_price: 0 });
      if (items.length === 0) {
        items = (state.form.items || []).map(function(item) {
          return { description: item.description, quantity: item.quantity, unit: item.unit || 'each', unit_price: item.unit_price || 0 };
        });
      }
    } else {
      items = (state.form.items || []).map(function(item) {
        return { description: item.description, quantity: item.quantity, unit: item.unit || 'each', unit_price: item.unit_price || 0 };
      });
    }

    var cust = proposal.isNewCustomer ? proposal.newCustomer : state.customers.find(function(c) { return c.id == proposal.customer_id; }) || {};

    var data = {
      proposal_id: proposalId || state.editId,
      supplier_id: state.suppliers.length > 0 ? state.suppliers[state.selectedSupplierIdx || 0].id : null,
      report_id: proposal.attached_report_id || null,
      job_address: cust.address || cust.customer_address || '',
      customer_name: cust.name || cust.email || '',
      items: items,
      notes: 'Material order for ' + (cust.address || cust.customer_address || 'job #' + (proposalId || state.editId))
    };

    try {
      var res = await fetch('/api/crm/supplier-orders', { method: 'POST', headers: headers(), body: JSON.stringify(data) });
      var result = await res.json();
      if (result?.success) {
        window.open('/api/crm/supplier-orders/' + result.order_id + '/print', '_blank');
        pbToast('Supplier order #' + result.order_number + ' created! Print window opened.', 'success');
      } else {
        pbToast('Failed to create supplier order: ' + (result?.error || 'Unknown error'), 'error');
      }
    } catch (e) { pbToast('Failed to create supplier order', 'error'); }
  };

  // ============================================================
  // CALCULATIONS
  // ============================================================
  function calcSubtotal() {
    return state.form.items.filter(i => !i._isHeader).reduce((s, i) => s + (i.quantity || 0) * (i.unit_price || 0), 0);
  }
  function calcDiscountAmount() {
    const f = state.form;
    const sub = calcSubtotal();
    return f.discount_type === 'percentage' ? sub * (f.discount_amount / 100) : (f.discount_amount || 0);
  }
  function calcTax() {
    const sub = calcSubtotal();
    const disc = calcDiscountAmount();
    const taxableItems = state.form.items.filter(i => !i._isHeader && i.is_taxable);
    const taxableSubtotal = taxableItems.reduce((s, i) => s + (i.quantity || 0) * (i.unit_price || 0), 0);
    const discRatio = sub > 0 ? (sub - disc) / sub : 1;
    return Math.round(taxableSubtotal * discRatio * (state.form.tax_rate / 100) * 100) / 100;
  }
  function calcTotal() {
    return Math.round((calcSubtotal() - calcDiscountAmount() + calcTax()) * 100) / 100;
  }
  function updateTotals() {
    const subEl = document.getElementById('pb-subtotal');
    const taxEl = document.getElementById('pb-tax');
    const totalEl = document.getElementById('pb-total');
    if (subEl) subEl.textContent = '$' + calcSubtotal().toFixed(2);
    if (taxEl) taxEl.textContent = '$' + calcTax().toFixed(2);
    if (totalEl) totalEl.textContent = '$' + calcTotal().toFixed(2);
  }

  // ============================================================
  // COLLECT FORM DATA
  // ============================================================
  function collectFormData() {
    const f = state.form;
    f.proposal_number = (document.getElementById('pb-number') || {}).value || f.proposal_number;
    f.created_date = (document.getElementById('pb-date') || {}).value || f.created_date;
    f.valid_until = (document.getElementById('pb-valid') || {}).value || f.valid_until;
    f.scope_of_work = (document.getElementById('pb-scope') || {}).value || '';
    f.warranty_terms = (document.getElementById('pb-warranty') || {}).value || '';
    f.payment_terms_text = (document.getElementById('pb-payment') || {}).value || '';
    f.notes = (document.getElementById('pb-notes') || {}).value || '';
    f.discount_type = (document.getElementById('pb-disc-type') || {}).value || 'fixed';
    f.discount_amount = parseFloat((document.getElementById('pb-discount') || {}).value) || 0;
    if (f.isNewCustomer) {
      f.newCustomer.name = (document.getElementById('pb-nc-name') || {}).value || '';
      f.newCustomer.email = (document.getElementById('pb-nc-email') || {}).value || '';
      f.newCustomer.phone = (document.getElementById('pb-nc-phone') || {}).value || '';
      f.newCustomer.company_name = (document.getElementById('pb-nc-company') || {}).value || '';
      f.newCustomer.address = (document.getElementById('pb-nc-address') || {}).value || '';
    }
    const reportSelect = document.getElementById('pb-report');
    if (reportSelect) f.attached_report_id = reportSelect.value || null;

    // Also collect step 3 fields if they exist in DOM
    var step3Name = document.getElementById('step3-name') || document.getElementById('dash-cust-name');
    if (step3Name) f.customer_name = step3Name.value || f.customer_name || '';
    var step3Email = document.getElementById('step3-email') || document.getElementById('dash-cust-email');
    if (step3Email) f.customer_email = step3Email.value || f.customer_email || '';
    var step3Phone = document.getElementById('step3-phone') || document.getElementById('dash-cust-phone');
    if (step3Phone) f.customer_phone = step3Phone.value || f.customer_phone || '';
    var step3Addr = document.getElementById('step3-address') || document.getElementById('dash-cust-address');
    if (step3Addr) f.property_address = step3Addr.value || f.property_address || '';

    // Capture per-square price from DOM if exists
    var ppsInput = document.getElementById('pps-price');
    if (ppsInput) state.pricePerSquare = Number(ppsInput.value) || state.pricePerSquare;

    return f;
  }

  // ============================================================
  // API ACTIONS
  // ============================================================
  async function saveProposal(andSend = false, silent = false) {
    // Collect from dashboard if we're on step 3, otherwise from editor
    if (state.createStep === 3 && typeof window._pb.collectDashboardData === 'function') {
      window._pb.collectDashboardData();
    }
    collectFormData();
    const f = state.form;

    // If coming from dashboard, use customer_name/email as new customer
    if (state.createStep === 3 && f.customer_name && !f.customer_id && !f.crm_customer_id) {
      f.isNewCustomer = true;
      f.newCustomer = { name: f.customer_name, email: f.customer_email || '', phone: f.customer_phone || '', address: f.property_address || '' };
    }

    // Validate
    if (!f.isNewCustomer && !f.customer_id && !f.crm_customer_id) { pbToast('Please select or enter a customer', 'error'); return; }
    if (f.isNewCustomer && (!f.newCustomer.name)) { pbToast('Customer name is required', 'error'); return; }
    // Auto-create line item from per-square pricing
    if (state.pricingMethod === 'per_square' && state.pricePerSquare > 0) {
      var squares = state.manualSquares !== null ? state.manualSquares : (state.selectedReport ? Math.ceil((state.selectedReport.roof_area_sqft || 0) / 100) : 0);
      if (squares > 0) {
        f.items = [{
          description: 'Roof Replacement — ' + squares + ' squares',
          quantity: squares,
          unit: 'sq',
          unit_price: state.pricingEngineMode === 'per_square_customer' ?
            (state.customerPricePerSquare || state.pricePerSquare) :
            Math.round(state.pricePerSquare * (1 + (state.markupPercent || 30) / 100) * 100) / 100,
          is_taxable: true
        }];
      }
    }

    if (!f.items.some(i => i.description)) { pbToast('Add at least one line item', 'error'); return; }

    try {
      // Resolve customer IDs — portal customers use customer_id, CRM contacts use crm_customer_id
      let portalCustomerId = f.customer_id || null;
      let crmCustomerId = f.crm_customer_id || null;
      if (f.isNewCustomer) {
        // Create a new CRM contact and use crm_customer_id
        const custRes = await fetch('/api/crm/customers', {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify(f.newCustomer)
        });
        if (custRes.ok) {
          const custData = await custRes.json();
          crmCustomerId = custData.id || custData.customer_id;
          portalCustomerId = null;
        } else {
          pbToast('Failed to create customer. Please try again.', 'error');
          return;
        }
      }

      const payload = {
        customer_id: crmCustomerId ? null : portalCustomerId,
        crm_customer_id: crmCustomerId || null,
        order_id: f.order_id || null,
        document_type: 'proposal',
        items: f.items.filter(i => i.description || i._isHeader).map(i => {
          if (i._isHeader) {
            return { description: i.description || '', quantity: 0, unit_price: 0, unit: 'each', is_taxable: false, category: '__section__' };
          }
          var costPrice = parseFloat(i.unit_price) || 0;
          var customerPrice;
          if (state.pricingEngineMode === 'per_square_customer') {
            customerPrice = costPrice; // Per-square mode: customer total is set separately, line items stay at cost
          } else {
            customerPrice = costPrice * (1 + (state.markupPercent || 30) / 100);
          }
          return {
            description: i.description,
            quantity: parseFloat(i.quantity) || 1,
            unit_price: Math.round(customerPrice * 100) / 100,
            unit: i.unit || 'each',
            is_taxable: i.is_taxable !== false,
            category: i.category || ''
          };
        }),
        tax_rate: f.tax_rate,
        discount_amount: calcDiscountAmount(),
        discount_type: f.discount_type || 'fixed',
        notes: f.notes,
        terms: f.payment_terms_text,
        scope_of_work: f.scope_of_work || '',
        warranty_terms: f.warranty_terms || '',
        payment_terms_text: f.payment_terms_text || '',
        valid_until: f.valid_until || '',
        attached_report_id: f.attached_report_id || null,
        due_days: 30,
        my_cost: state.myCost !== null ? state.myCost : null,
        accent_color: state.accentColor || '#0ea5e9',
        show_report_sections: {
          area: !!state.showAreaToCustomer,
          pitch: !!state.showPitchToCustomer,
          materials: !!state.showMaterialsToCustomer,
          edges: !!state.showEdgesToCustomer,
          solar: !!state.showSolarToCustomer,
          lineItems: !!state.showLineItemsToCustomer
        }
      };

      let res;
      if (state.editId) {
        // Update existing proposal
        res = await fetch('/api/invoices/' + state.editId, {
          method: 'PUT',
          headers: headers(),
          body: JSON.stringify(payload)
        });
      } else {
        res = await fetch('/api/invoices', {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify(payload)
        });
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        pbToast('Failed to save proposal: ' + (err.error || 'Unknown error'), 'error');
        return;
      }

      const data = await res.json();
      const proposalId = state.editId || data.invoice?.id;
      const shareUrl = data.invoice?.share_url || '';

      // silent=true means caller will handle state reset and UI (e.g. saveAndCreateSupplierOrder)
      if (silent) return proposalId;

      if (andSend && proposalId) {
        const sendRes = await fetch('/api/invoices/' + proposalId + '/send', {
          method: 'POST',
          headers: headers()
        });
        if (sendRes.ok) {
          const sendData = await sendRes.json();
          const link = sendData.share_url || shareUrl;
          if (link) {
            const fullUrl = window.location.origin + link;
            pbShareModal('Proposal Sent!', sendData.email_sent ? 'Email delivered to your customer. You can also share this link:' : 'Share this link with your customer:', fullUrl);
          } else {
            pbToast('Proposal saved and marked as sent!', 'success');
          }
        }
      } else if (shareUrl) {
        const fullUrl = window.location.origin + shareUrl;
        if (await window.rmConfirm('Proposal saved as draft!\n\nShareable link: ' + fullUrl + '\n\nCopy link to clipboard?')) {
          navigator.clipboard.writeText(fullUrl).catch(() => {});
        }
      } else {
        pbToast(andSend ? 'Proposal saved and marked as sent!' : 'Proposal saved as draft!', 'success');
      }
      pbClearDraft();
      state.mode = 'list';
      state.editId = null;
      state.form = resetForm();
      load();
    } catch (e) {
      pbToast('Error saving proposal: ' + e.message, 'error');
    }
  }

  // ============================================================
  // PROPOSAL TEMPLATES
  // ============================================================
  const PROPOSAL_TEMPLATES = [
    {
      id: 'standard_replacement',
      label: 'Standard Replacement',
      icon: 'fa-home',
      title: 'Roof Replacement Proposal',
      description: 'Thank you for the opportunity to provide this estimate for your roofing project. We are committed to delivering quality workmanship and materials.',
      scope: 'Complete removal and disposal of existing roofing system.\nInstallation of new roofing system including: synthetic underlayment, ice & water shield at eaves and valleys, drip edge, starter strips, architectural shingles, ridge cap, and all necessary flashings.\nAll work performed to manufacturer specifications and local building code.',
      warranty: 'All workmanship is warranted for a period of 5 years from the date of completion. Manufacturer warranties apply separately to all materials installed. This warranty covers defects in workmanship including but not limited to: improper installation, leaks resulting from installation errors, and flashing failures. Normal wear and tear, acts of God, and damage caused by third parties are excluded.',
      payment: 'A 30% deposit is required to schedule the work. 40% due at material delivery. Remaining 30% balance due upon satisfactory completion. Accepted payment methods: cheque, e-transfer, credit card. Late payments are subject to 2% monthly interest. All prices are in Canadian Dollars (CAD).'
    },
    {
      id: 'roof_repair',
      label: 'Roof Repair',
      icon: 'fa-tools',
      title: 'Roof Repair Proposal',
      description: 'We have assessed the damage to your roofing system and prepared this proposal for the necessary repairs.',
      scope: 'Targeted repair to affected area(s) as identified during site inspection.\nRemoval of damaged materials, installation of new underlayment and shingles to match existing roof system as closely as possible.\nRe-sealing of all flashings, pipe boots, and penetrations in the repair area.\nDebris removal and site cleanup.',
      warranty: 'All repair workmanship is warranted for 2 years from the date of completion. Warranty covers the repaired area only. Existing roof areas outside the repair zone are not covered under this warranty.',
      payment: '50% deposit required to schedule. Balance due upon completion. Payment accepted via cheque, e-transfer, or credit card.'
    },
    {
      id: 'insurance_claim',
      label: 'Insurance Claim',
      icon: 'fa-file-invoice',
      title: 'Insurance Roof Replacement Proposal',
      description: 'This proposal has been prepared in connection with an insurance claim for storm/hail damage to the roofing system. All work is performed to restore the roof to pre-loss condition.',
      scope: 'Complete removal and disposal of storm-damaged roofing system.\nInstallation of new roofing system to pre-loss condition or better, including all required materials per insurance scope of loss.\nDocumentation of all materials and labour for insurance purposes.\nWork performed to applicable building code and manufacturer installation requirements.',
      warranty: 'All workmanship is warranted for 5 years from the date of completion. Manufacturer warranties on materials apply as issued. This warranty is in addition to any obligations under the insurance claim.',
      payment: 'Payment terms subject to insurance claim approval. Deductible due at project start. Insurance proceeds payable directly or by assignment. Supplemental claims will be submitted for any additional damage discovered during work.'
    },
    {
      id: 'flat_tpo',
      label: 'Flat Roof / TPO',
      icon: 'fa-building',
      title: 'Commercial Flat Roof Replacement Proposal',
      description: 'We are pleased to provide this proposal for the installation of a new TPO/flat roof system on your commercial property.',
      scope: 'Removal and disposal of existing flat roofing membrane and insulation as applicable.\nInstallation of new TPO single-ply membrane roofing system, mechanically fastened or fully adhered as specified.\nIncludes: coverboard, insulation, TPO membrane, all flashings, terminations, and drain boots.\nWork performed to NRCA guidelines and manufacturer specifications.',
      warranty: 'Workmanship warranted for 5 years. NDL (No Dollar Limit) manufacturer warranty available upon request at additional cost. All penetrations and flashings warranted against leaks for the workmanship warranty period.',
      payment: '30% deposit to mobilize. 40% upon membrane completion. 30% upon final inspection and punch-list completion. Net 15 on final invoice. All prices in CAD.'
    },
    {
      id: 'inspection',
      label: 'Inspection',
      icon: 'fa-search',
      title: 'Roof Inspection & Assessment Report',
      description: 'This proposal covers a professional roof inspection and written assessment of the current condition of your roofing system.',
      scope: 'Full visual inspection of roofing system including field, eaves, rakes, ridges, valleys, flashings, penetrations, skylights, and gutters.\nPhotographic documentation of all observed conditions.\nWritten summary report with condition ratings and recommended actions.\nPriority ranking of repairs with estimated timelines.',
      warranty: 'Inspection findings represent conditions at time of inspection. This assessment is non-destructive and limited to visible components.',
      payment: 'Inspection fee due upon delivery of written report. Payment accepted via cheque, e-transfer, or credit card.'
    }
  ];

  // ============================================================
  // PUBLIC API
  // ============================================================
  window._pb = {
    async create() {
      pbClearDraft(); state.mode = 'create'; state.editId = null; state.form = resetForm();
      state.createStep = 1;  // Start at report selection
      state.pricingMethod = 'line_item';
      state.pricePerSquare = 350;
      state.selectedReport = null;
      state.selectedReportMaterials = null;
      state.markupPercent = 30;
      state.pricingEngineMode = 'markup';
      state.customerPricePerSquare = 0;
      state.showLineItemsToCustomer = false;
      state.customerPriceOverride = null;
      state.myCost = null;
      state.presetsApplied = false;
      state.accentColor = '#0ea5e9';
      state.showMaterialsToCustomer = false;
      state.showEdgesToCustomer = false;
      state.showSolarToCustomer = false;
      state.showPitchToCustomer = true;
      state.showAreaToCustomer = true;
      state.attachments = { includeRoofReport: true, includeMaterialBOM: true, insuranceCert: '', warrantyDoc: '', wcbCoverage: '', customAttachment: '' };
      state.loading = true; render();
      await checkPrereqs();
      state.loading = false;
      render();
    },
    backToList() { pbClearDraft(); state.mode = 'list'; state.editId = null; state.form = resetForm(); render(); },
    async showSupplierOrders() {
      state.loading = true; render();
      try {
        var res = await fetch('/api/crm/supplier-orders', { headers: headers() });
        var data = await res.json();
        state.supplierOrdersList = data.orders || [];
      } catch(e) { state.supplierOrdersList = []; }
      state.loading = false;
      state.mode = 'supplier-orders';
      render();
    },
    backToEditor() { window._pb.closePreview(); state.createStep = 3; state.mode = 'create'; render(); },
    setFilter(f) { state.filter = f; render(); },
    setSearch(term) { state.searchTerm = term; render(); },
    toggleCustMode(isNew) { state.form.isNewCustomer = isNew; render(); },
    selectCustomer(id) {
      if (!id) {
        state.form.customer_id = '';
        state.form.crm_customer_id = '';
        state.form.customer_name = '';
        state.form.customer_email = '';
        return;
      }
      if (id.toString().startsWith('crm:')) {
        var crmId = parseInt(id.toString().replace('crm:', ''));
        state.form.crm_customer_id = crmId;
        state.form.customer_id = '';
        var cust = state.customers.find(function(c) { return c.source === 'crm' && c.id == crmId; });
        if (cust) {
          state.form.customer_name = cust.name || cust.email || '';
          state.form.customer_email = cust.email || '';
          state.form.customer_phone = cust.phone || '';
        }
      } else {
        state.form.customer_id = id;
        state.form.crm_customer_id = '';
        var cust2 = state.customers.find(function(c) { return c.source !== 'crm' && c.id == id; });
        if (cust2) {
          state.form.customer_name = cust2.name || cust2.email || '';
          state.form.customer_email = cust2.email || '';
          state.form.customer_phone = cust2.phone || '';
        }
      }
    },
    addItem() {
      state.form.items.push({ description: '', quantity: 1, unit: 'sq ft', unit_price: 0, is_taxable: true, category: '' });
      render();
    },
    addSectionHeader() {
      state.form.items.push({ description: '', quantity: 0, unit_price: 0, unit: 'each', is_taxable: false, category: '__section__', _isHeader: true });
      render();
    },
    toggleLibrary() {
      const picker = document.getElementById('pb-lib-picker');
      if (!picker) return;
      picker.style.display = picker.style.display === 'none' ? 'block' : 'none';
    },
    addFromLibrary(li) {
      const item = state.itemLibrary[li];
      if (!item) return;
      state.form.items.push({ description: item.name + (item.description ? ' — ' + item.description : ''), quantity: parseFloat(item.default_quantity) || 1, unit: item.default_unit || 'each', unit_price: parseFloat(item.default_unit_price) || 0, is_taxable: item.is_taxable !== 0, category: item.category || '' });
      const picker = document.getElementById('pb-lib-picker');
      if (picker) picker.style.display = 'none';
      render();
    },
    openNewLibraryItemModal() {
      const picker = document.getElementById('pb-lib-picker');
      if (picker) picker.style.display = 'none';
      var overlay = document.createElement('div');
      overlay.id = 'pb-lib-modal';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center';
      overlay.innerHTML = '<div style="background:white;border-radius:16px;padding:28px;max-width:420px;width:90%;box-shadow:0 20px 40px rgba(0,0,0,0.2)">' +
        '<h3 style="font-size:16px;font-weight:700;color:#111;margin:0 0 16px">New Library Item</h3>' +
        '<div style="display:grid;gap:10px">' +
          '<div><label style="font-size:11px;font-weight:600;color:#6b7280;display:block;margin-bottom:3px">Item Name *</label><input id="lib-name" type="text" placeholder="e.g. Remove & Replace Shingles" style="width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:7px;font-size:13px;box-sizing:border-box"></div>' +
          '<div><label style="font-size:11px;font-weight:600;color:#6b7280;display:block;margin-bottom:3px">Description</label><input id="lib-desc" type="text" placeholder="Optional details" style="width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:7px;font-size:13px;box-sizing:border-box"></div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
            '<div><label style="font-size:11px;font-weight:600;color:#6b7280;display:block;margin-bottom:3px">Category</label><select id="lib-cat" style="width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:7px;font-size:13px"><option value="roofing">Roofing</option><option value="materials">Materials</option><option value="labour">Labour</option><option value="permits">Permits</option><option value="disposal">Disposal</option><option value="other">Other</option></select></div>' +
            '<div><label style="font-size:11px;font-weight:600;color:#6b7280;display:block;margin-bottom:3px">Unit</label><select id="lib-unit" style="width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:7px;font-size:13px"><option>each</option><option>pcs</option><option>sq ft</option><option>m²</option><option>sq</option><option>LF</option><option>m</option><option>bundle</option><option>roll</option><option>box</option><option>hour</option><option>day</option><option>lot</option></select></div>' +
          '</div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
            '<div><label style="font-size:11px;font-weight:600;color:#6b7280;display:block;margin-bottom:3px">Default Price ($)</label><input id="lib-price" type="number" value="0" min="0" step="0.01" style="width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:7px;font-size:13px;box-sizing:border-box"></div>' +
            '<div><label style="font-size:11px;font-weight:600;color:#6b7280;display:block;margin-bottom:3px">Default Qty</label><input id="lib-qty" type="number" value="1" min="0" step="0.01" style="width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:7px;font-size:13px;box-sizing:border-box"></div>' +
          '</div>' +
          '<label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#374151;cursor:pointer"><input id="lib-tax" type="checkbox" checked> Taxable</label>' +
        '</div>' +
        '<div style="display:flex;gap:8px;margin-top:18px">' +
          '<button onclick="document.getElementById(\'pb-lib-modal\').remove()" style="flex:1;padding:9px;background:#f3f4f6;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;color:#374151">Cancel</button>' +
          '<button onclick="window._pb.saveNewLibraryItem()" style="flex:2;padding:9px;background:#4f46e5;color:white;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">Save to Library</button>' +
        '</div>' +
      '</div>';
      document.body.appendChild(overlay);
      overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
      var nameInput = overlay.querySelector('#lib-name');
      if (nameInput) nameInput.focus();
    },
    async saveNewLibraryItem() {
      const name = (document.getElementById('lib-name') || {}).value?.trim();
      if (!name) { pbToast('Item name is required', 'error'); return; }
      const payload = {
        name,
        description: (document.getElementById('lib-desc') || {}).value || '',
        category: (document.getElementById('lib-cat') || {}).value || 'roofing',
        default_unit: (document.getElementById('lib-unit') || {}).value || 'each',
        default_unit_price: parseFloat((document.getElementById('lib-price') || {}).value) || 0,
        default_quantity: parseFloat((document.getElementById('lib-qty') || {}).value) || 1,
        is_taxable: (document.getElementById('lib-tax') || {}).checked !== false
      };
      try {
        const res = await fetch('/api/customer/item-library', { method: 'POST', headers: headers(), body: JSON.stringify(payload) });
        if (!res.ok) throw new Error('Save failed');
        const modal = document.getElementById('pb-lib-modal');
        if (modal) modal.remove();
        // Reload library
        const libRes = await fetch('/api/customer/item-library', { headers: headers() }).catch(() => ({ ok: false }));
        if (libRes.ok) { const d = await libRes.json(); state.itemLibrary = d.items || []; }
        pbToast('Item saved to library!', 'success');
        render();
      } catch(e) { pbToast('Failed to save item: ' + e.message, 'error'); }
    },
    removeItem(i) {
      if (state.form.items.length > 1) { state.form.items.splice(i, 1); render(); }
    },
    updateItem(i, field, value) {
      if (field === 'quantity' || field === 'unit_price') value = parseFloat(value) || 0;
      if (field === 'is_taxable') value = !!value;
      state.form.items[i][field] = value;
      updateTotals();
      // Re-render the specific row's amount cell
      const rows = document.querySelectorAll('#pb-items-body tr');
      if (rows[i]) {
        const amt = (state.form.items[i].quantity || 0) * (state.form.items[i].unit_price || 0);
        const cells = rows[i].querySelectorAll('td');
        if (cells[4]) cells[4].innerHTML = '$' + amt.toFixed(2);
      }
    },
    updateDiscount() {
      state.form.discount_type = (document.getElementById('pb-disc-type') || {}).value || 'fixed';
      state.form.discount_amount = parseFloat((document.getElementById('pb-discount') || {}).value) || 0;
      updateTotals();
    },
    templateWarranty() {
      const el = document.getElementById('pb-warranty');
      if (el) el.value = 'All workmanship is warranted for a period of 5 years from the date of completion. Manufacturer warranties apply separately to all materials installed. This warranty covers defects in workmanship including but not limited to: improper installation, leaks resulting from installation errors, and flashing failures. Normal wear and tear, acts of God, and damage caused by third parties are excluded.';
    },
    templatePayment() {
      const el = document.getElementById('pb-payment');
      if (el) el.value = 'A 30% deposit is required to schedule the work. 40% due at material delivery. Remaining 30% balance due upon satisfactory completion. Accepted payment methods: cheque, e-transfer, credit card (Visa/Mastercard/Amex via Square). Late payments are subject to 2% monthly interest. All prices are in Canadian Dollars (CAD).';
    },
    saveDraft() { saveProposal(false); },
    saveAndSend() { saveProposal(true); },
    previewCurrent() { collectFormData(); pbSaveDraft(); state.mode = 'preview'; render(); },
    shareLink(id, token) {
      if (token) {
        const url = window.location.origin + '/proposal/view/' + token;
        navigator.clipboard.writeText(url).then(() => pbToast('Link copied!', 'success')).catch(() => pbShareModal('Share Link', 'Copy the link below:', url));
      } else {
        pbToast('No share link available. Save the proposal first.', 'info');
      }
    },
    async convertToInvoice(id) {
      if (!(await window.rmConfirm('Convert this proposal to an invoice? A new invoice will be created with the same line items.'))) return
      try {
        const res = await fetch('/api/invoices/' + id + '/convert-to-invoice', { method: 'POST', headers: headers() });
        if (res.ok) {
          const data = await res.json();
          pbToast('Invoice ' + (data.invoice?.invoice_number || '') + ' created! Go to the Invoice Manager to view it.', 'success');
        } else {
          const err = await res.json().catch(() => ({}));
          pbToast('Failed: ' + (err.error || 'Unknown error'), 'error');
        }
      } catch (e) { pbToast('Error: ' + e.message, 'error'); }
    },
    async edit(id) {
      try {
        const res = await fetch('/api/invoices/' + id, { headers: headers() });
        if (!res.ok) return;
        const data = await res.json();
        const inv = data.invoice;
        const items = data.items || [];
        state.editId = id;
        state.form = {
          customer_id: inv.customer_id,
          newCustomer: { name: '', email: '', phone: '', company_name: '', address: '' },
          isNewCustomer: false,
          proposal_number: inv.invoice_number,
          created_date: (inv.created_at || '').slice(0, 10),
          valid_until: inv.valid_until || inv.due_date || '',
          scope_of_work: inv.scope_of_work || '',
          items: items.length > 0 ? items.map(i => i.category === '__section__'
            ? { description: i.description, quantity: 0, unit_price: 0, unit: 'each', is_taxable: false, category: '__section__', _isHeader: true }
            : { description: i.description, quantity: i.quantity, unit: i.unit || 'each', unit_price: i.unit_price, is_taxable: i.is_taxable !== 0, category: i.category || '' }
          ) : [{ description: '', quantity: 1, unit: 'sq ft', unit_price: 0, is_taxable: true, category: '' }],
          discount_type: inv.discount_type || 'fixed',
          discount_amount: inv.discount_amount || 0,
          tax_rate: inv.tax_rate || 5.0,
          warranty_terms: inv.warranty_terms || '',
          payment_terms_text: inv.payment_terms_text || inv.terms || '',
          notes: inv.notes || '',
          attached_report_id: inv.attached_report_id || null,
          order_id: inv.order_id || null
        };
        state.accentColor = inv.accent_color || '#0ea5e9';

        // Restore report section toggles
        try {
          const sections = inv.show_report_sections ? JSON.parse(inv.show_report_sections) : null;
          if (sections) {
            state.showAreaToCustomer     = !!sections.area;
            state.showPitchToCustomer    = !!sections.pitch;
            state.showMaterialsToCustomer = !!sections.materials;
            state.showEdgesToCustomer    = !!sections.edges;
            state.showSolarToCustomer    = !!sections.solar;
            state.showLineItemsToCustomer = !!sections.lineItems;
          }
        } catch(e) {}

        // Fetch attached report so preview can render its sections
        if (inv.attached_report_id) {
          try {
            const rRes = await fetch('/api/reports/' + inv.attached_report_id, { headers: headers() });
            if (rRes.ok) {
              const rData = await rRes.json();
              const rRow = rData.report;
              if (rRow && rRow.api_response_raw) {
                state.selectedReport = JSON.parse(rRow.api_response_raw);
                // Pull satellite image URL from DB column (not always in api_response_raw)
                if (rRow.satellite_image_url) state.selectedReport.satellite_image_url = rRow.satellite_image_url;
                // Pull property address from DB join
                if (!state.selectedReport.property_address && rRow.property_address) {
                  state.selectedReport.property_address = rRow.property_address;
                }
              }
            }
          } catch(e) {}
        } else {
          state.selectedReport = null;
        }

        state.mode = 'edit';
        render();
      } catch (e) { pbToast('Failed to load proposal', 'error'); }
    },
    async preview(id) {
      await window._pb.edit(id);
      state.mode = 'preview';
      render();
    },
    async send(id) {
      if (!(await window.rmConfirm('Send this proposal to the customer?'))) return
      try {
        await fetch('/api/invoices/' + id + '/send', { method: 'POST', headers: headers() });
        pbToast('Proposal sent!', 'success');
        load();
      } catch (e) { pbToast('Failed to send proposal', 'error'); }
    },
    async del(id) {
      if (!(await window.rmConfirm('Delete this draft proposal?'))) return
      try {
        await fetch('/api/invoices/' + id, { method: 'DELETE', headers: headers() });
        load();
      } catch (e) { pbToast('Failed to delete proposal', 'error'); }
    },
    setPricing(method) {
      state.pricingMethod = method;
      render();
    },
    async seedCatalog() {
      var res = await fetch('/api/crm/catalog/seed-defaults', { method: 'POST', headers: headers() }).then(function(r) { return r.json(); }).catch(function() { return null; });
      if (res) {
        var catRes = await fetch('/api/crm/catalog', { headers: headers() }).then(function(r) { return r.json(); }).catch(function() { return { items: [] }; });
        state.catalog = catRes.items || [];
        state.catalogLoaded = true;
        pbToast('Default roofing materials added to your catalog!', 'success');
        render();
      } else {
        pbToast('Failed to seed catalog. Please try again or add items manually.', 'error');
      }
    },
    async selectReport(reportId) {
      state.form.attached_report_id = reportId || null;
      state.selectedReport = state.reports.find(function(r) { return String(r.id) === String(reportId); }) || null;
      state.selectedReportMaterials = null;
      state.manualSquares = null;

      // Fetch full report data so preview can render measurement sections
      if (reportId) {
        try {
          var fetchId = (state.selectedReport && state.selectedReport.order_id) ? state.selectedReport.order_id : reportId;
          var fullRes = await fetch('/api/reports/' + fetchId, { headers: headers() });
          if (fullRes.ok) {
            var fullData = await fullRes.json();
            var fullRow = fullData.report;
            if (fullRow && fullRow.api_response_raw) {
              var parsed = JSON.parse(fullRow.api_response_raw);
              // Merge full data onto selectedReport
              state.selectedReport = Object.assign({}, state.selectedReport, parsed, {
                property_address: (state.selectedReport && state.selectedReport.property_address) || parsed.property_address || fullRow.property_address || '',
                satellite_image_url: fullRow.satellite_image_url || (parsed.imagery && (parsed.imagery.satellite_overhead_url || parsed.imagery.satellite_url)) || ''
              });
            }
          }
        } catch(e) {}
      }

      if (state.selectedReport) {
        state.form.property_address = state.selectedReport.property_address || '';
        var addrEl = document.getElementById('step3-address') || document.getElementById('dash-cust-address');
        if (addrEl) addrEl.value = state.form.property_address;

        // Use report data already loaded in state.reports instead of fetching
        var reportData = state.reports.find(function(r) { return String(r.id) === String(reportId); });
        if (reportData) {
          // Try to extract materials from the report data already in memory
          if (reportData.materials) {
            state.selectedReportMaterials = typeof reportData.materials === 'string' ? JSON.parse(reportData.materials) : reportData.materials;
          } else if (reportData.material_estimate) {
            state.selectedReportMaterials = typeof reportData.material_estimate === 'string' ? JSON.parse(reportData.material_estimate) : reportData.material_estimate;
          } else {
            // Materials not in the list data — try fetching report detail
            try {
              var detailRes = await fetch('/api/customer/reports-list', { headers: headers() });
              if (detailRes.ok) {
                var detailData = await detailRes.json();
                var fullReport = (detailData.reports || detailData.orders || []).find(function(r) { return String(r.id) === String(reportId); });
                if (fullReport && fullReport.materials) {
                  state.selectedReportMaterials = typeof fullReport.materials === 'string' ? JSON.parse(fullReport.materials) : fullReport.materials;
                }
              }
            } catch(e) { /* silently fail — materials just won't show */ }
          }
        }
      }

      // Auto-apply pricing presets from settings when a report is selected
      if (state.selectedReport && state.pricingPresets && !state.presetsApplied) {
        var pp = state.pricingPresets;
        var roofArea = state.selectedReport.total_true_area_sqft || state.selectedReport.roof_area_sqft || 0;
        var squares = Math.ceil(roofArea / 100);
        var materials = state.selectedReportMaterials;
        var bundleCount = 0;
        // Extract bundle count from materials if available
        if (materials && materials.items && Array.isArray(materials.items)) {
          for (var mi = 0; mi < materials.items.length; mi++) {
            var mItem = materials.items[mi];
            if (mItem.unit === 'bundles' && /shingle/i.test(mItem.description || '')) {
              bundleCount += (parseFloat(mItem.quantity) || 0);
            }
          }
        }
        // Fallback: calculate bundles from squares (3 bundles per square)
        if (bundleCount === 0 && squares > 0) {
          bundleCount = squares * 3;
        }

        if (pp.pricing_mode === 'markup') {
          state.pricingEngineMode = 'markup';
          state.markupPercent = pp.markup_percent || 30;
        } else if (pp.pricing_mode === 'per_square') {
          state.pricingEngineMode = 'per_square_customer';
          state.customerPricePerSquare = pp.price_per_square || 350;
        } else if (pp.pricing_mode === 'per_bundle') {
          // Per-bundle: calculate total material price from bundles, set as customer price override
          state.pricingEngineMode = 'per_square_customer';
          var bundleTotal = bundleCount * (pp.price_per_bundle || 125);
          // Add labor and tearoff if included
          var laborTotal = (pp.include_labor !== false && pp.labor_per_square) ? squares * pp.labor_per_square : 0;
          var tearoffTotal = (pp.include_tearoff !== false && pp.tearoff_per_square) ? squares * pp.tearoff_per_square : 0;
          var presetTotal = bundleTotal + laborTotal + tearoffTotal;
          state.customerPriceOverride = Math.round(presetTotal * 100) / 100;
          // Also set per-square equivalent for the UI
          state.customerPricePerSquare = squares > 0 ? Math.round(presetTotal / squares) : 0;
        }

        // Auto-add labor and tearoff line items for markup/per_square modes
        if (pp.pricing_mode !== 'per_bundle') {
          if (pp.include_labor !== false && pp.labor_per_square && squares > 0) {
            var hasLabor = state.form.items.some(function(it) { return /labor|installation/i.test(it.description); });
            if (!hasLabor) {
              state.form.items.push({ description: 'Installation Labor', quantity: squares, unit: 'squares', unit_price: pp.labor_per_square, is_taxable: true, category: 'labor' });
            }
          }
          if (pp.include_tearoff !== false && pp.tearoff_per_square && squares > 0) {
            var hasTearoff = state.form.items.some(function(it) { return /tear.?off|disposal/i.test(it.description); });
            if (!hasTearoff) {
              state.form.items.push({ description: 'Tear-off & Disposal', quantity: squares, unit: 'squares', unit_price: pp.tearoff_per_square, is_taxable: true, category: 'labor' });
            }
          }
        }

        state.presetsApplied = true;
        state.createStep = 3; // Jump straight to the proposal dashboard
      }

      render();
    },
    async pickReport(reportId) {
      state.reportSearch = '';
      await window._pb.selectReport(reportId);
      render();
    },
    setReportSearch(term) {
      state.reportSearch = (term || '').toLowerCase().trim();
      render();
      setTimeout(function() {
        var el = document.getElementById('pb-report-search');
        if (el) { el.focus(); var len = el.value.length; el.setSelectionRange(len, len); }
      }, 0);
    },
    goToSupplier() {
      // Collect customer address from report
      if (state.selectedReport) {
        state.form.property_address = state.selectedReport.property_address || '';
      }
      state.createStep = 2;
      render();
    },
    previewProposal() {
      window._pb.collectDashboardData();
      pbSaveDraft();
      // Render preview into overlay modal — state.mode stays unchanged
      var previewHtml = renderPreview();
      var modal = ensurePreviewModal();
      modal.innerHTML =
        '<div style="position:sticky;top:0;z-index:10000;background:white;border-bottom:1px solid #e5e7eb;padding:12px 20px;display:flex;align-items:center;justify-content:space-between">' +
          '<span style="font-weight:700;color:#111;font-size:14px"><i class="fas fa-eye" style="color:var(--accent);margin-right:8px"></i>Preview — Customer View</span>' +
          '<button onclick="window._pb.closePreview()" style="background:#f3f4f6;color:#374151;border:1px solid #d1d5db;padding:8px 16px;border-radius:8px;font-weight:600;font-size:13px;cursor:pointer"><i class="fas fa-times" style="margin-right:6px"></i>Close Preview</button>' +
        '</div>' +
        '<div style="padding:20px">' + previewHtml + '</div>';
      modal.style.display = 'block';
      modal.scrollTop = 0;
    },
    collectDashboardData() {
      var el;
      el = document.getElementById('dash-cust-name'); if (el) state.form.customer_name = el.value;
      el = document.getElementById('dash-cust-email'); if (el) state.form.customer_email = el.value;
      el = document.getElementById('dash-cust-phone'); if (el) state.form.customer_phone = el.value;
      el = document.getElementById('dash-cust-address'); if (el) state.form.property_address = el.value;
      el = document.getElementById('dash-scope'); if (el) state.form.scope_of_work = el.value;
      el = document.getElementById('dash-insurance'); if (el) state.attachments.insuranceCert = el.value;
      el = document.getElementById('dash-warranty'); if (el) state.attachments.warrantyDoc = el.value;
      el = document.getElementById('dash-wcb'); if (el) state.attachments.wcbCoverage = el.value;
      el = document.getElementById('dash-custom'); if (el) state.attachments.customAttachment = el.value;
      el = document.getElementById('dash-prop-title'); if (el) state.form.proposal_title = el.value;
      el = document.getElementById('dash-prop-desc'); if (el) state.form.proposal_description = el.value;
      el = document.getElementById('dash-logo-url'); if (el) state.form.company_logo_url = el.value;
    },
    collectDashboardAndSend() {
      window._pb.collectDashboardData();
      var hasExisting = !!(state.form.customer_id || state.form.crm_customer_id);
      if (!state.form.customer_name && !hasExisting) { pbToast('Please enter customer name', 'error'); return; }
      if (!state.form.customer_email && !hasExisting) { pbToast('Please enter customer email', 'error'); return; }
      saveProposal(true);
    },
    async saveAndCreateSupplierOrder() {
      // Save proposal first (silent=true skips the confirm dialog + state reset),
      // then create supplier order linked to the saved proposal ID.
      window._pb.collectDashboardData();
      var hasExisting2 = !!(state.form.customer_id || state.form.crm_customer_id);
      if (!state.form.customer_name && !hasExisting2) { pbToast('Please enter customer name first', 'error'); return; }
      pbToast('Saving proposal & generating supplier order...', 'info');
      try {
        var proposalId = await saveProposal(false, true);  // silent — returns proposalId
        if (!proposalId) return;  // saveProposal already showed an error toast
        await createSupplierOrder(proposalId);
        // Go back to list after supplier order created
        pbClearDraft();
        state.mode = 'list';
        state.editId = null;
        state.form = resetForm();
        load();
      } catch(e) {
        pbToast('Error: ' + (e.message || 'Failed to create supplier order'), 'error');
      }
    },
    downloadCustomerPDF() {
      // Collect data, switch to preview mode, then trigger print
      window._pb.collectDashboardData();
      pbSaveDraft();
      state.mode = 'preview';
      render();
      setTimeout(function() { window.print(); }, 500);
    },
    toggleMaterials() {
      state.materialsExpanded = !state.materialsExpanded;
      render();
    },
    applyTemplate(templateId) {
      var t = PROPOSAL_TEMPLATES.find(function(tpl) { return tpl.id === templateId; });
      if (!t) return;
      window._pb.collectDashboardData();
      state.form.proposal_title = t.title;
      state.form.proposal_description = t.description;
      state.form.scope_of_work = t.scope;
      state.form.warranty_terms = t.warranty;
      state.form.payment_terms_text = t.payment;
      pbToast('Template applied: ' + t.label, 'success');
      render();
    },
    closePreview() {
      var m = document.getElementById('pb-preview-modal');
      if (m) m.style.display = 'none';
    },
    updatePerSquare() {
      // Recalculate per-square total
      render();
    },
    setCertColor(color) {
      state.certAccentColor = color;
      state.certSettingsDirty = true;
      render();
    },
    async saveCertSettings() {
      try {
        var res = await fetch('/api/customer/branding', {
          method: 'PUT',
          headers: headers(),
          body: JSON.stringify({
            brand_license_number: state.certLicenseNumber || null,
            brand_primary_color: state.certAccentColor || null,
          })
        });
        if (res.ok) {
          state.certSettingsDirty = false;
          pbToast('Certificate settings saved!', 'success');
          render();
        } else {
          pbToast('Failed to save settings', 'error');
        }
      } catch(e) {
        pbToast('Error saving settings', 'error');
      }
    },
    async toggleAutoSendCertificate() {
      var newVal = !state.autoSendCertificate;
      try {
        var res = await fetch('/api/crm/proposals/automation/settings', {
          method: 'PUT',
          headers: headers(),
          body: JSON.stringify({ auto_send_certificate: newVal })
        });
        if (res.ok) {
          state.autoSendCertificate = newVal;
          pbToast(newVal ? '✅ Certificate auto-send enabled — customers will receive a certificate when they sign' : 'Certificate auto-send disabled', newVal ? 'success' : 'info');
          render();
        } else {
          pbToast('Failed to update setting', 'error');
        }
      } catch(e) {
        pbToast('Error updating setting', 'error');
      }
    },
    async sendCertificate(id) {
      pbToast('Sending certificate...', 'info');
      try {
        var res = await fetch('/api/invoices/' + id + '/send-certificate', {
          method: 'POST',
          headers: headers()
        });
        var data = await res.json();
        if (res.ok) {
          pbToast('Certificate sent to ' + (data.sent_to || 'customer'), 'success');
          // Update the local proposal record so the Sent badge appears immediately
          var p = state.proposals.find(function(x) { return x.id === id; });
          if (p) p.certificate_sent_at = new Date().toISOString();
          render();
        } else {
          pbToast(data.error || 'Failed to send certificate', 'error');
        }
      } catch(e) {
        pbToast('Error sending certificate', 'error');
      }
    }
  };

  // Close library picker when clicking outside
  document.addEventListener('click', function(e) {
    const picker = document.getElementById('pb-lib-picker');
    if (picker && picker.style.display !== 'none') {
      const btn = picker.previousElementSibling;
      if (!picker.contains(e.target) && e.target !== btn) {
        picker.style.display = 'none';
      }
    }
  });
});

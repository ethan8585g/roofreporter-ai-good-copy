// ============================================================
// PROPOSAL BUILDER — Enhanced Professional Proposal Creator
// Customer selector, Google Places, line items, rich text,
// warranty/payment terms, file attachments, share links
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  const root = document.getElementById('proposal-root');
  if (!root) return;

  const token = localStorage.getItem('rc_token') || localStorage.getItem('rc_customer_token') || '';
  const headers = () => ({ 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' });

  // State
  let state = {
    mode: 'list', // list | create | edit | preview
    proposals: [],
    customers: [],
    itemLibrary: [],
    reports: [],
    loading: true,
    editId: null,
    filter: 'all',
    searchTerm: '',
    // Form state
    form: resetForm()
  };

  function resetForm() {
    const today = new Date();
    const validUntil = new Date(today);
    validUntil.setDate(validUntil.getDate() + 30);
    return {
      customer_id: '',
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
      order_id: null
    };
  }

  load();

  async function load() {
    state.loading = true;
    render();
    try {
      const [propRes, custRes, libRes, repRes] = await Promise.all([
        fetch('/api/invoices?document_type=proposal', { headers: headers() }),
        fetch('/api/invoices/customers/list', { headers: headers() }),
        fetch('/api/customer/item-library', { headers: headers() }).catch(() => ({ ok: false })),
        fetch('/api/customer/reports-list', { headers: headers() }).catch(() => ({ ok: false }))
      ]);
      if (propRes.ok) { const d = await propRes.json(); state.proposals = d.invoices || []; }
      if (custRes.ok) { const d = await custRes.json(); state.customers = d.customers || []; }
      if (libRes.ok) { const d = await libRes.json(); state.itemLibrary = d.items || []; }
      if (repRes.ok) { const d = await repRes.json(); state.reports = d.reports || []; }
    } catch (e) { console.warn('Load error', e); }
    state.loading = false;
    render();
  }

  function render() {
    if (state.loading) {
      root.innerHTML = '<div class="flex items-center justify-center py-12"><div class="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-brand-500"></div><span class="ml-3 text-gray-500">Loading proposals...</span></div>';
      return;
    }
    switch (state.mode) {
      case 'list': root.innerHTML = renderList(); break;
      case 'create': case 'edit': root.innerHTML = renderEditor(); break;
      case 'preview': root.innerHTML = renderPreview(); break;
    }
  }

  // ============================================================
  // LIST VIEW
  // ============================================================
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
      paid: allProposals.filter(p => p.status === 'paid').length,
      totalValue: allProposals.reduce((s, p) => s + (p.total || 0), 0)
    };

    return `
    <div class="mb-6 flex items-center justify-between">
      <div>
        <h2 class="text-2xl font-bold text-gray-900"><i class="fas fa-file-signature text-brand-500 mr-2"></i>Proposals & Estimates</h2>
        <p class="text-gray-500 text-sm mt-1">Create professional roofing proposals with detailed line items</p>
      </div>
      <button onclick="window._pb.create()" class="px-5 py-2.5 bg-gradient-to-r from-sky-500 to-blue-600 text-white rounded-xl font-semibold text-sm hover:shadow-lg transition-all">
        <i class="fas fa-plus mr-1.5"></i>New Proposal
      </button>
    </div>

    <!-- Stats -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <div class="bg-white rounded-xl p-4 border border-gray-200"><p class="text-xs text-gray-500">Total Proposals</p><p class="text-2xl font-bold text-gray-900">${stats.total}</p></div>
      <div class="bg-white rounded-xl p-4 border border-gray-200"><p class="text-xs text-gray-500">Drafts</p><p class="text-2xl font-bold text-amber-600">${stats.draft}</p></div>
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
        <button onclick="window._pb.setFilter('draft')" class="px-3 py-1.5 rounded-lg text-xs font-medium ${filter === 'draft' ? 'bg-amber-100 text-amber-700 ring-1 ring-amber-300' : 'text-gray-500 hover:bg-gray-100'}">Draft ${stats.draft}</button>
        <button onclick="window._pb.setFilter('active')" class="px-3 py-1.5 rounded-lg text-xs font-medium ${filter === 'active' ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-300' : 'text-gray-500 hover:bg-gray-100'}">Active ${stats.sent}</button>
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
              const sc = { draft: 'bg-gray-100 text-gray-700', sent: 'bg-blue-100 text-blue-700', viewed: 'bg-indigo-100 text-indigo-700', paid: 'bg-green-100 text-green-700', overdue: 'bg-red-100 text-red-700', cancelled: 'bg-gray-100 text-gray-500' }[p.status] || 'bg-gray-100 text-gray-600';
              return `<tr class="hover:bg-gray-50">
                <td class="px-4 py-3 font-mono text-xs font-medium">${p.invoice_number}</td>
                <td class="px-4 py-3">${p.customer_name || 'Unknown'}<br><span class="text-xs text-gray-400">${p.customer_company || ''}</span></td>
                <td class="px-4 py-3 text-gray-500">${(p.created_at || '').slice(0, 10)}</td>
                <td class="px-4 py-3 font-semibold">$${(p.total || 0).toFixed(2)}</td>
                <td class="px-4 py-3"><span class="px-2 py-0.5 rounded-full text-xs font-medium ${sc}">${p.status}</span></td>
                <td class="px-4 py-3 text-right space-x-1">
                  <button onclick="window._pb.preview(${p.id})" class="text-brand-500 hover:text-brand-700 text-xs" title="Preview"><i class="fas fa-eye"></i></button>
                  ${p.status === 'draft' ? `<button onclick="window._pb.edit(${p.id})" class="text-gray-500 hover:text-gray-700 text-xs" title="Edit"><i class="fas fa-edit"></i></button>` : ''}
                  <button onclick="window._pb.send(${p.id})" class="text-green-500 hover:text-green-700 text-xs" title="Send"><i class="fas fa-paper-plane"></i></button>
                  <button onclick="window._pb.shareLink(${p.id}, '${p.share_token || ''}')" class="text-purple-500 hover:text-purple-700 text-xs" title="Share Link"><i class="fas fa-link"></i></button>
                  <button onclick="window._pb.convertToInvoice(${p.id})" class="text-amber-500 hover:text-amber-700 text-xs" title="Convert to Invoice"><i class="fas fa-file-invoice-dollar"></i></button>
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
          ${state.customers.map(c => `<option value="${c.id}" ${f.customer_id == c.id ? 'selected' : ''}>${c.name || c.email} ${c.company_name ? '(' + c.company_name + ')' : ''}</option>`).join('')}
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
      <select id="pb-report" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" onchange="state.form.attached_report_id = this.value || null">
        <option value="">No report attached</option>
        ${state.reports.map(r => `<option value="${r.id}" ${f.attached_report_id == r.id ? 'selected' : ''}>${r.property_address || 'Report #' + r.id} — ${(r.created_at || '').slice(0, 10)}</option>`).join('')}
      </select>
      <p class="text-xs text-gray-400 mt-2"><i class="fas fa-info-circle mr-1"></i>Attach a completed roof measurement report to this proposal. The report will be viewable by the customer.</p>
    </div>

    <!-- Line Items -->
    <div class="bg-white rounded-xl border border-gray-200 p-6 mb-6">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-lg font-bold text-gray-900"><i class="fas fa-list text-brand-500 mr-2"></i>Line Items</h3>
        <button onclick="window._pb.addItem()" class="px-3 py-1.5 bg-brand-50 text-brand-600 rounded-lg text-xs font-medium hover:bg-brand-100"><i class="fas fa-plus mr-1"></i>Add Row</button>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-3 py-2 text-left text-xs font-semibold text-gray-500 w-2/5">Description</th>
              <th class="px-3 py-2 text-center text-xs font-semibold text-gray-500 w-16">Qty</th>
              <th class="px-3 py-2 text-center text-xs font-semibold text-gray-500 w-20">Unit</th>
              <th class="px-3 py-2 text-right text-xs font-semibold text-gray-500 w-24">Unit Price</th>
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
    const amt = (item.quantity || 0) * (item.unit_price || 0);
    return `<tr class="border-b border-gray-100">
      <td class="px-2 py-1"><input type="text" value="${item.description || ''}" onchange="window._pb.updateItem(${i},'description',this.value)" class="w-full border border-gray-200 rounded px-2 py-1.5 text-sm" placeholder="Shingle installation"></td>
      <td class="px-2 py-1"><input type="number" value="${item.quantity}" onchange="window._pb.updateItem(${i},'quantity',this.value)" class="w-full border border-gray-200 rounded px-2 py-1.5 text-sm text-center" min="0" step="0.01"></td>
      <td class="px-2 py-1"><select onchange="window._pb.updateItem(${i},'unit',this.value)" class="w-full border border-gray-200 rounded px-1 py-1.5 text-xs">
        ${['each','sq ft','sq','bundle','roll','LF','piece','hour','day','lot'].map(u => `<option value="${u}" ${item.unit === u ? 'selected' : ''}>${u}</option>`).join('')}
      </select></td>
      <td class="px-2 py-1"><input type="number" value="${item.unit_price}" onchange="window._pb.updateItem(${i},'unit_price',this.value)" class="w-full border border-gray-200 rounded px-2 py-1.5 text-sm text-right" min="0" step="0.01"></td>
      <td class="px-2 py-1 text-right font-medium text-sm">$${amt.toFixed(2)}</td>
      <td class="px-2 py-1 text-center"><input type="checkbox" ${item.is_taxable ? 'checked' : ''} onchange="window._pb.updateItem(${i},'is_taxable',this.checked)"></td>
      <td class="px-2 py-1"><button onclick="window._pb.removeItem(${i})" class="text-red-400 hover:text-red-600 text-xs ${state.form.items.length <= 1 ? 'invisible' : ''}"><i class="fas fa-times"></i></button></td>
    </tr>`;
  }

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
      <div class="flex gap-2">
        <button onclick="window.print()" class="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-300"><i class="fas fa-print mr-1"></i>Print</button>
        <button onclick="window._pb.saveDraft()" class="px-4 py-2 bg-gray-700 text-white rounded-lg text-sm font-medium"><i class="fas fa-save mr-1"></i>Save</button>
        <button onclick="window._pb.saveAndSend()" class="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700"><i class="fas fa-paper-plane mr-1"></i>Send</button>
      </div>
    </div>

    <div class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden max-w-4xl mx-auto print:shadow-none print:border-none">
      <!-- Header -->
      <div class="bg-gradient-to-r from-sky-500 to-blue-600 text-white p-8">
        <div class="flex justify-between items-start">
          <div>
            <div class="flex items-center gap-3 mb-2">
              <div class="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center"><i class="fas fa-home text-white text-lg"></i></div>
              <div><h1 class="text-xl font-bold">RoofReporterAI</h1><p class="text-blue-200 text-xs">Professional Roof Measurement Reports</p></div>
            </div>
            <p class="text-blue-200 text-sm">Alberta, Canada</p>
            <p class="text-blue-200 text-xs">reports@reusecanada.ca</p>
          </div>
          <div class="text-right">
            <h2 class="text-2xl font-bold">PROPOSAL</h2>
            <p class="text-blue-200 text-sm mt-1">${f.proposal_number}</p>
            <p class="text-blue-200 text-xs mt-2">Date: ${f.created_date}</p>
            <p class="text-blue-200 text-xs">Valid Until: ${f.valid_until}</p>
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
              const amt = (item.quantity || 0) * (item.unit_price || 0);
              return `<tr class="border-b border-gray-100">
                <td class="px-4 py-2">${item.description || ''}</td>
                <td class="px-4 py-2 text-center">${item.quantity}</td>
                <td class="px-4 py-2 text-center">${item.unit}</td>
                <td class="px-4 py-2 text-right">$${(item.unit_price || 0).toFixed(2)}</td>
                <td class="px-4 py-2 text-right font-medium">$${amt.toFixed(2)}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>

        <div class="mt-4 flex justify-end">
          <div class="w-72 space-y-1">
            <div class="flex justify-between text-sm"><span class="text-gray-500">Subtotal</span><span>$${sub.toFixed(2)}</span></div>
            ${disc > 0 ? `<div class="flex justify-between text-sm text-red-600"><span>Discount</span><span>-$${disc.toFixed(2)}</span></div>` : ''}
            <div class="flex justify-between text-sm"><span class="text-gray-500">GST (${f.tax_rate}%)</span><span>$${tax.toFixed(2)}</span></div>
            <div class="flex justify-between text-lg font-bold border-t-2 border-gray-300 pt-2 mt-1"><span>Total (CAD)</span><span class="text-green-600">$${total.toFixed(2)}</span></div>
          </div>
        </div>
      </div>

      ${f.warranty_terms ? `<div class="p-8 border-b border-gray-200"><h3 class="text-xs font-semibold text-gray-500 uppercase mb-2">Warranty Terms</h3><div class="text-gray-700 text-sm whitespace-pre-wrap">${f.warranty_terms}</div></div>` : ''}
      ${f.payment_terms_text ? `<div class="p-8 border-b border-gray-200"><h3 class="text-xs font-semibold text-gray-500 uppercase mb-2">Payment Terms</h3><div class="text-gray-700 text-sm whitespace-pre-wrap">${f.payment_terms_text}</div></div>` : ''}
      ${f.notes ? `<div class="p-8 border-b border-gray-200"><h3 class="text-xs font-semibold text-gray-500 uppercase mb-2">Notes</h3><div class="text-gray-700 text-sm whitespace-pre-wrap">${f.notes}</div></div>` : ''}

      <div class="p-8 text-center text-gray-400 text-xs">
        <p>Thank you for considering our services. We look forward to working with you.</p>
        <p class="mt-1">RoofReporterAI | Professional Roof Measurement Reports | reports@reusecanada.ca</p>
      </div>
    </div>`;
  }

  // ============================================================
  // CALCULATIONS
  // ============================================================
  function calcSubtotal() {
    return state.form.items.reduce((s, i) => s + (i.quantity || 0) * (i.unit_price || 0), 0);
  }
  function calcDiscountAmount() {
    const f = state.form;
    const sub = calcSubtotal();
    return f.discount_type === 'percentage' ? sub * (f.discount_amount / 100) : (f.discount_amount || 0);
  }
  function calcTax() {
    const sub = calcSubtotal();
    const disc = calcDiscountAmount();
    const taxableItems = state.form.items.filter(i => i.is_taxable);
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
    return f;
  }

  // ============================================================
  // API ACTIONS
  // ============================================================
  async function saveProposal(andSend = false) {
    collectFormData();
    const f = state.form;

    // Validate
    if (!f.isNewCustomer && !f.customer_id) { alert('Please select a customer'); return; }
    if (f.isNewCustomer && (!f.newCustomer.name || !f.newCustomer.email)) { alert('Name and email are required for new customer'); return; }
    if (!f.items.some(i => i.description)) { alert('Add at least one line item'); return; }

    try {
      // If new customer, create first
      let customerId = f.customer_id;
      if (f.isNewCustomer) {
        // Use the CRM customer creation endpoint
        const custRes = await fetch('/api/crm/customers', {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify(f.newCustomer)
        });
        if (custRes.ok) {
          const custData = await custRes.json();
          customerId = custData.customer?.id || custData.id;
        } else {
          alert('Failed to create customer. Please try again.');
          return;
        }
      }

      const payload = {
        customer_id: customerId,
        order_id: f.order_id || null,
        document_type: 'proposal',
        items: f.items.filter(i => i.description).map(i => ({
          description: i.description,
          quantity: parseFloat(i.quantity) || 1,
          unit_price: parseFloat(i.unit_price) || 0,
          unit: i.unit || 'each',
          is_taxable: i.is_taxable ? 1 : 0,
          category: i.category || ''
        })),
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
        due_days: 30
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
        alert('Failed to save proposal: ' + (err.error || 'Unknown error'));
        return;
      }

      const data = await res.json();
      const proposalId = state.editId || data.invoice?.id;
      const shareUrl = data.invoice?.share_url || '';

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
            prompt('Proposal sent! Share this link with your customer:', fullUrl);
          } else {
            alert('Proposal saved and marked as sent!');
          }
        }
      } else if (shareUrl) {
        const fullUrl = window.location.origin + shareUrl;
        if (confirm('Proposal saved as draft!\n\nShareable link: ' + fullUrl + '\n\nCopy link to clipboard?')) {
          navigator.clipboard.writeText(fullUrl).catch(() => {});
        }
      } else {
        alert(andSend ? 'Proposal saved and marked as sent!' : 'Proposal saved as draft!');
      }
      state.mode = 'list';
      state.editId = null;
      state.form = resetForm();
      load();
    } catch (e) {
      alert('Error saving proposal: ' + e.message);
    }
  }

  // ============================================================
  // PUBLIC API
  // ============================================================
  window._pb = {
    create() { state.mode = 'create'; state.editId = null; state.form = resetForm(); render(); },
    backToList() { state.mode = 'list'; state.editId = null; state.form = resetForm(); render(); },
    backToEditor() { state.mode = state.editId ? 'edit' : 'create'; render(); },
    setFilter(f) { state.filter = f; render(); },
    setSearch(term) { state.searchTerm = term; render(); },
    toggleCustMode(isNew) { state.form.isNewCustomer = isNew; render(); },
    selectCustomer(id) { state.form.customer_id = id; },
    addItem() {
      state.form.items.push({ description: '', quantity: 1, unit: 'sq ft', unit_price: 0, is_taxable: true, category: '' });
      render();
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
    previewCurrent() { collectFormData(); state.mode = 'preview'; render(); },
    shareLink(id, token) {
      if (token) {
        const url = window.location.origin + '/proposal/view/' + token;
        navigator.clipboard.writeText(url).then(() => alert('Link copied!\n\n' + url)).catch(() => prompt('Share link:', url));
      } else {
        alert('No share link available. Save the proposal first.');
      }
    },
    async convertToInvoice(id) {
      if (!confirm('Convert this proposal to an invoice? A new invoice will be created with the same line items.')) return;
      try {
        const res = await fetch('/api/invoices/' + id + '/convert-to-invoice', { method: 'POST', headers: headers() });
        if (res.ok) {
          const data = await res.json();
          alert('Invoice ' + (data.invoice?.invoice_number || '') + ' created!\n\nGo to the Invoice Manager to view it.');
        } else {
          const err = await res.json().catch(() => ({}));
          alert('Failed: ' + (err.error || 'Unknown error'));
        }
      } catch (e) { alert('Error: ' + e.message); }
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
          items: items.length > 0 ? items.map(i => ({
            description: i.description, quantity: i.quantity, unit: i.unit || 'each',
            unit_price: i.unit_price, is_taxable: i.is_taxable !== 0, category: i.category || ''
          })) : [{ description: '', quantity: 1, unit: 'sq ft', unit_price: 0, is_taxable: true, category: '' }],
          discount_type: inv.discount_type || 'fixed',
          discount_amount: inv.discount_amount || 0,
          tax_rate: inv.tax_rate || 5.0,
          warranty_terms: inv.warranty_terms || '',
          payment_terms_text: inv.payment_terms_text || inv.terms || '',
          notes: inv.notes || '',
          attached_report_id: inv.attached_report_id || null,
          order_id: inv.order_id || null
        };
        state.mode = 'edit';
        render();
      } catch (e) { alert('Failed to load proposal'); }
    },
    async preview(id) {
      await window._pb.edit(id);
      state.mode = 'preview';
      render();
    },
    async send(id) {
      if (!confirm('Send this proposal to the customer?')) return;
      try {
        await fetch('/api/invoices/' + id + '/send', { method: 'POST', headers: headers() });
        alert('Proposal sent!');
        load();
      } catch (e) { alert('Failed to send proposal'); }
    },
    async del(id) {
      if (!confirm('Delete this draft proposal?')) return;
      try {
        await fetch('/api/invoices/' + id, { method: 'DELETE', headers: headers() });
        load();
      } catch (e) { alert('Failed to delete proposal'); }
    }
  };
});

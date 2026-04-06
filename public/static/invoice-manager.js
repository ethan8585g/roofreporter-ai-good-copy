// ============================================================
// INVOICE MANAGER — Dynamic Invoice Creator + Square Payment
// Create from proposal or manual, Square payment links, PDF,
// status management, webhook-driven payment confirmation
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  const root = document.getElementById('invoice-root');
  if (!root) return;

  const token = localStorage.getItem('rc_token') || localStorage.getItem('rc_customer_token') || '';
  const headers = () => ({ 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' });

  let state = {
    mode: 'list', // list | create | edit | view
    invoices: [],
    customers: [],
    proposals: [],
    reports: [],
    stats: {},
    loading: true,
    editId: null,
    filter: 'all',
    searchTerm: '',
    form: resetForm(),
    squareStatus: null
  };

  function imToast(msg, type) {
    var existing = document.getElementById('im-toast');
    if (existing) existing.remove();
    var toast = document.createElement('div');
    toast.id = 'im-toast';
    toast.style.cssText = 'position:fixed;top:20px;right:20px;z-index:99999;padding:14px 20px;border-radius:10px;font-size:14px;font-weight:600;max-width:400px;box-shadow:0 4px 20px rgba(0,0,0,0.15);';
    toast.style.background = type === 'error' ? '#fef2f2' : type === 'success' ? '#f0fdf4' : '#eff6ff';
    toast.style.color = type === 'error' ? '#991b1b' : type === 'success' ? '#166534' : '#1e40af';
    toast.style.border = '1px solid ' + (type === 'error' ? '#fecaca' : type === 'success' ? '#bbf7d0' : '#bfdbfe');
    toast.innerHTML = (type === 'error' ? '<i class="fas fa-exclamation-circle" style="margin-right:8px"></i>' : type === 'success' ? '<i class="fas fa-check-circle" style="margin-right:8px"></i>' : '<i class="fas fa-info-circle" style="margin-right:8px"></i>') + msg;
    document.body.appendChild(toast);
    setTimeout(function() { toast.remove(); }, 4000);
  }

  function resetForm() {
    const today = new Date();
    const due = new Date(today);
    due.setDate(due.getDate() + 30);
    return {
      customer_id: '',
      from_proposal_id: null,
      invoice_number: 'INV-' + today.toISOString().slice(0, 10).replace(/-/g, '') + '-' + Math.floor(Math.random() * 9999).toString().padStart(4, '0'),
      created_date: today.toISOString().slice(0, 10),
      due_date: due.toISOString().slice(0, 10),
      items: [{ description: '', quantity: 1, unit: 'each', unit_price: 0, is_taxable: true }],
      discount_type: 'fixed',
      discount_amount: 0,
      tax_rate: 5.0,
      notes: '',
      terms: 'Payment due within 30 days of invoice date. Late payments subject to 2% monthly interest.',
      order_id: null,
      attached_report_id: null
    };
  }

  load();

  async function load() {
    state.loading = true;
    render();
    try {
      const [invRes, custRes, propRes, rptRes, sqRes] = await Promise.all([
        fetch('/api/invoices', { headers: headers() }),
        fetch('/api/invoices/customers/list', { headers: headers() }),
        fetch('/api/invoices?document_type=proposal', { headers: headers() }).catch(() => ({ ok: false })),
        fetch('/api/reports/list', { headers: headers() }).catch(() => ({ ok: false })),
        fetch('/api/square/oauth/status', { headers: headers() }).catch(() => ({ ok: false }))
      ]);
      if (invRes.ok) { const d = await invRes.json(); state.invoices = d.invoices || []; state.stats = d.stats || {}; }
      if (custRes.ok) { const d = await custRes.json(); state.customers = d.customers || []; }
      if (propRes.ok) { const d = await propRes.json(); state.proposals = (d.invoices || []).filter(p => p.status !== 'cancelled'); }
      if (rptRes.ok) { const d = await rptRes.json(); state.reports = (d.reports || []).filter(r => r.status === 'completed' || r.status === 'enhancing'); }
      if (sqRes.ok) { state.squareStatus = await sqRes.json(); }
    } catch (e) { console.warn('Load error', e); }
    state.loading = false;
    render();
  }

  function render() {
    if (state.loading) {
      root.innerHTML = '<div class="flex items-center justify-center py-12"><div class="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-brand-500"></div><span class="ml-3 text-gray-500">Loading invoices...</span></div>';
      return;
    }
    switch (state.mode) {
      case 'list': root.innerHTML = renderList(); break;
      case 'create': case 'edit': root.innerHTML = renderEditor(); break;
      case 'view': root.innerHTML = renderView(); break;
    }
  }

  // ============================================================
  // LIST VIEW
  // ============================================================
  function renderSquareConnectBanner() {
    const sq = state.squareStatus;
    if (!sq) return '';
    if (!sq.app_configured) return '';
    if (sq.connected) {
      return `<div class="bg-emerald-500/10 border border-green-200 rounded-xl px-4 py-3 mb-4 flex items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center"><i class="fas fa-check-circle text-emerald-400 text-sm"></i></div>
          <div>
            <p class="text-sm font-bold text-green-800">Square Account Connected — ${sq.merchant_name || sq.merchant_id}</p>
            <p class="text-xs text-emerald-400">Payment links will be charged to your Square merchant account</p>
          </div>
        </div>
        <button onclick="window._im.disconnectSquare()" class="text-xs text-red-500 hover:text-red-700 font-medium px-3 py-1.5 hover:bg-red-500/10 rounded-lg transition-colors">
          <i class="fas fa-unlink mr-1"></i>Disconnect
        </button>
      </div>`;
    }
    return `<div class="bg-blue-500/10 border border-blue-200 rounded-xl px-4 py-3 mb-4 flex items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center"><i class="fas fa-credit-card text-blue-400 text-sm"></i></div>
        <div>
          <p class="text-sm font-bold text-blue-800">Connect Your Square Account</p>
          <p class="text-xs text-blue-400">Accept payments directly into your own Square merchant account. Payment links on invoices will route to your account.</p>
        </div>
      </div>
      <button onclick="window._im.connectSquare()" class="flex-shrink-0 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition-colors">
        <i class="fas fa-plug mr-1"></i>Connect Square
      </button>
    </div>`;
  }

  function renderList() {
    const allInvoices = state.invoices;
    const s = state.stats;
    const totalPaid = Number(s.total_paid || 0);
    const totalOut = Number(s.total_outstanding || 0);
    const totalOverdue = Number(s.total_overdue || 0);
    const totalDraft = Number(s.total_draft || 0);

    // Filter invoices based on active filter
    const filter = state.filter || 'all';
    const searchTerm = (state.searchTerm || '').toLowerCase();
    let invoices = allInvoices;
    if (filter !== 'all') invoices = invoices.filter(inv => inv.status === filter || (filter === 'outstanding' && ['sent','viewed'].includes(inv.status)));
    if (searchTerm) invoices = invoices.filter(inv => 
      (inv.invoice_number || '').toLowerCase().includes(searchTerm) || 
      (inv.customer_name || '').toLowerCase().includes(searchTerm) ||
      (inv.customer_company || '').toLowerCase().includes(searchTerm)
    );

    const filterBtn = (label, value, icon, count, color) => {
      const active = filter === value;
      return `<button onclick="window._im.setFilter('${value}')" class="px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${active ? 'bg-' + color + '-100 text-' + color + '-700 ring-1 ring-' + color + '-300' : 'text-gray-500 hover:bg-[#111111]/10'}">${icon ? '<i class="fas fa-' + icon + ' mr-1"></i>' : ''}${label}${count != null ? ' <span class="ml-1 px-1.5 py-0.5 bg-' + color + '-50 rounded text-' + color + '-600 text-[10px] font-bold">' + count + '</span>' : ''}</button>`;
    };

    return `
    <div class="mb-6 flex items-center justify-between flex-wrap gap-3">
      <div>
        <h2 class="text-2xl font-bold text-white"><i class="fas fa-file-invoice-dollar text-emerald-400 mr-2"></i>Invoice Manager</h2>
        <p class="text-gray-500 text-sm mt-1">Create invoices, track payments, and send Square payment links</p>
      </div>
      <div class="flex gap-2">
        <button onclick="window._im.fromProposal()" class="px-4 py-2 bg-purple-50 text-purple-700 rounded-xl text-sm font-medium hover:bg-purple-100 border border-purple-200 transition-all">
          <i class="fas fa-file-import mr-1"></i>From Proposal
        </button>
        <button onclick="window._im.create()" class="px-5 py-2.5 bg-gradient-to-r from-[#111111] to-[#1a1a1a] text-white rounded-xl font-semibold text-sm hover:shadow-lg transition-all">
          <i class="fas fa-plus mr-1.5"></i>New Invoice
        </button>
      </div>
    </div>

    <!-- Square Merchant Connect Banner -->
    ${renderSquareConnectBanner()}

    <!-- Stats Cards -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <div class="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl p-4 border border-green-200 cursor-pointer hover:shadow-md transition-all" onclick="window._im.setFilter('paid')">
        <div class="flex items-center gap-2 mb-1"><div class="w-7 h-7 bg-green-100 rounded-lg flex items-center justify-center"><i class="fas fa-check-circle text-emerald-400 text-xs"></i></div><p class="text-xs text-green-700 font-medium">Collected</p></div>
        <p class="text-2xl font-bold text-green-700">$${totalPaid.toFixed(2)}</p>
      </div>
      <div class="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-4 border border-blue-200 cursor-pointer hover:shadow-md transition-all" onclick="window._im.setFilter('outstanding')">
        <div class="flex items-center gap-2 mb-1"><div class="w-7 h-7 bg-blue-100 rounded-lg flex items-center justify-center"><i class="fas fa-clock text-blue-400 text-xs"></i></div><p class="text-xs text-blue-700 font-medium">Outstanding</p></div>
        <p class="text-2xl font-bold text-blue-700">$${totalOut.toFixed(2)}</p>
      </div>
      <div class="bg-gradient-to-br from-red-50 to-rose-50 rounded-xl p-4 border border-red-200 cursor-pointer hover:shadow-md transition-all" onclick="window._im.setFilter('overdue')">
        <div class="flex items-center gap-2 mb-1"><div class="w-7 h-7 bg-red-100 rounded-lg flex items-center justify-center"><i class="fas fa-exclamation-triangle text-red-400 text-xs"></i></div><p class="text-xs text-red-700 font-medium">Overdue</p></div>
        <p class="text-2xl font-bold text-red-700">$${totalOverdue.toFixed(2)}</p>
      </div>
      <div class="bg-gradient-to-br from-gray-50 to-slate-50 rounded-xl p-4 border border-white/10 cursor-pointer hover:shadow-md transition-all" onclick="window._im.setFilter('all')">
        <div class="flex items-center gap-2 mb-1"><div class="w-7 h-7 bg-white/5 rounded-lg flex items-center justify-center"><i class="fas fa-file-invoice text-gray-400 text-xs"></i></div><p class="text-xs text-gray-400 font-medium">Total Invoices</p></div>
        <p class="text-2xl font-bold text-white">${s.total_invoices || allInvoices.length}</p>
      </div>
    </div>

    <!-- Search & Filter Bar -->
    <div class="bg-[#111111] rounded-xl border border-white/10 p-3 mb-4 flex items-center gap-3 flex-wrap">
      <div class="relative flex-1 min-w-[200px]">
        <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
        <input type="text" id="im-search" placeholder="Search invoices..." value="${searchTerm}" 
          oninput="window._im.setSearch(this.value)" 
          class="w-full pl-8 pr-3 py-1.5 border border-white/10 rounded-lg text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none">
      </div>
      <div class="flex gap-1 flex-wrap">
        ${filterBtn('All', 'all', '', allInvoices.length, 'gray')}
        ${filterBtn('Draft', 'draft', 'edit', allInvoices.filter(i => i.status === 'draft').length, 'amber')}
        ${filterBtn('Sent', 'sent', 'paper-plane', allInvoices.filter(i => i.status === 'sent').length, 'blue')}
        ${filterBtn('Paid', 'paid', 'check-circle', allInvoices.filter(i => i.status === 'paid').length, 'green')}
        ${filterBtn('Overdue', 'overdue', 'exclamation-circle', allInvoices.filter(i => i.status === 'overdue').length, 'red')}
      </div>
    </div>

    <!-- Invoice Table -->
    <div class="bg-[#111111] rounded-xl border border-white/10 overflow-hidden shadow-sm">
      ${invoices.length === 0 ? `
        <div class="py-16 text-center">
          <i class="fas fa-file-invoice text-gray-300 text-5xl mb-4"></i>
          <p class="text-gray-500 font-medium">No invoices yet</p>
          <button onclick="window._im.create()" class="mt-4 px-5 py-2 bg-emerald-500 text-white rounded-lg text-sm font-medium hover:bg-emerald-600">Create Invoice</button>
        </div>
      ` : `
        <table class="w-full text-sm">
          <thead class="bg-[#0A0A0A] border-b border-white/10">
            <tr>
              <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Invoice #</th>
              <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Customer</th>
              <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Date</th>
              <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Due</th>
              <th class="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Total</th>
              <th class="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Status</th>
              <th class="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            ${invoices.map(inv => {
              const sc = { draft: 'bg-white/5 text-gray-300', sent: 'bg-blue-500/100/15 text-blue-400', viewed: 'bg-indigo-500/15 text-indigo-400', paid: 'bg-emerald-500/15 text-emerald-400', overdue: 'bg-red-500/100/15 text-red-400', cancelled: 'bg-white/5 text-gray-500', refunded: 'bg-purple-100 text-purple-700' }[inv.status] || 'bg-white/5 text-gray-400';
              return `<tr class="hover:bg-[#111111]/5">
                <td class="px-4 py-3 font-mono text-xs font-medium">${inv.invoice_number}</td>
                <td class="px-4 py-3">${inv.customer_name || 'Unknown'}<br><span class="text-xs text-gray-400">${inv.customer_company || ''}</span></td>
                <td class="px-4 py-3 text-gray-500 text-xs">${(inv.created_at || '').slice(0, 10)}</td>
                <td class="px-4 py-3 text-gray-500 text-xs">${inv.due_date || 'N/A'}</td>
                <td class="px-4 py-3 text-right font-semibold">$${(inv.total || 0).toFixed(2)}</td>
                <td class="px-4 py-3 text-center"><span class="px-2 py-0.5 rounded-full text-xs font-medium ${sc}">${inv.status}</span></td>
                <td class="px-4 py-3 text-right whitespace-nowrap">
                  <button onclick="window._im.view(${inv.id})" class="text-emerald-400 hover:text-brand-700 text-xs mr-1" title="View"><i class="fas fa-eye"></i></button>
                  ${inv.status === 'draft' ? `<button onclick="window._im.edit(${inv.id})" class="text-gray-500 hover:text-gray-300 text-xs mr-1" title="Edit"><i class="fas fa-edit"></i></button>` : ''}
                  ${['sent','viewed','overdue'].includes(inv.status) ? `<button onclick="window._im.createPaymentLink(${inv.id})" class="text-green-500 hover:text-green-700 text-xs mr-1" title="Square Payment Link"><i class="fas fa-credit-card"></i></button>` : ''}
                  ${inv.status === 'draft' ? `<button onclick="window._im.send(${inv.id})" class="text-blue-500 hover:text-blue-700 text-xs mr-1" title="Send"><i class="fas fa-paper-plane"></i></button>` : ''}
                  ${['sent','viewed','overdue'].includes(inv.status) ? `<button onclick="window._im.markPaid(${inv.id})" class="text-emerald-400 hover:text-green-800 text-xs mr-1" title="Mark Paid"><i class="fas fa-check-circle"></i></button>` : ''}
                  ${inv.status === 'draft' ? `<button onclick="window._im.del(${inv.id})" class="text-red-400 hover:text-red-400 text-xs" title="Delete"><i class="fas fa-trash"></i></button>` : ''}
                  ${['sent','viewed'].includes(inv.status) ? `<button onclick="window._im.void(${inv.id})" class="text-gray-400 hover:text-gray-400 text-xs" title="Void"><i class="fas fa-ban"></i></button>` : ''}
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
    return `
    <div class="mb-4 flex items-center justify-between">
      <button onclick="window._im.backToList()" class="text-gray-500 hover:text-gray-300 text-sm"><i class="fas fa-arrow-left mr-1"></i>Back to Invoices</button>
      <div class="flex gap-2">
        <button onclick="window._im.saveDraft()" class="px-4 py-2 bg-gray-200 text-gray-300 rounded-lg text-sm font-medium hover:bg-gray-300"><i class="fas fa-save mr-1"></i>Save Draft</button>
        <button onclick="window._im.saveAndSend()" class="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700"><i class="fas fa-paper-plane mr-1"></i>Save & Send</button>
      </div>
    </div>

    <!-- Header -->
    <div class="bg-[#111111] rounded-xl border border-white/10 p-6 mb-6">
      <h3 class="text-lg font-bold text-white mb-4"><i class="fas fa-file-invoice text-emerald-400 mr-2"></i>${state.editId ? 'Edit' : 'New'} Invoice</h3>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div><label class="block text-xs font-semibold text-gray-500 mb-1">Invoice Number</label><input type="text" id="im-number" value="${f.invoice_number}" class="w-full border border-white/15 rounded-lg px-3 py-2 text-sm bg-[#0A0A0A]" readonly></div>
        <div><label class="block text-xs font-semibold text-gray-500 mb-1">Created Date</label><input type="date" id="im-date" value="${f.created_date}" class="w-full border border-white/15 rounded-lg px-3 py-2 text-sm"></div>
        <div><label class="block text-xs font-semibold text-gray-500 mb-1">Due Date</label><input type="date" id="im-due" value="${f.due_date}" class="w-full border border-white/15 rounded-lg px-3 py-2 text-sm"></div>
      </div>
    </div>

    <!-- Customer -->
    <div class="bg-[#111111] rounded-xl border border-white/10 p-6 mb-6">
      <h3 class="text-lg font-bold text-white mb-4"><i class="fas fa-user text-emerald-400 mr-2"></i>Customer</h3>
      <select id="im-customer" class="w-full border border-white/15 rounded-lg px-3 py-2 text-sm">
        <option value="">Select a customer...</option>
        ${state.customers.map(c => `<option value="${c.id}" ${f.customer_id == c.id ? 'selected' : ''}>${c.name || c.email} ${c.company_name ? '(' + c.company_name + ')' : ''}</option>`).join('')}
      </select>
    </div>

    <!-- Line Items -->
    <div class="bg-[#111111] rounded-xl border border-white/10 p-6 mb-6">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-lg font-bold text-white"><i class="fas fa-list text-emerald-400 mr-2"></i>Line Items</h3>
        <button onclick="window._im.addItem()" class="px-3 py-1.5 bg-brand-50 text-brand-600 rounded-lg text-xs font-medium hover:bg-brand-100"><i class="fas fa-plus mr-1"></i>Add Row</button>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-[#0A0A0A]"><tr>
            <th class="px-3 py-2 text-left text-xs font-semibold text-gray-500 w-2/5">Description</th>
            <th class="px-3 py-2 text-center text-xs font-semibold text-gray-500 w-16">Qty</th>
            <th class="px-3 py-2 text-center text-xs font-semibold text-gray-500 w-20">Unit</th>
            <th class="px-3 py-2 text-right text-xs font-semibold text-gray-500 w-24">Price</th>
            <th class="px-3 py-2 text-right text-xs font-semibold text-gray-500 w-24">Amount</th>
            <th class="px-3 py-2 text-center text-xs font-semibold text-gray-500 w-12">Tax</th>
            <th class="px-3 py-2 w-10"></th>
          </tr></thead>
          <tbody id="im-items-body">
            ${f.items.map((item, i) => {
              const amt = (item.quantity || 0) * (item.unit_price || 0);
              return `<tr class="border-b border-white/5">
                <td class="px-2 py-1"><input type="text" value="${item.description || ''}" onchange="window._im.updateItem(${i},'description',this.value)" class="w-full border border-white/10 rounded px-2 py-1.5 text-sm"></td>
                <td class="px-2 py-1"><input type="number" value="${item.quantity}" onchange="window._im.updateItem(${i},'quantity',this.value)" class="w-full border border-white/10 rounded px-2 py-1.5 text-sm text-center" min="0" step="0.01"></td>
                <td class="px-2 py-1"><select onchange="window._im.updateItem(${i},'unit',this.value)" class="w-full border border-white/10 rounded px-1 py-1.5 text-xs">
                  ${['each','sq ft','sq','bundle','roll','LF','piece','hour','day','lot'].map(u => `<option value="${u}" ${item.unit === u ? 'selected' : ''}>${u}</option>`).join('')}
                </select></td>
                <td class="px-2 py-1"><input type="number" value="${item.unit_price}" onchange="window._im.updateItem(${i},'unit_price',this.value)" class="w-full border border-white/10 rounded px-2 py-1.5 text-sm text-right" min="0" step="0.01"></td>
                <td class="px-2 py-1 text-right font-medium text-sm">$${amt.toFixed(2)}</td>
                <td class="px-2 py-1 text-center"><input type="checkbox" ${item.is_taxable ? 'checked' : ''} onchange="window._im.updateItem(${i},'is_taxable',this.checked)"></td>
                <td class="px-2 py-1"><button onclick="window._im.removeItem(${i})" class="text-red-400 hover:text-red-400 text-xs ${f.items.length <= 1 ? 'invisible' : ''}"><i class="fas fa-times"></i></button></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>

      <!-- Summary -->
      <div class="mt-4 border-t border-white/10 pt-4 flex justify-end">
        <div class="w-72 space-y-2">
          <div class="flex justify-between text-sm"><span class="text-gray-500">Subtotal</span><span class="font-medium" id="im-subtotal">$${calcSub().toFixed(2)}</span></div>
          <div class="flex justify-between text-sm items-center gap-2">
            <span class="text-gray-500">Discount</span>
            <div class="flex items-center gap-1">
              <select id="im-disc-type" onchange="window._im.updTotals()" class="border border-white/15 rounded px-1 py-0.5 text-xs">
                <option value="fixed" ${f.discount_type === 'fixed' ? 'selected' : ''}>$</option>
                <option value="percentage" ${f.discount_type === 'percentage' ? 'selected' : ''}>%</option>
              </select>
              <input type="number" id="im-discount" value="${f.discount_amount}" onchange="window._im.updTotals()" class="border border-white/15 rounded px-2 py-0.5 text-xs w-20 text-right" step="0.01">
            </div>
          </div>
          <div class="flex justify-between text-sm"><span class="text-gray-500">Tax (${f.tax_rate}% GST)</span><span id="im-tax">$${calcTax().toFixed(2)}</span></div>
          <div class="flex justify-between text-lg font-bold border-t border-white/10 pt-2"><span>Total (CAD)</span><span class="text-emerald-400" id="im-total">$${calcTotal().toFixed(2)}</span></div>
        </div>
      </div>
    </div>

    <!-- Attach Roof Report -->
    ${state.reports.length > 0 ? `
    <div class="bg-[#111111] rounded-xl border border-white/10 p-6 mb-6">
      <h3 class="text-lg font-bold text-white mb-3"><i class="fas fa-file-pdf text-orange-500 mr-2"></i>Attach Roof Report</h3>
      <p class="text-gray-500 text-xs mb-3">Optionally attach a completed roof report to this invoice. The report will be accessible to the customer via the shared link.</p>
      <select id="im-report" class="w-full border border-white/15 rounded-lg px-3 py-2 text-sm">
        <option value="">No report attached</option>
        ${state.reports.map(r => `<option value="${r.id}" ${f.attached_report_id == r.id ? 'selected' : ''}>${r.property_address || 'Report #' + r.id} — ${(r.created_at || '').slice(0, 10)} — ${r.roof_area_sqft ? Math.round(r.roof_area_sqft) + ' sq ft' : r.status}</option>`).join('')}
      </select>
    </div>` : ''}

    <!-- Notes & Terms -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
      <div class="bg-[#111111] rounded-xl border border-white/10 p-6">
        <h3 class="text-lg font-bold text-white mb-3"><i class="fas fa-sticky-note text-emerald-400 mr-2"></i>Notes</h3>
        <textarea id="im-notes" rows="3" class="w-full border border-white/15 rounded-lg px-3 py-2 text-sm" placeholder="Additional notes...">${f.notes}</textarea>
      </div>
      <div class="bg-[#111111] rounded-xl border border-white/10 p-6">
        <h3 class="text-lg font-bold text-white mb-3"><i class="fas fa-gavel text-emerald-400 mr-2"></i>Payment Terms</h3>
        <textarea id="im-terms" rows="3" class="w-full border border-white/15 rounded-lg px-3 py-2 text-sm">${f.terms}</textarea>
      </div>
    </div>

    <div class="flex justify-end gap-3 mb-8">
      <button onclick="window._im.backToList()" class="px-5 py-2.5 bg-gray-200 text-gray-300 rounded-xl text-sm font-medium">Cancel</button>
      <button onclick="window._im.saveDraft()" class="px-5 py-2.5 bg-gray-700 text-white rounded-xl text-sm font-medium"><i class="fas fa-save mr-1"></i>Save Draft</button>
      <button onclick="window._im.saveAndSend()" class="px-5 py-2.5 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-xl text-sm font-medium"><i class="fas fa-paper-plane mr-1"></i>Save & Send</button>
    </div>`;
  }

  // ============================================================
  // VIEW (print-friendly invoice view)
  // ============================================================
  function renderView() {
    const f = state.form;
    const cust = state.customers.find(c => c.id == f.customer_id) || {};
    const sub = calcSub();
    const disc = calcDisc();
    const tax = calcTax();
    const total = calcTotal();
    const isPaid = f._status === 'paid';
    const payLink = f._squareUrl || '';

    return `
    <div class="mb-4 flex items-center justify-between print:hidden">
      <button onclick="window._im.backToList()" class="text-gray-500 hover:text-gray-300 text-sm"><i class="fas fa-arrow-left mr-1"></i>Back</button>
      <div class="flex gap-2">
        <button onclick="window.print()" class="px-4 py-2 bg-gray-200 text-gray-300 rounded-lg text-sm font-medium"><i class="fas fa-print mr-1"></i>Print / PDF</button>
        ${payLink ? `<button onclick="window._im.copyPayLink()" class="px-4 py-2 bg-emerald-500/15 text-emerald-400 rounded-lg text-sm font-medium border border-green-200"><i class="fas fa-link mr-1"></i>Copy Payment Link</button>` : ''}
        ${!isPaid && f._status !== 'draft' && f._status !== 'cancelled' ? `<button onclick="window._im.markPaid(${state.editId})" class="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium"><i class="fas fa-check mr-1"></i>Mark Paid</button>` : ''}
      </div>
    </div>

    <div class="bg-[#111111] rounded-xl border border-white/10 shadow-sm overflow-hidden max-w-4xl mx-auto print:shadow-none">
      ${isPaid ? '<div class="bg-emerald-500/10 border-b border-green-200 px-8 py-3 text-green-700 text-sm font-medium"><i class="fas fa-check-circle mr-2"></i>PAID</div>' : ''}

      <div class="bg-gradient-to-r from-[#111111] to-[#1a1a1a] text-white p-8">
        <div class="flex justify-between items-start">
          <div>
            <div class="flex items-center gap-3 mb-2">
              <div class="w-10 h-10 bg-[#111111]/20 rounded-lg flex items-center justify-center"><i class="fas fa-home text-white text-lg"></i></div>
              <div><h1 class="text-xl font-bold">Roof Manager</h1><p class="text-blue-200 text-xs">Professional Roof Measurement Reports</p></div>
            </div>
            <p class="text-blue-200 text-sm">Alberta, Canada</p>
          </div>
          <div class="text-right">
            <h2 class="text-2xl font-bold">INVOICE</h2>
            <p class="text-blue-200 text-sm mt-1">${f.invoice_number}</p>
            <p class="text-blue-200 text-xs mt-2">Date: ${f.created_date}</p>
            <p class="text-blue-200 text-xs">Due: ${f.due_date}</p>
          </div>
        </div>
      </div>

      <div class="p-8 border-b border-white/10">
        <h3 class="text-xs font-semibold text-gray-500 uppercase mb-2">Bill To</h3>
        <p class="font-bold text-white">${cust.name || 'Customer'}</p>
        ${cust.company_name ? `<p class="text-gray-400 text-sm">${cust.company_name}</p>` : ''}
        ${cust.email ? `<p class="text-gray-500 text-sm">${cust.email}</p>` : ''}
      </div>

      <div class="p-8 border-b border-white/10">
        <table class="w-full text-sm">
          <thead class="bg-[#0A0A0A] border-b-2 border-white/10"><tr>
            <th class="px-4 py-2 text-left font-semibold text-gray-400">Description</th>
            <th class="px-4 py-2 text-center font-semibold text-gray-400">Qty</th>
            <th class="px-4 py-2 text-center font-semibold text-gray-400">Unit</th>
            <th class="px-4 py-2 text-right font-semibold text-gray-400">Price</th>
            <th class="px-4 py-2 text-right font-semibold text-gray-400">Amount</th>
          </tr></thead>
          <tbody>
            ${f.items.map(item => {
              const amt = (item.quantity || 0) * (item.unit_price || 0);
              return `<tr class="border-b border-white/5">
                <td class="px-4 py-2">${item.description}</td>
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
            ${disc > 0 ? `<div class="flex justify-between text-sm text-red-400"><span>Discount</span><span>-$${disc.toFixed(2)}</span></div>` : ''}
            <div class="flex justify-between text-sm"><span class="text-gray-500">GST (${f.tax_rate}%)</span><span>$${tax.toFixed(2)}</span></div>
            <div class="flex justify-between text-lg font-bold border-t-2 border-white/15 pt-2 mt-1"><span>Total (CAD)</span><span class="text-emerald-400">$${total.toFixed(2)}</span></div>
          </div>
        </div>
      </div>

      ${payLink ? `
      <div class="p-8 border-b border-white/10 bg-emerald-500/10">
        <h3 class="text-xs font-semibold text-green-700 uppercase mb-2"><i class="fas fa-credit-card mr-1"></i>Pay Online</h3>
        <a href="${payLink}" target="_blank" class="text-green-700 hover:text-green-900 text-sm font-medium underline">${payLink}</a>
        <p class="text-emerald-400 text-xs mt-1">Visa, Mastercard, Amex, Apple Pay, Google Pay</p>
      </div>` : ''}

      ${f.terms ? `<div class="p-8 border-b border-white/10"><h3 class="text-xs font-semibold text-gray-500 uppercase mb-2">Payment Terms</h3><div class="text-gray-300 text-sm whitespace-pre-wrap">${f.terms}</div></div>` : ''}
      ${f.notes ? `<div class="p-8 border-b border-white/10"><h3 class="text-xs font-semibold text-gray-500 uppercase mb-2">Notes</h3><div class="text-gray-300 text-sm whitespace-pre-wrap">${f.notes}</div></div>` : ''}

      ${f.attached_report_id ? `
      <div class="p-8 border-b border-white/10 bg-orange-50">
        <h3 class="text-xs font-semibold text-orange-700 uppercase mb-2"><i class="fas fa-file-pdf mr-1"></i>Attached Roof Report</h3>
        ${(() => { const rpt = state.reports.find(r => r.id == f.attached_report_id); return rpt ? `<p class="text-orange-800 text-sm font-medium">${rpt.property_address || 'Report #' + rpt.id}</p><p class="text-orange-600 text-xs mt-1">${rpt.roof_area_sqft ? Math.round(rpt.roof_area_sqft) + ' sq ft roof area' : ''} ${rpt.order_number ? '| Order: ' + rpt.order_number : ''}</p><a href="/api/reports/${rpt.order_id}/html" target="_blank" class="inline-block mt-2 text-xs font-medium text-orange-700 hover:text-orange-900 underline"><i class="fas fa-external-link-alt mr-1"></i>View Full Report</a>` : `<p class="text-orange-600 text-sm">Report #${f.attached_report_id} attached</p>`; })()}
      </div>` : ''}

      <div class="p-8 text-center text-gray-400 text-xs">
        <p>Thank you for your business!</p>
        <p class="mt-1">Roof Manager | reports@reusecanada.ca</p>
      </div>
    </div>`;
  }

  // ============================================================
  // CALCULATIONS
  // ============================================================
  function calcSub() { return state.form.items.reduce((s, i) => s + (i.quantity || 0) * (i.unit_price || 0), 0); }
  function calcDisc() {
    const f = state.form;
    const sub = calcSub();
    return f.discount_type === 'percentage' ? sub * (f.discount_amount / 100) : (f.discount_amount || 0);
  }
  function calcTax() {
    const sub = calcSub();
    const disc = calcDisc();
    const taxable = state.form.items.filter(i => i.is_taxable).reduce((s, i) => s + (i.quantity || 0) * (i.unit_price || 0), 0);
    const ratio = sub > 0 ? (sub - disc) / sub : 1;
    return Math.round(taxable * ratio * (state.form.tax_rate / 100) * 100) / 100;
  }
  function calcTotal() { return Math.round((calcSub() - calcDisc() + calcTax()) * 100) / 100; }

  function updTotals() {
    state.form.discount_type = (document.getElementById('im-disc-type') || {}).value || 'fixed';
    state.form.discount_amount = parseFloat((document.getElementById('im-discount') || {}).value) || 0;
    const s = document.getElementById('im-subtotal');
    const t = document.getElementById('im-tax');
    const g = document.getElementById('im-total');
    if (s) s.textContent = '$' + calcSub().toFixed(2);
    if (t) t.textContent = '$' + calcTax().toFixed(2);
    if (g) g.textContent = '$' + calcTotal().toFixed(2);
  }

  function collectForm() {
    const f = state.form;
    f.customer_id = (document.getElementById('im-customer') || {}).value || '';
    f.created_date = (document.getElementById('im-date') || {}).value || f.created_date;
    f.due_date = (document.getElementById('im-due') || {}).value || f.due_date;
    f.notes = (document.getElementById('im-notes') || {}).value || '';
    f.terms = (document.getElementById('im-terms') || {}).value || '';
    f.discount_type = (document.getElementById('im-disc-type') || {}).value || 'fixed';
    f.discount_amount = parseFloat((document.getElementById('im-discount') || {}).value) || 0;
    var reportSelect = document.getElementById('im-report');
    if (reportSelect) f.attached_report_id = reportSelect.value || null;
    return f;
  }

  // ============================================================
  // SAVE
  // ============================================================
  async function saveInvoice(andSend = false) {
    collectForm();
    const f = state.form;
    if (!f.customer_id) { imToast('Please select a customer', 'error'); return; }
    if (!f.items.some(i => i.description)) { imToast('Add at least one line item', 'error'); return; }

    try {
      const payload = {
        customer_id: f.customer_id,
        order_id: f.order_id || null,
        document_type: 'invoice',
        items: f.items.filter(i => i.description).map(i => ({
          description: i.description,
          quantity: parseFloat(i.quantity) || 1,
          unit_price: parseFloat(i.unit_price) || 0,
          unit: i.unit || 'each',
          is_taxable: i.is_taxable ? 1 : 0
        })),
        tax_rate: f.tax_rate,
        discount_amount: calcDisc(),
        notes: f.notes,
        terms: f.terms,
        due_days: Math.max(1, Math.round((new Date(f.due_date) - new Date(f.created_date)) / 86400000)),
        attached_report_id: f.attached_report_id || null
      };

      let res;
      if (state.editId) {
        res = await fetch('/api/invoices/' + state.editId, { method: 'PUT', headers: headers(), body: JSON.stringify(payload) });
      } else {
        res = await fetch('/api/invoices', { method: 'POST', headers: headers(), body: JSON.stringify(payload) });
      }

      if (!res.ok) { const e = await res.json().catch(() => ({})); imToast('Error: ' + (e.error || 'Unknown'), 'error'); return; }
      const data = await res.json();
      const invId = state.editId || data.invoice?.id;

      if (andSend && invId) {
        await fetch('/api/invoices/' + invId + '/send', { method: 'POST', headers: headers() });
      }

      imToast(andSend ? 'Invoice saved and sent!' : 'Invoice saved as draft!', 'success');
      state.mode = 'list';
      state.editId = null;
      state.form = resetForm();
      load();
    } catch (e) { imToast('Error: ' + e.message, 'error'); }
  }

  // ============================================================
  // PUBLIC API
  // ============================================================
  window._im = {
    connectSquare() {
      // Open Square OAuth in popup
      const popup = window.open('/api/square/oauth/start?token=' + token, 'square_oauth', 'width=700,height=600,scrollbars=yes');
      const handler = (e) => {
        if (e.data?.type === 'square_oauth_success') {
          window.removeEventListener('message', handler);
          if (popup) popup.close();
          // Refresh Square status
          fetch('/api/square/oauth/status', { headers: headers() })
            .then(r => r.json()).then(d => { state.squareStatus = d; render(); });
        } else if (e.data?.type === 'square_oauth_error') {
          window.removeEventListener('message', handler);
          imToast('Square connection failed: ' + (e.data.error || 'Unknown error'), 'error');
        }
      };
      window.addEventListener('message', handler);
    },
    async disconnectSquare() {
      if (!confirm('Disconnect your Square merchant account? Payment links will use the platform default account.')) return;
      await fetch('/api/square/oauth/disconnect', { method: 'POST', headers: headers() });
      state.squareStatus = { ...state.squareStatus, connected: false };
      render();
    },
    create() { state.mode = 'create'; state.editId = null; state.form = resetForm(); render(); },
    backToList() { state.mode = 'list'; state.editId = null; state.form = resetForm(); render(); },
    setFilter(f) { state.filter = f; render(); },
    setSearch(term) { state.searchTerm = term; render(); },
    addItem() { state.form.items.push({ description: '', quantity: 1, unit: 'each', unit_price: 0, is_taxable: true }); render(); },
    removeItem(i) { if (state.form.items.length > 1) { state.form.items.splice(i, 1); render(); } },
    updateItem(i, field, value) {
      if (field === 'quantity' || field === 'unit_price') value = parseFloat(value) || 0;
      if (field === 'is_taxable') value = !!value;
      state.form.items[i][field] = value;
      updTotals();
      const rows = document.querySelectorAll('#im-items-body tr');
      if (rows[i]) {
        const amt = (state.form.items[i].quantity || 0) * (state.form.items[i].unit_price || 0);
        const cells = rows[i].querySelectorAll('td');
        if (cells[4]) cells[4].innerHTML = '$' + amt.toFixed(2);
      }
    },
    updTotals,
    saveDraft() { saveInvoice(false); },
    saveAndSend() { saveInvoice(true); },
    async edit(id) {
      try {
        const res = await fetch('/api/invoices/' + id, { headers: headers() });
        if (!res.ok) return;
        const data = await res.json();
        const inv = data.invoice;
        const items = data.items || [];
        const payLinks = data.payment_links || [];
        const activeLink = payLinks.find(l => l.status !== 'cancelled') || {};
        state.editId = id;
        state.form = {
          customer_id: inv.customer_id,
          from_proposal_id: null,
          invoice_number: inv.invoice_number,
          created_date: (inv.created_at || '').slice(0, 10),
          due_date: inv.due_date || '',
          items: items.length > 0 ? items.map(i => ({
            description: i.description, quantity: i.quantity, unit: i.unit || 'each',
            unit_price: i.unit_price, is_taxable: i.is_taxable !== 0
          })) : [{ description: '', quantity: 1, unit: 'each', unit_price: 0, is_taxable: true }],
          discount_type: inv.discount_type || 'fixed',
          discount_amount: inv.discount_amount || 0,
          tax_rate: inv.tax_rate || 5.0,
          notes: inv.notes || '',
          terms: inv.terms || '',
          order_id: inv.order_id || null,
          attached_report_id: inv.attached_report_id || null,
          _status: inv.status,
          _squareUrl: activeLink.payment_link_url || inv.payment_link_url || ''
        };
        state.mode = 'edit';
        render();
      } catch (e) { imToast('Failed to load invoice', 'error'); }
    },
    async view(id) {
      await window._im.edit(id);
      state.mode = 'view';
      render();
    },
    async send(id) {
      if (!confirm('Send this invoice to the customer?')) return;
      try {
        await fetch('/api/invoices/' + id + '/send', { method: 'POST', headers: headers() });
        imToast('Invoice sent!', 'success');
        load();
      } catch (e) { imToast('Failed to send', 'error'); }
    },
    async markPaid(id) {
      if (!confirm('Mark this invoice as paid?')) return;
      try {
        const res = await fetch('/api/invoices/' + id + '/status', {
          method: 'PATCH',
          headers: headers(),
          body: JSON.stringify({ status: 'paid' })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          imToast('Failed to mark as paid: ' + (err.error || 'Unknown error'), 'error');
          return;
        }
        imToast('Invoice marked as paid!', 'success');
        load();
      } catch (e) { imToast('Operation failed. Please try again.', 'error'); }
    },
    async del(id) {
      if (!confirm('Delete this draft invoice?')) return;
      try { await fetch('/api/invoices/' + id, { method: 'DELETE', headers: headers() }); load(); } catch (e) { imToast('Operation failed. Please try again.', 'error'); }
    },
    async void(id) {
      if (!confirm('Void/cancel this invoice? This cannot be undone.')) return;
      try {
        await fetch('/api/invoices/' + id + '/status', {
          method: 'PATCH',
          headers: headers(),
          body: JSON.stringify({ status: 'cancelled' })
        });
        load();
      } catch (e) { imToast('Operation failed. Please try again.', 'error'); }
    },
    async createPaymentLink(id) {
      if (!confirm('Create a Square payment link for this invoice?')) return;
      try {
        const res = await fetch('/api/invoices/' + id + '/payment-link', {
          method: 'POST',
          headers: headers()
        });
        const data = await res.json();
        if (res.ok && data.payment_link?.url) {
          const url = data.payment_link.url;
          navigator.clipboard.writeText(url).then(() => {
            imToast('Payment link created and copied!', 'success');
          }).catch(() => {
            prompt('Payment link created! Copy it:', url);
          });
          load(); // Refresh to show the link in UI
        } else {
          imToast('Failed to create payment link: ' + (data.error || 'Unknown error'), 'error');
        }
      } catch (e) {
        imToast('Error creating payment link: ' + e.message, 'error');
      }
    },
    copyPayLink() {
      const url = state.form._squareUrl;
      if (url) { navigator.clipboard.writeText(url); imToast('Payment link copied!', 'success'); }
    },
    async fromProposal() {
      const proposals = state.proposals.filter(p => p.status !== 'cancelled' && p.status !== 'draft');
      if (proposals.length === 0) { imToast('No sent proposals found to convert', 'info'); return; }

      const opts = proposals.map(p => `${p.invoice_number} — $${(p.total || 0).toFixed(2)} — ${p.customer_name || 'Unknown'}`);
      const choice = prompt('Select proposal to convert to invoice (enter number 1-' + opts.length + '):\n\n' + opts.map((o, i) => (i + 1) + '. ' + o).join('\n'));
      const idx = parseInt(choice) - 1;
      if (isNaN(idx) || idx < 0 || idx >= proposals.length) return;

      const prop = proposals[idx];
      // Fetch full proposal data
      try {
        const res = await fetch('/api/invoices/' + prop.id, { headers: headers() });
        if (!res.ok) return;
        const data = await res.json();
        const inv = data.invoice;
        const items = data.items || [];
        state.editId = null;
        const today = new Date();
        const due = new Date(today); due.setDate(due.getDate() + 30);
        state.form = {
          customer_id: inv.customer_id,
          from_proposal_id: inv.id,
          invoice_number: 'INV-' + today.toISOString().slice(0, 10).replace(/-/g, '') + '-' + Math.floor(Math.random() * 9999).toString().padStart(4, '0'),
          created_date: today.toISOString().slice(0, 10),
          due_date: due.toISOString().slice(0, 10),
          items: items.map(i => ({
            description: i.description, quantity: i.quantity, unit: i.unit || 'each',
            unit_price: i.unit_price, is_taxable: i.is_taxable !== 0
          })),
          discount_type: inv.discount_type || 'fixed',
          discount_amount: inv.discount_amount || 0,
          tax_rate: inv.tax_rate || 5.0,
          notes: 'Created from proposal ' + inv.invoice_number,
          terms: inv.terms || 'Payment due within 30 days.',
          order_id: inv.order_id || null,
          attached_report_id: inv.attached_report_id || null
        };
        state.mode = 'create';
        render();
      } catch (e) { imToast('Failed to load proposal data', 'error'); }
    }
  };
});

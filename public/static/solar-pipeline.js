// ============================================================
// Solar Sales Pipeline — kanban board + commission tracking
// ============================================================
(function () {
  'use strict';

  var root = document.getElementById('solar-pipeline-root');
  var token = localStorage.getItem('rc_customer_token') || '';
  function authHeaders() { return { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }; }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function money(n) { return '$' + (Math.round(Number(n) || 0)).toLocaleString(); }

  var STAGES = [
    { key: 'new_lead',          label: 'New Lead',         color: 'bg-gray-600' },
    { key: 'appointment_set',   label: 'Appointment Set',  color: 'bg-blue-600' },
    { key: 'proposal_sent',     label: 'Proposal Sent',    color: 'bg-indigo-600' },
    { key: 'signed',            label: 'Signed',           color: 'bg-emerald-600' },
    { key: 'install_scheduled', label: 'Install Scheduled',color: 'bg-cyan-600' },
    { key: 'installed',         label: 'Installed',        color: 'bg-teal-600' },
    { key: 'paid',              label: 'Paid',             color: 'bg-green-700' },
    { key: 'lost',              label: 'Lost',             color: 'bg-red-700' },
  ];
  var SOURCES = [
    { key: 'door_knock', label: 'Door Knock' },
    { key: 'referral',   label: 'Referral' },
    { key: 'online',     label: 'Online / Web' },
    { key: 'event',      label: 'Event / Show' },
    { key: 'cold_call',  label: 'Cold Call' },
    { key: 'self_gen',   label: 'Self-Generated' },
    { key: 'other',      label: 'Other' },
  ];

  var state = { deals: [], stats: null, editing: null };

  function load() {
    Promise.all([
      fetch('/api/customer/solar-pipeline/', { headers: authHeaders() }).then(function(r){return r.json();}),
      fetch('/api/customer/solar-pipeline/stats', { headers: authHeaders() }).then(function(r){return r.json();}),
    ]).then(function(results) {
      state.deals = (results[0] && results[0].deals) || [];
      state.stats = results[1] || null;
      render();
    }).catch(function() { root.innerHTML = '<div class="text-red-300 p-8">Failed to load pipeline.</div>'; });
  }

  function render() {
    root.innerHTML = topBarHtml() + statsHtml() + kanbanHtml() + editorModalHtml();
    wireEvents();
  }

  function topBarHtml() {
    return '<div class="flex items-center justify-between mb-4">' +
      '<div class="text-white">' +
        '<h2 class="text-xl font-bold">Pipeline</h2>' +
        '<p class="text-xs text-gray-400">' + state.deals.length + ' active deals &middot; drag a card to change its stage</p>' +
      '</div>' +
      '<button onclick="window._spNewDeal()" class="bg-amber-500 hover:bg-amber-400 text-white px-4 py-2 rounded-lg font-bold text-sm"><i class="fas fa-plus mr-1"></i>New Deal</button>' +
    '</div>';
  }

  function statsHtml() {
    if (!state.stats) return '';
    var s = state.stats;
    var commissions = s.commissions || {};
    var totalCommissions = (commissions.setter_total || 0) + (commissions.closer_total || 0) + (commissions.installer_total || 0) + (commissions.override_total || 0);

    var bySourceMap = {};
    (s.by_source || []).forEach(function(r) { bySourceMap[r.lead_source] = r; });
    var sourceRows = SOURCES.map(function(src) {
      var row = bySourceMap[src.key] || { cnt: 0, won: 0 };
      var conv = row.cnt > 0 ? Math.round((row.won / row.cnt) * 100) : 0;
      return '<div class="flex justify-between py-1 text-xs"><span class="text-gray-300">' + src.label + '</span><span class="font-bold text-white">' + row.cnt + ' <span class="text-gray-500">(' + conv + '% won)</span></span></div>';
    }).join('');

    var topClosers = (s.top_closers || []).slice(0, 5).map(function(c) {
      return '<div class="flex justify-between py-1 text-xs"><span class="text-gray-300 truncate">' + esc(c.name) + '</span><span class="font-bold text-amber-400">' + money(c.commission) + '</span></div>';
    }).join('') || '<div class="text-xs text-gray-500">No closed deals yet.</div>';

    return '<div class="grid grid-cols-4 gap-3 mb-5">' +
      '<div class="bg-gray-800 rounded-xl p-4">' +
        '<div class="text-[10px] font-bold text-gray-400 uppercase mb-2">Setter Commissions</div>' +
        '<div class="text-2xl font-black text-emerald-400">' + money(commissions.setter_total) + '</div>' +
      '</div>' +
      '<div class="bg-gray-800 rounded-xl p-4">' +
        '<div class="text-[10px] font-bold text-gray-400 uppercase mb-2">Closer Commissions</div>' +
        '<div class="text-2xl font-black text-blue-400">' + money(commissions.closer_total) + '</div>' +
      '</div>' +
      '<div class="bg-gray-800 rounded-xl p-4">' +
        '<div class="text-[10px] font-bold text-gray-400 uppercase mb-2">Override / Mgmt</div>' +
        '<div class="text-2xl font-black text-purple-400">' + money(commissions.override_total) + '</div>' +
      '</div>' +
      '<div class="bg-gray-800 rounded-xl p-4">' +
        '<div class="text-[10px] font-bold text-gray-400 uppercase mb-2">Total Commissions</div>' +
        '<div class="text-2xl font-black text-amber-400">' + money(totalCommissions) + '</div>' +
      '</div>' +
      '<div class="bg-gray-800 rounded-xl p-4 col-span-2">' +
        '<div class="text-[10px] font-bold text-gray-400 uppercase mb-2">Leads by Source</div>' +
        sourceRows +
      '</div>' +
      '<div class="bg-gray-800 rounded-xl p-4 col-span-2">' +
        '<div class="text-[10px] font-bold text-gray-400 uppercase mb-2">Top Closers (Commission)</div>' +
        topClosers +
      '</div>' +
    '</div>';
  }

  function kanbanHtml() {
    var dealsByStage = {};
    STAGES.forEach(function(s) { dealsByStage[s.key] = []; });
    state.deals.forEach(function(d) {
      var key = dealsByStage[d.stage] ? d.stage : 'new_lead';
      dealsByStage[key].push(d);
    });

    var cols = STAGES.map(function(stage) {
      var items = dealsByStage[stage.key] || [];
      var stageValue = items.reduce(function(s, d) { return s + (Number(d.contract_value_cad) || 0); }, 0);
      var cards = items.map(function(d) {
        var src = (SOURCES.find(function(s) { return s.key === d.lead_source; }) || {}).label || d.lead_source || '';
        return '<div draggable="true" data-deal-id="' + d.id + '" class="sp-card bg-gray-900 border border-gray-700 rounded-lg p-3 mb-2 cursor-move hover:border-amber-500" onclick="window._spEditDeal(' + d.id + ')">' +
          '<div class="text-sm font-bold text-white truncate">' + esc(d.homeowner_name || '(No name)') + '</div>' +
          '<div class="text-[10px] text-gray-400 truncate mt-0.5"><i class="fas fa-map-marker-alt mr-1"></i>' + esc(d.property_address || '') + '</div>' +
          '<div class="flex items-center justify-between mt-2">' +
            '<span class="text-[10px] px-1.5 py-0.5 bg-gray-700 text-gray-300 rounded">' + esc(src) + '</span>' +
            '<span class="text-xs font-bold text-emerald-400">' + money(d.contract_value_cad) + '</span>' +
          '</div>' +
          (d.closer_name ? '<div class="text-[10px] text-gray-500 mt-1"><i class="fas fa-user mr-1"></i>' + esc(d.closer_name) + '</div>' : '') +
        '</div>';
      }).join('') || '<div class="text-[11px] text-gray-600 italic py-4 text-center">No deals</div>';

      return '<div class="sp-col bg-gray-800 rounded-xl p-3 flex-shrink-0 w-[230px]" data-stage="' + stage.key + '">' +
        '<div class="flex items-center justify-between mb-3">' +
          '<div>' +
            '<div class="text-xs font-bold text-white flex items-center"><span class="w-2 h-2 rounded-full ' + stage.color + ' mr-2"></span>' + stage.label + '</div>' +
            '<div class="text-[10px] text-gray-400 mt-0.5">' + items.length + ' &middot; ' + money(stageValue) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="sp-col-body min-h-[120px]">' + cards + '</div>' +
      '</div>';
    }).join('');

    return '<div class="flex gap-3 overflow-x-auto pb-4">' + cols + '</div>';
  }

  function editorModalHtml() {
    return '<div id="sp-modal" class="fixed inset-0 z-50 hidden items-center justify-center bg-black/60 backdrop-blur-sm p-4"><div class="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto text-white"><div id="sp-modal-body"></div></div></div>';
  }

  function openEditor(deal) {
    state.editing = deal || {
      stage: 'new_lead', lead_source: 'other',
      setter_commission_pct: 0, closer_commission_pct: 0, installer_commission_pct: 0, override_commission_pct: 0,
      contract_value_cad: 0, system_kw: 0,
    };
    var d = state.editing;
    var isNew = !d.id;

    function field(label, name, type, val) {
      type = type || 'text';
      return '<div><label class="block text-[11px] font-bold text-gray-400 uppercase mb-1">' + label + '</label><input name="' + name + '" type="' + type + '" value="' + esc(val == null ? '' : val) + '" class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white"/></div>';
    }
    function sel(label, name, options, val) {
      var opts = options.map(function(o) { return '<option value="' + o.key + '"' + (o.key === val ? ' selected' : '') + '>' + o.label + '</option>'; }).join('');
      return '<div><label class="block text-[11px] font-bold text-gray-400 uppercase mb-1">' + label + '</label><select name="' + name + '" class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white">' + opts + '</select></div>';
    }

    var body = '<div class="p-6">' +
      '<div class="flex items-center justify-between mb-5">' +
        '<h3 class="text-lg font-black">' + (isNew ? 'New Deal' : 'Edit Deal') + '</h3>' +
        '<button onclick="window._spCloseModal()" class="text-gray-400 hover:text-white text-xl">&times;</button>' +
      '</div>' +
      '<form id="sp-form" class="space-y-4">' +

        '<div class="text-[11px] font-bold text-amber-400 uppercase">Prospect</div>' +
        '<div class="grid grid-cols-2 gap-3">' +
          field('Homeowner Name', 'homeowner_name', 'text', d.homeowner_name) +
          field('Phone', 'homeowner_phone', 'tel', d.homeowner_phone) +
          field('Email', 'homeowner_email', 'email', d.homeowner_email) +
          field('Address', 'property_address', 'text', d.property_address) +
          field('City', 'property_city', 'text', d.property_city) +
          field('Province / State', 'property_province', 'text', d.property_province) +
        '</div>' +

        '<div class="text-[11px] font-bold text-amber-400 uppercase pt-2">Stage &amp; Source</div>' +
        '<div class="grid grid-cols-3 gap-3">' +
          sel('Stage', 'stage', STAGES, d.stage) +
          sel('Lead Source', 'lead_source', SOURCES, d.lead_source) +
          field('Source Detail', 'lead_source_detail', 'text', d.lead_source_detail) +
        '</div>' +
        (d.stage === 'lost' ? field('Lost Reason', 'lost_reason', 'text', d.lost_reason) : '') +

        '<div class="text-[11px] font-bold text-amber-400 uppercase pt-2">Sales Team</div>' +
        '<div class="grid grid-cols-3 gap-3">' +
          field('Setter', 'setter_name', 'text', d.setter_name) +
          field('Closer', 'closer_name', 'text', d.closer_name) +
          field('Installer', 'installer_name', 'text', d.installer_name) +
        '</div>' +

        '<div class="text-[11px] font-bold text-amber-400 uppercase pt-2">Commission Splits (%)</div>' +
        '<div class="grid grid-cols-4 gap-3">' +
          field('Setter %', 'setter_commission_pct', 'number', d.setter_commission_pct) +
          field('Closer %', 'closer_commission_pct', 'number', d.closer_commission_pct) +
          field('Installer %', 'installer_commission_pct', 'number', d.installer_commission_pct) +
          field('Override %', 'override_commission_pct', 'number', d.override_commission_pct) +
        '</div>' +

        '<div class="text-[11px] font-bold text-amber-400 uppercase pt-2">Deal Economics</div>' +
        '<div class="grid grid-cols-2 gap-3">' +
          field('System Size (kW)', 'system_kw', 'number', d.system_kw) +
          field('Contract Value (CAD)', 'contract_value_cad', 'number', d.contract_value_cad) +
        '</div>' +
        '<div><label class="block text-[11px] font-bold text-gray-400 uppercase mb-1">Notes</label><textarea name="notes" rows="3" class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white">' + esc(d.notes || '') + '</textarea></div>' +

        '<div class="flex items-center justify-between pt-4 border-t border-gray-700">' +
          (isNew ? '<span></span>' : '<button type="button" onclick="window._spDelete(' + d.id + ')" class="text-red-400 hover:text-red-300 text-sm font-semibold"><i class="fas fa-trash mr-1"></i>Delete</button>') +
          '<div class="flex gap-2">' +
            '<button type="button" onclick="window._spCloseModal()" class="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-semibold">Cancel</button>' +
            '<button type="submit" class="px-6 py-2 bg-amber-500 hover:bg-amber-400 rounded-lg text-sm font-bold">' + (isNew ? 'Create Deal' : 'Save Changes') + '</button>' +
          '</div>' +
        '</div>' +
      '</form>' +
    '</div>';
    document.getElementById('sp-modal-body').innerHTML = body;
    var modal = document.getElementById('sp-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.getElementById('sp-form').addEventListener('submit', function(e) {
      e.preventDefault();
      submitForm(e.target);
    });
  }

  function submitForm(form) {
    var fd = new FormData(form);
    var payload = {};
    fd.forEach(function(v, k) { payload[k] = v; });
    var isNew = !state.editing || !state.editing.id;
    var url = isNew ? '/api/customer/solar-pipeline/' : '/api/customer/solar-pipeline/' + state.editing.id;
    var method = isNew ? 'POST' : 'PATCH';
    fetch(url, { method: method, headers: authHeaders(), body: JSON.stringify(payload) })
      .then(function(r) { return r.json(); })
      .then(function() { window._spCloseModal(); load(); });
  }

  window._spNewDeal = function() { openEditor(null); };
  window._spEditDeal = function(id) {
    var d = state.deals.find(function(x) { return x.id === id; });
    if (d) openEditor(d);
  };
  window._spCloseModal = function() {
    var m = document.getElementById('sp-modal');
    if (m) { m.classList.add('hidden'); m.classList.remove('flex'); }
    state.editing = null;
  };
  window._spDelete = function(id) {
    if (!confirm('Delete this deal?')) return;
    fetch('/api/customer/solar-pipeline/' + id, { method: 'DELETE', headers: authHeaders() })
      .then(function() { window._spCloseModal(); load(); });
  };

  // Drag & drop between stage columns
  function wireEvents() {
    var draggingId = null;
    var cards = document.querySelectorAll('.sp-card');
    cards.forEach(function(c) {
      c.addEventListener('dragstart', function(e) {
        draggingId = c.getAttribute('data-deal-id');
        c.style.opacity = '0.4';
        e.dataTransfer && (e.dataTransfer.effectAllowed = 'move');
      });
      c.addEventListener('dragend', function() { c.style.opacity = '1'; draggingId = null; });
    });
    var cols = document.querySelectorAll('.sp-col');
    cols.forEach(function(col) {
      col.addEventListener('dragover', function(e) { e.preventDefault(); col.classList.add('ring-2','ring-amber-400'); });
      col.addEventListener('dragleave', function() { col.classList.remove('ring-2','ring-amber-400'); });
      col.addEventListener('drop', function(e) {
        e.preventDefault();
        col.classList.remove('ring-2','ring-amber-400');
        if (!draggingId) return;
        var newStage = col.getAttribute('data-stage');
        fetch('/api/customer/solar-pipeline/' + draggingId, {
          method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ stage: newStage })
        }).then(function() { load(); });
      });
    });
  }

  load();
})();

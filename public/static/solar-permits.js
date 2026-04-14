// ============================================================
// Solar Permits — permitting management for solar sales companies
// ============================================================
(function () {
  'use strict';
  var root = document.getElementById('solar-permits-root');
  if (!root) return;
  var token = localStorage.getItem('rc_customer_token') || '';
  function hdr() { return { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }; }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  var STATUSES = [
    { k:'not_started',          l:'Not Started',           c:'bg-gray-600' },
    { k:'preparing',            l:'Preparing',             c:'bg-yellow-600' },
    { k:'submitted',            l:'Submitted',             c:'bg-blue-600' },
    { k:'under_review',         l:'Under Review',          c:'bg-indigo-600' },
    { k:'approved',             l:'Approved',              c:'bg-emerald-600' },
    { k:'rejected',             l:'Rejected',              c:'bg-red-700' },
    { k:'inspection_scheduled', l:'Inspection Scheduled',  c:'bg-cyan-600' },
    { k:'passed_inspection',    l:'Passed Inspection',     c:'bg-teal-600' },
    { k:'closed',               l:'Closed',                c:'bg-gray-700' },
  ];
  var TYPES = ['building','electrical','pv','interconnection','other'];

  function sMeta(k){ return STATUSES.find(function(s){return s.k===k;}) || { l:k, c:'bg-gray-600' }; }

  var state = { permits: [], stats: null, filter: '' };

  function load() {
    Promise.all([
      fetch('/api/customer/solar-permits' + (state.filter ? '?status='+state.filter : ''), { headers: hdr() }).then(function(r){return r.json();}),
      fetch('/api/customer/solar-permits/stats', { headers: hdr() }).then(function(r){return r.json();}),
    ]).then(function(rs){ state.permits = rs[0].permits || []; state.stats = rs[1]; render(); });
  }

  function render() {
    var counts = {}; (state.stats && state.stats.by_status || []).forEach(function(r){ counts[r.status] = r.cnt; });

    var statTiles = STATUSES.map(function(s){
      var n = counts[s.k] || 0;
      var active = state.filter === s.k;
      return '<button data-filter="' + s.k + '" class="' + (active?'ring-2 ring-amber-400 ':'') + s.c + ' text-white rounded-lg p-3 text-left">' +
        '<div class="text-xs opacity-80">' + s.l + '</div><div class="text-xl font-bold">' + n + '</div></button>';
    }).join('');

    root.innerHTML =
      '<div class="flex items-center justify-between mb-6">' +
        '<div>' +
          '<h2 class="text-2xl font-bold text-white">Permitting Management</h2>' +
          '<p class="text-gray-400 text-sm">Track permits, submissions, inspections, and fees by jurisdiction.</p>' +
        '</div>' +
        '<div class="flex gap-2">' +
          (state.filter ? '<button id="clear" class="text-gray-400 hover:text-white text-sm">Clear filter</button>' : '') +
          '<button id="addBtn" class="bg-amber-500 hover:bg-amber-600 text-white font-semibold px-4 py-2 rounded-lg"><i class="fas fa-plus mr-2"></i>New Permit</button>' +
        '</div>' +
      '</div>' +
      '<div class="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-9 gap-2 mb-6">' + statTiles + '</div>' +
      '<div class="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">' +
        '<table class="w-full text-sm">' +
          '<thead class="bg-gray-900 text-gray-400 text-xs uppercase"><tr>' +
            '<th class="text-left px-4 py-3">Homeowner</th>' +
            '<th class="text-left px-4 py-3">Jurisdiction</th>' +
            '<th class="text-left px-4 py-3">Type</th>' +
            '<th class="text-left px-4 py-3">Permit #</th>' +
            '<th class="text-left px-4 py-3">Status</th>' +
            '<th class="text-right px-4 py-3">Fee</th>' +
            '<th class="text-left px-4 py-3">Inspection</th>' +
            '<th></th></tr></thead><tbody id="rows"></tbody></table></div>';

    var rows = document.getElementById('rows');
    if (!state.permits.length) {
      rows.innerHTML = '<tr><td colspan="8" class="text-center text-gray-500 py-10">No permits yet. Click "New Permit" to add one.</td></tr>';
    } else {
      rows.innerHTML = state.permits.map(function(p){
        var m = sMeta(p.status);
        return '<tr class="border-t border-gray-700 hover:bg-gray-700/30">' +
          '<td class="px-4 py-3 text-white">' + esc(p.homeowner_name||'—') + '<div class="text-xs text-gray-500">' + esc(p.property_address||'') + '</div></td>' +
          '<td class="px-4 py-3 text-gray-300">' + esc(p.jurisdiction||'—') + '</td>' +
          '<td class="px-4 py-3 text-gray-300">' + esc(p.permit_type||'—') + '</td>' +
          '<td class="px-4 py-3 text-gray-300">' + esc(p.permit_number||'—') + '</td>' +
          '<td class="px-4 py-3"><span class="' + m.c + ' text-white text-xs font-semibold px-2 py-1 rounded">' + esc(m.l) + '</span></td>' +
          '<td class="px-4 py-3 text-right text-gray-300">$' + (Math.round(Number(p.fee_cad)||0)).toLocaleString() + '</td>' +
          '<td class="px-4 py-3 text-gray-300 text-xs">' + esc(p.inspection_at||'—') + (p.inspector_name?'<div class="text-gray-500">'+esc(p.inspector_name)+'</div>':'') + '</td>' +
          '<td class="px-4 py-3 text-right">' +
            '<button data-edit="' + p.id + '" class="text-blue-400 hover:text-blue-300 mr-2"><i class="fas fa-edit"></i></button>' +
            '<button data-del="' + p.id + '" class="text-red-400 hover:text-red-300"><i class="fas fa-trash"></i></button>' +
          '</td></tr>';
      }).join('');
    }

    document.getElementById('addBtn').onclick = function(){ openEditor(null); };
    var clr = document.getElementById('clear'); if (clr) clr.onclick = function(){ state.filter=''; load(); };
    document.querySelectorAll('[data-filter]').forEach(function(b){ b.onclick = function(){ state.filter = b.getAttribute('data-filter'); load(); }; });
    document.querySelectorAll('[data-edit]').forEach(function(b){ b.onclick = function(){ openEditor(Number(b.getAttribute('data-edit'))); }; });
    document.querySelectorAll('[data-del]').forEach(function(b){ b.onclick = function(){
      if (!confirm('Delete this permit?')) return;
      fetch('/api/customer/solar-permits/' + b.getAttribute('data-del'), { method:'DELETE', headers:hdr() }).then(load);
    }; });
  }

  function openEditor(id) {
    var p = id ? state.permits.find(function(x){return x.id===id;}) : {};
    var html =
      '<div id="modal" class="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 overflow-y-auto"><div class="bg-gray-900 border border-gray-700 rounded-xl max-w-2xl w-full p-6 my-8">' +
        '<h3 class="text-xl font-bold text-white mb-4">' + (id?'Edit Permit':'New Permit') + '</h3>' +
        '<div class="grid grid-cols-2 gap-3">' +
          inp('f_home','Homeowner name', p.homeowner_name) +
          inp('f_addr','Property address', p.property_address) +
          inp('f_jur','Jurisdiction (city/AHJ)', p.jurisdiction) +
          sel('f_type','Permit type', TYPES.map(function(t){return{k:t,l:t};}), p.permit_type) +
          inp('f_num','Permit number', p.permit_number) +
          sel('f_status','Status', STATUSES, p.status || 'not_started') +
          inp('f_fee','Fee (CAD)', p.fee_cad, 'number') +
          inp('f_sub','Submitted at (YYYY-MM-DD)', p.submitted_at) +
          inp('f_app','Approved at (YYYY-MM-DD)', p.approved_at) +
          inp('f_insp','Inspection at (YYYY-MM-DD)', p.inspection_at) +
          inp('f_inspn','Inspector name', p.inspector_name) +
          inp('f_doc','Document URL', p.document_url) +
        '</div>' +
        '<textarea id="f_notes" rows="3" class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white mt-3" placeholder="Notes">' + esc(p.notes||'') + '</textarea>' +
        '<textarea id="f_inotes" rows="2" class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white mt-3" placeholder="Inspector notes">' + esc(p.inspector_notes||'') + '</textarea>' +
        '<textarea id="f_rej" rows="2" class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white mt-3" placeholder="Rejection reason (if any)">' + esc(p.rejection_reason||'') + '</textarea>' +
        '<div class="flex justify-end gap-2 mt-5">' +
          '<button id="cancel" class="px-4 py-2 text-gray-300 hover:text-white">Cancel</button>' +
          '<button id="save" class="bg-amber-500 hover:bg-amber-600 text-white font-semibold px-4 py-2 rounded-lg">Save</button>' +
        '</div>' +
      '</div></div>';
    document.body.insertAdjacentHTML('beforeend', html);
    var m = document.getElementById('modal');
    document.getElementById('cancel').onclick = function(){ m.remove(); };
    document.getElementById('save').onclick = function(){
      var body = {
        homeowner_name: val('f_home'), property_address: val('f_addr'),
        jurisdiction: val('f_jur'), permit_type: val('f_type'), permit_number: val('f_num'),
        status: val('f_status'), fee_cad: Number(val('f_fee'))||0,
        submitted_at: val('f_sub'), approved_at: val('f_app'), inspection_at: val('f_insp'),
        inspector_name: val('f_inspn'), document_url: val('f_doc'),
        notes: val('f_notes'), inspector_notes: val('f_inotes'), rejection_reason: val('f_rej'),
      };
      var url = '/api/customer/solar-permits' + (id ? '/' + id : '');
      var method = id ? 'PATCH' : 'POST';
      fetch(url, { method: method, headers: hdr(), body: JSON.stringify(body) })
        .then(function(r){return r.json();}).then(function(){ m.remove(); load(); });
    };
  }

  function inp(id, ph, v, type) {
    return '<input id="' + id + '" type="' + (type||'text') + '" placeholder="' + ph + '" class="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white" value="' + esc(v==null?'':v) + '">';
  }
  function sel(id, ph, opts, v) {
    return '<select id="' + id + '" class="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white">' +
      '<option value="">' + ph + '</option>' +
      opts.map(function(o){ return '<option value="' + o.k + '"' + (v===o.k?' selected':'') + '>' + o.l + '</option>'; }).join('') +
    '</select>';
  }
  function val(id){ var e = document.getElementById(id); return e ? e.value : ''; }

  load();
})();

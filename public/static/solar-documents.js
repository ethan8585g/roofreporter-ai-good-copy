// ============================================================
// Solar Proposal Documents — contracts, agreements, install paperwork
// URL: /customer/solar-documents?deal=<id>  (per-deal view)
// URL: /customer/solar-documents             (company template library)
// ============================================================
(function () {
  'use strict';
  var root = document.getElementById('solar-documents-root');
  if (!root) return;
  var token = localStorage.getItem('rc_customer_token') || '';
  function hdr() { return { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }; }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  var params = new URLSearchParams(location.search);
  var dealId = params.get('deal');
  var state = { docs: [], templates: [] };

  var TYPES = [
    { k: 'contract',          l: 'Contract' },
    { k: 'agreement',         l: 'Agreement' },
    { k: 'install_paperwork', l: 'Install Paperwork' },
    { k: 'disclosure',        l: 'Disclosure' },
    { k: 'financing',         l: 'Financing Doc' },
    { k: 'other',             l: 'Other' },
  ];
  function typeLabel(k){ var t = TYPES.find(function(x){return x.k===k;}); return t?t.l:k; }

  function load() {
    var urls = dealId
      ? [ '/api/customer/solar-documents?deal_id=' + dealId, '/api/customer/solar-documents?is_template=1' ]
      : [ '/api/customer/solar-documents?is_template=1' ];
    Promise.all(urls.map(function(u){ return fetch(u, { headers: hdr() }).then(function(r){return r.json();}); }))
      .then(function(rs){
        if (dealId) { state.docs = rs[0].documents || []; state.templates = rs[1].documents || []; }
        else { state.templates = rs[0].documents || []; state.docs = []; }
        render();
      });
  }

  function render() {
    var heading = dealId
      ? '<h2 class="text-2xl font-bold text-white">Deal Documents</h2><p class="text-gray-400 text-sm">Attach contracts, agreements, and install paperwork to this deal.</p>'
      : '<h2 class="text-2xl font-bold text-white">Document Template Library</h2><p class="text-gray-400 text-sm">Pre-set company templates — attach any of these to a deal in one click.</p>';

    var attachSection = '';
    if (dealId) {
      attachSection =
        '<div class="bg-gray-800 border border-gray-700 rounded-lg p-4 mb-6">' +
          '<h3 class="text-white font-semibold mb-3"><i class="fas fa-folder-open text-amber-400 mr-2"></i>Attach from Template</h3>' +
          (state.templates.length
            ? '<div class="grid gap-2">' + state.templates.map(function(t){
                return '<div class="flex items-center justify-between bg-gray-900 rounded p-2">' +
                  '<div><span class="text-white text-sm">' + esc(t.title) + '</span> <span class="text-xs text-gray-500 ml-2">' + typeLabel(t.doc_type) + '</span></div>' +
                  '<button data-att="' + t.id + '" class="bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold px-3 py-1 rounded">Attach</button>' +
                '</div>';
              }).join('') + '</div>'
            : '<p class="text-gray-500 text-sm">No templates yet. Create one below, then reuse it on any deal.</p>') +
        '</div>';
    }

    var listDocs = dealId ? state.docs : state.templates;
    var listTitle = dealId ? 'Attached to this deal' : 'Templates';

    root.innerHTML =
      '<div class="flex items-center justify-between mb-6"><div>' + heading + '</div>' +
        '<button id="addBtn" class="bg-amber-500 hover:bg-amber-600 text-white font-semibold px-4 py-2 rounded-lg"><i class="fas fa-plus mr-2"></i>' + (dealId?'Add Document':'New Template') + '</button>' +
      '</div>' +
      attachSection +
      '<h3 class="text-white font-semibold mb-2">' + listTitle + '</h3>' +
      '<div id="list" class="grid gap-3"></div>';

    var list = document.getElementById('list');
    if (!listDocs.length) {
      list.innerHTML = '<div class="bg-gray-800 border border-gray-700 rounded-lg p-6 text-center text-gray-400">No documents yet.</div>';
    } else {
      list.innerHTML = listDocs.map(function(d){
        return '<div class="bg-gray-800 border border-gray-700 rounded-lg p-4 flex items-center gap-4">' +
          '<i class="fas fa-file-signature text-3xl text-amber-400"></i>' +
          '<div class="flex-1">' +
            '<div class="flex items-center gap-2"><h4 class="text-white font-semibold">' + esc(d.title) + '</h4>' +
              '<span class="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded">' + typeLabel(d.doc_type) + '</span>' +
              (d.signed ? '<span class="text-xs bg-emerald-600/30 text-emerald-300 px-2 py-0.5 rounded">Signed</span>' : '') +
              (d.is_template ? '<span class="text-xs bg-blue-600/30 text-blue-300 px-2 py-0.5 rounded">Template</span>' : '') +
            '</div>' +
            (d.file_url ? '<a href="' + esc(d.file_url) + '" target="_blank" class="text-amber-400 hover:text-amber-300 text-sm"><i class="fas fa-external-link-alt mr-1"></i>Open file</a>' : '<span class="text-gray-500 text-sm">No file link</span>') +
            (d.notes ? '<p class="text-gray-400 text-sm mt-1">' + esc(d.notes) + '</p>' : '') +
          '</div>' +
          '<div class="flex flex-col gap-1">' +
            (!d.is_template ? '<button data-sign="' + d.id + '" data-signed="' + (d.signed?1:0) + '" class="text-emerald-400 hover:text-emerald-300 text-sm"><i class="fas fa-check"></i> ' + (d.signed?'Unmark':'Mark Signed') + '</button>' : '') +
            '<button data-edit="' + d.id + '" class="text-blue-400 hover:text-blue-300 text-sm"><i class="fas fa-edit"></i> Edit</button>' +
            '<button data-del="' + d.id + '" class="text-red-400 hover:text-red-300 text-sm"><i class="fas fa-trash"></i> Delete</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    document.getElementById('addBtn').onclick = function(){ openEditor(null); };
    document.querySelectorAll('[data-att]').forEach(function(b){ b.onclick = function(){
      fetch('/api/customer/solar-documents/attach', { method:'POST', headers:hdr(), body: JSON.stringify({ template_id: Number(b.getAttribute('data-att')), deal_id: Number(dealId) }) }).then(load);
    }; });
    document.querySelectorAll('[data-edit]').forEach(function(b){ b.onclick = function(){ openEditor(Number(b.getAttribute('data-edit'))); }; });
    document.querySelectorAll('[data-del]').forEach(function(b){ b.onclick = function(){
      if (!confirm('Delete this document?')) return;
      fetch('/api/customer/solar-documents/' + b.getAttribute('data-del'), { method:'DELETE', headers:hdr() }).then(load);
    }; });
    document.querySelectorAll('[data-sign]').forEach(function(b){ b.onclick = function(){
      var signed = b.getAttribute('data-signed') === '1' ? 0 : 1;
      fetch('/api/customer/solar-documents/' + b.getAttribute('data-sign'), { method:'PATCH', headers:hdr(), body: JSON.stringify({ signed: signed }) }).then(load);
    }; });
  }

  function openEditor(id) {
    var all = state.docs.concat(state.templates);
    var d = id ? all.find(function(x){return x.id===id;}) : {};
    var isTpl = id ? !!d.is_template : !dealId;
    var html =
      '<div id="modal" class="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"><div class="bg-gray-900 border border-gray-700 rounded-xl max-w-xl w-full p-6">' +
        '<h3 class="text-xl font-bold text-white mb-4">' + (id ? 'Edit Document' : (isTpl ? 'New Template' : 'New Document')) + '</h3>' +
        '<div class="space-y-3">' +
          '<input id="f_title" class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white" placeholder="Title" value="' + esc(d.title||'') + '">' +
          '<select id="f_type" class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white">' +
            TYPES.map(function(t){ return '<option value="' + t.k + '"' + (d.doc_type===t.k?' selected':'') + '>' + t.l + '</option>'; }).join('') +
          '</select>' +
          '<input id="f_url" class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white" placeholder="File URL (Dropbox, Drive, DocuSign, etc.)" value="' + esc(d.file_url||'') + '">' +
          '<textarea id="f_notes" rows="3" class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white" placeholder="Notes">' + esc(d.notes||'') + '</textarea>' +
        '</div>' +
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
        title: document.getElementById('f_title').value,
        doc_type: document.getElementById('f_type').value,
        file_url: document.getElementById('f_url').value,
        notes: document.getElementById('f_notes').value,
      };
      if (!id) {
        body.is_template = isTpl ? 1 : 0;
        if (!isTpl && dealId) body.deal_id = Number(dealId);
      }
      if (!body.title) { alert('Title required'); return; }
      var url = '/api/customer/solar-documents' + (id ? '/' + id : '');
      var method = id ? 'PATCH' : 'POST';
      fetch(url, { method: method, headers: hdr(), body: JSON.stringify(body) }).then(function(r){return r.json();}).then(function(){ m.remove(); load(); });
    };
  }

  load();
})();

// ============================================================
// Solar Presentation — pre-set homeowner slide deck
// ============================================================
(function () {
  'use strict';
  var root = document.getElementById('solar-presentation-root');
  if (!root) return;
  var token = localStorage.getItem('rc_customer_token') || '';
  function hdr() { return { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }; }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  var state = { slides: [], mode: 'edit', idx: 0 };

  function load() {
    fetch('/api/customer/solar-presentation', { headers: hdr() })
      .then(function(r){return r.json();})
      .then(function(d){ state.slides = d.slides || []; render(); });
  }

  function render() {
    if (state.mode === 'present') return renderPresent();
    root.innerHTML =
      '<div class="flex items-center justify-between mb-6">' +
        '<div>' +
          '<h2 class="text-2xl font-bold text-white">Your Solar Presentation</h2>' +
          '<p class="text-gray-400 text-sm">Build the deck you show homeowners at the door or kitchen table.</p>' +
        '</div>' +
        '<div class="flex gap-2">' +
          '<button id="addBtn" class="bg-amber-500 hover:bg-amber-600 text-white font-semibold px-4 py-2 rounded-lg"><i class="fas fa-plus mr-2"></i>Add Slide</button>' +
          (state.slides.length ? '<button id="presentBtn" class="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-4 py-2 rounded-lg"><i class="fas fa-play mr-2"></i>Present</button>' : '') +
        '</div>' +
      '</div>' +
      '<div id="slides" class="grid gap-4"></div>';

    var list = document.getElementById('slides');
    if (!state.slides.length) {
      list.innerHTML = '<div class="bg-gray-800 border border-gray-700 rounded-lg p-8 text-center text-gray-400">No slides yet. Click "Add Slide" to start building your presentation.</div>';
    } else {
      list.innerHTML = state.slides.map(function(s, i){
        return '<div class="bg-gray-800 border border-gray-700 rounded-lg p-4 flex gap-4">' +
          '<div class="flex flex-col items-center text-gray-500 text-xs pt-2">' +
            '<span class="font-bold text-amber-400 text-lg">' + (i+1) + '</span>' +
            '<button data-mv="up" data-id="' + s.id + '" class="hover:text-white mt-2"><i class="fas fa-arrow-up"></i></button>' +
            '<button data-mv="down" data-id="' + s.id + '" class="hover:text-white mt-1"><i class="fas fa-arrow-down"></i></button>' +
          '</div>' +
          (s.image_url ? '<img src="' + esc(s.image_url) + '" class="w-32 h-24 object-cover rounded">' : '<div class="w-32 h-24 bg-gray-700 rounded flex items-center justify-center text-gray-500"><i class="fas fa-image"></i></div>') +
          '<div class="flex-1">' +
            '<h3 class="text-white font-semibold">' + esc(s.title || '(untitled)') + '</h3>' +
            '<p class="text-gray-400 text-sm mt-1 line-clamp-2">' + esc((s.body||'').slice(0,160)) + '</p>' +
            (s.cta_label ? '<span class="inline-block mt-2 text-xs bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded">CTA: ' + esc(s.cta_label) + '</span>' : '') +
          '</div>' +
          '<div class="flex flex-col gap-2">' +
            '<button data-edit="' + s.id + '" class="text-blue-400 hover:text-blue-300 text-sm"><i class="fas fa-edit"></i> Edit</button>' +
            '<button data-del="' + s.id + '" class="text-red-400 hover:text-red-300 text-sm"><i class="fas fa-trash"></i> Delete</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    document.getElementById('addBtn').onclick = function(){ openEditor(null); };
    var pb = document.getElementById('presentBtn'); if (pb) pb.onclick = function(){ state.mode='present'; state.idx=0; render(); };
    list.querySelectorAll('[data-edit]').forEach(function(b){ b.onclick = function(){ openEditor(Number(b.getAttribute('data-edit'))); }; });
    list.querySelectorAll('[data-del]').forEach(function(b){ b.onclick = function(){
      if (!confirm('Delete this slide?')) return;
      fetch('/api/customer/solar-presentation/' + b.getAttribute('data-del'), { method: 'DELETE', headers: hdr() }).then(load);
    }; });
    list.querySelectorAll('[data-mv]').forEach(function(b){ b.onclick = function(){
      var id = Number(b.getAttribute('data-id'));
      var dir = b.getAttribute('data-mv') === 'up' ? -1 : 1;
      var i = state.slides.findIndex(function(s){return s.id===id;});
      var j = i + dir; if (j<0 || j>=state.slides.length) return;
      var arr = state.slides.slice();
      var tmp = arr[i]; arr[i]=arr[j]; arr[j]=tmp;
      fetch('/api/customer/solar-presentation/reorder', { method:'POST', headers:hdr(), body: JSON.stringify({ order: arr.map(function(s){return s.id;}) }) }).then(load);
    }; });
  }

  function openEditor(id) {
    var s = id ? state.slides.find(function(x){return x.id===id;}) : {};
    var html =
      '<div id="modal" class="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"><div class="bg-gray-900 border border-gray-700 rounded-xl max-w-xl w-full p-6">' +
        '<h3 class="text-xl font-bold text-white mb-4">' + (id ? 'Edit Slide' : 'New Slide') + '</h3>' +
        '<div class="space-y-3">' +
          '<input id="f_title" class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white" placeholder="Title" value="' + esc(s.title||'') + '">' +
          '<textarea id="f_body" rows="5" class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white" placeholder="Talking points / body">' + esc(s.body||'') + '</textarea>' +
          '<input id="f_image" class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white" placeholder="Image URL (https://...)" value="' + esc(s.image_url||'') + '">' +
          '<input id="f_video" class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white" placeholder="Video URL (YouTube/Vimeo)" value="' + esc(s.video_url||'') + '">' +
          '<div class="grid grid-cols-2 gap-2">' +
            '<input id="f_ctalabel" class="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white" placeholder="CTA label" value="' + esc(s.cta_label||'') + '">' +
            '<input id="f_ctaurl" class="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white" placeholder="CTA url" value="' + esc(s.cta_url||'') + '">' +
          '</div>' +
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
        body: document.getElementById('f_body').value,
        image_url: document.getElementById('f_image').value,
        video_url: document.getElementById('f_video').value,
        cta_label: document.getElementById('f_ctalabel').value,
        cta_url: document.getElementById('f_ctaurl').value,
      };
      var url = '/api/customer/solar-presentation' + (id ? '/' + id : '');
      var method = id ? 'PATCH' : 'POST';
      fetch(url, { method: method, headers: hdr(), body: JSON.stringify(body) })
        .then(function(r){return r.json();})
        .then(function(){ m.remove(); load(); });
    };
  }

  function renderPresent() {
    var s = state.slides[state.idx]; if (!s) { state.mode='edit'; return render(); }
    root.innerHTML =
      '<div class="bg-gradient-to-br from-gray-900 to-black rounded-2xl p-10 min-h-[70vh] flex flex-col">' +
        '<div class="flex justify-between items-start mb-6">' +
          '<span class="text-amber-400 text-sm font-semibold">Slide ' + (state.idx+1) + ' / ' + state.slides.length + '</span>' +
          '<button id="exit" class="text-gray-400 hover:text-white"><i class="fas fa-times text-xl"></i></button>' +
        '</div>' +
        (s.image_url ? '<img src="' + esc(s.image_url) + '" class="max-h-72 mx-auto rounded-lg object-contain mb-6">' : '') +
        '<h1 class="text-4xl font-bold text-white mb-4 text-center">' + esc(s.title||'') + '</h1>' +
        '<div class="text-gray-300 text-lg max-w-3xl mx-auto whitespace-pre-wrap">' + esc(s.body||'') + '</div>' +
        (s.cta_label ? '<div class="mt-8 text-center"><a href="' + esc(s.cta_url||'#') + '" target="_blank" class="inline-block bg-amber-500 hover:bg-amber-600 text-white font-bold px-6 py-3 rounded-lg">' + esc(s.cta_label) + '</a></div>' : '') +
        '<div class="mt-auto pt-8 flex justify-between">' +
          '<button id="prev" class="bg-gray-800 hover:bg-gray-700 text-white px-6 py-3 rounded-lg" ' + (state.idx===0?'disabled':'') + '><i class="fas fa-arrow-left mr-2"></i>Back</button>' +
          '<button id="next" class="bg-amber-500 hover:bg-amber-600 text-white font-semibold px-6 py-3 rounded-lg" ' + (state.idx>=state.slides.length-1?'disabled':'') + '>Next<i class="fas fa-arrow-right ml-2"></i></button>' +
        '</div>' +
      '</div>';
    document.getElementById('exit').onclick = function(){ state.mode='edit'; render(); };
    document.getElementById('prev').onclick = function(){ if(state.idx>0){state.idx--; render();} };
    document.getElementById('next').onclick = function(){ if(state.idx<state.slides.length-1){state.idx++; render();} };
  }

  load();
})();

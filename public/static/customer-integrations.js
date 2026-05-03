// ============================================================
// Roof Manager — API Connections page
// Lets a customer manage outbound CRM webhook endpoints
// (AccuLynx / JobNimbus / Roofr / Custom).
// ============================================================
(function(){
  'use strict';

  var root = document.getElementById('integrations-root');
  function tok(){ return localStorage.getItem('rc_customer_token') || ''; }
  function hdrs(){ return { 'Authorization': 'Bearer ' + tok(), 'Content-Type': 'application/json' }; }
  function escapeHtml(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }

  function toast(msg, ok){
    var t = document.createElement('div');
    t.className = 'toast ' + (ok ? 'toast-ok' : 'toast-err');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function(){ t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, 2200);
    setTimeout(function(){ t.remove(); }, 2700);
  }

  var connections = [];
  var openDeliveries = {};

  document.addEventListener('DOMContentLoaded', loadAll);

  async function loadAll(){
    root.innerHTML = '<div class="flex items-center justify-center py-16"><div class="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2" style="border-color:var(--accent)"></div></div>';
    try {
      var res = await fetch('/api/customer/api-connections', { headers: hdrs() });
      if (res.status === 401) { window.location.href = '/customer/login'; return; }
      var data = await res.json();
      connections = data.connections || [];
      render();
    } catch (e) {
      root.innerHTML = '<p class="text-center py-12" style="color:#ef4444">Failed to load. Please refresh.</p>';
    }
  }

  function render(){
    var html =
      explainer() +
      addForm() +
      '<h2 class="text-base font-bold mt-8 mb-3" style="color:var(--text-primary)">Your Connections</h2>' +
      (connections.length === 0
        ? '<div class="card text-center" style="color:var(--text-muted)">No connections yet. Add one above to start pushing reports to your CRM.</div>'
        : connections.map(connectionCard).join(''));
    root.innerHTML = html;
    bind();
  }

  function explainer(){
    return ''
      + '<div class="card mb-5" style="background:linear-gradient(135deg,rgba(0,255,136,0.06),rgba(0,255,136,0.02));border-color:rgba(0,255,136,0.2)">'
      +   '<div class="flex items-start gap-3">'
      +     '<div style="width:36px;height:36px;border-radius:8px;background:rgba(0,255,136,0.15);display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="fas fa-plug" style="color:var(--accent)"></i></div>'
      +     '<div>'
      +       '<h3 class="font-bold mb-1" style="color:var(--text-primary)">How this works</h3>'
      +       '<p class="text-sm leading-relaxed" style="color:var(--text-secondary)">Add an API endpoint and key for your CRM. Every time a report is finalized for your account, we POST a JSON payload (report data + a link to the PDF) to that endpoint. We also include an <code style="background:var(--bg-elevated);padding:1px 5px;border-radius:4px">X-RoofManager-Signature</code> header so your receiver can verify the body. Failed deliveries are retried automatically (0s, 30s, 5m, 30m, 2h, 12h).</p>'
      +     '</div>'
      +   '</div>'
      + '</div>';
  }

  function addForm(){
    return ''
      + '<div class="card">'
      +   '<h2 class="text-base font-bold mb-3" style="color:var(--text-primary)">Add Connection</h2>'
      +   '<div class="grid grid-cols-1 md:grid-cols-2 gap-3">'
      +     field('Name', 'add-name', 'text', 'AccuLynx Production')
      +     selectField('Provider', 'add-provider', [['acculynx','AccuLynx'],['jobnimbus','JobNimbus'],['roofr','Roofr'],['custom','Custom Webhook']])
      +     field('Endpoint URL (HTTPS)', 'add-url', 'text', 'https://api.acculynx.com/...')
      +     field('API Key', 'add-key', 'password', 'paste your AccuLynx API key')
      +   '</div>'
      +   '<details class="mt-3" style="color:var(--text-muted)"><summary class="cursor-pointer text-sm">Advanced — auth header overrides</summary>'
      +     '<div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">'
      +       field('Auth Header', 'add-auth-header', 'text', 'Authorization')
      +       field('Auth Prefix (incl. trailing space)', 'add-auth-prefix', 'text', 'Bearer ')
      +     '</div>'
      +   '</details>'
      +   '<div class="flex justify-end mt-4">'
      +     '<button id="add-btn" class="btn btn-primary"><i class="fas fa-plus mr-2"></i>Add Connection</button>'
      +   '</div>'
      + '</div>';
  }

  function field(label, id, type, ph){
    return ''
      + '<div>'
      +   '<label class="block text-xs font-semibold mb-1" style="color:var(--text-secondary)">' + escapeHtml(label) + '</label>'
      +   '<input id="' + id + '" type="' + type + '" placeholder="' + escapeHtml(ph || '') + '" class="input" autocomplete="off">'
      + '</div>';
  }

  function selectField(label, id, opts){
    return ''
      + '<div>'
      +   '<label class="block text-xs font-semibold mb-1" style="color:var(--text-secondary)">' + escapeHtml(label) + '</label>'
      +   '<select id="' + id + '" class="input">'
      +     opts.map(function(o){ return '<option value="' + escapeHtml(o[0]) + '">' + escapeHtml(o[1]) + '</option>'; }).join('')
      +   '</select>'
      + '</div>';
  }

  function connectionCard(c){
    var disabled = !c.enabled;
    return ''
      + '<div class="card mb-3" data-id="' + c.id + '">'
      +   '<div class="flex items-start justify-between gap-4 flex-wrap">'
      +     '<div class="flex-1 min-w-0">'
      +       '<div class="flex items-center gap-2 mb-1">'
      +         '<h3 class="font-bold" style="color:var(--text-primary)">' + escapeHtml(c.name) + '</h3>'
      +         '<span class="pill ' + (disabled ? 'pill-disabled' : 'pill-ok') + '">' + (disabled ? 'Disabled' : 'Enabled') + '</span>'
      +         '<span class="pill pill-disabled">' + escapeHtml(c.provider) + '</span>'
      +       '</div>'
      +       '<p class="text-sm break-all" style="color:var(--text-muted)"><i class="fas fa-link mr-1"></i>' + escapeHtml(c.endpoint_url) + '</p>'
      +       '<p class="text-sm mt-1" style="color:var(--text-muted)"><i class="fas fa-key mr-1"></i>Key: <code>' + escapeHtml(c.api_key_hint || '••••') + '</code> &nbsp;·&nbsp; Header: <code>' + escapeHtml(c.auth_header) + '</code> &nbsp;·&nbsp; Prefix: <code>' + escapeHtml(c.auth_prefix) + '</code></p>'
      +     '</div>'
      +     '<div class="flex items-center gap-2 flex-shrink-0 flex-wrap">'
      +       '<button class="btn btn-secondary act-test" data-id="' + c.id + '"><i class="fas fa-paper-plane mr-1"></i>Test</button>'
      +       '<button class="btn btn-secondary act-toggle" data-id="' + c.id + '" data-enabled="' + (c.enabled ? '1' : '0') + '">' + (disabled ? 'Enable' : 'Disable') + '</button>'
      +       '<button class="btn btn-secondary act-edit" data-id="' + c.id + '"><i class="fas fa-pen"></i></button>'
      +       '<button class="btn btn-danger act-delete" data-id="' + c.id + '"><i class="fas fa-trash"></i></button>'
      +       '<button class="btn btn-secondary act-deliveries" data-id="' + c.id + '"><i class="fas fa-history mr-1"></i>Deliveries</button>'
      +     '</div>'
      +   '</div>'
      +   '<div class="mt-3" id="del-' + c.id + '" style="display:' + (openDeliveries[c.id] ? 'block' : 'none') + '"></div>'
      + '</div>';
  }

  function bind(){
    var addBtn = document.getElementById('add-btn');
    if (addBtn) addBtn.addEventListener('click', addConnection);
    Array.prototype.forEach.call(document.querySelectorAll('.act-test'),       function(b){ b.addEventListener('click', function(){ testConn(b.dataset.id); }); });
    Array.prototype.forEach.call(document.querySelectorAll('.act-toggle'),     function(b){ b.addEventListener('click', function(){ toggleConn(b.dataset.id, b.dataset.enabled !== '1'); }); });
    Array.prototype.forEach.call(document.querySelectorAll('.act-edit'),       function(b){ b.addEventListener('click', function(){ editConn(b.dataset.id); }); });
    Array.prototype.forEach.call(document.querySelectorAll('.act-delete'),     function(b){ b.addEventListener('click', function(){ deleteConn(b.dataset.id); }); });
    Array.prototype.forEach.call(document.querySelectorAll('.act-deliveries'), function(b){ b.addEventListener('click', function(){ toggleDeliveries(b.dataset.id); }); });
  }

  async function addConnection(){
    var body = {
      name: document.getElementById('add-name').value.trim(),
      provider: document.getElementById('add-provider').value,
      endpoint_url: document.getElementById('add-url').value.trim(),
      api_key: document.getElementById('add-key').value.trim(),
      auth_header: document.getElementById('add-auth-header').value.trim() || 'Authorization',
      auth_prefix: document.getElementById('add-auth-prefix').value || 'Bearer '
    };
    if (!body.name || !body.endpoint_url || !body.api_key) { toast('Name, URL, and API key are required', false); return; }
    try {
      var res = await fetch('/api/customer/api-connections', { method: 'POST', headers: hdrs(), body: JSON.stringify(body) });
      var j = await res.json();
      if (!res.ok) { toast(j.error || 'Failed to add', false); return; }
      toast('Connection added', true);
      await loadAll();
    } catch (e) { toast('Network error', false); }
  }

  async function testConn(id){
    toast('Sending test ping…', true);
    try {
      var res = await fetch('/api/customer/api-connections/' + id + '/test', { method: 'POST', headers: hdrs() });
      var j = await res.json();
      if (j.ok) toast('Test OK (' + (j.statusCode || 200) + ', ' + j.durationMs + 'ms)', true);
      else toast('Test failed: ' + (j.error || ('HTTP ' + (j.statusCode || '?'))), false);
    } catch (e) { toast('Network error', false); }
  }

  async function toggleConn(id, newEnabled){
    try {
      var res = await fetch('/api/customer/api-connections/' + id, { method: 'PUT', headers: hdrs(), body: JSON.stringify({ enabled: !!newEnabled }) });
      if (!res.ok) { var j = await res.json().catch(function(){ return {}; }); toast(j.error || 'Update failed', false); return; }
      await loadAll();
    } catch (e) { toast('Network error', false); }
  }

  async function editConn(id){
    var c = connections.find(function(x){ return x.id == id; }); if (!c) return;
    var name = prompt('Name:', c.name); if (name == null) return;
    var url = prompt('Endpoint URL (HTTPS):', c.endpoint_url); if (url == null) return;
    var key = prompt('API Key (leave blank to keep existing):', '');
    var body = { name: name.trim(), endpoint_url: url.trim() };
    if (key && key.trim()) body.api_key = key.trim();
    try {
      var res = await fetch('/api/customer/api-connections/' + id, { method: 'PUT', headers: hdrs(), body: JSON.stringify(body) });
      var j = await res.json();
      if (!res.ok) { toast(j.error || 'Update failed', false); return; }
      toast('Updated', true);
      await loadAll();
    } catch (e) { toast('Network error', false); }
  }

  async function deleteConn(id){
    if (!confirm('Delete this connection? Reports will no longer be sent to this endpoint.')) return;
    try {
      var res = await fetch('/api/customer/api-connections/' + id, { method: 'DELETE', headers: hdrs() });
      if (!res.ok) { toast('Delete failed', false); return; }
      toast('Deleted', true);
      await loadAll();
    } catch (e) { toast('Network error', false); }
  }

  async function toggleDeliveries(id){
    var box = document.getElementById('del-' + id);
    if (!box) return;
    if (openDeliveries[id]) { openDeliveries[id] = false; box.style.display = 'none'; box.innerHTML = ''; return; }
    openDeliveries[id] = true; box.style.display = 'block';
    box.innerHTML = '<p class="text-sm" style="color:var(--text-muted)">Loading deliveries…</p>';
    try {
      var res = await fetch('/api/customer/api-connections/' + id + '/deliveries', { headers: hdrs() });
      var j = await res.json();
      var rows = j.deliveries || [];
      if (rows.length === 0) { box.innerHTML = '<p class="text-sm" style="color:var(--text-muted)">No deliveries yet.</p>'; return; }
      box.innerHTML =
        '<div class="overflow-x-auto"><table class="min-w-full text-sm">'
        + '<thead><tr style="color:var(--text-muted)"><th class="text-left py-2 pr-3">When</th><th class="text-left py-2 pr-3">Order</th><th class="text-left py-2 pr-3">Status</th><th class="text-left py-2 pr-3">HTTP</th><th class="text-left py-2 pr-3">Attempts</th><th class="text-left py-2 pr-3">Error</th></tr></thead>'
        + '<tbody>' + rows.map(function(r){
            var pill = r.status === 'delivered' ? 'pill-ok' : (r.status === 'failed' ? 'pill-fail' : 'pill-pending');
            return '<tr style="border-top:1px solid var(--border-color)">'
              + '<td class="py-2 pr-3" style="color:var(--text-secondary)">' + escapeHtml(r.last_attempt_at || r.created_at || '') + '</td>'
              + '<td class="py-2 pr-3" style="color:var(--text-secondary)">' + escapeHtml(r.order_id) + '</td>'
              + '<td class="py-2 pr-3"><span class="pill ' + pill + '">' + escapeHtml(r.status) + '</span></td>'
              + '<td class="py-2 pr-3" style="color:var(--text-secondary)">' + escapeHtml(r.http_status == null ? '—' : String(r.http_status)) + '</td>'
              + '<td class="py-2 pr-3" style="color:var(--text-secondary)">' + escapeHtml(String(r.attempts || 0)) + '</td>'
              + '<td class="py-2 pr-3" style="color:#ef4444">' + escapeHtml(r.error_message || '') + '</td>'
              + '</tr>';
          }).join('') + '</tbody></table></div>';
    } catch (e) {
      box.innerHTML = '<p class="text-sm" style="color:#ef4444">Failed to load deliveries.</p>';
    }
  }
})();

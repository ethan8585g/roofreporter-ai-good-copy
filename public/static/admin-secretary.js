/**
 * AI Secretary — Super Admin Provisioning Dashboard
 * Manages: subscriber provisioning, phone pool, agent deployment
 */
(function () {
  'use strict';

  let currentView = 'provision';
  let subscribersData = null;
  let phonePoolData = null;
  let agentStatus = null;
  let deployHistory = [];
  let availablePoolNumbers = [];
  let twilioSearchResults = [];
  let provisionResult = null;
  let provisionError = null;
  let directoryRows = [{ name: '', phone_or_action: '', special_notes: '' }];
  let phoneStrategy = 'pool';
  let deployPolling = null;

  function getToken() {
    return localStorage.getItem('rc_token') || '';
  }

  async function apiFetch(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' }, opts.headers || {});
    const resp = await fetch('/api/admin' + path, opts);
    return resp.json();
  }

  // ── Navigation ─────────────────────────────────────────────────
  window.secSetView = function (view) {
    currentView = view;
    document.querySelectorAll('.sec-nav-item').forEach(function (el) {
      if (el.dataset.view === view) { el.classList.add('active'); el.classList.remove('text-gray-400'); }
      else { el.classList.remove('active'); el.classList.add('text-gray-400'); }
    });
    render();
    // Auto-load data for the view
    if (view === 'subscribers' && !subscribersData) loadSubscribers();
    if (view === 'phone-pool' && !phonePoolData) loadPhonePool();
    if (view === 'agent-deploy' && !agentStatus) loadAgentStatus();
  };

  // ── Render dispatcher ─────────────────────────────────────────
  function render() {
    var main = document.getElementById('sec-main');
    if (!main) return;
    switch (currentView) {
      case 'provision': main.innerHTML = renderProvision(); break;
      case 'subscribers': main.innerHTML = renderSubscribers(); break;
      case 'phone-pool': main.innerHTML = renderPhonePool(); break;
      case 'agent-deploy': main.innerHTML = renderAgentDeploy(); break;
      default: main.innerHTML = '<p class="text-gray-500">Unknown view</p>';
    }
  }

  // ── PROVISION VIEW ────────────────────────────────────────────
  function renderProvision() {
    var html = '<div style="max-width:900px">';
    html += '<h2 style="font-size:1.25rem;font-weight:700;color:#fff;margin-bottom:1.5rem"><i class="fas fa-user-plus mr-2 text-green-400"></i>Provision New AI Secretary Subscriber</h2>';

    // Result / Error blocks
    if (provisionResult) {
      html += '<div class="result-block"><h3 style="font-weight:700;color:#34d399;margin-bottom:0.5rem"><i class="fas fa-check-circle mr-1"></i>Provisioning Successful</h3>';
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;font-size:0.8rem;color:#94a3b8">';
      html += '<div><strong>Trunk ID:</strong> ' + (provisionResult.trunk_id || 'N/A') + '</div>';
      html += '<div><strong>Dispatch Rule ID:</strong> ' + (provisionResult.dispatch_rule_id || 'N/A') + '</div>';
      html += '<div><strong>SIP URI:</strong> ' + (provisionResult.sip_uri || 'N/A') + '</div>';
      html += '<div><strong>Phone Number:</strong> ' + (provisionResult.assigned_number || 'N/A') + '</div>';
      html += '<div><strong>Connection:</strong> <span class="badge badge-green">' + (provisionResult.connection_status || 'connected') + '</span></div>';
      html += '<div><strong>Customer ID:</strong> ' + (provisionResult.customer_id || 'N/A') + '</div>';
      html += '</div>';
      if (provisionResult.customer_id) {
        html += '<div style="margin-top:0.75rem"><button class="btn-sm btn-green" onclick="secTestCall(' + provisionResult.customer_id + ')"><i class="fas fa-phone mr-1"></i>Test Call</button>';
        html += ' <button class="btn-sm btn-gray" onclick="secClearResult()"><i class="fas fa-times mr-1"></i>Dismiss</button></div>';
      }
      html += '</div>';
    }
    if (provisionError) {
      html += '<div class="error-block"><strong style="color:#f87171"><i class="fas fa-exclamation-triangle mr-1"></i>Provisioning Failed</strong><p style="color:#fca5a5;font-size:0.8rem;margin-top:0.25rem">' + esc(provisionError) + '</p>';
      html += '<button class="btn-sm btn-gray" style="margin-top:0.5rem" onclick="secClearResult()">Dismiss</button></div>';
    }

    // Customer info section
    html += '<div class="card" style="margin-top:1rem"><div class="card-title"><i class="fas fa-user text-blue-400"></i>Customer Information</div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">';
    html += formField('sec-name', 'Business / Customer Name', 'text', 'Acme Roofing Ltd');
    html += formField('sec-email', 'Email', 'email', 'owner@acmeroofing.com');
    html += formField('sec-biz-phone', 'Business Phone', 'tel', '+1 (780) 555-1234');
    html += formField('sec-personal-phone', 'Personal Phone (optional)', 'tel', '+1 (780) 555-9999');
    html += '<div><label class="form-label">Carrier</label><select id="sec-carrier" class="form-select"><option value="">Select carrier...</option><option>Rogers</option><option>Telus</option><option>Bell</option><option>Shaw</option><option>Koodo</option><option>Fido</option><option>Other</option></select></div>';
    html += '</div></div>';

    // Phone strategy
    html += '<div class="card" style="margin-top:1rem"><div class="card-title"><i class="fas fa-phone-alt text-amber-400"></i>Phone Number Strategy</div>';
    html += '<div style="display:flex;gap:0.75rem;margin-bottom:1rem">';
    html += radioBtn('pool', 'Assign from Pool', phoneStrategy === 'pool');
    html += radioBtn('purchase', 'Purchase Twilio Number', phoneStrategy === 'purchase');
    html += radioBtn('byo', 'BYO SIP Credentials', phoneStrategy === 'byo');
    html += '</div>';

    if (phoneStrategy === 'pool') {
      html += '<div id="pool-section">';
      if (availablePoolNumbers.length === 0) {
        html += '<p style="color:#94a3b8;font-size:0.8rem">No available pool numbers. <button class="btn-sm btn-blue" onclick="secLoadPoolNumbers()">Load Pool</button></p>';
      } else {
        html += '<select id="sec-pool-number" class="form-select" style="max-width:300px">';
        availablePoolNumbers.forEach(function (n) {
          html += '<option value="' + n.id + '">' + esc(n.phone_number) + ' (' + (n.region || n.area_code || 'N/A') + ')</option>';
        });
        html += '</select>';
      }
      html += '</div>';
    } else if (phoneStrategy === 'purchase') {
      html += '<div style="display:grid;grid-template-columns:1fr 1fr auto;gap:0.75rem;align-items:end">';
      html += formField('sec-twilio-country', 'Country', 'text', 'CA', '');
      html += formField('sec-twilio-area', 'Area Code', 'text', '780', '');
      html += '<div><button class="btn-sm btn-blue" onclick="secSearchTwilio()"><i class="fas fa-search mr-1"></i>Search</button></div>';
      html += '</div>';
      if (twilioSearchResults.length > 0) {
        html += '<select id="sec-twilio-number" class="form-select" style="max-width:400px;margin-top:0.5rem">';
        twilioSearchResults.forEach(function (n) {
          html += '<option value="' + esc(n.phoneNumber || n.phone_number) + '">' + esc(n.friendlyName || n.phoneNumber || n.phone_number) + '</option>';
        });
        html += '</select>';
      }
    } else {
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">';
      html += formField('sec-byo-number', 'E.164 Phone Number', 'text', '+14165551234');
      html += formField('sec-sip-user', 'SIP Username', 'text', '');
      html += formField('sec-sip-pass', 'SIP Password', 'password', '');
      html += formField('sec-twilio-trunk', 'Twilio Trunk SID (optional)', 'text', 'TK...');
      html += '</div>';
    }
    html += '</div>';

    // Secretary config
    html += '<div class="card" style="margin-top:1rem"><div class="card-title"><i class="fas fa-robot text-purple-400"></i>Secretary Configuration</div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.75rem">';
    html += formField('sec-agent-name', 'Agent Name', 'text', 'Sarah', 'Sarah');
    html += '<div><label class="form-label">Voice</label><select id="sec-agent-voice" class="form-select"><option value="alloy" selected>Alloy</option><option value="echo">Echo</option><option value="fable">Fable</option><option value="onyx">Onyx</option><option value="nova">Nova</option><option value="shimmer">Shimmer</option></select></div>';
    html += '<div><label class="form-label">Language</label><select id="sec-agent-lang" class="form-select"><option value="en" selected>English</option><option value="fr">French</option><option value="es">Spanish</option></select></div>';
    html += '</div>';
    html += '<div style="margin-top:0.75rem">';
    html += '<label class="form-label">Greeting Script</label><textarea id="sec-greeting" class="form-input" rows="3" placeholder="Hi, thanks for calling {business_name}! This is {agent_name}, how can I help you today?"></textarea>';
    html += '</div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-top:0.75rem">';
    html += '<div><label class="form-label">Common Q&A (JSON or text)</label><textarea id="sec-qa" class="form-input" rows="3" placeholder="Business hours, services offered, etc."></textarea></div>';
    html += '<div><label class="form-label">General Notes</label><textarea id="sec-notes" class="form-input" rows="3" placeholder="Any special instructions for the AI agent..."></textarea></div>';
    html += '</div></div>';

    // Directories
    html += '<div class="card" style="margin-top:1rem"><div class="card-title"><i class="fas fa-address-book text-cyan-400"></i>Team Directory</div>';
    html += '<table class="tbl"><thead><tr><th>Name</th><th>Phone / Action</th><th>Notes</th><th></th></tr></thead><tbody>';
    directoryRows.forEach(function (row, i) {
      html += '<tr>';
      html += '<td><input class="form-input" value="' + esc(row.name) + '" onchange="secUpdateDir(' + i + ',\'name\',this.value)" placeholder="John Smith"></td>';
      html += '<td><input class="form-input" value="' + esc(row.phone_or_action) + '" onchange="secUpdateDir(' + i + ',\'phone_or_action\',this.value)" placeholder="+1 (780) 555-0000"></td>';
      html += '<td><input class="form-input" value="' + esc(row.special_notes || '') + '" onchange="secUpdateDir(' + i + ',\'special_notes\',this.value)" placeholder="Owner, handles emergencies"></td>';
      html += '<td><button class="btn-sm btn-danger" onclick="secRemoveDir(' + i + ')"><i class="fas fa-times"></i></button></td>';
      html += '</tr>';
    });
    html += '</tbody></table>';
    html += '<button class="btn-sm btn-gray" style="margin-top:0.5rem" onclick="secAddDir()"><i class="fas fa-plus mr-1"></i>Add Row</button>';
    html += '</div>';

    // Submit
    html += '<div style="margin-top:1.5rem;text-align:right">';
    html += '<button id="sec-provision-btn" class="btn-primary" style="padding:0.75rem 2rem;font-size:1rem" onclick="secProvision()">';
    html += '<i class="fas fa-rocket mr-2"></i>Provision + Deploy SIP Trunk</button>';
    html += '</div>';

    html += '</div>';
    return html;
  }

  // ── SUBSCRIBERS VIEW ──────────────────────────────────────────
  function renderSubscribers() {
    var html = '<h2 style="font-size:1.25rem;font-weight:700;color:#fff;margin-bottom:1rem"><i class="fas fa-users mr-2 text-blue-400"></i>Secretary Subscribers</h2>';

    if (!subscribersData) {
      html += '<div class="flex items-center justify-center py-20"><div class="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div><span class="ml-3 text-gray-500">Loading subscribers...</span></div>';
      return html;
    }

    var subs = subscribersData.subscribers || [];
    html += '<div style="margin-bottom:1rem"><button class="btn-sm btn-gray" onclick="secReloadSubscribers()"><i class="fas fa-sync mr-1"></i>Refresh</button> <span style="color:#64748b;font-size:0.75rem">' + subs.length + ' subscribers</span></div>';

    if (subs.length === 0) {
      html += '<div class="card" style="text-align:center;padding:3rem"><i class="fas fa-users-slash text-4xl text-gray-600 mb-3" style="display:block"></i><p style="color:#64748b">No subscribers yet. Use the Provision tab to add one.</p></div>';
      return html;
    }

    html += '<div style="overflow-x:auto"><table class="tbl"><thead><tr>';
    html += '<th>Customer</th><th>Plan</th><th>Status</th><th>Phone</th><th>Trunk ID</th><th>Dispatch ID</th><th>Last Test</th><th>Calls (24h)</th><th>Actions</th>';
    html += '</tr></thead><tbody>';
    subs.forEach(function (s) {
      var statusBadge = s.is_active ? '<span class="badge badge-green">Active</span>' : '<span class="badge badge-red">Inactive</span>';
      var connBadge = s.connection_status === 'connected' ? '<span class="badge badge-green">connected</span>'
        : s.connection_status === 'pending_forwarding' ? '<span class="badge badge-amber">pending</span>'
        : s.connection_status === 'failed' ? '<span class="badge badge-red">failed</span>'
        : '<span class="badge badge-gray">' + esc(s.connection_status || 'unknown') + '</span>';
      html += '<tr>';
      html += '<td><strong style="color:#fff">' + esc(s.customer_name || s.contact_name || '') + '</strong><br><span style="font-size:0.7rem;color:#64748b">' + esc(s.email || '') + '</span></td>';
      html += '<td>' + esc(s.plan_name || s.plan_type || 'Standard') + '</td>';
      html += '<td>' + statusBadge + ' ' + connBadge + '</td>';
      html += '<td style="font-family:monospace;font-size:0.75rem">' + esc(s.assigned_phone_number || s.agent_phone || '—') + '</td>';
      html += '<td style="font-family:monospace;font-size:0.7rem;max-width:120px;overflow:hidden;text-overflow:ellipsis">' + esc(s.livekit_inbound_trunk_id || s.trunk_id || '—') + '</td>';
      html += '<td style="font-family:monospace;font-size:0.7rem;max-width:120px;overflow:hidden;text-overflow:ellipsis">' + esc(s.livekit_dispatch_rule_id || s.dispatch_id || '—') + '</td>';
      html += '<td>' + (s.last_test_result ? '<span class="badge badge-' + (s.last_test_result === 'success' ? 'green' : 'red') + '">' + esc(s.last_test_result) + '</span>' : '—') + '</td>';
      html += '<td style="text-align:center">' + (s.calls_24h || s.recent_calls || 0) + '</td>';
      html += '<td style="white-space:nowrap">';
      var cid = s.customer_id || s.id;
      html += '<button class="btn-sm btn-green" onclick="secTestCall(' + cid + ')" title="Test Call"><i class="fas fa-phone"></i></button> ';
      html += '<button class="btn-sm btn-blue" onclick="secRedeployTrunk(' + cid + ')" title="Redeploy Trunk"><i class="fas fa-redo"></i></button> ';
      html += '<button class="btn-sm btn-danger" onclick="secToggle(' + cid + ')" title="Toggle Active"><i class="fas fa-power-off"></i></button>';
      html += '</td></tr>';
    });
    html += '</tbody></table></div>';
    return html;
  }

  // ── PHONE POOL VIEW ───────────────────────────────────────────
  function renderPhonePool() {
    var html = '<h2 style="font-size:1.25rem;font-weight:700;color:#fff;margin-bottom:1rem"><i class="fas fa-phone-alt mr-2 text-amber-400"></i>Phone Number Pool</h2>';

    html += '<div style="margin-bottom:1rem;display:flex;gap:0.5rem">';
    html += '<button class="btn-sm btn-green" onclick="secAddToPool()"><i class="fas fa-plus mr-1"></i>Add Manually</button>';
    html += '<button class="btn-sm btn-blue" onclick="secSetView(\'provision\');phoneStrategy=\'purchase\';render()"><i class="fas fa-shopping-cart mr-1"></i>Purchase from Twilio</button>';
    html += '<button class="btn-sm btn-gray" onclick="secReloadPool()"><i class="fas fa-sync mr-1"></i>Refresh</button>';
    html += '</div>';

    if (!phonePoolData) {
      html += '<div class="flex items-center justify-center py-20"><div class="w-8 h-8 border-4 border-amber-200 border-t-amber-600 rounded-full animate-spin"></div><span class="ml-3 text-gray-500">Loading phone pool...</span></div>';
      return html;
    }

    var pool = phonePoolData.phone_pool || [];
    if (pool.length === 0) {
      html += '<div class="card" style="text-align:center;padding:3rem"><i class="fas fa-phone-slash text-4xl text-gray-600 mb-3" style="display:block"></i><p style="color:#64748b">No phone numbers in pool. Add one manually or purchase from Twilio.</p></div>';
      return html;
    }

    html += '<table class="tbl"><thead><tr><th>Phone Number</th><th>Status</th><th>Assigned To</th><th>Trunk ID</th><th>Provider</th><th>Added</th><th>Actions</th></tr></thead><tbody>';
    pool.forEach(function (p) {
      var statusBadge = p.status === 'available' ? '<span class="badge badge-green">Available</span>'
        : p.status === 'assigned' ? '<span class="badge badge-blue">Assigned</span>'
        : '<span class="badge badge-gray">' + esc(p.status) + '</span>';
      html += '<tr>';
      html += '<td style="font-family:monospace;font-weight:600;color:#fff">' + esc(p.phone_number) + '</td>';
      html += '<td>' + statusBadge + '</td>';
      html += '<td>' + (p.customer_name ? esc(p.customer_name) : '<span style="color:#4b5563">—</span>') + '</td>';
      html += '<td style="font-family:monospace;font-size:0.7rem;max-width:100px;overflow:hidden;text-overflow:ellipsis">' + esc(p.sip_trunk_id || '—') + '</td>';
      html += '<td>' + esc(p.provider || '—') + '</td>';
      html += '<td style="font-size:0.7rem;color:#64748b">' + (p.created_at ? p.created_at.split('T')[0] : '—') + '</td>';
      html += '<td style="white-space:nowrap">';
      if (p.status === 'assigned') {
        html += '<button class="btn-sm btn-amber" onclick="secReleasePool(' + p.id + ')" title="Release"><i class="fas fa-unlock mr-1"></i>Release</button>';
      } else if (p.status === 'available') {
        html += '<button class="btn-sm btn-blue" onclick="secAssignPool(' + p.id + ')" title="Assign"><i class="fas fa-link mr-1"></i>Assign</button>';
      }
      html += '</td></tr>';
    });
    html += '</tbody></table>';
    return html;
  }

  // ── AGENT DEPLOY VIEW ─────────────────────────────────────────
  function renderAgentDeploy() {
    var html = '<h2 style="font-size:1.25rem;font-weight:700;color:#fff;margin-bottom:1.5rem"><i class="fas fa-rocket mr-2 text-purple-400"></i>Agent Deployment</h2>';

    // Current agent info card
    html += '<div class="card" style="margin-bottom:1.5rem">';
    html += '<div class="card-title"><i class="fas fa-server text-indigo-400"></i>LiveKit Cloud Agent</div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1rem">';
    html += '<div><span class="form-label">Subdomain</span><div style="color:#fff;font-family:monospace;font-size:0.85rem">roofreporterai-btkwkiwh</div></div>';
    html += '<div><span class="form-label">Agent ID</span><div style="color:#fff;font-family:monospace;font-size:0.85rem">CA_McGBLzwzRDve</div></div>';

    if (agentStatus && agentStatus.deployment) {
      var d = agentStatus.deployment;
      var statusBadge = d.status === 'succeeded' ? '<span class="badge badge-green">Succeeded</span>'
        : d.status === 'running' ? '<span class="badge badge-amber">Running</span>'
        : d.status === 'pending' ? '<span class="badge badge-blue">Pending</span>'
        : d.status === 'failed' ? '<span class="badge badge-red">Failed</span>'
        : '<span class="badge badge-gray">' + esc(d.status) + '</span>';
      html += '<div><span class="form-label">Last Deploy</span><div>' + statusBadge + ' <span style="color:#64748b;font-size:0.7rem">' + (d.finished_at || d.started_at || d.requested_at || '') + '</span></div></div>';
    } else {
      html += '<div><span class="form-label">Last Deploy</span><div style="color:#64748b;font-size:0.8rem">No deployments recorded</div></div>';
    }
    html += '</div>';

    html += '<div style="margin-top:1.25rem">';
    var isDeploying = agentStatus && agentStatus.deployment && (agentStatus.deployment.status === 'pending' || agentStatus.deployment.status === 'running');
    html += '<button id="deploy-agent-btn" class="btn-primary" onclick="secDeployAgent()" ' + (isDeploying ? 'disabled' : '') + '>';
    if (isDeploying) {
      html += '<div class="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" style="vertical-align:middle"></div>Deploying...';
    } else {
      html += '<i class="fas fa-cloud-upload-alt mr-2"></i>Deploy Agent to LiveKit Cloud';
    }
    html += '</button>';
    html += ' <button class="btn-sm btn-gray" onclick="secReloadAgentStatus()"><i class="fas fa-sync mr-1"></i>Refresh</button>';
    html += '</div>';

    if (agentStatus && agentStatus.deployment && agentStatus.deployment.error) {
      html += '<div class="error-block" style="margin-top:0.75rem"><strong style="color:#f87171">Error:</strong> <span style="color:#fca5a5;font-size:0.8rem">' + esc(agentStatus.deployment.error) + '</span></div>';
    }
    html += '</div>';

    // Deployment history
    html += '<div class="card"><div class="card-title"><i class="fas fa-history text-gray-400"></i>Deployment History</div>';
    if (deployHistory.length === 0) {
      html += '<p style="color:#64748b;font-size:0.8rem">No deployment history.</p>';
    } else {
      html += '<table class="tbl"><thead><tr><th>#</th><th>Status</th><th>Requested</th><th>Started</th><th>Finished</th><th>Commit</th><th>Error</th></tr></thead><tbody>';
      deployHistory.forEach(function (d) {
        var statusBadge = d.status === 'succeeded' ? '<span class="badge badge-green">Succeeded</span>'
          : d.status === 'running' ? '<span class="badge badge-amber">Running</span>'
          : d.status === 'pending' ? '<span class="badge badge-blue">Pending</span>'
          : '<span class="badge badge-red">Failed</span>';
        html += '<tr>';
        html += '<td>' + d.id + '</td>';
        html += '<td>' + statusBadge + '</td>';
        html += '<td style="font-size:0.7rem;color:#94a3b8">' + (d.requested_at || '—') + '</td>';
        html += '<td style="font-size:0.7rem;color:#94a3b8">' + (d.started_at || '—') + '</td>';
        html += '<td style="font-size:0.7rem;color:#94a3b8">' + (d.finished_at || '—') + '</td>';
        html += '<td style="font-family:monospace;font-size:0.7rem">' + esc(d.commit_sha ? d.commit_sha.slice(0, 7) : '—') + '</td>';
        html += '<td style="font-size:0.7rem;color:#f87171;max-width:200px;overflow:hidden;text-overflow:ellipsis">' + esc(d.error || '—') + '</td>';
        html += '</tr>';
      });
      html += '</tbody></table>';
    }
    html += '</div>';
    return html;
  }

  // ── API Actions ───────────────────────────────────────────────

  // Provision new subscriber
  window.secProvision = async function () {
    var btn = document.getElementById('sec-provision-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<div class="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" style="vertical-align:middle"></div>Provisioning...'; }
    provisionResult = null;
    provisionError = null;

    try {
      var body = {
        name: val('sec-name'),
        email: val('sec-email'),
        business_phone: val('sec-biz-phone'),
        personal_phone: val('sec-personal-phone'),
        carrier_name: val('sec-carrier'),
        agent_name: val('sec-agent-name') || 'Sarah',
        agent_voice: val('sec-agent-voice') || 'alloy',
        agent_language: val('sec-agent-lang') || 'en',
        greeting_script: val('sec-greeting'),
        common_qa: val('sec-qa'),
        general_notes: val('sec-notes'),
        directories: directoryRows.filter(function (r) { return r.name.trim(); }),
        // Secretary-specific fields that trigger deployLiveKitForCustomer
        setup_secretary: true,
        deploy_livekit: true,
      };

      // Phone strategy handling
      if (phoneStrategy === 'pool') {
        var poolSel = document.getElementById('sec-pool-number');
        if (poolSel) {
          body.phone_pool_id = parseInt(poolSel.value);
          var selOpt = poolSel.options[poolSel.selectedIndex];
          body.agent_phone_number = selOpt ? selOpt.textContent.split(' (')[0].trim() : '';
        }
      } else if (phoneStrategy === 'purchase') {
        var twilioSel = document.getElementById('sec-twilio-number');
        if (twilioSel) {
          body.agent_phone_number = twilioSel.value;
          body.purchase_twilio = true;
        }
      } else {
        body.agent_phone_number = val('sec-byo-number');
        body.sip_username = val('sec-sip-user');
        body.sip_password = val('sec-sip-pass');
        body.twilio_trunk_sid = val('sec-twilio-trunk');
      }

      if (!body.name || !body.email) {
        provisionError = 'Name and email are required';
        render();
        return;
      }

      var result = await apiFetch('/superadmin/onboarding/create', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      if (result.error) {
        provisionError = result.error;
      } else {
        provisionResult = {
          customer_id: result.customer_id,
          trunk_id: result.livekit?.trunk_id || result.trunk_id || '',
          dispatch_rule_id: result.livekit?.dispatch_rule_id || result.dispatch_rule_id || '',
          sip_uri: result.livekit?.sip_uri || result.sip_uri || '',
          assigned_number: body.agent_phone_number || '',
          connection_status: result.livekit?.success ? 'connected' : 'pending',
        };
      }
    } catch (err) {
      provisionError = err.message || 'Network error';
    }
    render();
  };

  window.secClearResult = function () {
    provisionResult = null;
    provisionError = null;
    render();
  };

  // Test call
  window.secTestCall = async function (customerId) {
    try {
      var r = await apiFetch('/superadmin/secretary/' + customerId + '/test-call', { method: 'POST' });
      alert(r.success ? 'Test call succeeded! Result: ' + (r.result || 'OK') : 'Test call failed: ' + (r.error || 'Unknown error'));
      if (subscribersData) { subscribersData = null; loadSubscribers(); }
    } catch (err) {
      alert('Test call error: ' + err.message);
    }
  };

  // Redeploy trunk
  window.secRedeployTrunk = async function (customerId) {
    if (!confirm('Redeploy SIP trunk for customer ' + customerId + '? This will delete and recreate the trunk.')) return;
    try {
      var r = await apiFetch('/superadmin/secretary/' + customerId + '/redeploy-trunk', { method: 'POST' });
      alert(r.success ? 'Trunk redeployed successfully! New trunk: ' + (r.trunk_id || 'N/A') : 'Redeploy failed: ' + (r.error || 'Unknown'));
      subscribersData = null; loadSubscribers();
    } catch (err) {
      alert('Redeploy error: ' + err.message);
    }
  };

  // Toggle active
  window.secToggle = async function (customerId) {
    if (!confirm('Toggle secretary active state for customer ' + customerId + '?')) return;
    try {
      await apiFetch('/superadmin/onboarding/' + customerId + '/toggle-secretary', { method: 'POST' });
      subscribersData = null; loadSubscribers();
    } catch (err) {
      alert('Toggle error: ' + err.message);
    }
  };

  // Phone pool actions
  window.secLoadPoolNumbers = async function () {
    var r = await apiFetch('/superadmin/phone-pool?status=available');
    availablePoolNumbers = r.phone_pool || [];
    render();
  };

  window.secReleasePool = async function (poolId) {
    if (!confirm('Release this phone number back to the pool? Any associated trunk/dispatch will be deleted.')) return;
    try {
      await apiFetch('/superadmin/phone-pool/' + poolId + '/release', { method: 'POST' });
      phonePoolData = null; loadPhonePool();
    } catch (err) {
      alert('Release error: ' + err.message);
    }
  };

  window.secAssignPool = async function (poolId) {
    var customerId = prompt('Enter customer ID to assign this number to:');
    if (!customerId) return;
    try {
      var r = await apiFetch('/superadmin/phone-pool/assign', {
        method: 'POST',
        body: JSON.stringify({ pool_id: poolId, customer_id: parseInt(customerId), deploy_sip: true }),
      });
      alert(r.success ? 'Number assigned and SIP deployed!' : 'Error: ' + (r.error || 'Unknown'));
      phonePoolData = null; loadPhonePool();
    } catch (err) {
      alert('Assign error: ' + err.message);
    }
  };

  window.secAddToPool = function () {
    var number = prompt('Enter phone number (E.164 format, e.g. +17805551234):');
    if (!number) return;
    apiFetch('/superadmin/phone-pool/add', {
      method: 'POST',
      body: JSON.stringify({ phone_number: number, region: 'CA' }),
    }).then(function (r) {
      if (r.success || r.id) { phonePoolData = null; loadPhonePool(); }
      else alert('Error: ' + (r.error || 'Unknown'));
    });
  };

  // Twilio search
  window.secSearchTwilio = async function () {
    var country = val('sec-twilio-country') || 'CA';
    var area = val('sec-twilio-area') || '';
    try {
      var r = await apiFetch('/superadmin/phone-numbers/available?country=' + encodeURIComponent(country) + '&area_code=' + encodeURIComponent(area));
      twilioSearchResults = r.numbers || r.available || [];
      render();
    } catch (err) {
      alert('Twilio search error: ' + err.message);
    }
  };

  // Agent deployment
  window.secDeployAgent = async function () {
    try {
      var r = await apiFetch('/superadmin/agent/deploy', { method: 'POST' });
      if (r.error) {
        alert('Deploy failed: ' + r.error + (r.hint ? '\n\n' + r.hint : ''));
        return;
      }
      // Start polling
      agentStatus = { deployment: { status: 'running', id: r.deploy_id } };
      render();
      startDeployPolling(r.deploy_id);
    } catch (err) {
      alert('Deploy error: ' + err.message);
    }
  };

  function startDeployPolling(deployId) {
    if (deployPolling) clearInterval(deployPolling);
    var attempts = 0;
    deployPolling = setInterval(async function () {
      attempts++;
      if (attempts > 120) { clearInterval(deployPolling); deployPolling = null; return; } // 10 min max
      try {
        var r = await apiFetch('/superadmin/agent/status');
        agentStatus = r;
        if (r.deployment && (r.deployment.status === 'succeeded' || r.deployment.status === 'failed')) {
          clearInterval(deployPolling);
          deployPolling = null;
          loadDeployHistory();
        }
        render();
      } catch (_) {}
    }, 5000);
  }

  // Directory management
  window.secUpdateDir = function (idx, field, value) { directoryRows[idx][field] = value; };
  window.secAddDir = function () { directoryRows.push({ name: '', phone_or_action: '', special_notes: '' }); render(); };
  window.secRemoveDir = function (idx) { directoryRows.splice(idx, 1); if (directoryRows.length === 0) directoryRows.push({ name: '', phone_or_action: '', special_notes: '' }); render(); };

  // Phone strategy
  window.secSetPhoneStrategy = function (s) { phoneStrategy = s; render(); };

  // ── Data loaders ──────────────────────────────────────────────
  async function loadSubscribers() {
    try {
      subscribersData = await apiFetch('/superadmin/secretary/subscribers');
    } catch (_) {
      subscribersData = { subscribers: [] };
    }
    render();
  }

  async function loadPhonePool() {
    try {
      phonePoolData = await apiFetch('/superadmin/phone-pool');
    } catch (_) {
      phonePoolData = { phone_pool: [] };
    }
    render();
  }

  async function loadAgentStatus() {
    try {
      agentStatus = await apiFetch('/superadmin/agent/status');
    } catch (_) {
      agentStatus = null;
    }
    loadDeployHistory();
    render();
  }

  async function loadDeployHistory() {
    try {
      var r = await apiFetch('/superadmin/agent/deployments');
      deployHistory = r.deployments || [];
    } catch (_) {
      deployHistory = [];
    }
    render();
  }

  window.secReloadSubscribers = function () { subscribersData = null; render(); loadSubscribers(); };
  window.secReloadPool = function () { phonePoolData = null; render(); loadPhonePool(); };
  window.secReloadAgentStatus = function () { agentStatus = null; render(); loadAgentStatus(); };

  // ── Helpers ───────────────────────────────────────────────────
  function val(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }
  function esc(s) { if (!s) return ''; var d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }

  function formField(id, label, type, placeholder, defaultVal) {
    return '<div><label class="form-label">' + label + '</label><input id="' + id + '" type="' + type + '" class="form-input" placeholder="' + (placeholder || '') + '" value="' + esc(defaultVal || '') + '"></div>';
  }

  function radioBtn(value, label, checked) {
    return '<label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;padding:0.5rem 0.75rem;border-radius:0.5rem;border:1px solid ' + (checked ? '#6366f1' : 'rgba(51,65,85,0.5)') + ';background:' + (checked ? 'rgba(99,102,241,0.1)' : 'transparent') + ';font-size:0.8rem;color:' + (checked ? '#a5b4fc' : '#94a3b8') + '">' +
      '<input type="radio" name="phone-strategy" value="' + value + '" ' + (checked ? 'checked' : '') + ' onchange="secSetPhoneStrategy(\'' + value + '\')" style="accent-color:#6366f1">' + label + '</label>';
  }

  // ── Init ──────────────────────────────────────────────────────
  render();

})();

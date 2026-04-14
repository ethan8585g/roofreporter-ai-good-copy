// ============================================================
// Team Management — Add/manage sales team members ($50/user/month)
// Full CRUD: invite, view roster, change roles, suspend, remove
// ============================================================

var teamState = { loading: true, members: [], invitations: [], billing: null, canManage: true, isTeamMember: false };

function getToken() { return localStorage.getItem('rc_customer_token') || ''; }
function authHeaders() { return { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' }; }

document.addEventListener('DOMContentLoaded', async function() {
  await loadTeamData();
  renderTeam();
});

async function loadTeamData() {
  teamState.loading = true;
  try {
    var res = await fetch('/api/team/members', { headers: authHeaders() });
    if (!res.ok) throw new Error('Failed to load team data');
    var data = await res.json();
    teamState.members = data.members || [];
    teamState.invitations = data.invitations || [];
    teamState.billing = data.billing || null;
    teamState.canManage = data.can_manage !== false;
    teamState.isTeamMember = data.is_team_member || false;
  } catch(e) {
    console.error('Team load error:', e);
  }
  teamState.loading = false;
}

function renderTeam() {
  var root = document.getElementById('team-root');
  if (!root) return;

  if (teamState.loading) {
    root.innerHTML = '<div class="flex items-center justify-center py-20"><div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-emerald-500"></div><span class="ml-4 text-gray-500 text-lg">Loading team...</span></div>';
    return;
  }

  var activeMembers = teamState.members.filter(function(m) { return m.status === 'active'; });
  var suspendedMembers = teamState.members.filter(function(m) { return m.status === 'suspended'; });
  var pendingInvites = teamState.invitations || [];
  var billing = teamState.billing;
  var monthlyCost = activeMembers.length * 50;

  // If user is a team member (not owner), show a different view
  if (teamState.isTeamMember && !teamState.canManage) {
    root.innerHTML = renderTeamMemberView(activeMembers);
    return;
  }

  var html = '';

  // ── Header ──
  html += '<div class="flex items-center justify-between mb-6">';
  html += '  <div>';
  html += '    <h2 class="text-xl font-bold text-gray-100"><i class="fas fa-users-cog mr-2 text-emerald-400"></i>Sales Team</h2>';
  html += '    <p class="text-sm text-gray-500 mt-0.5">' + activeMembers.length + ' active member' + (activeMembers.length !== 1 ? 's' : '') + ' &nbsp;&middot;&nbsp; $50/user/month</p>';
  html += '  </div>';
  html += '  <button onclick="showInviteModal()" class="bg-emerald-500/15 hover:bg-emerald-500/25 text-white font-semibold py-2.5 px-5 rounded-lg text-sm transition-all hover:scale-105">';
  html += '    <i class="fas fa-user-plus mr-2"></i>Invite Member';
  html += '  </button>';
  html += '</div>';

  // ── Active members table ──
  if (activeMembers.length > 0) {
    html += '<div class="bg-[#111111] rounded-xl shadow-sm border overflow-hidden mb-6">';
    html += '<table class="w-full text-sm">';
    html += '<thead class="bg-[#0A0A0A] border-b"><tr>';
    html += '<th class="text-left px-4 py-3 font-semibold text-gray-400">Member</th>';
    html += '<th class="text-left px-4 py-3 font-semibold text-gray-400">Role</th>';
    html += '<th class="text-left px-4 py-3 font-semibold text-gray-400">Since</th>';
    html += '<th class="text-right px-4 py-3 font-semibold text-gray-400">Actions</th>';
    html += '</tr></thead><tbody>';
    activeMembers.forEach(function(m) {
      html += '<tr class="border-b hover:bg-[#111111]/5 transition-colors">';
      html += '<td class="px-4 py-3">';
      html += '  <div class="flex items-center gap-3">';
      html += '    <div class="w-9 h-9 rounded-full bg-emerald-500/15 flex items-center justify-center">';
      html += '      <span class="text-emerald-400 font-bold text-sm">' + (m.name || 'U').charAt(0).toUpperCase() + '</span>';
      html += '    </div>';
      html += '    <div>';
      html += '      <div class="font-semibold text-gray-100">' + escHtml(m.name) + '</div>';
      html += '      <div class="text-xs text-gray-500">' + escHtml(m.email) + '</div>';
      html += '    </div>';
      html += '  </div>';
      html += '</td>';
      html += '<td class="px-4 py-3">';
      html += m.role === 'admin'
        ? '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-500/15 text-blue-400"><i class="fas fa-shield-alt mr-1"></i>Admin</span>'
        : '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-500/100/15 text-blue-400"><i class="fas fa-user mr-1"></i>Member</span>';
      html += '</td>';
      html += '<td class="px-4 py-3 text-gray-500 text-xs">' + (m.joined_at ? new Date(m.joined_at).toLocaleDateString() : '-') + '</td>';
      html += '<td class="px-4 py-3 text-right">';
      html += '  <div class="relative inline-block">';
      html += '    <button onclick="toggleActionMenu(' + m.id + ',event)" class="text-gray-400 hover:text-gray-200 p-2 rounded-lg hover:bg-white/5 transition-colors"><i class="fas fa-ellipsis-h"></i></button>';
      html += '    <div id="action-menu-' + m.id + '" class="hidden absolute right-0 mt-1 w-48 bg-[#1a1a1a] border border-white/10 rounded-lg shadow-xl z-10 py-1">';
      html += '      <button onclick="toggleRole(' + m.id + ',\'' + (m.role === 'admin' ? 'member' : 'admin') + '\');closeActionMenus()" class="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-white/5 flex items-center gap-2"><i class="fas fa-' + (m.role === 'admin' ? 'user' : 'shield-alt') + ' w-4 text-center text-gray-400 text-xs"></i>' + (m.role === 'admin' ? 'Demote to Member' : 'Promote to Admin') + '</button>';
      html += '      <button onclick="showPermModal(' + m.id + ',\'' + escHtml(m.name) + '\');closeActionMenus()" class="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-white/5 flex items-center gap-2"><i class="fas fa-sliders-h w-4 text-center text-gray-400 text-xs"></i>Edit Permissions</button>';
      html += '      <button onclick="suspendMember(' + m.id + ');closeActionMenus()" class="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-white/5 flex items-center gap-2"><i class="fas fa-pause w-4 text-center text-gray-400 text-xs"></i>Suspend</button>';
      html += '      <div class="border-t border-white/10 my-1"></div>';
      html += '      <button onclick="removeMember(' + m.id + ',\'' + escHtml(m.name) + '\');closeActionMenus()" class="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-red-500/10 flex items-center gap-2"><i class="fas fa-user-minus w-4 text-center text-xs"></i>Remove</button>';
      html += '    </div>';
      html += '  </div>';
      html += '</td>';
      html += '</tr>';
    });
    html += '</tbody></table></div>';
  } else {
    html += '<div class="bg-[#111111] rounded-xl shadow-sm border p-8 text-center mb-6">';
    html += '  <i class="fas fa-users text-gray-300 text-5xl mb-4"></i>';
    html += '  <h3 class="text-lg font-bold text-gray-300 mb-2">No team members yet</h3>';
    html += '  <p class="text-gray-500 mb-4 max-w-md mx-auto">Invite your sales team to access all platform features including roof reports and CRM.</p>';
    html += '  <button onclick="showInviteModal()" class="bg-emerald-500/15 hover:bg-emerald-500/15 text-white font-semibold py-2.5 px-5 rounded-lg text-sm transition-all"><i class="fas fa-user-plus mr-2"></i>Invite Your First Member</button>';
    html += '</div>';
  }

  // ── Suspended members ──
  if (suspendedMembers.length > 0) {
    html += '<div class="mb-6">';
    html += '<h3 class="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3"><i class="fas fa-pause-circle mr-1"></i>Suspended (' + suspendedMembers.length + ')</h3>';
    html += '<div class="bg-blue-500/15/10 border border-white/15 rounded-xl overflow-hidden">';
    suspendedMembers.forEach(function(m) {
      html += '<div class="flex items-center justify-between px-4 py-3 border-b border-white/15 last:border-0">';
      html += '  <div class="flex items-center gap-3">';
      html += '    <div class="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center"><span class="text-gray-400 font-bold text-xs">' + (m.name || 'U').charAt(0) + '</span></div>';
      html += '    <div><span class="font-medium text-gray-300">' + escHtml(m.name) + '</span><span class="text-xs text-gray-400 ml-2">' + escHtml(m.email) + '</span></div>';
      html += '  </div>';
      html += '  <div class="flex gap-2">';
      html += '    <button onclick="reactivateMember(' + m.id + ')" class="text-xs bg-emerald-500/100 hover:bg-green-600 text-white py-1 px-3 rounded font-semibold"><i class="fas fa-play mr-1"></i>Reactivate</button>';
      html += '    <button onclick="removeMember(' + m.id + ',\'' + escHtml(m.name) + '\')" class="text-xs bg-red-500/100 hover:bg-red-600 text-white py-1 px-3 rounded font-semibold"><i class="fas fa-trash mr-1"></i>Remove</button>';
      html += '  </div>';
      html += '</div>';
    });
    html += '</div></div>';
  }

  // ── Pending invitations ──
  if (pendingInvites.length > 0) {
    html += '<div class="mb-6">';
    html += '<h3 class="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3"><i class="fas fa-envelope-open-text mr-1"></i>Pending Invitations (' + pendingInvites.length + ')</h3>';
    html += '<div class="bg-blue-500/10 border border-blue-200 rounded-xl overflow-hidden">';
    pendingInvites.forEach(function(inv) {
      html += '<div class="flex items-center justify-between px-4 py-3 border-b border-blue-100 last:border-0">';
      html += '  <div>';
      html += '    <span class="font-medium text-gray-300">' + escHtml(inv.name) + '</span>';
      html += '    <span class="text-xs text-gray-400 ml-2">' + escHtml(inv.email) + '</span>';
      html += '    <span class="text-xs text-blue-500 ml-2">Expires ' + new Date(inv.expires_at).toLocaleDateString() + '</span>';
      html += '  </div>';
      html += '  <button onclick="cancelInvite(' + inv.id + ')" class="text-xs text-red-500 hover:text-red-700 font-semibold"><i class="fas fa-times mr-1"></i>Cancel</button>';
      html += '</div>';
    });
    html += '</div></div>';
  }

  // ── Pricing info (collapsed by default when team already has members) ──
  var pricingOpen = activeMembers.length === 0;
  html += '<details' + (pricingOpen ? ' open' : '') + '>';
  html += '  <summary class="cursor-pointer list-none flex items-center justify-between px-4 py-3 bg-[#0A0A0A] rounded-xl border text-sm font-semibold text-gray-400 hover:text-gray-200 select-none transition-colors">';
  html += '    <span><i class="fas fa-tag mr-2 text-emerald-400"></i>Team Pricing &nbsp;&middot;&nbsp; $50/user/month</span>';
  html += '    <i class="fas fa-chevron-down text-xs"></i>';
  html += '  </summary>';
  html += '  <div class="mt-2 bg-[#0A0A0A] rounded-xl border p-6">';
  html += '    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">';
  html += '      <div class="bg-[#111111] rounded-lg p-4 border text-center">';
  html += '        <div class="text-3xl font-black text-emerald-400">$50</div>';
  html += '        <div class="text-gray-500 text-sm">per user / month</div>';
  html += '      </div>';
  html += '      <div class="bg-[#111111] rounded-lg p-4 border">';
  html += '        <div class="font-semibold text-gray-300 mb-2">Each member gets:</div>';
  html += '        <ul class="text-sm text-gray-400 space-y-1">';
  html += '          <li><i class="fas fa-check text-emerald-400 mr-1"></i>Order roof reports</li>';
  html += '          <li><i class="fas fa-check text-emerald-400 mr-1"></i>Full CRM access</li>';
  html += '          <li><i class="fas fa-check text-emerald-400 mr-1"></i>D2D Manager</li>';
  html += '        </ul>';
  html += '      </div>';
  html += '      <div class="bg-[#111111] rounded-lg p-4 border">';
  html += '        <div class="font-semibold text-gray-300 mb-2">Team billing:</div>';
  html += '        <ul class="text-sm text-gray-400 space-y-1">';
  html += '          <li><i class="fas fa-info-circle text-blue-400 mr-1"></i>Billed to account owner</li>';
  html += '          <li><i class="fas fa-info-circle text-blue-400 mr-1"></i>Suspend anytime to pause billing</li>';
  html += '          <li><i class="fas fa-info-circle text-blue-400 mr-1"></i>No contracts, cancel anytime</li>';
  html += '          <li><i class="fas fa-info-circle text-blue-400 mr-1"></i>Report credits shared with team</li>';
  html += '        </ul>';
  html += '      </div>';
  html += '    </div>';
  html += '  </div>';
  html += '</details>';

  // ── Invite modal (hidden) ──
  html += renderInviteModal();

  root.innerHTML = html;
}

// ── Team Member View (read-only for regular team members) ──
function renderTeamMemberView(members) {
  var html = '<div class="bg-gradient-to-r from-blue-500 to-blue-700 rounded-2xl p-6 text-white mb-6">';
  html += '<h2 class="text-2xl font-bold"><i class="fas fa-users mr-2"></i>Your Team</h2>';
  html += '<p class="text-blue-200 mt-1">You are a member of this team</p>';
  html += '</div>';
  html += '<div class="bg-[#111111] rounded-xl shadow-sm border overflow-hidden">';
  members.forEach(function(m) {
    html += '<div class="flex items-center gap-3 px-4 py-3 border-b last:border-0">';
    html += '  <div class="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center"><span class="text-blue-700 font-bold">' + (m.name || 'U').charAt(0) + '</span></div>';
    html += '  <div><div class="font-semibold text-gray-100">' + escHtml(m.name) + '</div><div class="text-xs text-gray-500">' + escHtml(m.email) + ' · ' + m.role + '</div></div>';
    html += '</div>';
  });
  html += '</div>';
  html += '<div class="mt-6 text-center"><button onclick="leaveTeam()" class="text-red-500 hover:text-red-700 text-sm font-semibold"><i class="fas fa-sign-out-alt mr-1"></i>Leave Team</button></div>';
  return html;
}

// ── Permissions Modal ──
var permModalMemberId = null;

function showPermModal(memberId, memberName) {
  permModalMemberId = memberId;
  // Find current permissions for this member
  var member = teamState.members.find(function(m) { return m.id === memberId; });
  var currentPerms = {};
  try { currentPerms = JSON.parse(member && member.permissions ? member.permissions : '{}'); } catch(e) {}

  var modalHtml =
    '<div id="permModal" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">' +
      '<div class="bg-[#111111] rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">' +
        '<div class="bg-gradient-to-r from-emerald-500 to-emerald-600 px-6 py-4 text-white">' +
          '<h3 class="text-base font-bold"><i class="fas fa-sliders-h mr-2"></i>Permissions: ' + escHtml(memberName) + '</h3>' +
          '<p class="text-emerald-400 text-xs mt-0.5">Control what this member can access</p>' +
        '</div>' +
        '<div class="p-6">' +
          renderPermCheckboxes('perm', currentPerms) +
          '<div id="permMsg" class="mt-3"></div>' +
          '<div class="flex gap-3 mt-4">' +
            '<button onclick="hidePermModal()" class="flex-1 border border-white/15 rounded-lg py-2.5 text-sm font-semibold text-gray-300 hover:bg-[#111111]/5">Cancel</button>' +
            '<button onclick="savePermissions()" id="permSaveBtn" class="flex-1 bg-emerald-500/15 hover:bg-emerald-500/15 text-white rounded-lg py-2.5 text-sm font-semibold"><i class="fas fa-save mr-1"></i>Save Permissions</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';

  var existing = document.getElementById('permModal');
  if (existing) existing.remove();
  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function hidePermModal() {
  var el = document.getElementById('permModal');
  if (el) el.remove();
  permModalMemberId = null;
}

async function savePermissions() {
  if (!permModalMemberId) return;
  var btn = document.getElementById('permSaveBtn');
  var msg = document.getElementById('permMsg');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Saving...';

  var perms = collectPerms('perm');

  try {
    var res = await fetch('/api/team/members/' + permModalMemberId, {
      method: 'PUT', headers: authHeaders(),
      body: JSON.stringify({ permissions: perms })
    });
    var data = await res.json();
    if (res.ok && data.success) {
      msg.innerHTML = '<div class="text-emerald-400 text-sm"><i class="fas fa-check-circle mr-1"></i>Permissions saved</div>';
      setTimeout(async function() { hidePermModal(); await loadTeamData(); renderTeam(); }, 900);
    } else {
      msg.innerHTML = '<div class="text-red-500 text-sm">' + (data.error || 'Save failed') + '</div>';
      btn.disabled = false; btn.innerHTML = '<i class="fas fa-save mr-1"></i>Save Permissions';
    }
  } catch(e) {
    msg.innerHTML = '<div class="text-red-500 text-sm">Network error</div>';
    btn.disabled = false; btn.innerHTML = '<i class="fas fa-save mr-1"></i>Save Permissions';
  }
}

// ── Permission labels ──
// Mirrors src/lib/permissions.ts ALL_PERMISSION_KEYS. Module keys default on
// (backward compat with pre-RBAC invites); sensitive caps default off so they
// must be explicitly granted.
var MODULE_PERMS = [
  { key: 'orders',     label: 'Order Reports',           icon: 'fa-plus-circle' },
  { key: 'reports',    label: 'View Reports',             icon: 'fa-file-alt' },
  { key: 'crm',        label: 'CRM (Customers)',          icon: 'fa-users' },
  { key: 'pipeline',   label: 'Sales Pipeline',           icon: 'fa-stream' },
  { key: 'jobs',       label: 'Jobs',                     icon: 'fa-briefcase' },
  { key: 'invoices',   label: 'Invoices',                 icon: 'fa-file-invoice-dollar' },
  { key: 'proposals',  label: 'Proposals',                icon: 'fa-file-signature' },
  { key: 'secretary',  label: 'AI Secretary',             icon: 'fa-robot' },
  { key: 'cold_call',  label: 'Cold Call Center',         icon: 'fa-phone' },
  { key: 'd2d',        label: 'Door-to-Door',             icon: 'fa-map-marker-alt' },
  { key: 'billing',    label: 'Billing',                  icon: 'fa-credit-card' },
  { key: 'settings',   label: 'Settings',                 icon: 'fa-cog' },
  { key: 'team',       label: 'Team Management',          icon: 'fa-user-friends' },
];
var SENSITIVE_PERMS = [
  { key: 'view_financials', label: 'View Financial Amounts', icon: 'fa-dollar-sign',
    hint: 'See totals, revenue, costs, and profit.' },
  { key: 'export_reports',  label: 'Export Data (CSV / JSON)', icon: 'fa-download',
    hint: 'Download reports, invoices, customer lists.' },
  { key: 'delete_records',  label: 'Delete Records',         icon: 'fa-trash',
    hint: 'Permanently remove invoices, customers, jobs.' },
];
// Keep a flat list for backward compat with any external caller.
var PERM_LABELS = MODULE_PERMS.concat(SENSITIVE_PERMS);

function renderPermCheckboxes(idPrefix, perms) {
  // Effective defaults: modules on, sensitive off.
  var effective = {};
  MODULE_PERMS.forEach(function(p){ effective[p.key] = true; });
  SENSITIVE_PERMS.forEach(function(p){ effective[p.key] = false; });
  if (perms) for (var k in perms) { if (perms[k] === true) effective[k] = true; else if (perms[k] === false) effective[k] = false; }

  function renderRow(p, section) {
    var checked = effective[p.key] === true;
    var hint = p.hint ? '<span class="block text-[11px] text-gray-500 ml-6">' + p.hint + '</span>' : '';
    return '<label class="block py-1 cursor-pointer">' +
      '<span class="flex items-center gap-2">' +
        '<input type="checkbox" id="' + idPrefix + '_' + p.key + '"' + (checked ? ' checked' : '') +
          ' data-perm-section="' + section + '"' +
          ' class="rounded border-white/15 text-emerald-400 focus:ring-emerald-500">' +
        '<i class="fas ' + p.icon + ' text-gray-400 text-xs w-4 text-center"></i>' +
        '<span class="text-sm text-gray-300">' + p.label + '</span>' +
      '</span>' + hint +
    '</label>';
  }

  var html = '<div class="border border-white/10 rounded-lg p-3 bg-[#0A0A0A] space-y-3">';
  html += '<div>';
  html += '<p class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Module Access</p>';
  MODULE_PERMS.forEach(function(p){ html += renderRow(p, 'module'); });
  html += '</div>';
  html += '<div class="pt-2 border-t border-white/10">';
  html += '<p class="text-xs font-bold text-amber-500 uppercase tracking-wider mb-2"><i class="fas fa-shield-alt mr-1"></i>Sensitive Capabilities</p>';
  html += '<p class="text-[11px] text-gray-500 mb-2">Off by default. Only grant to trusted members.</p>';
  SENSITIVE_PERMS.forEach(function(p){ html += renderRow(p, 'sensitive'); });
  html += '</div>';
  html += '</div>';
  return html;
}

function collectPerms(idPrefix) {
  var perms = {};
  PERM_LABELS.forEach(function (p) {
    var el = document.getElementById(idPrefix + '_' + p.key);
    // Default-false for sensitive so missing checkbox never grants.
    var def = SENSITIVE_PERMS.some(function(sp){ return sp.key === p.key; }) ? false : true;
    perms[p.key] = el ? el.checked : def;
  });
  return perms;
}

// ── Invite Modal HTML ──
function renderInviteModal() {
  return '<div id="inviteModal" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 hidden">' +
    '<div class="bg-[#111111] rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden max-h-screen overflow-y-auto">' +
      '<div class="bg-gradient-to-r from-emerald-500 to-emerald-600 px-6 py-4 text-white">' +
        '<h3 class="text-lg font-bold"><i class="fas fa-user-plus mr-2"></i>Invite Team Member</h3>' +
        '<p class="text-emerald-400 text-sm">$50/month per user</p>' +
      '</div>' +
      '<form onsubmit="sendInvite(event)" class="p-6 space-y-4">' +
        '<div>' +
          '<label class="block text-sm font-semibold text-gray-300 mb-1">Full Name *</label>' +
          '<input type="text" id="invName" required placeholder="e.g. John Smith" class="w-full border border-white/15 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500">' +
        '</div>' +
        '<div>' +
          '<label class="block text-sm font-semibold text-gray-300 mb-1">Email Address *</label>' +
          '<input type="email" id="invEmail" required placeholder="john@company.com" class="w-full border border-white/15 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500">' +
        '</div>' +
        '<div>' +
          '<label class="block text-sm font-semibold text-gray-300 mb-1">Role</label>' +
          '<select id="invRole" class="w-full border border-white/15 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-emerald-500">' +
            '<option value="member">Team Member — no team management</option>' +
            '<option value="admin">Team Admin — full access + manage team</option>' +
          '</select>' +
        '</div>' +
        '<div>' + renderPermCheckboxes('inv', null) + '</div>' +
        '<div id="invMsg"></div>' +
        '<div class="flex gap-3 pt-2">' +
          '<button type="button" onclick="hideInviteModal()" class="flex-1 border border-white/15 rounded-lg py-2.5 text-sm font-semibold text-gray-300 hover:bg-[#111111]/5 transition-colors">Cancel</button>' +
          '<button type="submit" id="invBtn" class="flex-1 bg-emerald-500/15 hover:bg-emerald-500/15 text-white rounded-lg py-2.5 text-sm font-semibold transition-all"><i class="fas fa-paper-plane mr-1"></i>Send Invite</button>' +
        '</div>' +
      '</form>' +
    '</div>' +
  '</div>';
}

// ── Modal controls ──
function showInviteModal() {
  document.getElementById('inviteModal').classList.remove('hidden');
  document.getElementById('invName').value = '';
  document.getElementById('invEmail').value = '';
  document.getElementById('invMsg').innerHTML = '';
}
function hideInviteModal() {
  document.getElementById('inviteModal').classList.add('hidden');
}

// ── Send Invite ──
async function sendInvite(e) {
  e.preventDefault();
  var btn = document.getElementById('invBtn');
  var msg = document.getElementById('invMsg');
  var name = document.getElementById('invName').value.trim();
  var email = document.getElementById('invEmail').value.trim();
  var role = document.getElementById('invRole').value;

  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Sending...';
  msg.innerHTML = '';

  var permissions = collectPerms('inv');

  try {
    var res = await fetch('/api/team/invite', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ name: name, email: email, role: role, permissions: permissions })
    });
    var data = await res.json();
    if (res.ok && data.success) {
      msg.innerHTML = '<div class="bg-emerald-500/10 border border-green-200 rounded-lg p-3 text-green-700 text-sm"><i class="fas fa-check-circle mr-1"></i>' + data.message + '</div>';
      setTimeout(async function() { hideInviteModal(); await loadTeamData(); renderTeam(); }, 1500);
    } else if (res.status === 402 && (data.subscription_required || data.upgrade_required)) {
      var tier = data.subscription_required ? 'starter' : data.next_tier;
      var label = data.subscription_required
        ? 'Subscribe to Starter (' + data.price + '/month) to unlock 5 team members.'
        : 'Upgrade to ' + data.next_tier + ' (' + data.next_price + '/month) for ' + data.next_team_limit + ' team members.';
      msg.innerHTML =
        '<div class="bg-amber-500/10 border border-amber-300/30 rounded-lg p-3 text-amber-200 text-sm mb-2">' + (data.error || label) + '</div>' +
        '<button type="button" id="invSubBtn" class="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-semibold py-2.5 rounded-lg text-sm">' +
          (data.subscription_required ? 'Subscribe Now' : 'Upgrade Now') +
        '</button>';
      document.getElementById('invSubBtn').onclick = async function() {
        this.disabled = true; this.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Loading...';
        try {
          var r = await fetch('/api/square/checkout/subscription', {
            method: 'POST', headers: authHeaders(), body: JSON.stringify({ tier: tier })
          });
          var d = await r.json();
          if (d.checkout_url) { window.location.href = d.checkout_url; }
          else { msg.innerHTML = '<div class="bg-red-500/10 border border-red-200 rounded-lg p-3 text-red-700 text-sm">' + (d.error || 'Could not start checkout') + '</div>'; }
        } catch(e) {
          msg.innerHTML = '<div class="bg-red-500/10 border border-red-200 rounded-lg p-3 text-red-700 text-sm">Network error starting checkout</div>';
        }
      };
    } else {
      msg.innerHTML = '<div class="bg-red-500/10 border border-red-200 rounded-lg p-3 text-red-700 text-sm">' + (data.error || 'Failed to send invite') + '</div>';
    }
  } catch(err) {
    msg.innerHTML = '<div class="bg-red-500/10 border border-red-200 rounded-lg p-3 text-red-700 text-sm">Network error</div>';
  }
  btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane mr-1"></i>Send Invite';
}

// ── Actions ──
async function toggleRole(memberId, newRole) {
  if (!(await window.rmConfirm('Change role to ' + newRole + '?'))) return
  await fetch('/api/team/members/' + memberId, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ role: newRole }) });
  await loadTeamData(); renderTeam();
}

async function suspendMember(memberId) {
  if (!(await window.rmConfirm('Suspend this team member? Their access and billing will be paused.'))) return
  await fetch('/api/team/members/' + memberId + '/suspend', { method: 'POST', headers: authHeaders() });
  await loadTeamData(); renderTeam();
}

async function reactivateMember(memberId) {
  if (!(await window.rmConfirm('Reactivate this member? Billing will resume at $50/month.'))) return
  await fetch('/api/team/members/' + memberId + '/reactivate', { method: 'POST', headers: authHeaders() });
  await loadTeamData(); renderTeam();
}

async function removeMember(memberId, name) {
  if (!(await window.rmConfirm('Remove ' + name + ' from your team? This will revoke their access immediately.'))) return
  await fetch('/api/team/members/' + memberId, { method: 'DELETE', headers: authHeaders() });
  await loadTeamData(); renderTeam();
}

async function cancelInvite(inviteId) {
  if (!(await window.rmConfirm('Cancel this invitation?'))) return
  await fetch('/api/team/invite/' + inviteId, { method: 'DELETE', headers: authHeaders() });
  await loadTeamData(); renderTeam();
}

async function leaveTeam() {
  if (!(await window.rmConfirm('Are you sure you want to leave this team? You will lose access to the team account.'))) return
  await fetch('/api/team/leave', { method: 'POST', headers: authHeaders() });
  window.location.href = '/customer/dashboard';
}

// ── Action menu (••• per-row dropdown) ──
function toggleActionMenu(memberId, event) {
  event.stopPropagation();
  closeActionMenus();
  var menu = document.getElementById('action-menu-' + memberId);
  if (menu) {
    menu.classList.remove('hidden');
    document.addEventListener('click', closeActionMenus, { once: true });
  }
}

function closeActionMenus() {
  document.querySelectorAll('[id^="action-menu-"]').forEach(function(m) {
    m.classList.add('hidden');
  });
}

// ── Utility ──
function escHtml(str) {
  var d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

// ============================================================
// Team Activity Dashboard (owner-only)
// Tabs: Overview / Members / Activity / Billing
// ============================================================

var tdState = {
  loading: true,
  tab: 'overview',
  members: [],
  invitations: [],
  billing: null,
  gating: null,
  activity: null,
  feed: null,
  feedLoading: false,
  feedMemberFilter: '',
  feedEntityFilter: '',
  ownerOnly: false,
  error: null
};

function tdToken() { return localStorage.getItem('rc_customer_token') || ''; }
function tdHeaders() { return { 'Authorization': 'Bearer ' + tdToken(), 'Content-Type': 'application/json' }; }
function tdEsc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

document.addEventListener('DOMContentLoaded', async function() {
  await tdLoadAll();
  tdRender();
});

async function tdLoadAll() {
  tdState.loading = true;
  try {
    var [membersRes, gatingRes, activityRes] = await Promise.all([
      fetch('/api/team/members', { headers: tdHeaders() }),
      fetch('/api/team/gating', { headers: tdHeaders() }),
      fetch('/api/team/activity-summary', { headers: tdHeaders() })
    ]);

    if (gatingRes.status === 403 || activityRes.status === 403) {
      tdState.ownerOnly = true;
      tdState.loading = false;
      return;
    }

    var membersData = await membersRes.json();
    tdState.members = membersData.members || [];
    tdState.invitations = membersData.invitations || [];
    tdState.billing = membersData.billing || null;
    tdState.gating = gatingRes.ok ? await gatingRes.json() : null;
    tdState.activity = activityRes.ok ? await activityRes.json() : null;
  } catch (e) {
    tdState.error = e.message || 'Failed to load dashboard';
  }
  tdState.loading = false;
}

function tdRender() {
  var root = document.getElementById('td-root');
  if (!root) return;

  if (tdState.loading) {
    root.innerHTML = '<div class="flex items-center justify-center py-20"><div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-emerald-500"></div><span class="ml-4 text-gray-500 text-lg">Loading dashboard...</span></div>';
    return;
  }

  if (tdState.ownerOnly) {
    root.innerHTML =
      '<div class="bg-amber-500/10 border border-amber-500/30 rounded-xl p-8 text-center">' +
      '  <i class="fas fa-lock text-amber-400 text-4xl mb-3"></i>' +
      '  <h2 class="text-xl font-bold text-gray-100 mb-2">Account owner only</h2>' +
      '  <p class="text-gray-400">The Team Activity Dashboard is restricted to the account owner.</p>' +
      '  <a href="/customer/team" class="inline-block mt-4 text-emerald-400 hover:text-emerald-300 text-sm font-semibold">Go to Team Management &rarr;</a>' +
      '</div>';
    return;
  }

  var html = '';
  html += tdRenderHeader();
  html += tdRenderTabs();
  html += '<div class="mt-6">';
  if (tdState.tab === 'overview') html += tdRenderOverview();
  else if (tdState.tab === 'members') html += tdRenderMembers();
  else if (tdState.tab === 'activity') html += tdRenderActivity();
  else if (tdState.tab === 'billing') html += tdRenderBilling();
  html += '</div>';
  html += tdRenderInviteModal();
  root.innerHTML = html;
}

function tdRenderHeader() {
  var g = tdState.gating || {};
  var used = g.active_seats || 0;
  var limit = g.team_limit || 0;
  var pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  var barColor = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-emerald-500';

  var html = '<div class="flex items-start justify-between mb-6 gap-4 flex-wrap">';
  html += '  <div>';
  html += '    <h2 class="text-2xl font-bold text-gray-100"><i class="fas fa-chart-line mr-2 text-emerald-400"></i>Team Activity Dashboard</h2>';
  html += '    <p class="text-sm text-gray-500 mt-1">Manage and track all activity for team members on your account</p>';
  html += '  </div>';
  html += '  <div class="flex items-center gap-3">';
  if (g.subscribed && !g.at_cap) {
    html += '    <button onclick="tdShowInvite()" class="bg-emerald-500 hover:bg-emerald-600 text-white font-semibold py-2.5 px-5 rounded-lg text-sm"><i class="fas fa-user-plus mr-2"></i>Invite Member</button>';
  } else if (g.subscribed && g.at_cap) {
    html += '    <button onclick="tdUpgrade(\'' + (g.next_tier || '') + '\')" class="bg-amber-500 hover:bg-amber-600 text-white font-semibold py-2.5 px-5 rounded-lg text-sm"><i class="fas fa-arrow-up mr-2"></i>Upgrade to add more</button>';
  } else {
    html += '    <button onclick="tdUpgrade(\'starter\')" class="bg-emerald-500 hover:bg-emerald-600 text-white font-semibold py-2.5 px-5 rounded-lg text-sm"><i class="fas fa-star mr-2"></i>Subscribe to invite</button>';
  }
  html += '  </div>';
  html += '</div>';

  // Seat usage bar
  if (g.subscribed) {
    html += '<div class="rounded-xl p-4 mb-4" style="background:var(--bg-card);border:1px solid rgba(255,255,255,0.08)">';
    html += '  <div class="flex items-center justify-between mb-2">';
    html += '    <div class="text-sm text-gray-400"><i class="fas fa-users mr-1 text-emerald-400"></i>Seat usage &middot; <span class="text-gray-300 font-semibold">' + (g.tier || '').replace(/^./, function(c){return c.toUpperCase();}) + '</span> plan</div>';
    html += '    <div class="text-sm font-bold text-gray-200">' + used + ' / ' + limit + ' seats</div>';
    html += '  </div>';
    html += '  <div class="w-full h-2 bg-white/5 rounded-full overflow-hidden"><div class="h-full ' + barColor + '" style="width:' + pct + '%"></div></div>';
    if (g.at_cap && g.next_tier) {
      html += '  <p class="text-xs text-amber-400 mt-2"><i class="fas fa-info-circle mr-1"></i>You\'re at your plan\'s cap. Upgrade to ' + g.next_tier + ' (' + g.next_price + '/mo) for ' + g.next_team_limit + ' seats.</p>';
    }
    html += '</div>';
  } else {
    html += '<div class="rounded-xl p-4 mb-4 bg-amber-500/10 border border-amber-500/30">';
    html += '  <p class="text-sm text-amber-200"><i class="fas fa-exclamation-triangle mr-1"></i>No active subscription. Subscribe to Starter ($49.99/month) to invite up to 5 team members.</p>';
    html += '</div>';
  }
  return html;
}

function tdRenderTabs() {
  var tabs = [
    { id: 'overview', label: 'Overview', icon: 'fa-th-large' },
    { id: 'members',  label: 'Members',  icon: 'fa-users' },
    { id: 'activity', label: 'Activity', icon: 'fa-history' },
    { id: 'billing',  label: 'Billing',  icon: 'fa-credit-card' }
  ];
  var html = '<div class="flex gap-1 border-b border-white/10 overflow-x-auto">';
  tabs.forEach(function(t) {
    var active = tdState.tab === t.id;
    var cls = active
      ? 'text-emerald-400 border-emerald-400'
      : 'text-gray-400 border-transparent hover:text-gray-200';
    html += '<button onclick="tdSetTab(\'' + t.id + '\')" class="px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ' + cls + '"><i class="fas ' + t.icon + ' mr-1.5"></i>' + t.label + '</button>';
  });
  html += '</div>';
  return html;
}

function tdSetTab(id) {
  tdState.tab = id;
  tdRender();
  if (id === 'activity' && !tdState.feed && !tdState.feedLoading) tdLoadFeed();
}

async function tdLoadFeed() {
  tdState.feedLoading = true;
  tdRender();
  try {
    var q = new URLSearchParams();
    if (tdState.feedMemberFilter) q.set('member_id', tdState.feedMemberFilter);
    if (tdState.feedEntityFilter) q.set('entity_type', tdState.feedEntityFilter);
    q.set('limit', '100');
    var res = await fetch('/api/team/activity?' + q.toString(), { headers: tdHeaders() });
    if (res.ok) tdState.feed = await res.json();
  } catch (e) { console.error('feed load', e); }
  tdState.feedLoading = false;
  tdRender();
}

function tdSetFeedFilter(kind, value) {
  if (kind === 'member') tdState.feedMemberFilter = value;
  else if (kind === 'entity') tdState.feedEntityFilter = value;
  tdState.feed = null;
  tdLoadFeed();
}

// ── Overview tab ──
function tdRenderOverview() {
  var totals = (tdState.activity && tdState.activity.totals) || { active:0, suspended:0, removed:0, pending:0 };
  var stats = [
    { label: 'Active members', val: totals.active, icon: 'fa-user-check', color: 'text-emerald-400' },
    { label: 'Pending invites', val: totals.pending, icon: 'fa-envelope-open-text', color: 'text-blue-400' },
    { label: 'Suspended',       val: totals.suspended, icon: 'fa-pause-circle', color: 'text-amber-400' },
    { label: 'Removed',         val: totals.removed, icon: 'fa-user-minus', color: 'text-gray-500' }
  ];

  var html = '<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">';
  stats.forEach(function(s) {
    html += '<div class="rounded-xl p-4" style="background:var(--bg-card);border:1px solid rgba(255,255,255,0.08)">';
    html += '  <div class="text-xs text-gray-500 uppercase tracking-wider mb-1">' + s.label + '</div>';
    html += '  <div class="flex items-center gap-2"><i class="fas ' + s.icon + ' ' + s.color + '"></i><div class="text-2xl font-black text-gray-100">' + s.val + '</div></div>';
    html += '</div>';
  });
  html += '</div>';

  // Pending invites quick list
  var invites = tdState.invitations || [];
  if (invites.length > 0) {
    html += '<div class="rounded-xl overflow-hidden mb-4" style="background:var(--bg-card);border:1px solid rgba(255,255,255,0.08)">';
    html += '  <div class="px-4 py-3 border-b border-white/10"><h3 class="text-sm font-bold text-gray-200"><i class="fas fa-envelope-open-text text-blue-400 mr-1"></i>Pending Invitations</h3></div>';
    invites.forEach(function(inv) {
      var expires = new Date(inv.expires_at).toLocaleDateString();
      html += '  <div class="flex items-center justify-between px-4 py-3 border-b border-white/5 last:border-0">';
      html += '    <div><div class="text-sm font-semibold text-gray-200">' + tdEsc(inv.name) + '</div><div class="text-xs text-gray-500">' + tdEsc(inv.email) + ' &middot; expires ' + expires + '</div></div>';
      html += '    <div class="flex gap-2">';
      html += '      <button onclick="tdResendInvite(' + inv.id + ')" class="text-xs bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 py-1.5 px-3 rounded font-semibold"><i class="fas fa-paper-plane mr-1"></i>Resend</button>';
      html += '      <button onclick="tdCancelInvite(' + inv.id + ')" class="text-xs bg-red-500/15 hover:bg-red-500/25 text-red-300 py-1.5 px-3 rounded font-semibold"><i class="fas fa-times mr-1"></i>Cancel</button>';
      html += '    </div>';
      html += '  </div>';
    });
    html += '</div>';
  }

  // Recent sign-ins preview (top 5 by last_login)
  var byLogin = ((tdState.activity && tdState.activity.members) || []).slice().sort(function(a, b) {
    var la = a.member_last_login ? new Date(a.member_last_login).getTime() : 0;
    var lb = b.member_last_login ? new Date(b.member_last_login).getTime() : 0;
    return lb - la;
  }).slice(0, 5);

  html += '<div class="rounded-xl overflow-hidden" style="background:var(--bg-card);border:1px solid rgba(255,255,255,0.08)">';
  html += '  <div class="px-4 py-3 border-b border-white/10"><h3 class="text-sm font-bold text-gray-200"><i class="fas fa-history text-emerald-400 mr-1"></i>Recent Activity</h3></div>';
  if (byLogin.length === 0) {
    html += '  <div class="p-6 text-center text-gray-500 text-sm">No team members yet.</div>';
  } else {
    byLogin.forEach(function(m) {
      var last = m.member_last_login ? new Date(m.member_last_login).toLocaleString() : 'Never signed in';
      html += '    <div class="flex items-center gap-3 px-4 py-3 border-b border-white/5 last:border-0">';
      html += '      <div class="w-9 h-9 rounded-full bg-emerald-500/15 flex items-center justify-center"><span class="text-emerald-400 font-bold text-sm">' + (m.name || 'U').charAt(0).toUpperCase() + '</span></div>';
      html += '      <div class="flex-1"><div class="text-sm font-semibold text-gray-200">' + tdEsc(m.name) + '</div><div class="text-xs text-gray-500">Last seen: ' + last + '</div></div>';
      html += '      <span class="text-xs ' + (m.status === 'active' ? 'text-emerald-400' : 'text-gray-500') + '">' + m.status + '</span>';
      html += '    </div>';
    });
  }
  html += '</div>';

  return html;
}

// ── Members tab ──
function tdRenderMembers() {
  var rows = (tdState.activity && tdState.activity.members) || [];
  if (rows.length === 0) {
    return '<div class="rounded-xl p-10 text-center" style="background:var(--bg-card);border:1px solid rgba(255,255,255,0.08)"><i class="fas fa-users text-gray-600 text-4xl mb-3"></i><p class="text-gray-400">No team members yet. Invite your first one.</p></div>';
  }

  var html = '<div class="rounded-xl overflow-hidden" style="background:var(--bg-card);border:1px solid rgba(255,255,255,0.08)">';
  html += '<table class="w-full text-sm"><thead style="background:var(--bg-page)"><tr>';
  ['Member', 'Role', 'Status', 'Joined', 'Last Login', 'Actions'].forEach(function(h) {
    html += '<th class="text-left px-4 py-3 font-semibold text-gray-400 text-xs uppercase tracking-wider">' + h + '</th>';
  });
  html += '</tr></thead><tbody>';
  rows.forEach(function(m) {
    var statusColors = { active: 'bg-emerald-500/15 text-emerald-400', suspended: 'bg-amber-500/15 text-amber-400', removed: 'bg-gray-500/15 text-gray-400' };
    var statusCls = statusColors[m.status] || statusColors.removed;
    var joined = m.joined_at ? new Date(m.joined_at).toLocaleDateString() : '-';
    var last = m.member_last_login ? new Date(m.member_last_login).toLocaleString() : '—';
    html += '<tr class="border-t border-white/5">';
    html += '  <td class="px-4 py-3">';
    html += '    <div class="flex items-center gap-3">';
    html += '      <div class="w-8 h-8 rounded-full bg-emerald-500/15 flex items-center justify-center"><span class="text-emerald-400 font-bold text-xs">' + (m.name || 'U').charAt(0).toUpperCase() + '</span></div>';
    html += '      <div><div class="font-semibold text-gray-200">' + tdEsc(m.name) + '</div><div class="text-xs text-gray-500">' + tdEsc(m.email) + '</div></div>';
    html += '    </div>';
    html += '  </td>';
    html += '  <td class="px-4 py-3"><span class="text-xs font-semibold ' + (m.role === 'admin' ? 'text-blue-400' : 'text-gray-300') + '">' + (m.role === 'admin' ? 'Admin' : 'Member') + '</span></td>';
    html += '  <td class="px-4 py-3"><span class="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ' + statusCls + '">' + m.status + '</span></td>';
    html += '  <td class="px-4 py-3 text-xs text-gray-400">' + joined + '</td>';
    html += '  <td class="px-4 py-3 text-xs text-gray-400">' + last + '</td>';
    html += '  <td class="px-4 py-3">';
    html += '    <div class="flex gap-1">';
    if (m.status === 'active') {
      html += '      <button title="' + (m.role === 'admin' ? 'Demote to Member' : 'Promote to Admin') + '" onclick="tdToggleRole(' + m.id + ',\'' + (m.role === 'admin' ? 'member' : 'admin') + '\')" class="text-xs bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 py-1 px-2 rounded"><i class="fas fa-' + (m.role === 'admin' ? 'user' : 'shield-alt') + '"></i></button>';
      html += '      <button title="Suspend" onclick="tdSuspend(' + m.id + ')" class="text-xs bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 py-1 px-2 rounded"><i class="fas fa-pause"></i></button>';
      html += '      <button title="Remove" onclick="tdRemove(' + m.id + ',\'' + tdEsc(m.name) + '\')" class="text-xs bg-red-500/15 hover:bg-red-500/25 text-red-300 py-1 px-2 rounded"><i class="fas fa-trash"></i></button>';
    } else if (m.status === 'suspended') {
      html += '      <button title="Reactivate" onclick="tdReactivate(' + m.id + ')" class="text-xs bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 py-1 px-2 rounded"><i class="fas fa-play"></i></button>';
      html += '      <button title="Remove" onclick="tdRemove(' + m.id + ',\'' + tdEsc(m.name) + '\')" class="text-xs bg-red-500/15 hover:bg-red-500/25 text-red-300 py-1 px-2 rounded"><i class="fas fa-trash"></i></button>';
    } else {
      html += '      <span class="text-xs text-gray-500">—</span>';
    }
    html += '    </div>';
    html += '  </td>';
    html += '</tr>';
  });
  html += '</tbody></table></div>';
  return html;
}

// ── Activity tab (v2 — real audit feed) ──
var TD_ENTITY_META = {
  crm_customer:  { label: 'CRM Customer',  icon: 'fa-user-tag',    color: 'text-purple-400' },
  proposal:      { label: 'Proposal',      icon: 'fa-file-signature', color: 'text-blue-400' },
  invoice:       { label: 'Invoice',       icon: 'fa-file-invoice-dollar', color: 'text-emerald-400' },
  pipeline_lead: { label: 'Pipeline Lead', icon: 'fa-bullseye',    color: 'text-amber-400' },
  order:         { label: 'Order',         icon: 'fa-shopping-cart', color: 'text-cyan-400' },
  report:        { label: 'Report',        icon: 'fa-file-alt',    color: 'text-indigo-400' }
};

function tdRenderActivity() {
  var members = (tdState.activity && tdState.activity.members) || [];
  var feed = tdState.feed;

  var html = '';

  // Filters
  html += '<div class="flex flex-wrap gap-3 items-center mb-4">';
  html += '  <div class="flex items-center gap-2">';
  html += '    <label class="text-xs text-gray-500">Member:</label>';
  html += '    <select onchange="tdSetFeedFilter(\'member\', this.value)" class="bg-black/30 border border-white/15 text-gray-200 text-xs rounded-lg px-2 py-1.5">';
  html += '      <option value="">All</option>';
  html += '      <option value="0"' + (tdState.feedMemberFilter === '0' ? ' selected' : '') + '>Owner only</option>';
  members.forEach(function(m) {
    var sel = String(tdState.feedMemberFilter) === String(m.id) ? ' selected' : '';
    html += '      <option value="' + m.id + '"' + sel + '>' + tdEsc(m.name) + '</option>';
  });
  html += '    </select>';
  html += '  </div>';
  html += '  <div class="flex items-center gap-2">';
  html += '    <label class="text-xs text-gray-500">Type:</label>';
  html += '    <select onchange="tdSetFeedFilter(\'entity\', this.value)" class="bg-black/30 border border-white/15 text-gray-200 text-xs rounded-lg px-2 py-1.5">';
  html += '      <option value="">All</option>';
  Object.keys(TD_ENTITY_META).forEach(function(k) {
    var sel = tdState.feedEntityFilter === k ? ' selected' : '';
    html += '      <option value="' + k + '"' + sel + '>' + TD_ENTITY_META[k].label + '</option>';
  });
  html += '    </select>';
  html += '  </div>';
  html += '  <button onclick="tdLoadFeed()" class="text-xs bg-white/5 hover:bg-white/10 text-gray-300 py-1.5 px-3 rounded-lg"><i class="fas fa-sync mr-1"></i>Refresh</button>';
  html += '</div>';

  if (tdState.feedLoading) {
    html += '<div class="flex items-center justify-center py-10"><div class="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-emerald-500"></div></div>';
    return html;
  }

  var events = (feed && feed.events) || [];
  if (events.length === 0) {
    html += '<div class="rounded-xl p-10 text-center" style="background:var(--bg-card);border:1px solid rgba(255,255,255,0.08)"><i class="fas fa-history text-gray-600 text-4xl mb-3"></i><p class="text-gray-400">No activity recorded yet.</p><p class="text-xs text-gray-500 mt-2">Events appear here as team members create CRM customers, proposals, invoices, and pipeline leads.</p></div>';
    return html;
  }

  html += '<div class="rounded-xl overflow-hidden" style="background:var(--bg-card);border:1px solid rgba(255,255,255,0.08)">';
  events.forEach(function(ev) {
    var meta = TD_ENTITY_META[ev.entity_type] || { label: ev.entity_type, icon: 'fa-circle', color: 'text-gray-400' };
    var when = ev.created_at ? new Date(ev.created_at + 'Z').toLocaleString() : '';
    var actor = ev.actor_name || (ev.actor_team_member_id ? 'Team member #' + ev.actor_team_member_id : 'Owner');
    var summary = tdSummarizeEvent(ev);
    html += '<div class="flex items-start gap-3 px-4 py-3 border-b border-white/5 last:border-0">';
    html += '  <div class="w-9 h-9 rounded-full bg-white/5 flex items-center justify-center flex-shrink-0"><i class="fas ' + meta.icon + ' ' + meta.color + '"></i></div>';
    html += '  <div class="flex-1 min-w-0">';
    html += '    <div class="text-sm text-gray-200"><span class="font-semibold">' + tdEsc(actor) + '</span> <span class="text-gray-400">' + tdEsc(ev.action) + ' ' + meta.label.toLowerCase() + '</span>' + (summary ? ' <span class="text-gray-300">&middot; ' + summary + '</span>' : '') + '</div>';
    html += '    <div class="text-xs text-gray-500 mt-0.5">' + when + (ev.actor_role ? ' &middot; ' + ev.actor_role : '') + '</div>';
    html += '  </div>';
    html += '</div>';
  });
  html += '</div>';

  if (feed && feed.next_cursor) {
    html += '<div class="text-center mt-4"><button onclick="tdLoadMoreFeed()" class="text-xs bg-white/5 hover:bg-white/10 text-gray-300 py-2 px-4 rounded-lg">Load more</button></div>';
  }
  return html;
}

function tdSummarizeEvent(ev) {
  var m = ev.metadata || {};
  if (ev.entity_type === 'crm_customer' && m.name) return tdEsc(m.name);
  if (ev.entity_type === 'proposal') return (m.proposal_number ? tdEsc(m.proposal_number) + ' ' : '') + (m.title ? tdEsc(m.title) : '') + (m.total != null ? ' ($' + m.total + ')' : '');
  if (ev.entity_type === 'invoice') return (m.invoice_number ? tdEsc(m.invoice_number) + ' ' : '') + (m.customer_name ? '&rarr; ' + tdEsc(m.customer_name) : '') + (m.total != null ? ' ($' + m.total + ')' : '');
  if (ev.entity_type === 'pipeline_lead') return (m.name ? tdEsc(m.name) : '') + (m.source ? ' &middot; ' + tdEsc(m.source) : '');
  return '';
}

async function tdLoadMoreFeed() {
  if (!tdState.feed || !tdState.feed.next_cursor) return;
  var q = new URLSearchParams();
  if (tdState.feedMemberFilter) q.set('member_id', tdState.feedMemberFilter);
  if (tdState.feedEntityFilter) q.set('entity_type', tdState.feedEntityFilter);
  q.set('before', tdState.feed.next_cursor);
  q.set('limit', '100');
  var res = await fetch('/api/team/activity?' + q.toString(), { headers: tdHeaders() });
  if (res.ok) {
    var more = await res.json();
    tdState.feed.events = tdState.feed.events.concat(more.events || []);
    tdState.feed.next_cursor = more.next_cursor;
    tdRender();
  }
}

// ── Billing tab ──
function tdRenderBilling() {
  var b = tdState.billing || { active_seats: 0, team_limit: 5, remaining_seats: 5 };
  var tLimit = b.team_limit || 5;
  var html = '<div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">';
  html += '  <div class="rounded-xl p-5" style="background:var(--bg-card);border:1px solid rgba(255,255,255,0.08)"><div class="text-xs text-gray-500 uppercase tracking-wider mb-1">Active seats</div><div class="text-3xl font-black text-gray-100">' + b.active_seats + '</div></div>';
  html += '  <div class="rounded-xl p-5" style="background:var(--bg-card);border:1px solid rgba(255,255,255,0.08)"><div class="text-xs text-gray-500 uppercase tracking-wider mb-1">Team limit</div><div class="text-3xl font-black text-gray-100">' + (tLimit < 999 ? tLimit : '&infin;') + '</div><div class="text-xs text-gray-500 mt-1">members included</div></div>';
  html += '  <div class="rounded-xl p-5" style="background:var(--bg-card);border:1px solid rgba(255,255,255,0.08)"><div class="text-xs text-gray-500 uppercase tracking-wider mb-1">Seats remaining</div><div class="text-3xl font-black text-emerald-400">' + (tLimit < 999 ? (b.remaining_seats != null ? b.remaining_seats : tLimit - b.active_seats) : '&infin;') + '</div></div>';
  html += '</div>';

  html += '<div class="rounded-xl p-5" style="background:var(--bg-card);border:1px solid rgba(255,255,255,0.08)">';
  html += '  <h3 class="text-sm font-bold text-gray-200 mb-3"><i class="fas fa-info-circle text-blue-400 mr-1"></i>Team info</h3>';
  html += '  <ul class="text-sm text-gray-400 space-y-2">';
  html += '    <li><i class="fas fa-check text-emerald-400 mr-2"></i>Team members are included with your membership</li>';
  html += '    <li><i class="fas fa-check text-emerald-400 mr-2"></i>Suspend a member anytime to free up a seat</li>';
  html += '    <li><i class="fas fa-check text-emerald-400 mr-2"></i>No extra cost per team member</li>';
  html += '    <li><i class="fas fa-check text-emerald-400 mr-2"></i>Report credits are shared across the whole team</li>';
  html += '  </ul>';
  html += '</div>';
  return html;
}

// ── Invite modal ──
function tdRenderInviteModal() {
  return '<div id="tdInviteModal" class="fixed inset-0 bg-black/60 flex items-center justify-center z-50 hidden">' +
    '<div class="rounded-2xl w-full max-w-md mx-4" style="background:var(--bg-card);border:1px solid rgba(255,255,255,0.08)">' +
      '<div class="bg-gradient-to-r from-emerald-500 to-emerald-600 px-6 py-4 rounded-t-2xl">' +
        '<h3 class="text-lg font-bold text-white"><i class="fas fa-user-plus mr-2"></i>Invite Team Member</h3>' +
      '</div>' +
      '<form onsubmit="tdSendInvite(event)" class="p-6 space-y-4">' +
        '<div><label class="block text-sm font-semibold text-gray-300 mb-1">Full Name</label><input type="text" id="tdInvName" required class="w-full border border-white/15 bg-black/30 text-gray-100 rounded-lg px-4 py-2.5 text-sm"></div>' +
        '<div><label class="block text-sm font-semibold text-gray-300 mb-1">Email</label><input type="email" id="tdInvEmail" required class="w-full border border-white/15 bg-black/30 text-gray-100 rounded-lg px-4 py-2.5 text-sm"></div>' +
        '<div><label class="block text-sm font-semibold text-gray-300 mb-1">Role</label><select id="tdInvRole" class="w-full border border-white/15 bg-black/30 text-gray-100 rounded-lg px-4 py-2.5 text-sm"><option value="member">Team Member</option><option value="admin">Team Admin</option></select></div>' +
        '<div id="tdInvMsg"></div>' +
        '<div class="flex gap-3 pt-2">' +
          '<button type="button" onclick="tdHideInvite()" class="flex-1 border border-white/15 rounded-lg py-2.5 text-sm font-semibold text-gray-300">Cancel</button>' +
          '<button type="submit" id="tdInvBtn" class="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg py-2.5 text-sm font-semibold"><i class="fas fa-paper-plane mr-1"></i>Send Invite</button>' +
        '</div>' +
      '</form>' +
    '</div>' +
  '</div>';
}

function tdShowInvite() {
  var m = document.getElementById('tdInviteModal');
  if (!m) return;
  m.classList.remove('hidden');
  document.getElementById('tdInvName').value = '';
  document.getElementById('tdInvEmail').value = '';
  document.getElementById('tdInvMsg').innerHTML = '';
}
function tdHideInvite() { var m = document.getElementById('tdInviteModal'); if (m) m.classList.add('hidden'); }

async function tdSendInvite(e) {
  e.preventDefault();
  var btn = document.getElementById('tdInvBtn');
  var msg = document.getElementById('tdInvMsg');
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Sending...';
  msg.innerHTML = '';
  try {
    var res = await fetch('/api/team/invite', {
      method: 'POST', headers: tdHeaders(),
      body: JSON.stringify({
        name: document.getElementById('tdInvName').value.trim(),
        email: document.getElementById('tdInvEmail').value.trim(),
        role: document.getElementById('tdInvRole').value
      })
    });
    var data = await res.json();
    if (res.ok && data.success) {
      msg.innerHTML = '<div class="bg-emerald-500/15 border border-emerald-500/30 rounded-lg p-2 text-emerald-300 text-sm"><i class="fas fa-check-circle mr-1"></i>' + data.message + '</div>';
      setTimeout(async function() { tdHideInvite(); await tdLoadAll(); tdRender(); }, 1000);
    } else if (res.status === 402) {
      var tier = data.subscription_required ? 'starter' : data.next_tier;
      msg.innerHTML = '<div class="bg-amber-500/15 border border-amber-500/30 rounded-lg p-2 text-amber-200 text-sm mb-2">' + (data.error || 'Upgrade required') + '</div>' +
        '<button type="button" onclick="tdUpgrade(\'' + tier + '\')" class="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-semibold py-2 rounded-lg text-sm">' + (data.subscription_required ? 'Subscribe Now' : 'Upgrade Now') + '</button>';
    } else {
      msg.innerHTML = '<div class="bg-red-500/15 border border-red-500/30 rounded-lg p-2 text-red-300 text-sm">' + (data.error || 'Failed to send invite') + '</div>';
    }
  } catch (err) {
    msg.innerHTML = '<div class="bg-red-500/15 border border-red-500/30 rounded-lg p-2 text-red-300 text-sm">Network error</div>';
  }
  btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane mr-1"></i>Send Invite';
}

async function tdUpgrade(tier) {
  if (!tier) return;
  try {
    var r = await fetch('/api/square/checkout/subscription', { method: 'POST', headers: tdHeaders(), body: JSON.stringify({ tier: tier }) });
    var d = await r.json();
    if (d.checkout_url) window.location.href = d.checkout_url;
    else alert(d.error || 'Could not start checkout');
  } catch (e) { alert('Network error starting checkout'); }
}

// ── Actions ──
async function tdToggleRole(id, newRole) {
  if (!(await window.rmConfirm('Change role to ' + newRole + '?'))) return;
  await fetch('/api/team/members/' + id, { method: 'PUT', headers: tdHeaders(), body: JSON.stringify({ role: newRole }) });
  await tdLoadAll(); tdRender();
}
async function tdSuspend(id) {
  if (!(await window.rmConfirm('Suspend this team member? Their access and billing will be paused.'))) return;
  await fetch('/api/team/members/' + id + '/suspend', { method: 'POST', headers: tdHeaders() });
  await tdLoadAll(); tdRender();
}
async function tdReactivate(id) {
  if (!(await window.rmConfirm('Reactivate this member? They will regain access to your team account.'))) return;
  await fetch('/api/team/members/' + id + '/reactivate', { method: 'POST', headers: tdHeaders() });
  await tdLoadAll(); tdRender();
}
async function tdRemove(id, name) {
  if (!(await window.rmConfirm('Remove ' + name + ' from your team? This will revoke their access immediately.'))) return;
  await fetch('/api/team/members/' + id, { method: 'DELETE', headers: tdHeaders() });
  await tdLoadAll(); tdRender();
}
async function tdCancelInvite(id) {
  if (!(await window.rmConfirm('Cancel this invitation?'))) return;
  await fetch('/api/team/invite/' + id, { method: 'DELETE', headers: tdHeaders() });
  await tdLoadAll(); tdRender();
}
async function tdResendInvite(id) {
  var r = await fetch('/api/team/invite/' + id + '/resend', { method: 'POST', headers: tdHeaders() });
  var d = await r.json();
  if (r.ok) {
    await tdLoadAll(); tdRender();
    alert('Invitation resent.');
  } else {
    alert(d.error || 'Resend failed');
  }
}

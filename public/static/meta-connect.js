// ============================================================
// RoofReporterAI — Meta Connect Dashboard
// Super Admin — Facebook Groups, Pages, Ads, Scheduling
// ============================================================
(function() {
  'use strict';
  const MC = { tab: 'overview', data: {}, loading: false, postingCampaignId: null };

  window.loadMetaConnect = function() {
    const root = document.getElementById('sa-root');
    if (!root) return;
    root.innerHTML = renderShell();
    mcLoadTab('overview');
  };

  function mcH() {
    const t = localStorage.getItem('rc_token');
    return t ? { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
  }
  async function mcF(url, opts) {
    try { const r = await fetch(url, Object.assign({ headers: mcH() }, opts || {})); return await r.json(); } catch (e) { console.error('MC:', e); return null; }
  }

  function renderShell() {
    return `<div class="slide-in" id="mc-root">
      <div class="flex items-center justify-between mb-6">
        <div>
          <h2 class="text-2xl font-black text-gray-900 flex items-center gap-3">
            <div class="w-10 h-10 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-xl flex items-center justify-center shadow-lg">
              <i class="fab fa-meta text-white"></i>
            </div>
            Meta Connect
          </h2>
          <p class="text-sm text-gray-500 mt-1">Facebook Groups, Pages, Ads Manager & Post Scheduling</p>
        </div>
        <div id="mc-account-badge"></div>
      </div>
      <div class="flex gap-1 mb-6 bg-gray-100 rounded-xl p-1">
        ${['overview','groups','post-blast','ads','scheduler'].map(t =>
          `<button onclick="window.mcSetTab('${t}')" id="mc-tab-${t}" class="mc-tab px-4 py-2 rounded-lg text-sm font-medium transition-all ${MC.tab===t?'bg-white text-gray-900 shadow-sm':'text-gray-500 hover:text-gray-700'}">
            <i class="fas fa-${t==='overview'?'chart-pie':t==='groups'?'users-cog':t==='post-blast'?'paper-plane':t==='ads'?'ad':t==='scheduler'?'calendar-alt':'circle'} mr-1.5"></i>
            ${t==='overview'?'Overview':t==='groups'?'Groups & Pages':t==='post-blast'?'Post Blast':t==='ads'?'Ads Manager':'Scheduler'}
          </button>`
        ).join('')}
      </div>
      <div id="mc-content"><div class="flex items-center justify-center py-20"><div class="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div></div></div>
    </div>`;
  }

  window.mcSetTab = function(tab) {
    MC.tab = tab;
    document.querySelectorAll('.mc-tab').forEach(el => { el.classList.remove('bg-white','text-gray-900','shadow-sm'); el.classList.add('text-gray-500'); });
    const a = document.getElementById('mc-tab-'+tab);
    if (a) { a.classList.add('bg-white','text-gray-900','shadow-sm'); a.classList.remove('text-gray-500'); }
    mcLoadTab(tab);
  };

  async function mcLoadTab(tab) {
    MC.loading = true;
    const c = document.getElementById('mc-content');
    if (c) c.innerHTML = '<div class="flex items-center justify-center py-20"><div class="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div></div>';

    switch (tab) {
      case 'overview': MC.data.dash = await mcF('/api/meta/dashboard'); break;
      case 'groups':
        MC.data.groups = await mcF('/api/meta/groups');
        MC.data.pages = await mcF('/api/meta/pages');
        break;
      case 'post-blast': MC.data.postCamps = await mcF('/api/meta/post-campaigns'); MC.data.groups = MC.data.groups || await mcF('/api/meta/groups'); break;
      case 'ads': MC.data.ads = await mcF('/api/meta/ads'); break;
      case 'scheduler': MC.data.scheduled = await mcF('/api/meta/scheduled'); MC.data.groups = MC.data.groups || await mcF('/api/meta/groups'); break;
    }
    MC.loading = false;

    // Update account badge
    const badge = document.getElementById('mc-account-badge');
    const d = MC.data.dash || (await mcF('/api/meta/account'));
    if (badge) {
      if (d?.connected) {
        const a = d.account || {};
        badge.innerHTML = `<div class="flex items-center gap-2 px-3 py-1.5 bg-green-50 border border-green-200 rounded-full">
          ${a.picture ? `<img src="${a.picture}" class="w-6 h-6 rounded-full">` : '<i class="fab fa-facebook text-blue-600"></i>'}
          <span class="text-xs font-semibold text-green-700">${a.name||'Connected'}</span>
          <button onclick="window.mcDisconnect()" class="text-red-400 hover:text-red-600 text-xs ml-1"><i class="fas fa-times"></i></button>
        </div>`;
      } else {
        badge.innerHTML = `<button onclick="window.mcShowLogin()" class="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 shadow-sm">
          <i class="fab fa-facebook mr-1"></i>Connect Facebook
        </button>`;
      }
    }
    renderTab(tab);
  }

  function renderTab(tab) {
    const c = document.getElementById('mc-content');
    if (!c) return;
    switch (tab) {
      case 'overview': c.innerHTML = renderOverview(); break;
      case 'groups': c.innerHTML = renderGroups(); break;
      case 'post-blast': c.innerHTML = renderPostBlast(); break;
      case 'ads': c.innerHTML = renderAds(); break;
      case 'scheduler': c.innerHTML = renderScheduler(); break;
    }
  }

  // ============================================================
  // OVERVIEW
  // ============================================================
  function renderOverview() {
    const d = MC.data.dash || {};
    if (!d.connected) return renderLoginPrompt();
    const g = d.groups||{}, pc = d.post_campaigns||{}, ads = d.ads||{}, sc = d.scheduled||{};
    return `<div class="space-y-6">
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div class="bg-gradient-to-br from-blue-500 to-blue-700 rounded-xl p-5 text-white shadow-lg">
          <p class="text-blue-100 text-xs font-medium uppercase">Groups</p>
          <p class="text-3xl font-black mt-1">${g.total||0}</p>
          <p class="text-blue-200 text-xs mt-1">${g.enabled||0} enabled for posting</p>
        </div>
        <div class="bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl p-5 text-white shadow-lg">
          <p class="text-green-100 text-xs font-medium uppercase">Posts Sent</p>
          <p class="text-3xl font-black mt-1">${pc.total_posted||0}</p>
          <p class="text-green-200 text-xs mt-1">${pc.total||0} campaigns / ${pc.total_failed||0} failed</p>
        </div>
        <div class="bg-gradient-to-br from-purple-500 to-violet-600 rounded-xl p-5 text-white shadow-lg">
          <p class="text-purple-100 text-xs font-medium uppercase">Ad Impressions</p>
          <p class="text-3xl font-black mt-1">${(ads.impressions||0).toLocaleString()}</p>
          <p class="text-purple-200 text-xs mt-1">${ads.clicks||0} clicks / ${ads.leads||0} leads</p>
        </div>
        <div class="bg-gradient-to-br from-orange-500 to-red-600 rounded-xl p-5 text-white shadow-lg">
          <p class="text-orange-100 text-xs font-medium uppercase">Ad Spend</p>
          <p class="text-3xl font-black mt-1">$${((ads.spend_cents||0)/100).toFixed(2)}</p>
          <p class="text-orange-200 text-xs mt-1">${sc.pending||0} scheduled posts pending</p>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-6">
        <div class="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <h3 class="font-bold text-gray-900 mb-3"><i class="fas fa-bolt mr-2 text-blue-500"></i>Quick Actions</h3>
          <div class="space-y-2">
            <button onclick="window.mcSetTab('post-blast')" class="w-full text-left px-4 py-3 bg-blue-50 hover:bg-blue-100 rounded-lg text-sm transition-colors"><i class="fas fa-paper-plane mr-2 text-blue-600"></i>Create Mass Group Post</button>
            <button onclick="window.mcSetTab('ads')" class="w-full text-left px-4 py-3 bg-purple-50 hover:bg-purple-100 rounded-lg text-sm transition-colors"><i class="fas fa-ad mr-2 text-purple-600"></i>Launch New Ad Campaign</button>
            <button onclick="window.mcSetTab('scheduler')" class="w-full text-left px-4 py-3 bg-green-50 hover:bg-green-100 rounded-lg text-sm transition-colors"><i class="fas fa-calendar-alt mr-2 text-green-600"></i>Schedule a Post</button>
            <button onclick="window.mcSyncAll()" class="w-full text-left px-4 py-3 bg-gray-50 hover:bg-gray-100 rounded-lg text-sm transition-colors"><i class="fas fa-sync-alt mr-2 text-gray-600"></i>Sync Groups & Pages from Facebook</button>
          </div>
        </div>
        <div class="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <h3 class="font-bold text-gray-900 mb-3"><i class="fas fa-info-circle mr-2 text-gray-500"></i>Connection Info</h3>
          <div class="space-y-2 text-sm">
            <div class="flex justify-between"><span class="text-gray-500">Account</span><span class="font-medium">${d.account?.name||'—'}</span></div>
            <div class="flex justify-between"><span class="text-gray-500">Groups Synced</span><span class="font-medium">${g.total||0}</span></div>
            <div class="flex justify-between"><span class="text-gray-500">Pages Managed</span><span class="font-medium">${d.pages?.total||0}</span></div>
            <div class="flex justify-between"><span class="text-gray-500">Total Campaigns</span><span class="font-medium">${pc.total||0} posts / ${ads.total||0} ads</span></div>
          </div>
        </div>
      </div>
    </div>`;
  }

  function renderLoginPrompt() {
    return `<div class="bg-white rounded-2xl border-2 border-dashed border-blue-200 p-12 text-center max-w-lg mx-auto">
      <div class="w-20 h-20 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-xl">
        <i class="fab fa-facebook-f text-white text-3xl"></i>
      </div>
      <h3 class="text-xl font-bold text-gray-900">Connect Your Facebook Account</h3>
      <p class="text-gray-500 text-sm mt-2 mb-6">Link your Facebook account to manage groups, run ads, and schedule posts directly from the RoofReporterAI admin panel.</p>
      <button onclick="window.mcShowLogin()" class="px-8 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors shadow-lg text-sm">
        <i class="fab fa-facebook mr-2"></i>Login with Facebook
      </button>
      <div class="mt-6 p-4 bg-blue-50 rounded-xl text-left">
        <p class="text-xs font-bold text-blue-700 mb-2">Required Permissions:</p>
        <ul class="text-xs text-blue-600 space-y-1">
          <li><i class="fas fa-check mr-1"></i>publish_to_groups — Post to Facebook groups</li>
          <li><i class="fas fa-check mr-1"></i>pages_manage_posts — Post to pages</li>
          <li><i class="fas fa-check mr-1"></i>ads_management — Create and manage ads</li>
          <li><i class="fas fa-check mr-1"></i>groups_access_member_info — See group details</li>
        </ul>
      </div>
      <div class="mt-4 p-3 bg-yellow-50 rounded-lg"><p class="text-xs text-yellow-700"><i class="fas fa-exclamation-triangle mr-1"></i><strong>Manual token entry:</strong> If FB Login SDK isn't configured, paste your access token below.</p></div>
      <div class="mt-3 flex gap-2">
        <input id="mc-manual-token" type="text" placeholder="Paste Facebook access token here..." class="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-xs" />
        <button onclick="window.mcSaveManualToken()" class="px-4 py-2 bg-green-600 text-white rounded-lg text-xs font-semibold hover:bg-green-700">Save Token</button>
      </div>
    </div>`;
  }

  // ============================================================
  // GROUPS & PAGES
  // ============================================================
  function renderGroups() {
    const groups = (MC.data.groups||{}).groups || [];
    const pages = (MC.data.pages||{}).pages || [];
    return `<div class="space-y-6">
      <div class="flex items-center justify-between">
        <p class="text-sm text-gray-500">${groups.length} groups / ${pages.length} pages synced</p>
        <button onclick="window.mcSyncAll()" class="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700"><i class="fas fa-sync-alt mr-1"></i>Sync from Facebook</button>
      </div>

      <!-- Groups -->
      <div class="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div class="px-6 py-4 border-b border-gray-100"><h3 class="font-bold text-gray-900"><i class="fas fa-users mr-2 text-blue-500"></i>Groups (${groups.length})</h3></div>
        ${groups.length===0?'<div class="px-6 py-12 text-center text-gray-400"><i class="fas fa-users text-4xl mb-3 opacity-30"></i><p>No groups synced yet</p><p class="text-xs mt-1">Click "Sync from Facebook" to pull your groups</p></div>':`
          <div class="overflow-x-auto"><table class="w-full text-sm">
            <thead><tr class="bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
              <th class="px-4 py-3">Group</th><th class="px-4 py-3">Members</th><th class="px-4 py-3">Privacy</th><th class="px-4 py-3">Admin</th><th class="px-4 py-3">Posting</th>
            </tr></thead>
            <tbody class="divide-y divide-gray-50">${groups.map(g=>`
              <tr class="hover:bg-gray-50"><td class="px-4 py-3 font-medium text-gray-900">${g.group_name}<br><code class="text-[10px] text-gray-400">${g.fb_group_id}</code></td>
              <td class="px-4 py-3 text-xs">${(g.member_count||0).toLocaleString()}</td>
              <td class="px-4 py-3"><span class="px-2 py-0.5 rounded-full text-[10px] font-semibold ${g.privacy==='OPEN'?'bg-green-100 text-green-700':g.privacy==='CLOSED'?'bg-yellow-100 text-yellow-700':'bg-red-100 text-red-700'}">${g.privacy}</span></td>
              <td class="px-4 py-3">${g.is_admin?'<i class="fas fa-check-circle text-green-500"></i>':'<span class="text-gray-300">—</span>'}</td>
              <td class="px-4 py-3"><label class="relative inline-flex items-center cursor-pointer"><input type="checkbox" ${g.enabled?'checked':''} onchange="window.mcToggleGroup(${g.id},this.checked)" class="sr-only peer"><div class="w-9 h-5 bg-gray-200 peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:bg-blue-600 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full"></div></label></td></tr>
            `).join('')}</tbody></table></div>
        `}
      </div>

      <!-- Pages -->
      <div class="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div class="px-6 py-4 border-b border-gray-100"><h3 class="font-bold text-gray-900"><i class="fas fa-flag mr-2 text-purple-500"></i>Pages (${pages.length})</h3></div>
        ${pages.length===0?'<div class="px-6 py-8 text-center text-gray-400"><p class="text-sm">No pages synced yet</p></div>':`
          <div class="overflow-x-auto"><table class="w-full text-sm">
            <thead><tr class="bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
              <th class="px-4 py-3">Page</th><th class="px-4 py-3">Category</th><th class="px-4 py-3">Followers</th><th class="px-4 py-3">Published</th>
            </tr></thead>
            <tbody class="divide-y divide-gray-50">${pages.map(p=>`
              <tr class="hover:bg-gray-50"><td class="px-4 py-3 font-medium">${p.page_name}<br><code class="text-[10px] text-gray-400">${p.fb_page_id}</code></td>
              <td class="px-4 py-3 text-xs">${p.category||'—'}</td>
              <td class="px-4 py-3 text-xs">${(p.followers_count||0).toLocaleString()}</td>
              <td class="px-4 py-3">${p.is_published?'<i class="fas fa-check-circle text-green-500"></i>':'<span class="text-gray-300">—</span>'}</td></tr>
            `).join('')}</tbody></table></div>
        `}
      </div>
    </div>`;
  }

  // ============================================================
  // POST BLAST — Mass group posting
  // ============================================================
  function renderPostBlast() {
    const camps = (MC.data.postCamps||{}).campaigns || [];
    const groups = (MC.data.groups||{}).groups || [];
    const enabledGroups = groups.filter(g=>g.enabled);
    return `<div class="space-y-6">
      <div class="flex items-center justify-between">
        <p class="text-sm text-gray-500">${camps.length} campaign${camps.length!==1?'s':''} / ${enabledGroups.length} groups enabled</p>
        <button onclick="window.mcShowCreatePost()" class="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700"><i class="fas fa-plus mr-1"></i>New Post Blast</button>
      </div>

      ${camps.length===0?`<div class="bg-white rounded-xl border-2 border-dashed border-gray-200 p-12 text-center">
        <i class="fas fa-paper-plane text-5xl text-gray-300 mb-4"></i>
        <p class="text-gray-500 font-medium">No post campaigns yet</p>
        <p class="text-gray-400 text-sm mt-1">Create a post blast to send messages to multiple Facebook groups at once</p>
        <button onclick="window.mcShowCreatePost()" class="mt-4 px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700"><i class="fas fa-plus mr-1"></i>Create First Post Blast</button>
      </div>`:camps.map(c=>`
        <div class="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div class="p-5">
            <div class="flex items-start justify-between">
              <div><h4 class="font-bold text-gray-900">${c.name}</h4><p class="text-xs text-gray-400 mt-0.5">${c.total_groups} groups targeted</p></div>
              <span class="px-2.5 py-1 rounded-full text-xs font-bold uppercase ${c.status==='completed'?'bg-green-100 text-green-700':c.status==='running'?'bg-blue-100 text-blue-700 animate-pulse':c.status==='failed'?'bg-red-100 text-red-600':'bg-gray-100 text-gray-500'}">${c.status}</span>
            </div>
            <div class="mt-3 p-3 bg-gray-50 rounded-lg text-xs text-gray-600 whitespace-pre-wrap max-h-24 overflow-y-auto">${c.message_template}</div>
            <div class="grid grid-cols-3 gap-3 mt-3">
              <div class="text-center p-2 bg-green-50 rounded-lg"><div class="text-lg font-bold text-green-600">${c.posted_count||0}</div><div class="text-[10px] text-gray-400">Posted</div></div>
              <div class="text-center p-2 bg-red-50 rounded-lg"><div class="text-lg font-bold text-red-600">${c.failed_count||0}</div><div class="text-[10px] text-gray-400">Failed</div></div>
              <div class="text-center p-2 bg-gray-50 rounded-lg"><div class="text-lg font-bold text-gray-600">${c.total_groups-(c.posted_count||0)-(c.failed_count||0)}</div><div class="text-[10px] text-gray-400">Remaining</div></div>
            </div>
          </div>
          <div class="px-5 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
            <span class="text-xs text-gray-400">${c.created_at?new Date(c.created_at).toLocaleDateString('en-CA'):''}</span>
            <div class="flex gap-2">
              ${c.status==='draft'||c.status==='running'?`<button onclick="window.mcRunPostBlast(${c.id})" class="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-semibold hover:bg-green-700"><i class="fas fa-play mr-1"></i>${c.status==='running'?'Continue':'Start'} Posting</button>`:''}
              <button onclick="window.mcViewPostLogs(${c.id})" class="px-3 py-1.5 bg-gray-200 text-gray-700 rounded-lg text-xs font-semibold hover:bg-gray-300"><i class="fas fa-list mr-1"></i>Logs</button>
              <button onclick="window.mcDeletePostCampaign(${c.id})" class="px-2 py-1.5 text-red-400 hover:text-red-600 text-xs"><i class="fas fa-trash"></i></button>
            </div>
          </div>
        </div>
      `).join('')}
    </div>

    <!-- Create Post Blast Modal -->
    <div id="mc-post-modal" class="hidden fixed inset-0 z-50 bg-black/50 flex items-center justify-center">
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
        <div class="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 class="font-bold text-gray-900"><i class="fas fa-paper-plane mr-2 text-blue-500"></i>Create Post Blast</h3>
          <button onclick="document.getElementById('mc-post-modal').classList.add('hidden')" class="text-gray-400 hover:text-gray-600"><i class="fas fa-times"></i></button>
        </div>
        <div class="p-6 space-y-4">
          <div><label class="block text-xs font-semibold text-gray-600 mb-1">Campaign Name</label>
            <input id="mc-pb-name" type="text" placeholder="e.g. March Roofing Season Promo" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" /></div>
          <div><label class="block text-xs font-semibold text-gray-600 mb-1">Post Message</label>
            <textarea id="mc-pb-message" rows="5" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" placeholder="Write your post here...&#10;&#10;Tip: Make it valuable, not salesy. Share tips, case studies, or offer a free demo."></textarea></div>
          <div><label class="block text-xs font-semibold text-gray-600 mb-1">Link URL (optional)</label>
            <input id="mc-pb-link" type="url" placeholder="https://www.roofreporterai.com" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" /></div>
          <div>
            <label class="block text-xs font-semibold text-gray-600 mb-2">Target Groups (${enabledGroups.length} enabled)</label>
            <div class="max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-2 space-y-1">
              <label class="flex items-center gap-2 p-1"><input type="checkbox" id="mc-pb-all" checked onchange="document.querySelectorAll('.mc-pb-grp').forEach(c=>c.checked=this.checked)" class="rounded"><span class="text-xs font-semibold">Select All (${enabledGroups.length})</span></label>
              ${enabledGroups.map(g=>`<label class="flex items-center gap-2 p-1"><input type="checkbox" class="mc-pb-grp rounded" value="${g.fb_group_id}" checked><span class="text-xs">${g.group_name} (${(g.member_count||0).toLocaleString()})</span></label>`).join('')}
            </div>
          </div>
          <button onclick="window.mcCreatePostBlast()" class="w-full bg-blue-600 text-white py-2.5 rounded-lg font-semibold hover:bg-blue-700"><i class="fas fa-paper-plane mr-1"></i>Create Post Blast</button>
        </div>
      </div>
    </div>

    <!-- Post Logs Modal -->
    <div id="mc-logs-modal" class="hidden fixed inset-0 z-50 bg-black/50 flex items-center justify-center">
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
        <div class="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 class="font-bold text-gray-900"><i class="fas fa-list mr-2 text-blue-500"></i>Post Logs</h3>
          <button onclick="document.getElementById('mc-logs-modal').classList.add('hidden')" class="text-gray-400 hover:text-gray-600"><i class="fas fa-times"></i></button>
        </div>
        <div class="p-6" id="mc-logs-content"><p class="text-center text-gray-400">Loading...</p></div>
      </div>
    </div>

    <!-- Posting Progress -->
    <div id="mc-posting-progress" class="hidden fixed bottom-6 right-6 z-50 bg-white rounded-xl shadow-2xl border border-blue-200 p-4 w-80">
      <div class="flex items-center justify-between mb-2">
        <span class="text-sm font-bold text-gray-900"><i class="fas fa-paper-plane mr-1 text-blue-600"></i>Posting in progress...</span>
        <span id="mc-posting-pct" class="text-xs font-bold text-blue-600">0%</span>
      </div>
      <div class="w-full bg-gray-200 rounded-full h-2"><div id="mc-posting-bar" class="bg-blue-600 h-2 rounded-full transition-all" style="width:0%"></div></div>
      <p id="mc-posting-detail" class="text-xs text-gray-500 mt-2">Starting...</p>
    </div>`;
  }

  // ============================================================
  // ADS MANAGER
  // ============================================================
  function renderAds() {
    const ads = (MC.data.ads||{}).campaigns || [];
    return `<div class="space-y-6">
      <div class="flex items-center justify-between">
        <p class="text-sm text-gray-500">${ads.length} ad campaign${ads.length!==1?'s':''}</p>
        <button onclick="window.mcShowCreateAd()" class="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-semibold hover:bg-purple-700"><i class="fas fa-plus mr-1"></i>New Ad Campaign</button>
      </div>
      ${ads.length===0?`<div class="bg-white rounded-xl border-2 border-dashed border-gray-200 p-12 text-center">
        <i class="fas fa-ad text-5xl text-gray-300 mb-4"></i><p class="text-gray-500 font-medium">No ad campaigns yet</p>
        <p class="text-gray-400 text-sm mt-1">Create a Meta Ads campaign to reach roofing companies across North America</p>
        <button onclick="window.mcShowCreateAd()" class="mt-4 px-5 py-2.5 bg-purple-600 text-white rounded-lg text-sm font-semibold hover:bg-purple-700"><i class="fas fa-plus mr-1"></i>Create First Ad</button>
      </div>`:ads.map(a=>`
        <div class="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div class="flex items-start justify-between">
            <div><h4 class="font-bold text-gray-900">${a.name}</h4><p class="text-xs text-gray-400">${a.objective||'LEADS'} &middot; ${a.currency||'CAD'}</p></div>
            <span class="px-2.5 py-1 rounded-full text-xs font-bold uppercase ${a.status==='active'?'bg-green-100 text-green-700':a.status==='paused'?'bg-yellow-100 text-yellow-700':'bg-gray-100 text-gray-500'}">${a.status}</span>
          </div>
          <div class="grid grid-cols-5 gap-3 mt-4">
            <div class="text-center"><div class="text-lg font-bold text-blue-600">${(a.impressions||0).toLocaleString()}</div><div class="text-[10px] text-gray-400">Impressions</div></div>
            <div class="text-center"><div class="text-lg font-bold text-green-600">${a.clicks||0}</div><div class="text-[10px] text-gray-400">Clicks</div></div>
            <div class="text-center"><div class="text-lg font-bold text-purple-600">${a.leads||0}</div><div class="text-[10px] text-gray-400">Leads</div></div>
            <div class="text-center"><div class="text-lg font-bold text-orange-600">$${((a.spend_cents||0)/100).toFixed(2)}</div><div class="text-[10px] text-gray-400">Spend</div></div>
            <div class="text-center"><div class="text-lg font-bold text-red-600">${a.ctr?a.ctr.toFixed(2)+'%':'—'}</div><div class="text-[10px] text-gray-400">CTR</div></div>
          </div>
          <div class="flex gap-2 mt-4">
            ${a.fb_campaign_id?`<button onclick="window.mcSyncAd(${a.id})" class="px-3 py-1.5 bg-blue-100 text-blue-700 rounded-lg text-xs font-semibold hover:bg-blue-200"><i class="fas fa-sync-alt mr-1"></i>Sync Metrics</button>`:
            `<button onclick="window.mcPublishAd(${a.id})" class="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-semibold hover:bg-green-700"><i class="fas fa-rocket mr-1"></i>Publish to Meta</button>`}
            <button onclick="window.mcDeleteAd(${a.id})" class="px-2 py-1.5 text-red-400 hover:text-red-600 text-xs"><i class="fas fa-trash"></i></button>
          </div>
        </div>
      `).join('')}
    </div>

    <!-- Create Ad Modal -->
    <div id="mc-ad-modal" class="hidden fixed inset-0 z-50 bg-black/50 flex items-center justify-center">
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div class="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 class="font-bold text-gray-900"><i class="fas fa-ad mr-2 text-purple-500"></i>Create Ad Campaign</h3>
          <button onclick="document.getElementById('mc-ad-modal').classList.add('hidden')" class="text-gray-400 hover:text-gray-600"><i class="fas fa-times"></i></button>
        </div>
        <div class="p-6 space-y-4">
          <div><label class="block text-xs font-semibold text-gray-600 mb-1">Campaign Name</label><input id="mc-ad-name" type="text" placeholder="e.g. Roofing Leads — Alberta" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
          <div><label class="block text-xs font-semibold text-gray-600 mb-1">Objective</label><select id="mc-ad-objective" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
            <option value="OUTCOME_LEADS">Lead Generation</option><option value="OUTCOME_TRAFFIC">Website Traffic</option><option value="OUTCOME_AWARENESS">Brand Awareness</option><option value="OUTCOME_ENGAGEMENT">Engagement</option><option value="OUTCOME_SALES">Sales/Conversions</option></select></div>
          <div class="grid grid-cols-2 gap-4">
            <div><label class="block text-xs font-semibold text-gray-600 mb-1">Daily Budget ($)</label><input id="mc-ad-daily" type="number" step="0.01" value="25" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
            <div><label class="block text-xs font-semibold text-gray-600 mb-1">Currency</label><select id="mc-ad-currency" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"><option value="CAD">CAD</option><option value="USD">USD</option></select></div>
          </div>
          <button onclick="window.mcCreateAd()" class="w-full bg-purple-600 text-white py-2.5 rounded-lg font-semibold hover:bg-purple-700"><i class="fas fa-plus mr-1"></i>Create Campaign</button>
        </div>
      </div>
    </div>`;
  }

  // ============================================================
  // SCHEDULER
  // ============================================================
  function renderScheduler() {
    const posts = (MC.data.scheduled||{}).posts || [];
    const groups = (MC.data.groups||{}).groups || [];
    return `<div class="space-y-6">
      <div class="flex items-center justify-between">
        <p class="text-sm text-gray-500">${posts.length} scheduled post${posts.length!==1?'s':''}</p>
        <div class="flex gap-2">
          <button onclick="window.mcExecuteScheduled()" class="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700"><i class="fas fa-bolt mr-1"></i>Execute Due Posts</button>
          <button onclick="window.mcShowSchedulePost()" class="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700"><i class="fas fa-plus mr-1"></i>Schedule Post</button>
        </div>
      </div>
      <div class="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        ${posts.length===0?'<div class="px-6 py-12 text-center text-gray-400"><i class="fas fa-calendar-alt text-4xl mb-3 opacity-30"></i><p>No scheduled posts</p></div>':`
          <div class="overflow-x-auto"><table class="w-full text-sm">
            <thead><tr class="bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
              <th class="px-4 py-3">Scheduled</th><th class="px-4 py-3">Target</th><th class="px-4 py-3">Message</th><th class="px-4 py-3">Recurrence</th><th class="px-4 py-3">Status</th><th class="px-4 py-3 text-right">Actions</th>
            </tr></thead>
            <tbody class="divide-y divide-gray-50">${posts.map(p=>`
              <tr class="hover:bg-gray-50">
                <td class="px-4 py-3 text-xs whitespace-nowrap">${p.schedule_at?new Date(p.schedule_at).toLocaleString('en-CA',{dateStyle:'medium',timeStyle:'short'}):''}</td>
                <td class="px-4 py-3 text-xs"><span class="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-[10px] font-medium">${p.target_type}</span> ${p.target_name||p.target_id}</td>
                <td class="px-4 py-3 text-xs text-gray-600 max-w-xs truncate">${p.message}</td>
                <td class="px-4 py-3 text-xs capitalize">${p.recurrence}</td>
                <td class="px-4 py-3"><span class="px-2 py-0.5 rounded-full text-[10px] font-semibold ${p.status==='posted'?'bg-green-100 text-green-700':p.status==='failed'?'bg-red-100 text-red-600':p.status==='cancelled'?'bg-gray-100 text-gray-400':'bg-blue-100 text-blue-700'}">${p.status}</span></td>
                <td class="px-4 py-3 text-right">${p.status==='scheduled'?`<button onclick="window.mcCancelScheduled(${p.id})" class="text-red-400 hover:text-red-600 text-xs"><i class="fas fa-times"></i></button>`:''}</td>
              </tr>`).join('')}</tbody></table></div>
        `}
      </div>
    </div>

    <!-- Schedule Post Modal -->
    <div id="mc-schedule-modal" class="hidden fixed inset-0 z-50 bg-black/50 flex items-center justify-center">
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4">
        <div class="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 class="font-bold text-gray-900"><i class="fas fa-calendar-alt mr-2 text-blue-500"></i>Schedule Post</h3>
          <button onclick="document.getElementById('mc-schedule-modal').classList.add('hidden')" class="text-gray-400 hover:text-gray-600"><i class="fas fa-times"></i></button>
        </div>
        <div class="p-6 space-y-4">
          <div><label class="block text-xs font-semibold text-gray-600 mb-1">Target Group/Page</label>
            <select id="mc-sch-target" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              ${groups.map(g=>`<option value="${g.fb_group_id}" data-name="${g.group_name}">Group: ${g.group_name}</option>`).join('')}
            </select></div>
          <div><label class="block text-xs font-semibold text-gray-600 mb-1">Message</label><textarea id="mc-sch-msg" rows="4" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"></textarea></div>
          <div><label class="block text-xs font-semibold text-gray-600 mb-1">Link (optional)</label><input id="mc-sch-link" type="url" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
          <div class="grid grid-cols-2 gap-4">
            <div><label class="block text-xs font-semibold text-gray-600 mb-1">Schedule Date/Time</label><input id="mc-sch-time" type="datetime-local" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
            <div><label class="block text-xs font-semibold text-gray-600 mb-1">Recurrence</label><select id="mc-sch-recur" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"><option value="once">Once</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></div>
          </div>
          <button onclick="window.mcCreateScheduled()" class="w-full bg-blue-600 text-white py-2.5 rounded-lg font-semibold hover:bg-blue-700"><i class="fas fa-calendar-check mr-1"></i>Schedule Post</button>
        </div>
      </div>
    </div>`;
  }

  // ============================================================
  // ACTIONS
  // ============================================================
  window.mcShowLogin = function() {
    // Try FB Login SDK first, fallback to manual token
    if (typeof FB !== 'undefined') {
      FB.login(function(response) {
        if (response.authResponse) {
          mcF('/api/meta/auth/save-token', { method: 'POST', body: JSON.stringify({
            access_token: response.authResponse.accessToken,
            fb_user_id: response.authResponse.userID
          }) }).then(function() { mcLoadTab('overview'); });
        }
      }, { scope: 'publish_to_groups,pages_manage_posts,pages_read_engagement,ads_management,groups_access_member_info' });
    } else {
      alert('FB SDK not loaded. Use the manual token entry field below.');
    }
  };

  window.mcSaveManualToken = async function() {
    const token = document.getElementById('mc-manual-token')?.value?.trim();
    if (!token) return alert('Paste your Facebook access token');
    const data = await mcF('/api/meta/auth/save-token', { method: 'POST', body: JSON.stringify({ access_token: token }) });
    if (data?.success) { alert('Connected as ' + data.name); mcLoadTab('overview'); }
    else alert(data?.error || 'Failed to connect');
  };

  window.mcDisconnect = async function() {
    if (!confirm('Disconnect Facebook account?')) return;
    await mcF('/api/meta/disconnect', { method: 'POST', body: '{}' });
    mcLoadTab('overview');
  };

  window.mcSyncAll = async function() {
    alert('Syncing groups and pages...');
    const [g, p] = await Promise.all([
      mcF('/api/meta/sync-groups', { method: 'POST', body: '{}' }),
      mcF('/api/meta/sync-pages', { method: 'POST', body: '{}' })
    ]);
    alert('Synced ' + (g?.synced||0) + ' groups and ' + (p?.synced||0) + ' pages');
    mcLoadTab(MC.tab);
  };

  window.mcToggleGroup = async function(id, enabled) {
    await mcF('/api/meta/groups/' + id + '/toggle', { method: 'PUT', body: JSON.stringify({ enabled }) });
  };

  // Post Blast
  window.mcShowCreatePost = function() { document.getElementById('mc-post-modal').classList.remove('hidden'); };
  window.mcCreatePostBlast = async function() {
    const name = document.getElementById('mc-pb-name').value.trim();
    const message = document.getElementById('mc-pb-message').value.trim();
    if (!name || !message) return alert('Name and message required');
    const checked = document.querySelectorAll('.mc-pb-grp:checked');
    const groupIds = Array.from(checked).map(c => c.value);
    if (groupIds.length === 0) return alert('Select at least one group');
    const data = await mcF('/api/meta/post-campaigns', { method: 'POST', body: JSON.stringify({
      name, message_template: message, link_url: document.getElementById('mc-pb-link').value, group_ids: groupIds
    }) });
    if (data?.success) { document.getElementById('mc-post-modal').classList.add('hidden'); mcLoadTab('post-blast'); }
    else alert(data?.error || 'Failed');
  };

  // CHUNKED POSTING — keeps calling /post-chunk until done
  window.mcRunPostBlast = async function(id) {
    const progress = document.getElementById('mc-posting-progress');
    const bar = document.getElementById('mc-posting-bar');
    const pct = document.getElementById('mc-posting-pct');
    const detail = document.getElementById('mc-posting-detail');
    if (progress) progress.classList.remove('hidden');

    let done = false;
    let totalPosted = 0, totalFailed = 0;
    while (!done) {
      const res = await mcF('/api/meta/post-chunk', { method: 'POST', body: JSON.stringify({ campaign_id: id, batch_size: 3 }) });
      if (!res) { done = true; break; }
      totalPosted += res.batch_posted || 0;
      totalFailed += res.batch_failed || 0;
      const remaining = res.remaining || 0;
      const total = totalPosted + totalFailed + remaining;
      const pctVal = total > 0 ? Math.round((totalPosted + totalFailed) / total * 100) : 100;
      if (bar) bar.style.width = pctVal + '%';
      if (pct) pct.textContent = pctVal + '%';
      if (detail) detail.textContent = totalPosted + ' posted, ' + totalFailed + ' failed, ' + remaining + ' remaining';
      done = res.done;
      if (!done) await new Promise(r => setTimeout(r, 1000)); // 1s pause between chunks
    }
    if (detail) detail.textContent = 'Done! ' + totalPosted + ' posted, ' + totalFailed + ' failed';
    setTimeout(function() { if (progress) progress.classList.add('hidden'); mcLoadTab('post-blast'); }, 3000);
  };

  window.mcViewPostLogs = async function(id) {
    document.getElementById('mc-logs-modal').classList.remove('hidden');
    const logsEl = document.getElementById('mc-logs-content');
    const data = await mcF('/api/meta/post-campaigns/' + id + '/logs');
    const logs = data?.logs || [];
    logsEl.innerHTML = logs.length === 0 ? '<p class="text-center text-gray-400">No logs yet</p>' :
      '<div class="space-y-2">' + logs.map(l => `<div class="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
        <span class="text-xs font-medium">${l.group_name||l.fb_group_id}</span>
        <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold ${l.status==='posted'?'bg-green-100 text-green-700':l.status==='failed'?'bg-red-100 text-red-600':'bg-gray-100 text-gray-500'}">${l.status}</span>
        ${l.error_message?'<span class="text-[10px] text-red-500 max-w-xs truncate">'+l.error_message+'</span>':''}
      </div>`).join('') + '</div>';
  };

  window.mcDeletePostCampaign = async function(id) {
    if (!confirm('Delete this post campaign and all logs?')) return;
    await mcF('/api/meta/post-campaigns/' + id, { method: 'DELETE' });
    mcLoadTab('post-blast');
  };

  // Ads
  window.mcShowCreateAd = function() { document.getElementById('mc-ad-modal').classList.remove('hidden'); };
  window.mcCreateAd = async function() {
    const name = document.getElementById('mc-ad-name').value.trim();
    if (!name) return alert('Campaign name required');
    const data = await mcF('/api/meta/ads', { method: 'POST', body: JSON.stringify({
      name, objective: document.getElementById('mc-ad-objective').value,
      daily_budget: parseFloat(document.getElementById('mc-ad-daily').value) || 25,
      currency: document.getElementById('mc-ad-currency').value
    }) });
    if (data?.success) { document.getElementById('mc-ad-modal').classList.add('hidden'); mcLoadTab('ads'); }
    else alert(data?.error || 'Failed');
  };
  window.mcPublishAd = async function(id) {
    if (!confirm('Publish this campaign to Meta Ads?')) return;
    const data = await mcF('/api/meta/ads/' + id + '/publish', { method: 'POST', body: '{}' });
    alert(data?.success ? data.message : (data?.error || 'Failed'));
    mcLoadTab('ads');
  };
  window.mcSyncAd = async function(id) {
    const data = await mcF('/api/meta/ads/' + id + '/sync', { method: 'POST', body: '{}' });
    alert(data?.success ? 'Metrics synced!' : (data?.error || 'Sync failed'));
    mcLoadTab('ads');
  };
  window.mcDeleteAd = async function(id) {
    if (!confirm('Delete this ad campaign?')) return;
    await mcF('/api/meta/ads/' + id, { method: 'DELETE' });
    mcLoadTab('ads');
  };

  // Scheduler
  window.mcShowSchedulePost = function() { document.getElementById('mc-schedule-modal').classList.remove('hidden'); };
  window.mcCreateScheduled = async function() {
    const sel = document.getElementById('mc-sch-target');
    const msg = document.getElementById('mc-sch-msg').value.trim();
    const time = document.getElementById('mc-sch-time').value;
    if (!msg || !time) return alert('Message and schedule time required');
    const data = await mcF('/api/meta/scheduled', { method: 'POST', body: JSON.stringify({
      target_type: 'group', target_id: sel.value, target_name: sel.options[sel.selectedIndex]?.dataset?.name || '',
      message: msg, link_url: document.getElementById('mc-sch-link').value,
      schedule_at: new Date(time).toISOString(), recurrence: document.getElementById('mc-sch-recur').value
    }) });
    if (data?.success) { document.getElementById('mc-schedule-modal').classList.add('hidden'); mcLoadTab('scheduler'); }
    else alert(data?.error || 'Failed');
  };
  window.mcCancelScheduled = async function(id) {
    if (!confirm('Cancel this scheduled post?')) return;
    await mcF('/api/meta/scheduled/' + id, { method: 'DELETE' });
    mcLoadTab('scheduler');
  };
  window.mcExecuteScheduled = async function() {
    const data = await mcF('/api/meta/scheduled/execute', { method: 'POST', body: '{}' });
    alert(data?.success ? 'Executed ' + data.posted + ' posts (' + data.failed + ' failed)' : (data?.error || 'Failed'));
    mcLoadTab('scheduler');
  };
})();

// ============================================================
// Roof Manager — Instagram Super-Admin Dashboard
// Single-brand social media operating system
// ============================================================
(function() {
  'use strict';
  const IG = {
    tab: 'performance',
    loading: false,
    status: null,
    summary: null,
    posts: [],
    postsTotal: 0,
    dailyAnalytics: [],
    competitors: [],
    hashtags: [],
    hooks: [],
    gaps: [],
    ideas: [],
    schedule: [],
    leads: [],
    leadSummary: null,
    boosts: [],
    dmKeywords: [],
    trackingNumbers: [],
  };

  function igH() {
    const t = localStorage.getItem('rc_token');
    return t ? { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
  }

  async function igF(url) {
    try { const r = await fetch('/api/admin/instagram' + url, { headers: igH() }); return await r.json(); } catch(e) { console.error('[IG]', e); return null; }
  }

  async function igPost(url, body) {
    try {
      const opts = { method: 'POST', headers: igH() };
      if (body) opts.body = JSON.stringify(body);
      const r = await fetch('/api/admin/instagram' + url, opts);
      const d = await r.json();
      if (!r.ok || !d.success) { if (window.rmToast) window.rmToast('Error: ' + (d.error || 'Failed'), 'error'); return null; }
      return d;
    } catch(e) { if (window.rmToast) window.rmToast('Error: ' + e.message, 'error'); return null; }
  }

  async function igPatch(url, body) {
    try {
      const r = await fetch('/api/admin/instagram' + url, { method: 'PATCH', headers: igH(), body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok || !d.success) { if (window.rmToast) window.rmToast('Error: ' + (d.error || 'Failed'), 'error'); return null; }
      return d;
    } catch(e) { if (window.rmToast) window.rmToast('Error: ' + e.message, 'error'); return null; }
  }

  async function igDelete(url) {
    try {
      const r = await fetch('/api/admin/instagram' + url, { method: 'DELETE', headers: igH() });
      return await r.json();
    } catch(e) { return null; }
  }

  // KPI card helper (matches samc pattern)
  function igmc(label, value, icon, color, sub) {
    return '<div class="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">' +
      '<div class="flex items-start justify-between"><div>' +
      '<p class="text-xs font-medium text-gray-400 uppercase tracking-wider">' + label + '</p>' +
      '<p class="text-2xl font-black text-gray-900 mt-1">' + value + '</p>' +
      (sub ? '<p class="text-xs text-gray-400 mt-1">' + sub + '</p>' : '') +
      '</div><div class="w-10 h-10 bg-' + color + '-100 rounded-xl flex items-center justify-center"><i class="fas ' + icon + ' text-' + color + '-500"></i></div></div></div>';
  }

  window.loadInstagram = function() {
    const root = document.getElementById('sa-root');
    if (!root) return;
    root.innerHTML = renderShell();
    igLoadTab(IG.tab);
  };

  window.igSetTab = function(tab) {
    IG.tab = tab;
    const root = document.getElementById('sa-root');
    if (root) root.innerHTML = renderShell();
    igLoadTab(tab);
  };

  function renderShell() {
    const tabs = ['performance', 'research', 'studio', 'leads'];
    const icons = { performance: 'chart-line', research: 'microscope', studio: 'film', leads: 'bullseye' };
    const labels = { performance: 'Performance', research: 'Research', studio: 'Studio', leads: 'Leads & Boost' };

    return '<div class="slide-in" id="ig-root">' +
      '<div class="flex items-center justify-between mb-6">' +
        '<div>' +
          '<h2 class="text-2xl font-black text-gray-900 flex items-center gap-3">' +
            '<div class="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg" style="background:linear-gradient(135deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)">' +
              '<i class="fab fa-instagram text-white"></i>' +
            '</div>' +
            'Instagram Command Center' +
          '</h2>' +
          '<p class="text-sm text-gray-500 mt-1">' + (IG.status?.account ? '@' + IG.status.account.username + ' \u00b7 ' + (IG.status.account.follower_count || 0).toLocaleString() + ' followers' : 'Social media operating system for Roof Manager') + '</p>' +
        '</div>' +
      '</div>' +
      '<div class="flex gap-1 mb-6 bg-gray-100 rounded-xl p-1">' +
        tabs.map(function(t) {
          return '<button onclick="window.igSetTab(\'' + t + '\')" class="px-4 py-2 rounded-lg text-sm font-medium transition-all ' + (IG.tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700') + '">' +
            '<i class="fas fa-' + icons[t] + ' mr-1.5"></i>' + labels[t] + '</button>';
        }).join('') +
      '</div>' +
      '<div id="ig-content"><div class="flex items-center justify-center py-20"><div class="w-8 h-8 border-4 border-pink-200 border-t-pink-600 rounded-full animate-spin"></div></div></div>' +
    '</div>';
  }

  async function igLoadTab(tab) {
    IG.loading = true;
    var el = document.getElementById('ig-content');
    if (!el) return;

    try {
      if (tab === 'performance') {
        var [statusD, summaryD, postsD, dailyD] = await Promise.all([
          igF('/status'), igF('/analytics/summary?window=30d'),
          igF('/posts?limit=20&sort=engagement_rate'),
          igF('/analytics/daily?from=' + new Date(Date.now()-30*86400000).toISOString().slice(0,10))
        ]);
        if (statusD) IG.status = statusD.data;
        if (summaryD) IG.summary = summaryD.data;
        if (postsD) { IG.posts = postsD.data?.posts || []; IG.postsTotal = postsD.data?.total || 0; }
        if (dailyD) IG.dailyAnalytics = dailyD.data || [];
        el.innerHTML = renderPerformance();
      } else if (tab === 'research') {
        var [compD, hashD, hookD, gapD] = await Promise.all([
          igF('/competitors'), igF('/research/hashtags'), igF('/research/hooks'), igF('/research/gaps')
        ]);
        if (compD) IG.competitors = compD.data || [];
        if (hashD) IG.hashtags = hashD.data || [];
        if (hookD) IG.hooks = hookD.data || [];
        if (gapD) IG.gaps = gapD.data || [];
        el.innerHTML = renderResearch();
      } else if (tab === 'studio') {
        var [ideasD, schedD] = await Promise.all([igF('/ideas'), igF('/schedule')]);
        if (ideasD) IG.ideas = ideasD.data || [];
        if (schedD) IG.schedule = schedD.data || [];
        el.innerHTML = renderStudio();
      } else if (tab === 'leads') {
        var [leadsD, summD, boostsD, kwD, numD] = await Promise.all([
          igF('/leads'), igF('/leads/summary'), igF('/boosts'), igF('/dm-keywords'), igF('/tracking-numbers')
        ]);
        if (leadsD) IG.leads = leadsD.data || [];
        if (summD) IG.leadSummary = summD.data || null;
        if (boostsD) IG.boosts = boostsD.data || [];
        if (kwD) IG.dmKeywords = kwD.data || [];
        if (numD) IG.trackingNumbers = numD.data || [];
        el.innerHTML = renderLeads();
      }
    } catch(e) { console.error('[IG] Load error:', e); el.innerHTML = '<p class="text-red-500 p-4">Error loading: ' + e.message + '</p>'; }
    IG.loading = false;
    // Re-render shell to update account info in header
    var root = document.getElementById('sa-root');
    if (root && IG.status) {
      var header = root.querySelector('h2');
      if (!header) return;
    }
  }

  // ── Dashboard 1: Performance ──
  function renderPerformance() {
    var s = IG.summary || {};
    var deltaColor = (s.followers_delta||0) >= 0 ? 'text-green-600' : 'text-red-600';
    var deltaSign = (s.followers_delta||0) >= 0 ? '+' : '';

    var html = '<div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">' +
      igmc('Followers', (s.followers||0).toLocaleString(), 'fa-users', 'purple', '<span class="'+deltaColor+'">'+deltaSign+(s.followers_delta||0)+'</span> vs 30d ago') +
      igmc('Impressions 30d', (s.impressions||0).toLocaleString(), 'fa-eye', 'blue') +
      igmc('Engagement Rate', (s.engagement_rate||0).toFixed(1)+'%', 'fa-heart', 'pink') +
      igmc('Organic Leads', s.organic_leads||0, 'fa-user-plus', 'green') +
      igmc('Blended CPL', s.blended_cpl_cents ? '$'+(s.blended_cpl_cents/100).toFixed(2) : '$0.00', 'fa-dollar-sign', 'yellow') +
    '</div>';

    // Actions
    html += '<div class="flex gap-2 mb-6">';
    if (!IG.status?.account) {
      html += '<button onclick="window.igAutoConnect()" class="px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-lg text-sm font-semibold hover:shadow-lg transition-all"><i class="fab fa-instagram mr-1"></i>Auto-Connect Instagram</button>';
    }
    html += '<button onclick="window.igPullNow()" class="px-4 py-2 bg-gradient-to-r from-pink-500 to-purple-500 text-white rounded-lg text-sm font-semibold hover:shadow-lg transition-all"><i class="fas fa-sync mr-1"></i>Pull Now</button>';
    html += '</div>';

    // Follower Growth Chart
    if (IG.dailyAnalytics.length > 0) {
      var maxF = Math.max.apply(null, IG.dailyAnalytics.map(function(d){return d.followers||0}).concat([1]));
      var minF = Math.min.apply(null, IG.dailyAnalytics.map(function(d){return d.followers||0}));
      var range = maxF - minF || 1;
      html += '<div class="bg-white rounded-xl border border-gray-100 p-5 shadow-sm mb-6">' +
        '<h3 class="text-sm font-semibold text-gray-700 mb-3"><i class="fas fa-chart-bar mr-1.5 text-purple-500"></i>Follower Growth (30 Days)</h3><div class="space-y-1.5">';
      IG.dailyAnalytics.slice(-14).forEach(function(d) {
        var pct = Math.max(5, Math.round(((d.followers||0) - minF) / range * 100));
        html += '<div class="flex items-center gap-2"><span class="text-xs text-gray-400 w-16 shrink-0">'+(d.snapshot_date||'').slice(5)+'</span>' +
          '<div class="flex-1 bg-gray-100 rounded-full h-2.5"><div class="bg-gradient-to-r from-purple-400 to-pink-500 h-2.5 rounded-full" style="width:'+pct+'%"></div></div>' +
          '<span class="text-xs font-mono text-gray-600 w-12 text-right">'+(d.followers||0).toLocaleString()+'</span></div>';
      });
      html += '</div></div>';
    }

    // Posts table
    html += '<div class="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">' +
      '<div class="p-4 border-b border-gray-100 flex justify-between items-center">' +
        '<h3 class="text-sm font-semibold text-gray-700"><i class="fas fa-images mr-1.5 text-pink-500"></i>Top Posts (by engagement)</h3>' +
        '<span class="text-xs text-gray-400">'+IG.postsTotal+' total</span></div>' +
      '<div class="overflow-x-auto"><table class="w-full text-sm"><thead class="bg-gray-50"><tr>' +
        '<th class="px-3 py-2 text-left text-xs font-semibold text-gray-500">Type</th>' +
        '<th class="px-3 py-2 text-left text-xs font-semibold text-gray-500">Caption</th>' +
        '<th class="px-3 py-2 text-right text-xs font-semibold text-gray-500">Reach</th>' +
        '<th class="px-3 py-2 text-right text-xs font-semibold text-gray-500">Eng. Rate</th>' +
        '<th class="px-3 py-2 text-right text-xs font-semibold text-gray-500">Leads</th>' +
        '<th class="px-3 py-2 text-right text-xs font-semibold text-gray-500">CPL</th>' +
        '<th class="px-3 py-2 text-left text-xs font-semibold text-gray-500">Posted</th></tr></thead><tbody class="divide-y divide-gray-50">';

    if (IG.posts.length === 0) {
      html += '<tr><td colspan="7" class="px-3 py-8 text-center text-gray-400">No posts synced yet. Click "Auto-Connect" then "Pull Now".</td></tr>';
    } else {
      IG.posts.forEach(function(p) {
        var typeClass = p.media_type==='REEL'?'bg-purple-100 text-purple-700':p.media_type==='VIDEO'?'bg-blue-100 text-blue-700':'bg-gray-100 text-gray-600';
        var engClass = (p.engagement_rate||0)>0.05?'text-green-600':'text-gray-600';
        html += '<tr class="hover:bg-pink-50/40 transition-colors">' +
          '<td class="px-3 py-2"><span class="px-2 py-0.5 rounded text-xs font-bold '+typeClass+'">'+(p.media_type||'IMAGE')+'</span></td>' +
          '<td class="px-3 py-2 text-gray-600 text-xs max-w-[200px] truncate">'+(p.caption||'').slice(0,60)+'</td>' +
          '<td class="px-3 py-2 text-right font-mono text-xs">'+(p.reach||0).toLocaleString()+'</td>' +
          '<td class="px-3 py-2 text-right font-bold text-xs '+engClass+'">'+((p.engagement_rate||0)*100).toFixed(1)+'%</td>' +
          '<td class="px-3 py-2 text-right text-xs">'+((p.organic_leads||0)+(p.paid_leads||0))+'</td>' +
          '<td class="px-3 py-2 text-right text-xs font-mono">'+(p.cpl_blended_cents?'$'+(p.cpl_blended_cents/100).toFixed(2):'-')+'</td>' +
          '<td class="px-3 py-2 text-xs text-gray-400">'+(p.posted_at?new Date(p.posted_at).toLocaleDateString():'')+'</td></tr>';
      });
    }
    html += '</tbody></table></div></div>';
    return html;
  }

  // ── Dashboard 2: Research ──
  function renderResearch() {
    var html = '<div class="bg-white rounded-xl border border-gray-100 shadow-sm p-5 mb-6">' +
      '<div class="flex justify-between items-center mb-4">' +
        '<h3 class="text-sm font-semibold text-gray-700"><i class="fas fa-binoculars mr-1.5 text-blue-500"></i>Competitors</h3>' +
        '<div class="flex gap-2">' +
          '<button onclick="window.igAddCompetitor()" class="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-semibold"><i class="fas fa-plus mr-1"></i>Add</button>' +
          '<button onclick="window.igRunResearch()" class="px-3 py-1.5 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-lg text-xs font-semibold"><i class="fas fa-flask mr-1"></i>Run Research Now</button>' +
        '</div></div><div class="space-y-2">';

    if (IG.competitors.length === 0) {
      html += '<p class="text-sm text-gray-400 text-center py-4">No competitors added yet.</p>';
    } else {
      IG.competitors.forEach(function(c) {
        html += '<div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg">' +
          '<div class="flex items-center gap-3"><span class="font-semibold text-sm text-gray-800">@'+c.username+'</span>' +
          '<span class="text-xs text-gray-400">'+(c.follower_count||0).toLocaleString()+' followers</span>' +
          '<span class="text-xs text-gray-400">'+(c.media_count||0)+' posts</span></div>' +
          '<div class="flex items-center gap-2"><span class="text-xs text-gray-400">'+(c.last_pulled_at?'Pulled '+new Date(c.last_pulled_at).toLocaleDateString():'Never pulled')+'</span>' +
          '<button onclick="window.igPullComp('+c.id+')" class="p-1.5 text-blue-500 hover:bg-blue-50 rounded"><i class="fas fa-sync text-xs"></i></button>' +
          '<button onclick="window.igDelComp('+c.id+')" class="p-1.5 text-red-400 hover:bg-red-50 rounded"><i class="fas fa-trash text-xs"></i></button></div></div>';
      });
    }
    html += '</div></div>';

    // Hashtags + Hooks
    html += '<div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">';

    html += '<div class="bg-white rounded-xl border border-gray-100 shadow-sm p-5"><h3 class="text-sm font-semibold text-gray-700 mb-3"><i class="fas fa-hashtag mr-1.5 text-green-500"></i>Top Hashtags</h3><div class="flex flex-wrap gap-1.5">';
    if (IG.hashtags.length === 0) { html += '<span class="text-sm text-gray-400">Run research to populate</span>'; }
    IG.hashtags.slice(0,30).forEach(function(h) {
      var cls = h.score>0.7?'bg-green-100 text-green-700 text-sm font-bold':h.score>0.4?'bg-blue-100 text-blue-600 text-xs font-semibold':'bg-gray-100 text-gray-500 text-xs';
      html += '<span class="px-2 py-1 rounded-lg '+cls+'" title="Score: '+h.score+'">'+h.value+'</span>';
    });
    html += '</div></div>';

    html += '<div class="bg-white rounded-xl border border-gray-100 shadow-sm p-5"><h3 class="text-sm font-semibold text-gray-700 mb-3"><i class="fas fa-bolt mr-1.5 text-yellow-500"></i>Hooks That Win</h3><div class="space-y-2">';
    if (IG.hooks.length === 0) { html += '<p class="text-sm text-gray-400">No hooks extracted yet</p>'; }
    IG.hooks.slice(0,10).forEach(function(h, i) {
      html += '<div class="flex items-start gap-2"><span class="text-xs font-bold text-gray-400 mt-0.5">'+(i+1)+'.</span>' +
        '<div class="flex-1"><p class="text-xs text-gray-700">"'+h.value+'"</p>' +
        '<div class="w-full bg-gray-100 rounded-full h-1.5 mt-1"><div class="bg-yellow-400 h-1.5 rounded-full" style="width:'+Math.round(h.score*100)+'%"></div></div></div></div>';
    });
    html += '</div></div></div>';

    // Content Gaps
    html += '<div class="bg-white rounded-xl border border-gray-100 shadow-sm p-5"><h3 class="text-sm font-semibold text-gray-700 mb-3"><i class="fas fa-puzzle-piece mr-1.5 text-red-500"></i>Content Gaps</h3>' +
      '<p class="text-xs text-gray-400 mb-3">Topics competitors cover that you haven\'t</p><div class="flex flex-wrap gap-2">';
    if (IG.gaps.length === 0) { html += '<span class="text-sm text-gray-400">No gaps detected</span>'; }
    IG.gaps.forEach(function(g) {
      html += '<button onclick="window.igGapToIdea(\''+g.value+'\')" class="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs font-semibold hover:bg-red-100">'+g.value+' <span class="text-red-400 ml-1">('+Math.round(g.score*100)+'%)</span></button>';
    });
    html += '</div></div>';
    return html;
  }

  // ── Dashboard 3: Studio ──
  function renderStudio() {
    var pendingIdeas = IG.ideas.filter(function(i){return i.status==='idea'||i.status==='approved';});
    var html = '<div class="flex gap-2 mb-6"><button onclick="window.igGenIdeas()" class="px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg text-sm font-semibold hover:shadow-lg transition-all"><i class="fas fa-lightbulb mr-1"></i>Generate Ideas</button></div>';

    html += '<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">';

    // Ideas column
    html += '<div><h3 class="text-sm font-semibold text-gray-700 mb-3"><i class="fas fa-lightbulb mr-1.5 text-yellow-500"></i>Ideas ('+pendingIdeas.length+')</h3><div class="space-y-3">';
    if (pendingIdeas.length === 0) {
      html += '<div class="text-center py-8 text-gray-400 text-sm">No ideas yet. Click "Generate Ideas".</div>';
    }
    pendingIdeas.forEach(function(idea) {
      var statusCls = idea.status==='approved'?'bg-green-100 text-green-700':'bg-yellow-100 text-yellow-700';
      html += '<div class="bg-white rounded-xl border border-gray-100 shadow-sm p-4">' +
        '<div class="flex justify-between items-start mb-2"><h4 class="text-sm font-bold text-gray-800">'+idea.title+'</h4>' +
        '<span class="px-2 py-0.5 rounded text-xs font-bold '+statusCls+'">'+idea.status+'</span></div>' +
        '<p class="text-xs text-gray-500 mb-2">'+(idea.angle||'')+'</p>' +
        '<div class="flex items-center gap-3 text-xs text-gray-400 mb-3"><span><i class="fas fa-bullseye mr-1"></i>'+(idea.target_persona||'')+'</span><span><i class="fas fa-bookmark mr-1"></i>'+(idea.pillar||'')+'</span></div>' +
        '<div class="flex items-center gap-2 mb-3"><span class="text-xs text-gray-500">Predicted Eng:</span>' +
        '<div class="flex-1 bg-gray-100 rounded-full h-2"><div class="bg-green-400 h-2 rounded-full" style="width:'+Math.round((idea.predicted_engagement||0)*100)+'%"></div></div>' +
        '<span class="text-xs font-bold text-gray-600">'+((idea.predicted_engagement||0)*100).toFixed(0)+'%</span>' +
        '<span class="text-xs text-gray-400 ml-2">CPL: $'+((idea.predicted_cpl_cents||0)/100).toFixed(2)+'</span></div>' +
        '<div class="flex gap-1.5">' +
        (idea.status==='idea'?'<button onclick="window.igApprove('+idea.id+')" class="px-3 py-1.5 bg-green-500 text-white rounded-lg text-xs font-semibold"><i class="fas fa-check mr-1"></i>Approve</button>':'') +
        (idea.status==='approved'?'<button onclick="window.igFilmToday('+idea.id+')" class="px-3 py-1.5 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg text-xs font-semibold"><i class="fas fa-video mr-1"></i>Film Today</button>':'') +
        '<button onclick="window.igArchive('+idea.id+')" class="px-3 py-1.5 bg-gray-100 text-gray-500 rounded-lg text-xs font-semibold"><i class="fas fa-archive mr-1"></i>Archive</button></div></div>';
    });
    html += '</div></div>';

    // Schedule column
    html += '<div><h3 class="text-sm font-semibold text-gray-700 mb-3"><i class="fas fa-calendar-alt mr-1.5 text-blue-500"></i>Scheduled & Drafts ('+IG.schedule.length+')</h3><div class="space-y-3">';
    if (IG.schedule.length === 0) {
      html += '<div class="text-center py-8 text-gray-400 text-sm">No scheduled posts.</div>';
    }
    IG.schedule.forEach(function(s) {
      var sCls = s.status==='queued'?'bg-blue-100 text-blue-700':s.status==='published'?'bg-green-100 text-green-700':'bg-gray-100 text-gray-600';
      html += '<div class="bg-white rounded-xl border border-gray-100 shadow-sm p-4">' +
        '<div class="flex justify-between items-start mb-2"><div><span class="px-2 py-0.5 rounded text-xs font-bold '+sCls+'">'+s.status+'</span>' +
        '<span class="text-xs text-gray-400 ml-2">'+(s.media_type||'')+'</span></div>' +
        '<span class="text-xs text-gray-400">'+(s.scheduled_at?new Date(s.scheduled_at).toLocaleString():'')+'</span></div>' +
        '<p class="text-xs text-gray-600 mb-2">'+(s.caption_primary||'').slice(0,80)+'...</p>' +
        (s.status==='queued'?'<div class="flex gap-1.5"><button onclick="window.igPubNow('+s.id+')" class="px-3 py-1.5 bg-green-500 text-white rounded-lg text-xs font-semibold"><i class="fas fa-rocket mr-1"></i>Publish Now</button>' +
        '<button onclick="window.igCancelSched('+s.id+')" class="px-3 py-1.5 bg-gray-100 text-gray-500 rounded-lg text-xs font-semibold"><i class="fas fa-times mr-1"></i>Cancel</button></div>':'') +
        '</div>';
    });
    html += '</div></div></div>';
    return html;
  }

  // ── Dashboard 4: Leads & Boost ──
  function renderLeads() {
    var t = IG.leadSummary?.totals || {};
    var blendedCpl = (t.total_leads||0) > 0 ? Math.round((t.total_cost||0) / t.total_leads) : 0;
    var killSwitch = blendedCpl > 6000 && (t.total_leads||0) > 0;

    var html = '';
    if (killSwitch) {
      html += '<div class="bg-red-50 border-2 border-red-300 rounded-xl p-4 mb-6 flex items-center gap-3"><i class="fas fa-exclamation-triangle text-red-500 text-xl"></i><div><p class="font-bold text-red-700">CPL Kill Switch Triggered</p><p class="text-sm text-red-600">Blended CPL ($'+(blendedCpl/100).toFixed(2)+') exceeds ceiling ($60.00). All boosts paused.</p></div></div>';
    }

    html += '<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">' +
      igmc('Total Leads (30d)', t.total_leads||0, 'fa-user-plus', 'green', (t.qualified||0)+' qualified') +
      igmc('Organic CPL', '$'+((IG.leadSummary?.by_channel||[]).find(function(c){return c.source_channel==='utm'})?.cpl/100||0).toFixed(2), 'fa-seedling', 'green') +
      igmc('Paid CPL', '$'+((IG.leadSummary?.by_channel||[]).find(function(c){return c.source_channel==='phone'})?.cpl/100||0).toFixed(2), 'fa-ad', 'blue') +
      igmc('Blended CPL', '$'+(blendedCpl/100).toFixed(2), 'fa-balance-scale', blendedCpl>5000?'red':'green') +
    '</div>';

    html += '<div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">';

    // Leads table
    html += '<div class="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden"><div class="p-4 border-b border-gray-100"><h3 class="text-sm font-semibold text-gray-700"><i class="fas fa-funnel-dollar mr-1.5 text-green-500"></i>Recent Leads</h3></div>' +
      '<div class="overflow-x-auto max-h-96 overflow-y-auto"><table class="w-full text-xs"><thead class="bg-gray-50 sticky top-0"><tr>' +
      '<th class="px-2 py-1.5 text-left font-semibold text-gray-500">Source</th><th class="px-2 py-1.5 text-left font-semibold text-gray-500">Contact</th>' +
      '<th class="px-2 py-1.5 text-left font-semibold text-gray-500">Message</th><th class="px-2 py-1.5 text-center font-semibold text-gray-500">Status</th>' +
      '<th class="px-2 py-1.5 text-left font-semibold text-gray-500">Date</th></tr></thead><tbody class="divide-y divide-gray-50">';

    if (IG.leads.length === 0) { html += '<tr><td colspan="5" class="px-2 py-6 text-center text-gray-400">No leads yet</td></tr>'; }
    IG.leads.slice(0,50).forEach(function(l) {
      var srcCls = l.source_channel==='utm'?'bg-blue-100 text-blue-700':l.source_channel==='dm'?'bg-purple-100 text-purple-700':'bg-green-100 text-green-700';
      var qualLabel = l.qualified===1?'Qualified':l.qualified===-1?'Spam':'Raw';
      var qualCls = l.qualified===1?'bg-green-100 text-green-700':l.qualified===-1?'bg-red-100 text-red-600':'bg-gray-100 text-gray-500';
      html += '<tr class="hover:bg-green-50/40"><td class="px-2 py-1.5"><span class="px-1.5 py-0.5 rounded text-xs font-bold '+srcCls+'">'+l.source_channel+'</span></td>' +
        '<td class="px-2 py-1.5 text-gray-600">'+(l.contact_name||l.contact_email||l.contact_phone||'-')+'</td>' +
        '<td class="px-2 py-1.5 text-gray-500 max-w-[150px] truncate">'+(l.message_or_query||'').slice(0,40)+'</td>' +
        '<td class="px-2 py-1.5 text-center"><button onclick="window.igToggleLead('+l.id+','+(l.qualified===1?0:1)+')" class="px-2 py-0.5 rounded text-xs font-bold '+qualCls+'">'+qualLabel+'</button></td>' +
        '<td class="px-2 py-1.5 text-gray-400">'+(l.created_at?new Date(l.created_at).toLocaleDateString():'')+'</td></tr>';
    });
    html += '</tbody></table></div></div>';

    // Boosts
    html += '<div class="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden"><div class="p-4 border-b border-gray-100 flex justify-between items-center">' +
      '<h3 class="text-sm font-semibold text-gray-700"><i class="fas fa-rocket mr-1.5 text-orange-500"></i>Active Boosts</h3>' +
      '<button onclick="window.igReallocate()" class="px-3 py-1 bg-orange-100 text-orange-700 rounded-lg text-xs font-semibold"><i class="fas fa-random mr-1"></i>Reallocate</button></div><div class="divide-y divide-gray-50">';

    if (IG.boosts.length === 0) { html += '<div class="p-4 text-center text-gray-400 text-sm">No active boosts</div>'; }
    IG.boosts.forEach(function(b) {
      var bCls = b.status==='active'?'bg-green-100 text-green-700':'bg-gray-100 text-gray-500';
      html += '<div class="p-3 flex items-center justify-between"><div><span class="px-2 py-0.5 rounded text-xs font-bold '+bCls+'">'+b.status+'</span>' +
        '<span class="text-xs text-gray-500 ml-2">Post #'+b.post_id+'</span></div><div class="text-right">' +
        '<span class="text-xs font-bold text-gray-700">$'+(b.daily_budget_cents/100).toFixed(2)+'/day</span>' +
        '<span class="text-xs text-gray-400 ml-2">Spent: $'+((b.spent_cents||0)/100).toFixed(2)+'</span></div>' +
        '<div class="flex gap-1">' +
        (b.status==='active'?'<button onclick="window.igPauseBoost('+b.id+')" class="p-1 text-yellow-500 hover:bg-yellow-50 rounded"><i class="fas fa-pause text-xs"></i></button>':'') +
        (b.status==='paused'?'<button onclick="window.igResumeBoost('+b.id+')" class="p-1 text-green-500 hover:bg-green-50 rounded"><i class="fas fa-play text-xs"></i></button>':'') +
        '</div></div>';
    });
    html += '</div></div></div>';

    // DM Keywords + Tracking Numbers
    html += '<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">';
    html += '<div class="bg-white rounded-xl border border-gray-100 shadow-sm p-5"><div class="flex justify-between items-center mb-3"><h3 class="text-sm font-semibold text-gray-700"><i class="fas fa-comment-dots mr-1.5 text-purple-500"></i>DM Keywords</h3>' +
      '<button onclick="window.igAddKw()" class="px-3 py-1 bg-purple-500 text-white rounded-lg text-xs font-semibold"><i class="fas fa-plus mr-1"></i>Add</button></div><div class="space-y-2">';
    if (IG.dmKeywords.length === 0) { html += '<p class="text-sm text-gray-400 text-center py-2">No keywords set up</p>'; }
    IG.dmKeywords.forEach(function(k) {
      html += '<div class="flex items-center justify-between p-2 bg-gray-50 rounded-lg"><div class="flex items-center gap-2"><span class="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs font-bold">'+k.keyword+'</span>' +
        '<span class="text-xs text-gray-500 truncate max-w-[150px]">'+k.reply_template.slice(0,40)+'...</span></div>' +
        '<div class="flex items-center gap-2"><span class="text-xs text-gray-400">'+(k.hit_count||0)+' hits</span><span class="w-2 h-2 rounded-full '+(k.is_active?'bg-green-400':'bg-gray-300')+'"></span></div></div>';
    });
    html += '</div></div>';

    html += '<div class="bg-white rounded-xl border border-gray-100 shadow-sm p-5"><div class="flex justify-between items-center mb-3"><h3 class="text-sm font-semibold text-gray-700"><i class="fas fa-phone mr-1.5 text-green-500"></i>Tracking Numbers</h3>' +
      '<button onclick="window.igProvision()" class="px-3 py-1 bg-green-500 text-white rounded-lg text-xs font-semibold"><i class="fas fa-plus mr-1"></i>Provision</button></div><div class="space-y-2">';
    if (IG.trackingNumbers.length === 0) { html += '<p class="text-sm text-gray-400 text-center py-2">No tracking numbers configured</p>'; }
    IG.trackingNumbers.forEach(function(n) {
      html += '<div class="flex items-center justify-between p-2 bg-gray-50 rounded-lg"><span class="text-sm font-mono text-gray-700">'+n.phone_number+'</span>' +
        '<div class="flex items-center gap-3"><span class="text-xs text-gray-400">'+(n.total_calls||0)+' calls</span>' +
        '<span class="text-xs '+(n.assigned_post_id?'text-blue-500':'text-gray-400')+'">'+(n.assigned_post_id?'Post #'+n.assigned_post_id:'Available')+'</span></div></div>';
    });
    html += '</div></div></div>';
    return html;
  }

  // ── Actions ──
  window.igAutoConnect = async function() {
    var btn = event.target.closest('button');
    if (btn) { btn.disabled=true; btn.innerHTML='<i class="fas fa-spinner fa-spin mr-1"></i>Connecting...'; }
    var d = await igPost('/auto-connect');
    if (d && d.data) { if (window.rmToast) window.rmToast('Connected @'+d.data.username+' ('+d.data.followers+' followers)!', 'success'); }
    if (btn) { btn.disabled=false; btn.innerHTML='<i class="fab fa-instagram mr-1"></i>Auto-Connect Instagram'; }
    igLoadTab('performance');
  };
  window.igPullNow = async function() {
    var btn = event.target.closest('button');
    if (btn) { btn.disabled=true; btn.innerHTML='<i class="fas fa-spinner fa-spin mr-1"></i>Pulling...'; }
    var d = await igPost('/pull/account');
    if (d) { if (window.rmToast) window.rmToast('Synced '+(d.data?.posts_synced||0)+' posts', 'success'); }
    if (btn) { btn.disabled=false; btn.innerHTML='<i class="fas fa-sync mr-1"></i>Pull Now'; }
    igLoadTab('performance');
  };
  window.igAddCompetitor = async function() {
    var u = prompt('Enter competitor Instagram username (without @):'); if (!u) return;
    var d = await igPost('/competitors', { username: u });
    if (d) { if (window.rmToast) window.rmToast('Added @'+u, 'success'); igLoadTab('research'); }
  };
  window.igDelComp = async function(id) { if (!confirm('Remove?')) return; await igDelete('/competitors/'+id); igLoadTab('research'); };
  window.igPullComp = async function(id) {
    if (window.rmToast) window.rmToast('Pulling...', 'info');
    var d = await igPost('/competitors/'+id+'/pull');
    if (d) { if (window.rmToast) window.rmToast('Synced '+(d.data?.posts_synced||0)+' posts', 'success'); }
    igLoadTab('research');
  };
  window.igRunResearch = async function() {
    if (window.rmToast) window.rmToast('Running research...', 'info');
    var d = await igPost('/research/run');
    if (d) { if (window.rmToast) window.rmToast('Scored '+(d.data?.hashtags_scored||0)+' hashtags, '+(d.data?.gaps_found||0)+' gaps', 'success'); }
    igLoadTab('research');
  };
  window.igGapToIdea = async function(topic) {
    if (window.rmToast) window.rmToast('Generating ideas for "'+topic+'"...', 'info');
    await igPost('/ideas/generate?n=3'); igSetTab('studio');
  };
  window.igGenIdeas = async function() {
    var btn = event.target.closest('button');
    if (btn) { btn.disabled=true; btn.innerHTML='<i class="fas fa-spinner fa-spin mr-1"></i>Generating...'; }
    var d = await igPost('/ideas/generate?n=10');
    if (d) { if (window.rmToast) window.rmToast('Generated '+(d.data?.ideas_generated||0)+' ideas', 'success'); }
    if (btn) { btn.disabled=false; btn.innerHTML='<i class="fas fa-lightbulb mr-1"></i>Generate Ideas'; }
    igLoadTab('studio');
  };
  window.igApprove = async function(id) { await igPost('/ideas/'+id+'/approve'); if (window.rmToast) window.rmToast('Approved', 'success'); igLoadTab('studio'); };
  window.igArchive = async function(id) { await igPost('/ideas/'+id+'/reject'); igLoadTab('studio'); };
  window.igFilmToday = async function(id) {
    if (window.rmToast) window.rmToast('Starting Film Today...', 'info');
    var btn = event.target.closest('button');
    if (btn) { btn.disabled=true; btn.innerHTML='<i class="fas fa-spinner fa-spin mr-1"></i>Producing...'; }
    var d = await igPost('/ideas/'+id+'/produce');
    if (d && d.data?.draft_id) {
      if (window.rmToast) window.rmToast('Draft created! Cost: $'+((d.data.production_cost_cents||0)/100).toFixed(2), 'success');
      var schedAt = new Date(Date.now()+120000).toISOString();
      await igPost('/schedule', { draft_id: d.data.draft_id, scheduled_at: schedAt });
    }
    if (btn) { btn.disabled=false; btn.innerHTML='<i class="fas fa-video mr-1"></i>Film Today'; }
    igLoadTab('studio');
  };
  window.igPubNow = async function(id) { var d = await igPost('/schedule/'+id+'/publish-now'); if (d) { if (window.rmToast) window.rmToast('Published!', 'success'); } igLoadTab('studio'); };
  window.igCancelSched = async function(id) { await igPost('/schedule/'+id+'/cancel'); igLoadTab('studio'); };
  window.igToggleLead = async function(id, val) { await igPatch('/leads/'+id, { qualified: val }); igLoadTab('leads'); };
  window.igReallocate = async function() {
    var d = await igPost('/boosts/reallocate');
    if (d) { if (window.rmToast) window.rmToast('Reallocation: paused '+(d.data?.paused||0)+', boosted '+(d.data?.boosted||0), 'success'); }
    igLoadTab('leads');
  };
  window.igPauseBoost = async function(id) { await igPatch('/boosts/'+id, { status: 'paused' }); igLoadTab('leads'); };
  window.igResumeBoost = async function(id) { await igPatch('/boosts/'+id, { status: 'active' }); igLoadTab('leads'); };
  window.igAddKw = async function() {
    var kw = prompt('DM keyword (e.g. ROOF):'); if (!kw) return;
    var reply = prompt('Auto-reply message:'); if (!reply) return;
    var url = prompt('Landing URL (with utm_source=instagram):'); if (!url) return;
    await igPost('/dm-keywords', { keyword: kw, reply_template: reply, landing_url: url });
    igLoadTab('leads');
  };
  window.igProvision = async function() {
    var d = await igPost('/tracking-numbers/provision');
    if (d) { if (window.rmToast) window.rmToast('Provisioned '+(d.data?.provisioned||0)+' numbers', 'success'); }
    igLoadTab('leads');
  };
})();

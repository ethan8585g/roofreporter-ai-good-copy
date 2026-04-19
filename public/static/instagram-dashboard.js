// ============================================================
// Roof Manager — Instagram Command Center
// Super Admin — 5-Phase Content Pipeline + Lead Attribution
// ============================================================
(function() {
  'use strict';

  var IG = {
    tab: 'performance', loading: false, status: null, summary: null,
    posts: [], postsTotal: 0, dailyAnalytics: [],
    competitors: [], hashtags: [], hooks: [], gaps: [],
    ideas: [], schedule: [],
    leads: [], leadSummary: null, boosts: [],
    dmKeywords: [], trackingNumbers: []
  };

  // ── Auth + API helpers ──
  function igH() {
    var t = localStorage.getItem('rc_token');
    return t ? { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
  }
  async function igF(url) {
    try { var r = await fetch('/api/admin/instagram' + url, { headers: igH() }); return await r.json(); }
    catch(e) { console.error('[IG GET]', url, e); return null; }
  }
  async function igPost(url, body) {
    try {
      var opts = { method: 'POST', headers: igH() };
      if (body) opts.body = JSON.stringify(body);
      var r = await fetch('/api/admin/instagram' + url, opts);
      var d = await r.json();
      if (!r.ok || !d.success) { console.error('[IG POST]', url, d); if (window.rmToast) window.rmToast(d.error || 'Request failed', 'error'); return null; }
      return d;
    } catch(e) { console.error('[IG POST]', url, e); if (window.rmToast) window.rmToast(e.message, 'error'); return null; }
  }
  async function igPatch(url, body) {
    try {
      var r = await fetch('/api/admin/instagram' + url, { method: 'PATCH', headers: igH(), body: JSON.stringify(body) });
      var d = await r.json(); return d;
    } catch(e) { return null; }
  }
  async function igDel(url) {
    try { var r = await fetch('/api/admin/instagram' + url, { method: 'DELETE', headers: igH() }); return await r.json(); } catch(e) { return null; }
  }

  // ── Pillar colors ──
  var pillarColors = {
    education: { bg: 'from-blue-500 to-indigo-600', border: 'border-l-blue-500', badge: 'bg-blue-100 text-blue-700' },
    'social-proof': { bg: 'from-green-500 to-emerald-600', border: 'border-l-green-500', badge: 'bg-green-100 text-green-700' },
    'storm-alert': { bg: 'from-red-500 to-orange-600', border: 'border-l-red-500', badge: 'bg-red-100 text-red-700' },
    offer: { bg: 'from-amber-500 to-yellow-600', border: 'border-l-amber-500', badge: 'bg-amber-100 text-amber-700' },
    'behind-the-scenes': { bg: 'from-purple-500 to-violet-600', border: 'border-l-purple-500', badge: 'bg-purple-100 text-purple-700' }
  };
  function getPillar(p) { return pillarColors[p] || pillarColors.education; }

  // ── Entry point ──
  window.loadInstagram = function() {
    var root = document.getElementById('sa-root');
    if (!root) return;
    root.innerHTML = renderShell();
    igLoadTab(IG.tab);
  };

  window.igSetTab = function(tab) {
    IG.tab = tab;
    var root = document.getElementById('sa-root');
    if (root) root.innerHTML = renderShell();
    igLoadTab(tab);
  };

  function renderShell() {
    var tabs = [
      { id: 'performance', icon: 'fa-chart-line', label: 'Performance' },
      { id: 'research', icon: 'fa-microscope', label: 'Research' },
      { id: 'studio', icon: 'fa-film', label: 'Studio' },
      { id: 'leads', icon: 'fa-bullseye', label: 'Leads & Boost' }
    ];

    return '<div class="slide-in" id="ig-root">' +
      // Header
      '<div class="flex items-center justify-between mb-6"><div>' +
        '<h2 class="text-2xl font-black text-gray-900 flex items-center gap-3">' +
          '<div class="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg" style="background:linear-gradient(135deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)">' +
            '<i class="fab fa-instagram text-white"></i></div>' +
          'Instagram Command Center</h2>' +
        '<p class="text-sm text-gray-500 mt-1">' +
          (IG.status && IG.status.account ? '@' + IG.status.account.username + ' \u00b7 ' + (IG.status.account.follower_count || 0).toLocaleString() + ' followers' : '5-phase content pipeline + lead attribution') +
        '</p></div></div>' +
      // Tabs
      '<div class="flex gap-1 mb-6 bg-gray-100 rounded-xl p-1">' +
        tabs.map(function(t) {
          var active = IG.tab === t.id;
          return '<button onclick="window.igSetTab(\'' + t.id + '\')" class="px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ' +
            (active ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700') + '">' +
            '<i class="fas ' + t.icon + ' mr-1.5"></i>' + t.label + '</button>';
        }).join('') +
      '</div>' +
      // Content area
      '<div id="ig-content"><div class="flex items-center justify-center py-20">' +
        '<div class="w-8 h-8 border-4 border-pink-200 border-t-pink-600 rounded-full animate-spin"></div>' +
        '<span class="ml-3 text-gray-400">Loading...</span></div></div>' +
    '</div>';
  }

  async function igLoadTab(tab) {
    IG.loading = true;
    var el = document.getElementById('ig-content');
    if (!el) return;
    try {
      if (tab === 'performance') {
        var results = await Promise.all([
          igF('/status'), igF('/analytics/summary?window=30d'),
          igF('/posts?limit=20&sort=engagement_rate'),
          igF('/analytics/daily?from=' + new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10))
        ]);
        if (results[0]) IG.status = results[0].data;
        if (results[1]) IG.summary = results[1].data;
        if (results[2]) { IG.posts = (results[2].data || {}).posts || []; IG.postsTotal = (results[2].data || {}).total || 0; }
        if (results[3]) IG.dailyAnalytics = results[3].data || [];
        el.innerHTML = renderPerformance();
      } else if (tab === 'research') {
        var r2 = await Promise.all([igF('/competitors'), igF('/research/hashtags'), igF('/research/hooks'), igF('/research/gaps')]);
        if (r2[0]) IG.competitors = r2[0].data || [];
        if (r2[1]) IG.hashtags = r2[1].data || [];
        if (r2[2]) IG.hooks = r2[2].data || [];
        if (r2[3]) IG.gaps = r2[3].data || [];
        el.innerHTML = renderResearch();
      } else if (tab === 'studio') {
        var r3 = await Promise.all([igF('/ideas'), igF('/schedule')]);
        if (r3[0]) IG.ideas = r3[0].data || [];
        if (r3[1]) IG.schedule = r3[1].data || [];
        el.innerHTML = renderStudio();
      } else if (tab === 'leads') {
        var r4 = await Promise.all([igF('/leads'), igF('/leads/summary'), igF('/boosts'), igF('/dm-keywords'), igF('/tracking-numbers')]);
        if (r4[0]) IG.leads = r4[0].data || [];
        if (r4[1]) IG.leadSummary = r4[1].data || null;
        if (r4[2]) IG.boosts = r4[2].data || [];
        if (r4[3]) IG.dmKeywords = r4[3].data || [];
        if (r4[4]) IG.trackingNumbers = r4[4].data || [];
        el.innerHTML = renderLeads();
      }
    } catch (e) {
      console.error('[IG]', e);
      el.innerHTML = '<div class="text-center py-12 text-red-500"><i class="fas fa-exclamation-triangle text-3xl mb-3"></i><p>Failed to load: ' + e.message + '</p></div>';
    }
    IG.loading = false;
  }

  // ════════════════════════════════════════════════
  //  DASHBOARD 1 — PERFORMANCE
  // ════════════════════════════════════════════════
  function renderPerformance() {
    var s = IG.summary || {};
    var acct = IG.status ? IG.status.account : null;
    var hasToken = IG.status ? IG.status.has_token : false;

    // Not connected — show big CTA
    if (!acct) {
      return '<div class="bg-white rounded-2xl border-2 border-dashed border-pink-200 p-12 text-center max-w-lg mx-auto mt-8">' +
        '<div class="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-xl" style="background:linear-gradient(135deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)">' +
          '<i class="fab fa-instagram text-white text-3xl"></i></div>' +
        '<h3 class="text-xl font-bold text-gray-900">Connect Your Instagram Account</h3>' +
        '<p class="text-gray-500 text-sm mt-2 mb-6">Link your Instagram Business account to start tracking performance, generating content, and attributing leads.</p>' +
        (hasToken
          ? '<button onclick="window.igAutoConnect(event)" class="px-8 py-3 text-white rounded-xl font-bold hover:shadow-xl transition-all shadow-lg" style="background:linear-gradient(135deg,#e6683c,#cc2366)"><i class="fab fa-instagram mr-2"></i>Auto-Connect Now</button>'
          : '<div class="bg-amber-50 border border-amber-200 rounded-xl p-4 text-left text-sm text-amber-800"><i class="fas fa-info-circle mr-2"></i>Set <code class="bg-amber-100 px-1 rounded">GRAPH_API_KEY</code> in your Cloudflare secrets first, then come back here.</div>'
        ) +
      '</div>';
    }

    var html = '';

    // Dark hero header
    html += '<div class="bg-gradient-to-r from-gray-900 to-slate-800 rounded-2xl p-6 mb-6 shadow-xl">' +
      '<div class="flex items-center justify-between">' +
        '<div class="flex items-center gap-4">' +
          '<div class="w-14 h-14 rounded-full flex items-center justify-center shadow-lg" style="background:linear-gradient(135deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)">' +
            '<i class="fab fa-instagram text-white text-xl"></i></div>' +
          '<div><h3 class="text-white font-bold text-lg">@' + (acct.username || '') + '</h3>' +
            '<p class="text-gray-400 text-xs">' + (acct.follower_count || 0).toLocaleString() + ' followers \u00b7 ' + (acct.media_count || 0) + ' posts \u00b7 Last synced: ' + (acct.last_synced_at ? new Date(acct.last_synced_at).toLocaleString() : 'never') + '</p></div></div>' +
        '<button onclick="window.igPullNow(event)" class="px-5 py-2.5 bg-white/10 border border-white/20 text-white rounded-xl text-sm font-semibold hover:bg-white/20 transition-all"><i class="fas fa-sync mr-1.5"></i>Pull Now</button>' +
      '</div></div>';

    // Gradient KPI cards
    var delta = s.followers_delta || 0;
    var deltaStr = (delta >= 0 ? '+' : '') + delta;
    html += '<div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">';
    html += kpiGrad('Followers', (s.followers || 0).toLocaleString(), deltaStr + ' (30d)', 'fa-users', 'from-pink-500 to-rose-600', 'pink');
    html += kpiGrad('Impressions', (s.impressions || 0).toLocaleString(), 'last 30 days', 'fa-eye', 'from-purple-500 to-violet-600', 'purple');
    html += kpiGrad('Eng. Rate', (s.engagement_rate || 0).toFixed(1) + '%', '30-day average', 'fa-heart', 'from-blue-500 to-indigo-600', 'blue');
    html += kpiGrad('Organic Leads', String(s.organic_leads || 0), '30-day total', 'fa-user-plus', 'from-green-500 to-emerald-600', 'green');
    html += kpiGrad('Blended CPL', s.blended_cpl_cents ? '$' + (s.blended_cpl_cents / 100).toFixed(2) : '$0.00', 'cost per lead', 'fa-dollar-sign', 'from-amber-500 to-yellow-600', 'amber');
    html += '</div>';

    // Follower growth chart
    if (IG.dailyAnalytics.length > 1) {
      var vals = IG.dailyAnalytics.map(function(d) { return d.followers || 0; });
      var maxF = Math.max.apply(null, vals.concat([1]));
      var minF = Math.min.apply(null, vals);
      var range = maxF - minF || 1;
      html += '<div class="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden mb-6">' +
        '<div class="px-6 py-4 border-b border-gray-100"><h3 class="font-bold text-gray-900 text-sm"><i class="fas fa-chart-area mr-2 text-purple-500"></i>Follower Growth</h3></div>' +
        '<div class="p-6"><div class="space-y-2">';
      IG.dailyAnalytics.slice(-14).forEach(function(d) {
        var pct = Math.max(3, Math.round(((d.followers || 0) - minF) / range * 100));
        html += '<div class="flex items-center gap-3">' +
          '<span class="text-[11px] text-gray-400 w-14 shrink-0 font-mono">' + (d.snapshot_date || '').slice(5) + '</span>' +
          '<div class="flex-1 bg-gray-100 rounded-full h-3">' +
            '<div class="h-3 rounded-full bg-gradient-to-r from-purple-400 to-pink-500 transition-all" style="width:' + pct + '%"></div></div>' +
          '<span class="text-[11px] font-bold text-gray-700 w-14 text-right">' + (d.followers || 0).toLocaleString() + '</span></div>';
      });
      html += '</div></div></div>';
    }

    // Posts table
    html += '<div class="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">' +
      '<div class="px-6 py-4 border-b border-gray-100 flex justify-between items-center">' +
        '<h3 class="font-bold text-gray-900 text-sm"><i class="fas fa-images mr-2 text-pink-500"></i>Top Posts by Engagement</h3>' +
        '<span class="text-xs text-gray-400">' + IG.postsTotal + ' total posts</span></div>' +
      '<div class="overflow-x-auto"><table class="w-full text-sm">' +
        '<thead><tr class="bg-gray-50 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">' +
          '<th class="px-4 py-3">Type</th><th class="px-4 py-3">Caption</th><th class="px-4 py-3 text-right">Reach</th>' +
          '<th class="px-4 py-3 text-right">Eng. Rate</th><th class="px-4 py-3 text-right">Leads</th>' +
          '<th class="px-4 py-3 text-right">CPL</th><th class="px-4 py-3">Date</th></tr></thead>' +
        '<tbody class="divide-y divide-gray-50">';

    if (IG.posts.length === 0) {
      html += '<tr><td colspan="7" class="px-4 py-12 text-center"><i class="fas fa-camera-retro text-4xl text-gray-200 mb-3 block"></i>' +
        '<p class="text-gray-400 font-medium">No posts synced yet</p><p class="text-gray-300 text-xs mt-1">Click "Pull Now" to sync your Instagram posts</p></td></tr>';
    }
    IG.posts.forEach(function(p) {
      var typeCls = { REEL: 'bg-purple-100 text-purple-700', VIDEO: 'bg-blue-100 text-blue-700', CAROUSEL_ALBUM: 'bg-indigo-100 text-indigo-700', IMAGE: 'bg-gray-100 text-gray-600', STORY: 'bg-pink-100 text-pink-700' };
      var eng = ((p.engagement_rate || 0) * 100).toFixed(1);
      var engCls = parseFloat(eng) > 5 ? 'text-green-600 font-bold' : 'text-gray-600';
      html += '<tr class="hover:bg-gray-50 transition-colors">' +
        '<td class="px-4 py-3"><span class="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase ' + (typeCls[p.media_type] || typeCls.IMAGE) + '">' + (p.media_type || 'IMAGE') + '</span></td>' +
        '<td class="px-4 py-3 text-gray-600 text-xs max-w-[220px] truncate">' + (p.caption || '').slice(0, 70) + '</td>' +
        '<td class="px-4 py-3 text-right font-mono text-xs">' + (p.reach || 0).toLocaleString() + '</td>' +
        '<td class="px-4 py-3 text-right text-xs ' + engCls + '">' + eng + '%</td>' +
        '<td class="px-4 py-3 text-right text-xs font-medium">' + ((p.organic_leads || 0) + (p.paid_leads || 0)) + '</td>' +
        '<td class="px-4 py-3 text-right text-xs font-mono">' + (p.cpl_blended_cents ? '$' + (p.cpl_blended_cents / 100).toFixed(2) : '\u2014') + '</td>' +
        '<td class="px-4 py-3 text-xs text-gray-400">' + (p.posted_at ? new Date(p.posted_at).toLocaleDateString() : '') + '</td></tr>';
    });
    html += '</tbody></table></div></div>';
    return html;
  }

  function kpiGrad(label, value, sub, icon, gradient, shade) {
    return '<div class="bg-gradient-to-br ' + gradient + ' rounded-xl p-5 text-white shadow-lg">' +
      '<div class="flex items-start justify-between">' +
        '<div><p class="text-' + shade + '-100 text-[11px] font-medium uppercase tracking-wider">' + label + '</p>' +
          '<p class="text-2xl font-black mt-1">' + value + '</p>' +
          '<p class="text-' + shade + '-200 text-[11px] mt-1">' + sub + '</p></div>' +
        '<div class="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center"><i class="fas ' + icon + ' text-white"></i></div></div></div>';
  }

  // ════════════════════════════════════════════════
  //  DASHBOARD 2 — RESEARCH
  // ════════════════════════════════════════════════
  function renderResearch() {
    var html = '';

    // Competitor Roster
    html += '<div class="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden mb-6">' +
      '<div class="px-6 py-4 border-b border-gray-100 flex justify-between items-center">' +
        '<h3 class="font-bold text-gray-900 text-sm"><i class="fas fa-binoculars mr-2 text-blue-500"></i>Competitor Intelligence</h3>' +
        '<div class="flex gap-2">' +
          '<button onclick="window.igAddCompetitor(event)" class="px-4 py-2 bg-blue-500 text-white rounded-xl text-xs font-bold hover:bg-blue-600 transition-colors shadow"><i class="fas fa-plus mr-1.5"></i>Add Competitor</button>' +
          '<button onclick="window.igRunResearch(event)" class="px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-xl text-xs font-bold hover:shadow-lg transition-all shadow"><i class="fas fa-flask mr-1.5"></i>Run Research</button>' +
        '</div></div>';

    if (IG.competitors.length === 0) {
      html += '<div class="p-12 text-center"><i class="fas fa-user-secret text-4xl text-gray-200 mb-3 block"></i>' +
        '<p class="text-gray-400 font-medium">No competitors tracked yet</p>' +
        '<p class="text-gray-300 text-xs mt-1">Add competitor usernames to analyze their content strategy</p></div>';
    } else {
      html += '<div class="p-4 space-y-2">';
      IG.competitors.forEach(function(c) {
        var followerPct = Math.min(100, Math.round((c.follower_count || 0) / Math.max.apply(null, IG.competitors.map(function(x) { return x.follower_count || 1; })) * 100));
        html += '<div class="flex items-center gap-4 p-3 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors">' +
          '<div class="w-10 h-10 bg-gradient-to-br from-gray-300 to-gray-400 rounded-full flex items-center justify-center"><i class="fas fa-user text-white text-sm"></i></div>' +
          '<div class="flex-1 min-w-0">' +
            '<div class="flex items-center gap-2"><span class="font-bold text-sm text-gray-800">@' + c.username + '</span>' +
              '<span class="text-[11px] text-gray-400">' + (c.follower_count || 0).toLocaleString() + ' followers</span></div>' +
            '<div class="w-full bg-gray-200 rounded-full h-1.5 mt-1"><div class="bg-blue-400 h-1.5 rounded-full" style="width:' + followerPct + '%"></div></div></div>' +
          '<div class="flex items-center gap-1.5 shrink-0">' +
            '<span class="text-[10px] text-gray-400">' + (c.last_pulled_at ? new Date(c.last_pulled_at).toLocaleDateString() : 'Never') + '</span>' +
            '<button onclick="window.igPullComp(event,' + c.id + ')" class="p-2 text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"><i class="fas fa-sync text-xs"></i></button>' +
            '<button onclick="window.igDelComp(event,' + c.id + ')" class="p-2 text-red-400 hover:bg-red-50 rounded-lg transition-colors"><i class="fas fa-trash text-xs"></i></button></div></div>';
      });
      html += '</div>';
    }
    html += '</div>';

    // Two columns: Hashtags + Hooks
    html += '<div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">';

    // Hashtags
    html += '<div class="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">' +
      '<div class="px-6 py-4 border-b border-gray-100"><h3 class="font-bold text-gray-900 text-sm"><i class="fas fa-hashtag mr-2 text-green-500"></i>Top Hashtags</h3></div>' +
      '<div class="p-5"><div class="flex flex-wrap gap-2">';
    if (IG.hashtags.length === 0) {
      html += '<p class="text-sm text-gray-400 py-4">Run research to discover hashtags</p>';
    }
    IG.hashtags.slice(0, 35).forEach(function(h) {
      var s = h.score || 0;
      var cls = s > 0.7 ? 'bg-gradient-to-r from-green-400 to-emerald-500 text-white text-sm font-bold shadow-sm' :
                s > 0.4 ? 'bg-green-100 text-green-700 text-xs font-semibold' :
                'bg-gray-100 text-gray-500 text-[11px]';
      html += '<span class="px-2.5 py-1 rounded-full ' + cls + ' cursor-default" title="Score: ' + s.toFixed(2) + '">' + h.value + '</span>';
    });
    html += '</div></div></div>';

    // Hooks
    html += '<div class="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">' +
      '<div class="px-6 py-4 border-b border-gray-100"><h3 class="font-bold text-gray-900 text-sm"><i class="fas fa-bolt mr-2 text-yellow-500"></i>Winning Hooks</h3></div>' +
      '<div class="p-5 space-y-3">';
    if (IG.hooks.length === 0) {
      html += '<p class="text-sm text-gray-400 py-4">No hooks extracted yet</p>';
    }
    IG.hooks.slice(0, 8).forEach(function(h, i) {
      html += '<div class="flex items-start gap-3">' +
        '<div class="w-6 h-6 bg-yellow-100 rounded-full flex items-center justify-center shrink-0 mt-0.5"><span class="text-[10px] font-black text-yellow-600">' + (i + 1) + '</span></div>' +
        '<div class="flex-1"><p class="text-xs text-gray-700 leading-relaxed">\u201c' + h.value + '\u201d</p>' +
          '<div class="flex items-center gap-2 mt-1.5"><div class="flex-1 bg-gray-100 rounded-full h-1.5"><div class="bg-gradient-to-r from-yellow-400 to-amber-500 h-1.5 rounded-full" style="width:' + Math.round((h.score || 0) * 100) + '%"></div></div>' +
          '<span class="text-[10px] font-bold text-gray-400">' + Math.round((h.score || 0) * 100) + '%</span></div></div></div>';
    });
    html += '</div></div></div>';

    // Content Gaps
    html += '<div class="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">' +
      '<div class="px-6 py-4 border-b border-gray-100"><h3 class="font-bold text-gray-900 text-sm"><i class="fas fa-puzzle-piece mr-2 text-red-500"></i>Content Gaps</h3>' +
        '<p class="text-[11px] text-gray-400 mt-1">Topics competitors cover that you haven\'t \u2014 click to generate ideas</p></div>' +
      '<div class="p-5 flex flex-wrap gap-2">';
    if (IG.gaps.length === 0) {
      html += '<p class="text-sm text-gray-400 py-4">No gaps detected \u2014 you\'re covering the field!</p>';
    }
    IG.gaps.forEach(function(g) {
      html += '<button onclick="window.igGapToIdea(event,\'' + g.value.replace(/'/g, "\\'") + '\')" class="px-3.5 py-2 bg-red-50 text-red-600 rounded-xl text-xs font-bold hover:bg-red-100 hover:shadow transition-all border border-red-100">' +
        '<i class="fas fa-plus-circle mr-1.5 text-red-400"></i>' + g.value + '</button>';
    });
    html += '</div></div>';
    return html;
  }

  // ════════════════════════════════════════════════
  //  DASHBOARD 3 — STUDIO (Kanban)
  // ════════════════════════════════════════════════
  function renderStudio() {
    var pending = IG.ideas.filter(function(i) { return i.status === 'idea' || i.status === 'approved'; });
    var html = '';

    // Header actions
    html += '<div class="flex items-center justify-between mb-6">' +
      '<div class="flex items-center gap-2"><span class="text-sm text-gray-500">' + pending.length + ' ideas \u00b7 ' + IG.schedule.length + ' scheduled</span></div>' +
      '<button onclick="window.igGenIdeas(event)" class="px-5 py-2.5 bg-gradient-to-r from-purple-500 to-pink-600 text-white rounded-xl text-sm font-bold hover:shadow-xl transition-all shadow-lg">' +
        '<i class="fas fa-lightbulb mr-2"></i>Generate 10 Ideas</button></div>';

    html += '<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">';

    // ── Ideas Column ──
    html += '<div>' +
      '<div class="flex items-center gap-2 mb-4"><div class="w-8 h-8 bg-yellow-100 rounded-lg flex items-center justify-center"><i class="fas fa-lightbulb text-yellow-600 text-sm"></i></div>' +
        '<h3 class="font-bold text-gray-900 text-sm">Content Ideas</h3></div>';

    if (pending.length === 0) {
      html += '<div class="bg-white rounded-xl border-2 border-dashed border-gray-200 p-10 text-center">' +
        '<i class="fas fa-magic text-4xl text-gray-200 mb-3 block"></i>' +
        '<p class="text-gray-400 font-medium">No ideas in the pipeline</p>' +
        '<p class="text-gray-300 text-xs mt-1">Click "Generate 10 Ideas" to get AI-powered content suggestions</p></div>';
    }

    html += '<div class="space-y-3">';
    pending.forEach(function(idea) {
      var pc = getPillar(idea.pillar);
      var isApproved = idea.status === 'approved';
      html += '<div class="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden hover:shadow-md transition-shadow border-l-4 ' + pc.border + '">' +
        '<div class="p-4">' +
          '<div class="flex justify-between items-start mb-2">' +
            '<h4 class="text-sm font-bold text-gray-800 leading-snug flex-1 mr-2">' + idea.title + '</h4>' +
            '<span class="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase shrink-0 ' + (isApproved ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700') + '">' + idea.status + '</span></div>' +
          (idea.angle ? '<p class="text-xs text-gray-500 mb-3 leading-relaxed">' + idea.angle + '</p>' : '') +
          '<div class="flex flex-wrap gap-1.5 mb-3">' +
            (idea.target_persona ? '<span class="px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-[10px] font-medium"><i class="fas fa-bullseye mr-1"></i>' + idea.target_persona + '</span>' : '') +
            (idea.pillar ? '<span class="px-2 py-0.5 rounded-full ' + pc.badge + ' text-[10px] font-medium"><i class="fas fa-bookmark mr-1"></i>' + idea.pillar + '</span>' : '') +
          '</div>' +
          '<div class="flex items-center gap-2 mb-3">' +
            '<span class="text-[10px] text-gray-400 w-10">Eng.</span>' +
            '<div class="flex-1 bg-gray-100 rounded-full h-2"><div class="bg-gradient-to-r from-green-400 to-emerald-500 h-2 rounded-full" style="width:' + Math.round((idea.predicted_engagement || 0) * 100) + '%"></div></div>' +
            '<span class="text-[11px] font-bold text-gray-600">' + ((idea.predicted_engagement || 0) * 100).toFixed(0) + '%</span>' +
            '<span class="text-[10px] text-gray-400 ml-1">CPL $' + ((idea.predicted_cpl_cents || 0) / 100).toFixed(0) + '</span></div>' +
          '<div class="flex gap-2">' +
            (idea.status === 'idea' ? '<button onclick="window.igApprove(event,' + idea.id + ')" class="flex-1 px-3 py-2 bg-green-500 text-white rounded-lg text-xs font-bold hover:bg-green-600 transition-colors"><i class="fas fa-check mr-1"></i>Approve</button>' : '') +
            (isApproved ? '<button onclick="window.igFilmToday(event,' + idea.id + ')" class="flex-1 px-3 py-2 text-white rounded-lg text-xs font-bold hover:shadow-lg transition-all animate-pulse" style="background:linear-gradient(135deg,#a855f7,#ec4899)"><i class="fas fa-video mr-1.5"></i>Film Today</button>' : '') +
            '<button onclick="window.igArchive(event,' + idea.id + ')" class="px-3 py-2 bg-gray-100 text-gray-400 rounded-lg text-xs font-medium hover:bg-gray-200 transition-colors"><i class="fas fa-archive"></i></button>' +
          '</div></div></div>';
    });
    html += '</div></div>';

    // ── Schedule Column ──
    html += '<div>' +
      '<div class="flex items-center gap-2 mb-4"><div class="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center"><i class="fas fa-calendar-alt text-blue-600 text-sm"></i></div>' +
        '<h3 class="font-bold text-gray-900 text-sm">Publishing Queue</h3></div>';

    if (IG.schedule.length === 0) {
      html += '<div class="bg-white rounded-xl border-2 border-dashed border-gray-200 p-10 text-center">' +
        '<i class="fas fa-rocket text-4xl text-gray-200 mb-3 block"></i>' +
        '<p class="text-gray-400 font-medium">Nothing scheduled</p>' +
        '<p class="text-gray-300 text-xs mt-1">Approve an idea, click "Film Today", and it will appear here</p></div>';
    }

    html += '<div class="space-y-3">';
    IG.schedule.forEach(function(s) {
      var statusMap = {
        queued: { cls: 'bg-blue-100 text-blue-700', icon: 'fa-clock' },
        publishing: { cls: 'bg-yellow-100 text-yellow-700 animate-pulse', icon: 'fa-spinner fa-spin' },
        published: { cls: 'bg-green-100 text-green-700', icon: 'fa-check-circle' },
        failed: { cls: 'bg-red-100 text-red-700', icon: 'fa-times-circle' },
        canceled: { cls: 'bg-gray-100 text-gray-500', icon: 'fa-ban' }
      };
      var st = statusMap[s.status] || statusMap.queued;
      var schedDate = s.scheduled_at ? new Date(s.scheduled_at) : null;
      var timeLeft = schedDate ? Math.max(0, Math.round((schedDate.getTime() - Date.now()) / 60000)) : 0;

      html += '<div class="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden hover:shadow-md transition-shadow">' +
        '<div class="p-4">' +
          '<div class="flex justify-between items-center mb-2">' +
            '<span class="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase ' + st.cls + '"><i class="fas ' + st.icon + ' mr-1"></i>' + s.status + '</span>' +
            (s.status === 'queued' && timeLeft > 0 ? '<span class="text-[11px] text-blue-500 font-mono"><i class="fas fa-hourglass-half mr-1"></i>' + (timeLeft > 60 ? Math.round(timeLeft / 60) + 'h' : timeLeft + 'min') + '</span>' : '') +
            (schedDate ? '<span class="text-[11px] text-gray-400">' + schedDate.toLocaleString() + '</span>' : '') +
          '</div>' +
          '<p class="text-xs text-gray-600 mb-3 leading-relaxed">' + (s.caption_primary || '').slice(0, 100) + (s.caption_primary && s.caption_primary.length > 100 ? '...' : '') + '</p>' +
          (s.status === 'queued' ? '<div class="flex gap-2">' +
            '<button onclick="window.igPubNow(event,' + s.id + ')" class="flex-1 px-3 py-2 bg-green-500 text-white rounded-lg text-xs font-bold hover:bg-green-600 transition-colors"><i class="fas fa-rocket mr-1"></i>Publish Now</button>' +
            '<button onclick="window.igCancelSched(event,' + s.id + ')" class="px-3 py-2 bg-gray-100 text-gray-400 rounded-lg text-xs font-medium hover:bg-gray-200"><i class="fas fa-times"></i></button></div>' : '') +
        '</div></div>';
    });
    html += '</div></div></div>';
    return html;
  }

  // ════════════════════════════════════════════════
  //  DASHBOARD 4 — LEADS & BOOST
  // ════════════════════════════════════════════════
  function renderLeads() {
    var t = (IG.leadSummary || {}).totals || {};
    var blendedCpl = (t.total_leads || 0) > 0 ? Math.round((t.total_cost || 0) / (t.total_leads || 1)) : 0;
    var killSwitch = blendedCpl > 6000 && (t.total_leads || 0) > 0;
    var html = '';

    // Kill switch banner
    if (killSwitch) {
      html += '<div class="bg-red-50 border-2 border-red-300 rounded-2xl p-5 mb-6 flex items-center gap-4 animate-pulse">' +
        '<div class="w-12 h-12 bg-red-100 rounded-xl flex items-center justify-center shrink-0"><i class="fas fa-exclamation-triangle text-red-500 text-xl"></i></div>' +
        '<div><p class="font-bold text-red-800 text-sm">CPL Kill Switch Triggered</p>' +
          '<p class="text-red-600 text-xs mt-0.5">Blended CPL ($' + (blendedCpl / 100).toFixed(2) + ') exceeds the $60.00 ceiling. All active boosts have been paused automatically.</p></div></div>';
    }

    // Lead economics KPIs
    var channels = (IG.leadSummary || {}).by_channel || [];
    var utmCpl = (channels.find(function(c) { return c.source_channel === 'utm'; }) || {}).cpl || 0;
    var phoneCpl = (channels.find(function(c) { return c.source_channel === 'phone'; }) || {}).cpl || 0;
    html += '<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">';
    html += kpiGrad('Total Leads', String(t.total_leads || 0), (t.qualified || 0) + ' qualified', 'fa-user-plus', 'from-green-500 to-emerald-600', 'green');
    html += kpiGrad('Organic CPL', '$' + (utmCpl / 100).toFixed(2), 'UTM channel', 'fa-seedling', 'from-teal-500 to-cyan-600', 'teal');
    html += kpiGrad('Paid CPL', '$' + (phoneCpl / 100).toFixed(2), 'phone + boost', 'fa-ad', 'from-blue-500 to-indigo-600', 'blue');
    html += kpiGrad('Blended CPL', '$' + (blendedCpl / 100).toFixed(2), 'all channels', 'fa-balance-scale', blendedCpl > 5000 ? 'from-red-500 to-rose-600' : 'from-green-500 to-emerald-600', blendedCpl > 5000 ? 'red' : 'green');
    html += '</div>';

    html += '<div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">';

    // Leads table
    html += '<div class="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">' +
      '<div class="px-6 py-4 border-b border-gray-100"><h3 class="font-bold text-gray-900 text-sm"><i class="fas fa-funnel-dollar mr-2 text-green-500"></i>Recent Leads</h3></div>' +
      '<div class="overflow-x-auto max-h-[400px] overflow-y-auto"><table class="w-full text-xs">' +
        '<thead class="bg-gray-50 sticky top-0"><tr class="text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">' +
          '<th class="px-4 py-2.5">Source</th><th class="px-4 py-2.5">Contact</th><th class="px-4 py-2.5">Message</th><th class="px-4 py-2.5 text-center">Status</th><th class="px-4 py-2.5">Date</th></tr></thead>' +
        '<tbody class="divide-y divide-gray-50">';

    if (IG.leads.length === 0) {
      html += '<tr><td colspan="5" class="px-4 py-10 text-center"><i class="fas fa-inbox text-3xl text-gray-200 mb-2 block"></i><p class="text-gray-400 text-xs">No leads yet</p></td></tr>';
    }
    var srcColors = { utm: 'bg-blue-100 text-blue-700', dm: 'bg-purple-100 text-purple-700', phone: 'bg-green-100 text-green-700' };
    var qualColors = { '1': 'bg-green-500 text-white', '-1': 'bg-red-100 text-red-600', '0': 'bg-gray-100 text-gray-500' };
    var qualLabels = { '1': 'Qualified', '-1': 'Spam', '0': 'Raw' };
    IG.leads.slice(0, 50).forEach(function(l) {
      html += '<tr class="hover:bg-gray-50 transition-colors">' +
        '<td class="px-4 py-2.5"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ' + (srcColors[l.source_channel] || srcColors.utm) + '">' + l.source_channel + '</span></td>' +
        '<td class="px-4 py-2.5 text-gray-600 font-medium">' + (l.contact_name || l.contact_email || l.contact_phone || '\u2014') + '</td>' +
        '<td class="px-4 py-2.5 text-gray-500 max-w-[140px] truncate">' + (l.message_or_query || '').slice(0, 40) + '</td>' +
        '<td class="px-4 py-2.5 text-center"><button onclick="window.igToggleLead(event,' + l.id + ',' + (l.qualified === 1 ? 0 : 1) + ')" class="px-2.5 py-1 rounded-full text-[10px] font-bold ' + (qualColors[String(l.qualified)] || qualColors['0']) + ' hover:opacity-80 transition-opacity">' + (qualLabels[String(l.qualified)] || 'Raw') + '</button></td>' +
        '<td class="px-4 py-2.5 text-gray-400">' + (l.created_at ? new Date(l.created_at).toLocaleDateString() : '') + '</td></tr>';
    });
    html += '</tbody></table></div></div>';

    // Boosts panel
    html += '<div class="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">' +
      '<div class="px-6 py-4 border-b border-gray-100 flex justify-between items-center">' +
        '<h3 class="font-bold text-gray-900 text-sm"><i class="fas fa-rocket mr-2 text-orange-500"></i>Boost Campaigns</h3>' +
        '<button onclick="window.igReallocate(event)" class="px-3 py-1.5 bg-orange-100 text-orange-700 rounded-lg text-[11px] font-bold hover:bg-orange-200 transition-colors"><i class="fas fa-random mr-1"></i>Reallocate</button></div>';

    if (IG.boosts.length === 0) {
      html += '<div class="p-10 text-center"><i class="fas fa-chart-line text-3xl text-gray-200 mb-2 block"></i><p class="text-gray-400 text-xs">No boost campaigns active</p></div>';
    } else {
      html += '<div class="divide-y divide-gray-50">';
      IG.boosts.forEach(function(b) {
        var spent = (b.spent_cents || 0);
        var budget = b.lifetime_budget_cents || (b.daily_budget_cents * 7);
        var spentPct = budget > 0 ? Math.min(100, Math.round(spent / budget * 100)) : 0;
        html += '<div class="p-4">' +
          '<div class="flex items-center justify-between mb-2">' +
            '<div class="flex items-center gap-2"><span class="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase ' + (b.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500') + '">' + b.status + '</span>' +
            '<span class="text-xs text-gray-500">Post #' + b.post_id + '</span></div>' +
            '<div class="flex items-center gap-1">' +
              (b.status === 'active' ? '<button onclick="window.igPauseBoost(event,' + b.id + ')" class="p-1.5 text-yellow-500 hover:bg-yellow-50 rounded-lg"><i class="fas fa-pause text-xs"></i></button>' : '') +
              (b.status === 'paused' ? '<button onclick="window.igResumeBoost(event,' + b.id + ')" class="p-1.5 text-green-500 hover:bg-green-50 rounded-lg"><i class="fas fa-play text-xs"></i></button>' : '') +
            '</div></div>' +
          '<div class="flex items-center gap-3 text-[11px]">' +
            '<span class="text-gray-500">$' + (b.daily_budget_cents / 100).toFixed(2) + '/day</span>' +
            '<div class="flex-1 bg-gray-100 rounded-full h-2"><div class="bg-gradient-to-r from-orange-400 to-amber-500 h-2 rounded-full" style="width:' + spentPct + '%"></div></div>' +
            '<span class="text-gray-700 font-bold">$' + (spent / 100).toFixed(2) + ' spent</span></div></div>';
      });
      html += '</div>';
    }
    html += '</div></div>';

    // DM Keywords + Tracking Numbers
    html += '<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">';

    // DM Keywords
    html += '<div class="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">' +
      '<div class="px-6 py-4 border-b border-gray-100 flex justify-between items-center">' +
        '<h3 class="font-bold text-gray-900 text-sm"><i class="fas fa-comment-dots mr-2 text-purple-500"></i>DM Auto-Reply Keywords</h3>' +
        '<button onclick="window.igAddKw(event)" class="px-3 py-1.5 bg-purple-500 text-white rounded-lg text-[11px] font-bold hover:bg-purple-600 transition-colors"><i class="fas fa-plus mr-1"></i>Add</button></div>';
    if (IG.dmKeywords.length === 0) {
      html += '<div class="p-8 text-center"><p class="text-gray-400 text-xs">No DM keywords configured</p></div>';
    } else {
      html += '<div class="p-4 space-y-2">';
      IG.dmKeywords.forEach(function(k) {
        html += '<div class="flex items-center justify-between p-3 bg-gray-50 rounded-xl">' +
          '<div class="flex items-center gap-2.5">' +
            '<span class="px-3 py-1 bg-purple-100 text-purple-700 rounded-lg text-xs font-black">' + k.keyword + '</span>' +
            '<span class="text-[11px] text-gray-500 truncate max-w-[180px]">' + (k.reply_template || '').slice(0, 50) + '</span></div>' +
          '<div class="flex items-center gap-2"><span class="text-[10px] text-gray-400 font-mono">' + (k.hit_count || 0) + ' hits</span>' +
            '<div class="w-2 h-2 rounded-full ' + (k.is_active ? 'bg-green-400' : 'bg-gray-300') + '"></div></div></div>';
      });
      html += '</div>';
    }
    html += '</div>';

    // Tracking Numbers
    html += '<div class="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">' +
      '<div class="px-6 py-4 border-b border-gray-100 flex justify-between items-center">' +
        '<h3 class="font-bold text-gray-900 text-sm"><i class="fas fa-phone mr-2 text-green-500"></i>Tracking Number Pool</h3>' +
        '<button onclick="window.igProvision(event)" class="px-3 py-1.5 bg-green-500 text-white rounded-lg text-[11px] font-bold hover:bg-green-600 transition-colors"><i class="fas fa-plus mr-1"></i>Provision</button></div>';
    if (IG.trackingNumbers.length === 0) {
      html += '<div class="p-8 text-center"><p class="text-gray-400 text-xs">Set TWILIO_TRACKING_NUMBER_POOL in secrets, then click Provision</p></div>';
    } else {
      html += '<div class="p-4 space-y-2">';
      IG.trackingNumbers.forEach(function(n) {
        html += '<div class="flex items-center justify-between p-3 bg-gray-50 rounded-xl">' +
          '<span class="text-sm font-mono text-gray-700 font-bold">' + n.phone_number + '</span>' +
          '<div class="flex items-center gap-3"><span class="text-[10px] text-gray-400">' + (n.total_calls || 0) + ' calls</span>' +
            '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold ' + (n.assigned_post_id ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700') + '">' +
              (n.assigned_post_id ? 'Post #' + n.assigned_post_id : 'Available') + '</span></div></div>';
      });
      html += '</div>';
    }
    html += '</div></div>';
    return html;
  }

  // ════════════════════════════════════════════════
  //  ACTIONS — All accept (e) to fix strict mode
  // ════════════════════════════════════════════════
  function btnLoading(e, text) {
    if (!e) return null;
    var btn = e.target ? e.target.closest('button') : null;
    if (btn) { btn.disabled = true; btn.dataset.original = btn.innerHTML; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1.5"></i>' + (text || 'Loading...'); }
    return btn;
  }
  function btnReset(btn) {
    if (btn) { btn.disabled = false; btn.innerHTML = btn.dataset.original || ''; }
  }

  window.igAutoConnect = async function(e) {
    var btn = btnLoading(e, 'Connecting...');
    var d = await igPost('/auto-connect');
    if (d && d.data) { if (window.rmToast) window.rmToast('Connected @' + d.data.username + ' (' + (d.data.followers || 0).toLocaleString() + ' followers)!', 'success'); }
    btnReset(btn);
    igLoadTab('performance');
  };

  window.igPullNow = async function(e) {
    var btn = btnLoading(e, 'Syncing...');
    var d = await igPost('/pull/account');
    if (d && d.data) { if (window.rmToast) window.rmToast('Synced ' + (d.data.posts_synced || 0) + ' posts', 'success'); }
    btnReset(btn);
    igLoadTab('performance');
  };

  window.igAddCompetitor = async function(e) {
    var u = prompt('Enter Instagram username (without @):');
    if (!u) return;
    var d = await igPost('/competitors', { username: u });
    if (d) { if (window.rmToast) window.rmToast('Added @' + u, 'success'); igLoadTab('research'); }
  };

  window.igDelComp = async function(e, id) { if (!confirm('Remove this competitor?')) return; await igDel('/competitors/' + id); igLoadTab('research'); };

  window.igPullComp = async function(e, id) {
    var btn = btnLoading(e, 'Pulling...');
    var d = await igPost('/competitors/' + id + '/pull');
    if (d && d.data) { if (window.rmToast) window.rmToast('Synced ' + (d.data.posts_synced || 0) + ' posts, ' + (d.data.hooks_extracted || 0) + ' hooks', 'success'); }
    btnReset(btn);
    igLoadTab('research');
  };

  window.igRunResearch = async function(e) {
    var btn = btnLoading(e, 'Analyzing...');
    var d = await igPost('/research/run');
    if (d && d.data) { if (window.rmToast) window.rmToast('Scored ' + (d.data.hashtags_scored || 0) + ' hashtags, found ' + (d.data.gaps_found || 0) + ' gaps', 'success'); }
    btnReset(btn);
    igLoadTab('research');
  };

  window.igGapToIdea = async function(e, topic) {
    if (window.rmToast) window.rmToast('Generating ideas for "' + topic + '"...', 'info');
    await igPost('/ideas/generate?n=3');
    window.igSetTab('studio');
  };

  window.igGenIdeas = async function(e) {
    var btn = btnLoading(e, 'Generating...');
    var d = await igPost('/ideas/generate?n=10');
    if (d && d.data) { if (window.rmToast) window.rmToast('Generated ' + (d.data.ideas_generated || 0) + ' ideas', 'success'); }
    btnReset(btn);
    igLoadTab('studio');
  };

  window.igApprove = async function(e, id) { await igPost('/ideas/' + id + '/approve'); if (window.rmToast) window.rmToast('Idea approved!', 'success'); igLoadTab('studio'); };
  window.igArchive = async function(e, id) { await igPost('/ideas/' + id + '/reject'); igLoadTab('studio'); };

  window.igFilmToday = async function(e, id) {
    var btn = btnLoading(e, 'Producing...');
    if (window.rmToast) window.rmToast('Starting Film Today pipeline...', 'info');
    var d = await igPost('/ideas/' + id + '/produce');
    if (d && d.data && d.data.draft_id) {
      if (window.rmToast) window.rmToast('Draft #' + d.data.draft_id + ' created! Cost: $' + ((d.data.production_cost_cents || 0) / 100).toFixed(2), 'success');
      var schedAt = new Date(Date.now() + 120000).toISOString();
      await igPost('/schedule', { draft_id: d.data.draft_id, scheduled_at: schedAt });
    }
    btnReset(btn);
    igLoadTab('studio');
  };

  window.igPubNow = async function(e, id) {
    var btn = btnLoading(e, 'Publishing...');
    await igPost('/schedule/' + id + '/publish-now');
    btnReset(btn);
    igLoadTab('studio');
  };

  window.igCancelSched = async function(e, id) { await igPost('/schedule/' + id + '/cancel'); igLoadTab('studio'); };

  window.igToggleLead = async function(e, id, val) { await igPatch('/leads/' + id, { qualified: val }); igLoadTab('leads'); };

  window.igReallocate = async function(e) {
    var btn = btnLoading(e, 'Reallocating...');
    var d = await igPost('/boosts/reallocate');
    if (d && d.data) { if (window.rmToast) window.rmToast('Paused ' + (d.data.paused || 0) + ' underperformers, boosted ' + (d.data.boosted || 0) + ' winners', 'success'); }
    btnReset(btn);
    igLoadTab('leads');
  };

  window.igPauseBoost = async function(e, id) { await igPatch('/boosts/' + id, { status: 'paused' }); igLoadTab('leads'); };
  window.igResumeBoost = async function(e, id) { await igPatch('/boosts/' + id, { status: 'active' }); igLoadTab('leads'); };

  window.igAddKw = async function(e) {
    var kw = prompt('DM keyword (e.g. ROOF, QUOTE, STORM):');
    if (!kw) return;
    var reply = prompt('Auto-reply message template:');
    if (!reply) return;
    var url = prompt('Landing URL (must include utm_source=instagram):');
    if (!url) return;
    await igPost('/dm-keywords', { keyword: kw, reply_template: reply, landing_url: url });
    if (window.rmToast) window.rmToast('Keyword "' + kw + '" added', 'success');
    igLoadTab('leads');
  };

  window.igProvision = async function(e) {
    var btn = btnLoading(e, 'Provisioning...');
    var d = await igPost('/tracking-numbers/provision');
    if (d && d.data) { if (window.rmToast) window.rmToast('Provisioned ' + (d.data.provisioned || 0) + ' numbers', 'success'); }
    btnReset(btn);
    igLoadTab('leads');
  };
})();

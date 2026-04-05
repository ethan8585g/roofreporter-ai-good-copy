// ============================================================
// HeyGen Video Studio — Super Admin Dashboard Module
// Full-featured AI video creation platform for Roof Manager
// Mirrors HeyGen's platform UX with Home, AI Studio, Video Agent,
// Interactive Avatar, Video Translate, Photo Avatar, Brand Kit,
// Templates, and My Videos tabs
// ============================================================

(function() {
  'use strict';

  const API = '/api/heygen';
  const getToken = () => localStorage.getItem('rc_token') || '';
  const hdrs = () => ({ 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' });

  /* ── State ─────────────────────────────────────────────── */
  let currentTab = 'home';
  let avatars = [];
  let voices = [];
  let templates = [];
  let pollingIntervals = {};
  let brandKit = JSON.parse(localStorage.getItem('hg_brand_kit') || '{}');
  let dashboardCache = null;

  /* ── Fetch helper ──────────────────────────────────────── */
  async function hgFetch(url, opts) {
    try {
      const res = await fetch(url, { headers: hdrs(), ...(opts || {}) });
      if (!res.ok) {
        const text = await res.text();
        try { return { _error: true, ...(JSON.parse(text)) }; }
        catch(e) { return { _error: true, error: text || ('HTTP ' + res.status) }; }
      }
      return await res.json();
    } catch(e) {
      return { _error: true, error: e.message };
    }
  }

  /* ── Main Entry ────────────────────────────────────────── */
  window.loadHeyGen = function() {
    const container = document.getElementById('sa-root');
    if (!container) return;
    container.innerHTML = renderShell();
    switchTab('home');
  };

  function renderShell() {
    const tabs = [
      { id: 'home',         label: 'Home',               icon: 'fa-home' },
      { id: 'studio',       label: 'AI Studio',          icon: 'fa-film' },
      { id: 'agent',        label: 'Video Agent',        icon: 'fa-robot' },
      { id: 'interactive',  label: 'Interactive Avatar',  icon: 'fa-comments' },
      { id: 'translate',    label: 'Video Translate',     icon: 'fa-language' },
      { id: 'photo-avatar', label: 'Photo Avatar',        icon: 'fa-camera' },
      { id: 'brand',        label: 'Brand Kit',           icon: 'fa-palette' },
      { id: 'templates',    label: 'Templates',           icon: 'fa-clone' },
      { id: 'videos',       label: 'My Videos',           icon: 'fa-play-circle' },
    ];

    return `
    <div style="max-width:1400px;margin:0 auto">
      <!-- Header -->
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
        <div style="display:flex;align-items:center;gap:14px">
          <div style="width:48px;height:48px;background:linear-gradient(135deg,#7c3aed,#a855f7);border-radius:12px;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(124,58,237,0.3)">
            <i class="fas fa-video" style="color:#fff;font-size:22px"></i>
          </div>
          <div>
            <h2 style="margin:0;font-size:24px;font-weight:900;color:#1a1a2e">HeyGen Video Studio</h2>
            <p style="margin:0;font-size:13px;color:#64748b">AI-powered video creation for Roof Manager</p>
          </div>
        </div>
        <div id="hg-api-badge" style="display:flex;gap:8px;align-items:center">
          <button onclick="window._hgCheckQuota()" style="padding:6px 14px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;font-size:11px;color:#475569;cursor:pointer;font-weight:600"><i class="fas fa-coins" style="margin-right:4px;color:#f59e0b"></i>Credits</button>
          <span id="hg-conn-dot" style="width:8px;height:8px;border-radius:50%;background:#94a3b8;display:inline-block"></span>
          <span id="hg-conn-label" style="font-size:11px;color:#64748b;font-weight:500">Checking...</span>
        </div>
      </div>

      <!-- Navigation Tabs -->
      <div style="display:flex;gap:2px;margin-bottom:20px;border-bottom:2px solid #e2e8f0;padding-bottom:0;overflow-x:auto">
        ${tabs.map(t => `<button onclick="window._hgTab('${t.id}')" id="hg-tab-${t.id}" style="padding:10px 14px;font-size:12px;font-weight:600;border:none;background:none;cursor:pointer;border-bottom:3px solid transparent;color:#64748b;transition:all .2s;white-space:nowrap;display:flex;align-items:center;gap:5px">
          <i class="fas ${t.icon}" style="font-size:11px"></i>${t.label}
        </button>`).join('')}
      </div>

      <div id="hg-content"></div>
    </div>`;
  }

  window._hgTab = function(tab) {
    currentTab = tab;
    document.querySelectorAll('[id^="hg-tab-"]').forEach(el => {
      el.style.borderBottomColor = 'transparent';
      el.style.color = '#64748b';
    });
    const active = document.getElementById('hg-tab-' + tab);
    if (active) { active.style.borderBottomColor = '#7c3aed'; active.style.color = '#7c3aed'; }
    switchTab(tab);
  };

  async function switchTab(tab) {
    const el = document.getElementById('hg-content');
    if (!el) return;
    el.innerHTML = loader();
    try {
      switch(tab) {
        case 'home':         await renderHome(el); break;
        case 'studio':       await renderStudio(el); break;
        case 'agent':        await renderAgent(el); break;
        case 'interactive':  renderInteractive(el); break;
        case 'translate':    renderTranslate(el); break;
        case 'photo-avatar': renderPhotoAvatar(el); break;
        case 'brand':        await renderBrandKit(el); break;
        case 'templates':    await renderTemplates(el); break;
        case 'videos':       await renderVideos(el); break;
        default: el.innerHTML = errBox('Unknown tab');
      }
    } catch(e) { el.innerHTML = errBox('Failed to load: ' + e.message); }
  }

  /* ========================================================================
     HOME — Dashboard with stats, quota, quick actions, recent videos
     ======================================================================== */
  async function renderHome(el) {
    const data = await hgFetch(API + '/dashboard');

    // Update API badge
    updateApiBadge(data);

    if (data._error) {
      el.innerHTML = apiKeyMissing(data.error || 'Failed to load dashboard. Check API configuration.');
      return;
    }

    if (!data.api_configured) {
      el.innerHTML = apiKeyMissing();
      return;
    }

    const s = data.stats || {};
    const q = data.quota || {};
    const freeCredits = (q.details?.avatar_iv_free_credit || 0)
      + (q.details?.video_agent_v2_free_video || 0)
      + (q.details?.image_free_credit || 0);

    el.innerHTML = `
    <!-- Welcome Banner -->
    <div style="background:linear-gradient(135deg,#7c3aed 0%,#4f46e5 50%,#1e40af 100%);border-radius:16px;padding:28px 32px;color:white;margin-bottom:24px;position:relative;overflow:hidden">
      <div style="position:absolute;right:-20px;top:-20px;width:180px;height:180px;border-radius:50%;background:rgba(255,255,255,0.06)"></div>
      <div style="position:absolute;right:60px;bottom:-40px;width:120px;height:120px;border-radius:50%;background:rgba(255,255,255,0.04)"></div>
      <h3 style="font-size:22px;font-weight:800;margin:0 0 6px 0"><i class="fas fa-sparkles" style="margin-right:8px;color:#fbbf24"></i>Welcome to HeyGen Video Studio</h3>
      <p style="font-size:14px;opacity:0.85;margin:0 0 16px 0">Create professional AI avatar videos for marketing, tutorials, and client report walkthroughs.</p>
      <div style="display:flex;gap:12px">
        <button onclick="window._hgTab('studio')" style="padding:8px 18px;background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.3);border-radius:8px;color:white;font-size:12px;font-weight:700;cursor:pointer;backdrop-filter:blur(4px)"><i class="fas fa-plus" style="margin-right:4px"></i>Create Video</button>
        <button onclick="window._hgTab('agent')" style="padding:8px 18px;background:transparent;border:1px solid rgba(255,255,255,0.25);border-radius:8px;color:white;font-size:12px;font-weight:600;cursor:pointer"><i class="fas fa-robot" style="margin-right:4px"></i>Video Agent</button>
      </div>
    </div>

    <!-- Stats + Quota Row -->
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:24px">
      ${statCard('Total Videos', s.total || 0, 'fa-video', '#7c3aed', '#f5f3ff')}
      ${statCard('Completed', s.completed || 0, 'fa-check-circle', '#059669', '#ecfdf5')}
      ${statCard('Processing', s.processing || 0, 'fa-cog fa-spin', '#d97706', '#fffbeb')}
      ${statCard('Failed', s.failed || 0, 'fa-times-circle', '#dc2626', '#fef2f2')}
      ${statCard('Free Credits', freeCredits, 'fa-coins', '#f59e0b', '#fffbeb')}
    </div>

    <!-- Quick Create Cards -->
    <h3 style="font-size:16px;font-weight:700;color:#1e293b;margin-bottom:14px"><i class="fas fa-bolt" style="color:#f59e0b;margin-right:6px"></i>Quick Create</h3>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:28px">
      ${quickCard('studio', 'fa-film', '#7c3aed', 'AI Studio', 'Full video editor with avatar, voice & script')}
      ${quickCard('agent', 'fa-robot', '#2563eb', 'Video Agent', 'Describe your video, AI creates it')}
      ${quickCard('interactive', 'fa-comments', '#059669', 'Interactive Avatar', 'Live streaming avatar')}
      ${quickCard('translate', 'fa-language', '#d97706', 'Video Translate', 'Translate to 175+ languages')}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
      <!-- Recent Videos -->
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
          <h4 style="font-size:14px;font-weight:700;color:#1e293b;margin:0"><i class="fas fa-clock" style="color:#7c3aed;margin-right:6px"></i>Recent Videos</h4>
          <button onclick="window._hgTab('videos')" style="font-size:11px;color:#7c3aed;background:none;border:none;cursor:pointer;font-weight:600">View All &rarr;</button>
        </div>
        ${(data.recent_videos||[]).length === 0
          ? '<p style="color:#94a3b8;font-size:13px;text-align:center;padding:30px 0"><i class="fas fa-film" style="font-size:28px;color:#d1d5db;display:block;margin-bottom:8px"></i>No videos yet &mdash; create your first one!</p>'
          : (data.recent_videos||[]).slice(0,5).map(v => videoRow(v)).join('')}
      </div>

      <!-- Video Ideas -->
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px">
        <h4 style="font-size:14px;font-weight:700;color:#1e293b;margin:0 0 14px 0"><i class="fas fa-lightbulb" style="color:#f59e0b;margin-right:6px"></i>Video Ideas for Roof Manager</h4>
        <div style="display:grid;gap:8px">
          ${ideaRow('fa-rocket', '#7c3aed', 'Product Demo', 'studio', 'Full walkthrough of Roof Manager features')}
          ${ideaRow('fa-bullhorn', '#ec4899', '30s Social Ad', 'agent', 'Quick TikTok/Instagram reel ad')}
          ${ideaRow('fa-graduation-cap', '#d97706', 'How-To Tutorial', 'studio', 'Step-by-step guide for new users')}
          ${ideaRow('fa-hard-hat', '#059669', 'Contractor Pitch', 'agent', 'Why roofers love our AI reports')}
          ${ideaRow('fa-home', '#2563eb', 'Homeowner Explainer', 'agent', 'Get your roof measured from home')}
          ${ideaRow('fa-file-alt', '#dc2626', 'Report Walkthrough', 'studio', 'Walk clients through their roof report')}
        </div>
      </div>
    </div>

    <!-- API Status Detail (collapsed) -->
    ${data.api_status === 'connected' ? `
    <div style="margin-top:20px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px 18px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:12px;color:#475569"><i class="fas fa-plug" style="color:#22c55e;margin-right:4px"></i><strong>HeyGen API Connected</strong></span>
        <span style="font-size:11px;color:#94a3b8">Paid Credits: ${q.remaining_quota ?? 0} &bull; Free: Avatar IV (${q.details?.avatar_iv_free_credit||0}), Video Agent (${q.details?.video_agent_v2_free_video||0}), Images (${q.details?.image_free_credit||0})</span>
      </div>
    </div>` : ''}`;
  }


  /* ========================================================================
     AI STUDIO — Full avatar video editor
     ======================================================================== */
  async function renderStudio(el) {
    el.innerHTML = loader();
    try {
      if (!avatars.length) {
        const [aData, vData] = await Promise.all([hgFetch(API + '/avatars'), hgFetch(API + '/voices')]);
        if (aData._error || vData._error) { el.innerHTML = errBox('Failed to load HeyGen data: ' + (aData.error || vData.error)); return; }
        avatars = aData.avatars || [];
        voices = vData.voices || [];
      }
    } catch(e) { el.innerHTML = errBox(e.message); return; }

    const engVoices = voices.filter(v => v.language && v.language.toLowerCase().includes('en'));
    const defaultAvatar = brandKit.default_avatar || avatars[0]?.avatar_id || '';

    el.innerHTML = `
    <div style="display:grid;grid-template-columns:320px 1fr;gap:20px">
      <!-- LEFT: Settings -->
      <div style="display:flex;flex-direction:column;gap:14px">
        <!-- Project Settings -->
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px">
          <h4 style="font-size:13px;font-weight:700;color:#1e293b;margin:0 0 12px 0"><i class="fas fa-cog" style="color:#7c3aed;margin-right:4px"></i>Project Settings</h4>
          <label class="hg-label">Title</label>
          <input id="hg-title" type="text" placeholder="My Roof Manager Video" class="hg-input">
          <label class="hg-label">Category</label>
          <select id="hg-category" class="hg-input">
            <option value="marketing">Marketing</option>
            <option value="social">Social Media</option>
            <option value="training">Tutorial / How-To</option>
            <option value="ad">Advertisement</option>
            <option value="testimonial">Testimonial</option>
            <option value="report_walkthrough">Report Walkthrough</option>
          </select>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:2px">
            <div>
              <label class="hg-label">Aspect Ratio</label>
              <select id="hg-aspect" class="hg-input">
                <option value="16:9">16:9 Landscape</option>
                <option value="9:16">9:16 Portrait</option>
                <option value="1:1">1:1 Square</option>
              </select>
            </div>
            <div>
              <label class="hg-label">Speed</label>
              <select id="hg-speed" class="hg-input">
                <option value="0.8">0.8x Slow</option>
                <option value="1.0" selected>1.0x Normal</option>
                <option value="1.1">1.1x Slightly Fast</option>
                <option value="1.2">1.2x Fast</option>
                <option value="1.5">1.5x Very Fast</option>
              </select>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px">
            <div>
              <label class="hg-label">Background</label>
              <select id="hg-bg-type" class="hg-input" onchange="document.getElementById('hg-bg-color-row').style.display=this.value==='color'?'block':'none';document.getElementById('hg-bg-url-row').style.display=this.value!=='color'?'block':'none'">
                <option value="color">Solid Color</option>
                <option value="image">Image URL</option>
              </select>
            </div>
            <div id="hg-bg-color-row">
              <label class="hg-label">Color</label>
              <input id="hg-bg" type="color" value="${brandKit.bg_color || '#ffffff'}" style="width:100%;height:32px;border:1px solid #d1d5db;border-radius:6px;cursor:pointer;box-sizing:border-box">
            </div>
            <div id="hg-bg-url-row" style="display:none;grid-column:1/-1">
              <label class="hg-label">Image URL</label>
              <input id="hg-bg-url" type="url" placeholder="https://..." class="hg-input">
            </div>
          </div>
          <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:#64748b;margin-top:8px;cursor:pointer">
            <input type="checkbox" id="hg-test-mode"> <span>Test Mode (free, watermarked, low quality)</span>
          </label>
        </div>

        <!-- Avatar Selection -->
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <h4 style="font-size:13px;font-weight:700;color:#1e293b;margin:0"><i class="fas fa-user-circle" style="color:#a855f7;margin-right:4px"></i>Avatar</h4>
            <input id="hg-avatar-search" type="text" placeholder="Search..." style="padding:4px 8px;font-size:10px;border:1px solid #e2e8f0;border-radius:4px;width:90px" oninput="window._hgFilterAvatars(this.value)">
          </div>
          <div id="hg-avatar-grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;max-height:240px;overflow-y:auto;margin-bottom:8px">
            ${renderAvatarGrid(avatars, defaultAvatar)}
          </div>
          <div style="font-size:10px;color:#94a3b8">${avatars.length} avatars available &bull; <span id="hg-selected-avatar-name">${avatars.find(a=>a.avatar_id===defaultAvatar)?.avatar_name || 'None selected'}</span></div>
        </div>

        <!-- Voice Selection -->
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <h4 style="font-size:13px;font-weight:700;color:#1e293b;margin:0"><i class="fas fa-microphone" style="color:#ec4899;margin-right:4px"></i>Voice</h4>
            <select id="hg-voice-lang" style="padding:3px 6px;font-size:10px;border:1px solid #e2e8f0;border-radius:4px" onchange="window._hgFilterVoices()">
              <option value="en">English</option>
              <option value="fr">French</option>
              <option value="es">Spanish</option>
              <option value="de">German</option>
              <option value="all">All Languages</option>
            </select>
          </div>
          <select id="hg-voice" class="hg-input" style="margin-bottom:4px">
            ${engVoices.slice(0, 100).map(v => `<option value="${v.voice_id}" ${brandKit.default_voice === v.voice_id ? 'selected' : ''}>${v.name} (${v.gender || ''})</option>`).join('')}
          </select>
          <div style="font-size:10px;color:#94a3b8">${voices.length} voices &bull; ${engVoices.length} English</div>
        </div>
      </div>

      <!-- RIGHT: Script Editor + Preview -->
      <div style="display:flex;flex-direction:column;gap:14px">
        <!-- Script Editor -->
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <h4 style="font-size:14px;font-weight:700;color:#1e293b;margin:0"><i class="fas fa-pen-fancy" style="color:#7c3aed;margin-right:6px"></i>Script Editor</h4>
            <div style="display:flex;gap:6px">
              <button onclick="window._hgShowPresets()" class="hg-btn-sm" style="background:#f5f3ff;color:#7c3aed;border-color:#ddd6fe"><i class="fas fa-magic" style="margin-right:3px"></i>Presets</button>
              <button onclick="window._hgSaveAsTemplate()" class="hg-btn-sm" style="background:#f8fafc;color:#475569;border-color:#e2e8f0"><i class="fas fa-save" style="margin-right:3px"></i>Save Template</button>
            </div>
          </div>

          <textarea id="hg-script" rows="14" placeholder="Enter your video script here. The avatar will speak this text.

Tips:
  &bull; Keep under 2 minutes for best quality
  &bull; Use conversational language
  &bull; Mention Roof Manager features and benefits
  &bull; Add [pause] for natural pauses" style="width:100%;padding:12px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;font-family:inherit;resize:vertical;box-sizing:border-box;line-height:1.6"></textarea>

          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px">
            <span id="hg-word-count" style="font-size:11px;color:#94a3b8">0 words &bull; ~0s</span>
            <span id="hg-char-count" style="font-size:11px;color:#94a3b8"></span>
          </div>
        </div>

        <!-- Presets Panel (hidden) -->
        <div id="hg-presets-panel" style="display:none;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:12px;padding:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <h4 style="font-size:13px;font-weight:700;color:#6d28d9;margin:0">Script Presets</h4>
            <button onclick="document.getElementById('hg-presets-panel').style.display='none'" style="background:none;border:none;cursor:pointer;color:#6d28d9"><i class="fas fa-times"></i></button>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
            ${presetBtn('product_demo', 'fa-rocket', 'Product Demo', 'Full feature walkthrough')}
            ${presetBtn('social_ad', 'fa-bullhorn', '30s Social Ad', 'Quick social media ad')}
            ${presetBtn('contractor_pitch', 'fa-hard-hat', 'Contractor Pitch', 'Why roofers choose us')}
            ${presetBtn('homeowner_explainer', 'fa-home', 'Homeowner Explainer', 'Get roof measured from home')}
            ${presetBtn('report_walkthrough', 'fa-file-alt', 'Report Walkthrough', 'Walk through a roof report')}
            ${presetBtn('pricing_explainer', 'fa-dollar-sign', 'Pricing Explainer', 'Credit-based pricing')}
          </div>
        </div>

        <!-- Generate + Preview -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <div style="background:#1a2332;border-radius:12px;padding:24px;text-align:center;min-height:240px;display:flex;align-items:center;justify-content:center">
            <div id="hg-preview" style="color:#64748b;font-size:13px">
              <i class="fas fa-play-circle" style="font-size:48px;color:#475569;margin-bottom:12px;display:block"></i>
              Preview appears after generation
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:10px">
            <button onclick="window._hgGenerate()" id="hg-gen-btn" style="padding:14px;background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;box-shadow:0 4px 14px rgba(124,58,237,0.3);transition:all .2s" onmouseover="this.style.transform='translateY(-1px)'" onmouseout="this.style.transform='none'">
              <i class="fas fa-video" style="margin-right:8px"></i>Generate Video
            </button>
            <div id="hg-gen-status"></div>
            <div style="background:#f8fafc;border-radius:10px;padding:14px;flex:1">
              <h5 style="font-size:12px;font-weight:700;color:#1e293b;margin:0 0 8px 0"><i class="fas fa-info-circle" style="color:#3b82f6;margin-right:4px"></i>Tips</h5>
              <ul style="font-size:11px;color:#64748b;line-height:1.8;padding-left:14px;margin:0">
                <li>16:9 for YouTube/web, 9:16 for TikTok/Reels</li>
                <li>Scripts under 2min get best quality</li>
                <li>Videos take ~3-5 min to generate</li>
                <li>Use Brand Kit colors for consistency</li>
                <li>Test mode = free, watermarked preview</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>

    <style>
      .hg-label{display:block;font-size:11px;font-weight:600;color:#475569;margin-bottom:3px}
      .hg-input{width:100%;padding:7px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;margin-bottom:8px;box-sizing:border-box}
      .hg-btn-sm{padding:5px 10px;font-size:11px;border:1px solid #ddd;border-radius:6px;cursor:pointer;font-weight:600}
    </style>`;

    // Attach word counter
    const scriptEl = document.getElementById('hg-script');
    if (scriptEl) {
      scriptEl.addEventListener('input', () => {
        const words = scriptEl.value.trim().split(/\s+/).filter(Boolean).length;
        const secs = Math.round(words / 2.5);
        const chars = scriptEl.value.length;
        document.getElementById('hg-word-count').textContent = words + ' words \u2022 ~' + secs + 's estimated';
        document.getElementById('hg-char-count').textContent = chars + ' characters';
      });
    }
  }

  function renderAvatarGrid(list, selectedId) {
    return list.slice(0, 60).map(a => `
      <div onclick="window._hgSelectAvatar('${a.avatar_id}','${(a.avatar_name||'').replace(/'/g,"\\'")}')" id="hg-av-${a.avatar_id}" style="cursor:pointer;border-radius:8px;overflow:hidden;border:2px solid ${a.avatar_id===selectedId?'#7c3aed':'transparent'};transition:border .15s;aspect-ratio:1;position:relative" title="${a.avatar_name||'Avatar'}">
        ${a.preview_image_url ? `<img src="${a.preview_image_url}" style="width:100%;height:100%;object-fit:cover" loading="lazy">` : `<div style="width:100%;height:100%;background:#f1f5f9;display:flex;align-items:center;justify-content:center;font-size:10px;color:#94a3b8">${(a.avatar_name||'?').charAt(0)}</div>`}
        ${a.avatar_id===selectedId ? '<div style="position:absolute;top:2px;right:2px;width:14px;height:14px;background:#7c3aed;border-radius:50%;display:flex;align-items:center;justify-content:center"><i class="fas fa-check" style="color:#fff;font-size:7px"></i></div>' : ''}
      </div>`).join('');
  }


  /* ========================================================================
     VIDEO AGENT — Prompt-to-video
     ======================================================================== */
  async function renderAgent(el) {
    el.innerHTML = `
    <div style="max-width:920px;margin:0 auto">
      <div style="background:linear-gradient(135deg,#1e3a5f,#0f172a);border-radius:16px;padding:28px 32px;color:white;margin-bottom:24px;position:relative;overflow:hidden">
        <div style="position:absolute;right:30px;top:50%;transform:translateY(-50%);font-size:80px;opacity:0.06"><i class="fas fa-robot"></i></div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
          <i class="fas fa-robot" style="font-size:20px;color:#60a5fa"></i>
          <h3 style="font-size:18px;font-weight:800;margin:0">Video Agent</h3>
          <span style="padding:2px 8px;background:rgba(96,165,250,0.2);border:1px solid rgba(96,165,250,0.3);border-radius:12px;font-size:10px;color:#93c5fd">AI-Powered</span>
        </div>
        <p style="font-size:13px;opacity:0.8;margin:0">Describe what you want and AI automatically selects the best avatar, voice, scenes, and style. Just type a prompt!</p>
      </div>

      <div style="display:grid;grid-template-columns:1fr 360px;gap:20px">
        <!-- Prompt Area -->
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px">
          <label class="hg-label">Video Title</label>
          <input id="hg-agent-title" type="text" placeholder="e.g. Roof Manager Product Tour" class="hg-input">

          <label class="hg-label">Describe Your Video</label>
          <textarea id="hg-agent-prompt" rows="12" class="hg-input" style="resize:vertical;font-family:inherit;line-height:1.6" placeholder="Describe the video you want. Be specific about:
&bull; Who the presenter should look like
&bull; What message to convey
&bull; Target audience (contractors, homeowners)
&bull; Tone (professional, casual, energetic)
&bull; Length preference (30s, 60s, 2min)
&bull; Any text overlays or statistics"></textarea>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
            <div>
              <label class="hg-label">Aspect Ratio</label>
              <select id="hg-agent-aspect" class="hg-input"><option value="16:9">16:9 Landscape</option><option value="9:16">9:16 Portrait</option><option value="1:1">1:1 Square</option></select>
            </div>
            <div>
              <label class="hg-label">Category</label>
              <select id="hg-agent-cat" class="hg-input"><option value="marketing">Marketing</option><option value="social">Social Media</option><option value="training">Tutorial</option><option value="ad">Advertisement</option></select>
            </div>
          </div>

          <button onclick="window._hgGenerateAgent()" id="hg-agent-btn" style="width:100%;padding:14px;background:linear-gradient(135deg,#2563eb,#3b82f6);color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;box-shadow:0 4px 14px rgba(37,99,235,0.3)">
            <i class="fas fa-robot" style="margin-right:8px"></i>Generate with AI Agent
          </button>
          <div id="hg-agent-status" style="margin-top:10px"></div>
        </div>

        <!-- One-Click Prompts -->
        <div>
          <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:14px">
            <h4 style="font-size:13px;font-weight:700;color:#1e293b;margin:0 0 12px 0"><i class="fas fa-bolt" style="color:#f59e0b;margin-right:4px"></i>One-Click Prompts</h4>
            <div style="display:grid;gap:8px">
              ${agentPresetCard('product_overview','fa-rocket','#7c3aed','Product Overview','60s feature walkthrough')}
              ${agentPresetCard('social_30s','fa-hashtag','#ec4899','30s Social Ad','Instagram/TikTok ready')}
              ${agentPresetCard('contractor_testimonial','fa-hard-hat','#f59e0b','Contractor Story','Why roofers choose us')}
              ${agentPresetCard('how_it_works','fa-cogs','#2563eb','How It Works','Step-by-step explainer')}
              ${agentPresetCard('pricing_explainer','fa-dollar-sign','#059669','Pricing Explainer','Credit pricing breakdown')}
              ${agentPresetCard('before_after','fa-exchange-alt','#f97316','Before & After','Manual vs AI measurement')}
            </div>
          </div>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px">
            <h5 style="font-size:12px;font-weight:700;color:#1e293b;margin:0 0 8px 0"><i class="fas fa-magic" style="color:#a855f7;margin-right:4px"></i>How It Works</h5>
            <ul style="font-size:11px;color:#64748b;line-height:1.8;padding-left:14px;margin:0">
              <li>AI picks best avatar & voice for your prompt</li>
              <li>Generates scenes, transitions & overlays</li>
              <li>Results in 3-8 minutes</li>
              <li>Great for quick social media content</li>
              <li>3 free Video Agent credits available</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
    <style>.hg-label{display:block;font-size:11px;font-weight:600;color:#475569;margin-bottom:3px}.hg-input{width:100%;padding:7px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;margin-bottom:8px;box-sizing:border-box}</style>`;
  }


  /* ========================================================================
     INTERACTIVE AVATAR
     ======================================================================== */
  function renderInteractive(el) {
    el.innerHTML = `
    <div style="max-width:900px;margin:0 auto">
      <div style="background:linear-gradient(135deg,#059669,#10b981);border-radius:16px;padding:28px 32px;color:white;margin-bottom:24px;position:relative;overflow:hidden">
        <div style="position:absolute;right:30px;top:50%;transform:translateY(-50%);font-size:80px;opacity:0.06"><i class="fas fa-comments"></i></div>
        <h3 style="font-size:18px;font-weight:800;margin:0 0 6px 0"><i class="fas fa-comments" style="margin-right:8px"></i>Interactive Avatar</h3>
        <p style="font-size:13px;opacity:0.85;margin:0">Create live, two-way AI avatar experiences for customer support, sales demos, and training.</p>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px">
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px">
          <h4 style="font-size:14px;font-weight:700;color:#1e293b;margin:0 0 14px 0">Use Cases for Roof Manager</h4>
          ${interactiveUseCase('fa-headset','#7c3aed','Customer Support Avatar','Answer questions about roof reports in real-time')}
          ${interactiveUseCase('fa-chalkboard-teacher','#2563eb','Product Demo Avatar','Walk prospects through the platform live')}
          ${interactiveUseCase('fa-graduation-cap','#d97706','Training Assistant','Onboard new users with interactive guidance')}
          ${interactiveUseCase('fa-phone-volume','#059669','Sales Avatar','Qualify leads and answer pricing questions')}
        </div>
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px">
          <h4 style="font-size:14px;font-weight:700;color:#1e293b;margin:0 0 14px 0">Configuration</h4>
          <label class="hg-label">Knowledge Base</label>
          <textarea id="hg-ia-knowledge" rows="5" placeholder="Enter knowledge the avatar should know:
&bull; Pricing: $15/report standard
&bull; Features: AI satellite measurement, pitch analysis
&bull; Turnaround: 5-10 minutes
&bull; Coverage: All of Canada" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;font-family:inherit;margin-bottom:12px;box-sizing:border-box;resize:vertical"></textarea>
          <label class="hg-label">Avatar Style</label>
          <select style="width:100%;padding:7px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;margin-bottom:12px;box-sizing:border-box">
            <option>Professional &mdash; Business attire</option>
            <option>Casual &mdash; Friendly approachable</option>
            <option>Technical &mdash; Expert presenter</option>
          </select>
          <button onclick="window._hgSetupInteractive()" style="width:100%;padding:12px;background:linear-gradient(135deg,#059669,#10b981);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer"><i class="fas fa-play" style="margin-right:6px"></i>Create Interactive Session</button>
          <p style="font-size:10px;color:#94a3b8;margin-top:8px;text-align:center">Requires HeyGen Enterprise. <a href="https://docs.heygen.com/docs/streaming-api" target="_blank" style="color:#7c3aed">Learn more</a></p>
        </div>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px">
        <h4 style="font-size:14px;font-weight:700;color:#1e293b;margin:0 0 10px 0"><i class="fas fa-code" style="color:#7c3aed;margin-right:6px"></i>Embed on Your Website</h4>
        <p style="font-size:12px;color:#64748b;margin-bottom:10px">Once configured, embed the interactive avatar on your landing page:</p>
        <div style="background:#1e293b;border-radius:8px;padding:14px;font-family:monospace;font-size:11px;color:#a5f3fc;line-height:1.7;overflow-x:auto">&lt;script src="https://labs.heygen.com/guest/streaming-embed?share=YOUR_TOKEN"&gt;&lt;/script&gt;</div>
      </div>
    </div>
    <style>.hg-label{display:block;font-size:11px;font-weight:600;color:#475569;margin-bottom:3px}</style>`;
  }


  /* ========================================================================
     VIDEO TRANSLATE
     ======================================================================== */
  function renderTranslate(el) {
    el.innerHTML = `
    <div style="max-width:820px;margin:0 auto">
      <div style="background:linear-gradient(135deg,#d97706,#f59e0b);border-radius:16px;padding:28px 32px;color:white;margin-bottom:24px;position:relative;overflow:hidden">
        <div style="position:absolute;right:30px;top:50%;transform:translateY(-50%);font-size:80px;opacity:0.06"><i class="fas fa-language"></i></div>
        <h3 style="font-size:18px;font-weight:800;margin:0 0 6px 0"><i class="fas fa-language" style="margin-right:8px"></i>Video Translate</h3>
        <p style="font-size:13px;opacity:0.85;margin:0">Translate any video to 175+ languages with AI lip-sync. Perfect for international markets.</p>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">
          <div>
            <label class="hg-label">Video URL</label>
            <input id="hg-translate-url" type="url" placeholder="https://... paste video URL" class="hg-input">
            <label class="hg-label">Title</label>
            <input id="hg-translate-title" type="text" placeholder="Translated Video Title" class="hg-input">
            <label class="hg-label">Number of Speakers</label>
            <select id="hg-translate-speakers" class="hg-input"><option value="1">1</option><option value="2">2</option><option value="3">3+</option></select>
          </div>
          <div>
            <label class="hg-label">Target Language</label>
            <select id="hg-translate-lang" class="hg-input">
              <option value="fr">French</option><option value="es">Spanish</option><option value="de">German</option><option value="pt">Portuguese</option><option value="it">Italian</option><option value="zh">Chinese (Mandarin)</option><option value="ja">Japanese</option><option value="ko">Korean</option><option value="ar">Arabic</option><option value="hi">Hindi</option><option value="nl">Dutch</option><option value="pl">Polish</option><option value="uk">Ukrainian</option><option value="tr">Turkish</option><option value="vi">Vietnamese</option><option value="ru">Russian</option><option value="th">Thai</option><option value="id">Indonesian</option>
            </select>
            <label class="hg-label" style="margin-top:8px">Options</label>
            <div style="display:flex;flex-direction:column;gap:6px">
              <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#475569;cursor:pointer"><input type="checkbox" id="hg-translate-lipsync" checked> Enable lip-sync</label>
              <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#475569;cursor:pointer"><input type="checkbox" id="hg-translate-audio-only"> Audio-only (no lip-sync)</label>
            </div>
          </div>
        </div>
        <button onclick="window._hgTranslate()" id="hg-translate-btn" style="width:100%;padding:14px;background:linear-gradient(135deg,#d97706,#f59e0b);color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer"><i class="fas fa-language" style="margin-right:6px"></i>Translate Video</button>
        <div id="hg-translate-status" style="margin-top:10px"></div>
        <p style="font-size:10px;color:#94a3b8;text-align:center;margin-top:8px">Requires Video Translate credits. <a href="https://docs.heygen.com/reference/video-translate" target="_blank" style="color:#7c3aed">API Docs</a></p>
      </div>
    </div>
    <style>.hg-label{display:block;font-size:11px;font-weight:600;color:#475569;margin-bottom:3px}.hg-input{width:100%;padding:7px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;margin-bottom:8px;box-sizing:border-box}</style>`;
  }


  /* ========================================================================
     PHOTO AVATAR
     ======================================================================== */
  function renderPhotoAvatar(el) {
    el.innerHTML = `
    <div style="max-width:820px;margin:0 auto">
      <div style="background:linear-gradient(135deg,#e11d48,#f43f5e);border-radius:16px;padding:28px 32px;color:white;margin-bottom:24px;position:relative;overflow:hidden">
        <div style="position:absolute;right:30px;top:50%;transform:translateY(-50%);font-size:80px;opacity:0.06"><i class="fas fa-camera"></i></div>
        <h3 style="font-size:18px;font-weight:800;margin:0 0 6px 0"><i class="fas fa-camera" style="margin-right:8px"></i>Photo Avatar</h3>
        <p style="font-size:13px;opacity:0.85;margin:0">Create a custom AI avatar from a single photo. Upload a headshot and generate videos with your own digital spokesperson.</p>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px">
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px;text-align:center">
          <label class="hg-label" style="text-align:left">Photo URL</label>
          <input id="hg-photo-url" type="url" placeholder="https://... headshot image URL" class="hg-input">
          <label class="hg-label" style="text-align:left">Avatar Name</label>
          <input id="hg-photo-name" type="text" placeholder="e.g. Roof Manager Spokesperson" class="hg-input">
          <div style="border:2px dashed #e11d48;border-radius:12px;padding:30px;margin:10px 0;background:#fef2f2">
            <i class="fas fa-user-plus" style="font-size:36px;color:#e11d48;margin-bottom:10px;display:block"></i>
            <p style="font-size:13px;font-weight:600;color:#be123c;margin:0 0 4px 0">Upload via URL above</p>
            <p style="font-size:11px;color:#f87171">Clear headshot, neutral expression, good lighting</p>
          </div>
          <button onclick="window._hgCreatePhotoAvatar()" id="hg-photo-btn" style="width:100%;padding:12px;background:linear-gradient(135deg,#e11d48,#f43f5e);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer"><i class="fas fa-camera" style="margin-right:6px"></i>Create Photo Avatar</button>
          <div id="hg-photo-status" style="margin-top:8px"></div>
        </div>
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px">
          <h4 style="font-size:14px;font-weight:700;color:#1e293b;margin:0 0 14px 0">Create Your Spokesperson</h4>
          <p style="font-size:13px;color:#64748b;line-height:1.7;margin-bottom:16px">Upload a photo to create a custom AI avatar for consistent brand representation across all your marketing and tutorial videos.</p>
          <div style="display:grid;gap:8px;margin-bottom:16px">
            ${photoUseCase('CEO Welcome Video','Personal greeting for new users')}
            ${photoUseCase('Sales Rep Avatar','Consistent face across all pitches')}
            ${photoUseCase('Support Representative','Branded help & tutorial videos')}
            ${photoUseCase('Brand Ambassador','Social media content at scale')}
          </div>
          <h5 style="font-size:12px;font-weight:700;color:#1e293b;margin-bottom:6px">Photo Requirements:</h5>
          <ul style="font-size:11px;color:#64748b;padding-left:14px;margin:0;line-height:1.8">
            <li>Front-facing headshot</li>
            <li>Good lighting, neutral background</li>
            <li>1024x1024px minimum resolution</li>
            <li>No sunglasses, hats, or obstructions</li>
          </ul>
        </div>
      </div>
    </div>
    <style>.hg-label{display:block;font-size:11px;font-weight:600;color:#475569;margin-bottom:3px}.hg-input{width:100%;padding:7px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;margin-bottom:8px;box-sizing:border-box}</style>`;
  }


  /* ========================================================================
     BRAND KIT
     ======================================================================== */
  async function renderBrandKit(el) {
    // Load avatars/voices if not cached
    if (!avatars.length) {
      try {
        const [aData, vData] = await Promise.all([hgFetch(API + '/avatars'), hgFetch(API + '/voices')]);
        if (!aData._error) avatars = aData.avatars || [];
        if (!vData._error) voices = vData.voices || [];
      } catch(e) {}
    }
    const bk = brandKit;
    const engVoices = voices.filter(v => v.language && v.language.toLowerCase().includes('en'));

    el.innerHTML = `
    <div style="max-width:920px;margin:0 auto">
      <div style="background:linear-gradient(135deg,#7c3aed,#6d28d9);border-radius:16px;padding:28px 32px;color:white;margin-bottom:24px">
        <h3 style="font-size:18px;font-weight:800;margin:0 0 6px 0"><i class="fas fa-palette" style="margin-right:8px"></i>Brand Kit</h3>
        <p style="font-size:13px;opacity:0.85;margin:0">Set your brand colors, logo, and defaults. Applied to all new videos automatically.</p>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px">
          <h4 style="font-size:14px;font-weight:700;color:#1e293b;margin:0 0 14px 0"><i class="fas fa-tint" style="color:#7c3aed;margin-right:6px"></i>Brand Colors</h4>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
            <div><label class="hg-label">Primary</label><input id="bk-primary" type="color" value="${bk.primary||'#0d9668'}" style="width:100%;height:40px;border:1px solid #d1d5db;border-radius:6px;cursor:pointer;box-sizing:border-box"></div>
            <div><label class="hg-label">Secondary</label><input id="bk-secondary" type="color" value="${bk.secondary||'#1a2332'}" style="width:100%;height:40px;border:1px solid #d1d5db;border-radius:6px;cursor:pointer;box-sizing:border-box"></div>
            <div><label class="hg-label">Background</label><input id="bk-bg" type="color" value="${bk.bg_color||'#ffffff'}" style="width:100%;height:40px;border:1px solid #d1d5db;border-radius:6px;cursor:pointer;box-sizing:border-box"></div>
            <div><label class="hg-label">Text</label><input id="bk-text" type="color" value="${bk.text_color||'#1a1a2e'}" style="width:100%;height:40px;border:1px solid #d1d5db;border-radius:6px;cursor:pointer;box-sizing:border-box"></div>
          </div>
          <label class="hg-label">Logo URL</label><input id="bk-logo" type="url" value="${bk.logo_url||''}" placeholder="https://roofmanager.ca/logo.png" class="hg-input">
          <label class="hg-label">Company Name</label><input id="bk-company" type="text" value="${bk.company||'Roof Manager'}" class="hg-input">
          <label class="hg-label">Tagline</label><input id="bk-tagline" type="text" value="${bk.tagline||"Canada's #1 AI Roof Measurement Platform"}" class="hg-input">
          <button onclick="window._hgSaveBrandKit()" style="width:100%;padding:10px;background:#7c3aed;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer"><i class="fas fa-save" style="margin-right:4px"></i>Save Brand Kit</button>
        </div>
        <div>
          <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:14px">
            <h4 style="font-size:14px;font-weight:700;color:#1e293b;margin:0 0 14px 0"><i class="fas fa-eye" style="color:#3b82f6;margin-right:6px"></i>Preview</h4>
            <div style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
              <div style="background:${bk.primary||'#0d9668'};padding:16px;text-align:center">
                <div style="font-size:18px;font-weight:800;color:#fff">${bk.company||'Roof Manager'}</div>
                <div style="font-size:12px;color:rgba(255,255,255,0.8)">${bk.tagline||"Canada's #1 AI Roof Measurement Platform"}</div>
              </div>
              <div style="background:${bk.bg_color||'#ffffff'};padding:20px;text-align:center">
                <p style="color:${bk.text_color||'#1a1a2e'};font-size:14px">Your video content appears here</p>
                <button style="padding:8px 16px;background:${bk.secondary||'#1a2332'};color:#fff;border:none;border-radius:6px;font-size:12px;cursor:default">Call to Action</button>
              </div>
            </div>
          </div>
          <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px">
            <h4 style="font-size:14px;font-weight:700;color:#1e293b;margin:0 0 10px 0"><i class="fas fa-font" style="color:#6d28d9;margin-right:6px"></i>Default Voice & Avatar</h4>
            <label class="hg-label">Default Avatar</label>
            <select id="bk-avatar" class="hg-input"><option value="">-- Select --</option>${avatars.slice(0,60).map(a=>`<option value="${a.avatar_id}" ${bk.default_avatar===a.avatar_id?'selected':''}>${a.avatar_name}</option>`).join('')}</select>
            <label class="hg-label">Default Voice</label>
            <select id="bk-voice" class="hg-input"><option value="">-- Select --</option>${engVoices.slice(0,60).map(v=>`<option value="${v.voice_id}" ${bk.default_voice===v.voice_id?'selected':''}>${v.name} (${v.gender||''})</option>`).join('')}</select>
          </div>
        </div>
      </div>
    </div>
    <style>.hg-label{display:block;font-size:11px;font-weight:600;color:#475569;margin-bottom:3px}.hg-input{width:100%;padding:7px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;margin-bottom:8px;box-sizing:border-box}</style>`;
  }


  /* ========================================================================
     TEMPLATES
     ======================================================================== */
  async function renderTemplates(el) {
    const data = await hgFetch(API + '/templates');
    if (data._error) { el.innerHTML = errBox(data.error); return; }
    const tmpls = data.templates || [];

    const presetTemplates = [
      { name:'Getting Started Guide', category:'training', description:'New user onboarding walkthrough', script_template: SCRIPT_PRESETS.product_demo?.script||'', preset:true },
      { name:'How to Read Your Report', category:'training', description:'Report sections explained', preset:true },
      { name:'30-Second Social Ad', category:'social', description:'Quick attention-grabber for social', script_template: SCRIPT_PRESETS.social_ad?.script||'', preset:true },
      { name:'Contractor Value Proposition', category:'marketing', description:'Why roofers choose Roof Manager', script_template: SCRIPT_PRESETS.contractor_pitch?.script||'', preset:true },
    ];

    el.innerHTML = `
    <div style="max-width:1000px;margin:0 auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <h3 style="font-size:18px;font-weight:800;color:#1e293b"><i class="fas fa-clone" style="color:#a855f7;margin-right:8px"></i>Video Templates</h3>
        <button onclick="document.getElementById('hg-new-tpl').style.display=document.getElementById('hg-new-tpl').style.display==='none'?'block':'none'" style="padding:8px 16px;background:#7c3aed;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer"><i class="fas fa-plus" style="margin-right:4px"></i>New Template</button>
      </div>
      <div id="hg-new-tpl" style="display:none;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:12px;padding:18px;margin-bottom:20px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
          <input id="hg-tpl-name" placeholder="Template name" class="hg-input">
          <select id="hg-tpl-cat" class="hg-input"><option value="marketing">Marketing</option><option value="social">Social Media</option><option value="training">Tutorial</option><option value="ad">Advertisement</option><option value="report_walkthrough">Report Walkthrough</option></select>
        </div>
        <textarea id="hg-tpl-desc" rows="2" placeholder="Description" class="hg-input" style="font-family:inherit"></textarea>
        <textarea id="hg-tpl-script" rows="4" placeholder="Script template &mdash; use {{address}}, {{total_area}}, {{pitch}} as placeholders" class="hg-input" style="font-family:inherit"></textarea>
        <button onclick="window._hgSaveTemplate()" style="padding:8px 16px;background:#7c3aed;color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer"><i class="fas fa-save" style="margin-right:4px"></i>Save Template</button>
      </div>

      <h4 style="font-size:14px;font-weight:700;color:#475569;margin-bottom:10px">Built-in Presets</h4>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px;margin-bottom:24px">
        ${presetTemplates.map(t => `
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <div style="width:32px;height:32px;background:#f5f3ff;border-radius:8px;display:flex;align-items:center;justify-content:center"><i class="fas fa-clone" style="color:#7c3aed;font-size:12px"></i></div>
            <div><div style="font-size:13px;font-weight:700;color:#1e293b">${t.name}</div><div style="font-size:10px;color:#94a3b8">${t.category}</div></div>
          </div>
          <p style="font-size:11px;color:#64748b;margin:0 0 10px 0">${t.description}</p>
          <button onclick="window._hgTab('studio');setTimeout(()=>{const s=document.getElementById('hg-script');if(s)s.value=atob('${btoa(t.script_template||'')}');s&&s.dispatchEvent(new Event('input'))},600)" style="width:100%;padding:6px;font-size:11px;background:#7c3aed;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600">Use in Studio</button>
        </div>`).join('')}
      </div>

      <h4 style="font-size:14px;font-weight:700;color:#475569;margin-bottom:10px">Your Templates (${tmpls.length})</h4>
      ${tmpls.length === 0 ? '<p style="color:#94a3b8;text-align:center;padding:30px;font-size:13px">No custom templates yet.</p>' :
        `<div style="display:grid;gap:10px">${tmpls.map(t => `
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;display:flex;justify-content:space-between;align-items:center">
          <div style="flex:1"><div style="font-size:14px;font-weight:700;color:#1e293b">${t.name}</div><div style="font-size:11px;color:#94a3b8">${t.category} &bull; Used ${t.usage_count||0}x${t.description?' &bull; '+t.description:''}</div></div>
          <div style="display:flex;gap:6px">
            <button onclick="window._hgUseTemplate(${t.id})" style="padding:6px 12px;font-size:11px;background:#7c3aed;color:#fff;border:none;border-radius:4px;cursor:pointer">Use</button>
            <button onclick="window._hgDeleteTemplate(${t.id})" style="padding:6px 10px;font-size:11px;background:#fef2f2;color:#dc2626;border:1px solid #fecaca;border-radius:4px;cursor:pointer"><i class="fas fa-trash"></i></button>
          </div>
        </div>`).join('')}</div>`}
    </div>
    <style>.hg-input{width:100%;padding:7px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;margin-bottom:8px;box-sizing:border-box}</style>`;
  }


  /* ========================================================================
     MY VIDEOS
     ======================================================================== */
  async function renderVideos(el) {
    const data = await hgFetch(API + '/videos?limit=50');
    if (data._error) { el.innerHTML = errBox(data.error); return; }
    const videos = data.videos || [];

    if (videos.length === 0) {
      el.innerHTML = `<div style="text-align:center;padding:80px;color:#94a3b8">
        <i class="fas fa-film" style="font-size:56px;color:#d1d5db;margin-bottom:16px;display:block"></i>
        <p style="font-size:18px;font-weight:700;margin-bottom:6px">No Videos Yet</p>
        <p style="font-size:13px;margin-bottom:20px">Create your first video using AI Studio or Video Agent</p>
        <button onclick="window._hgTab('studio')" style="padding:10px 20px;background:#7c3aed;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer"><i class="fas fa-plus" style="margin-right:4px"></i>Create Video</button>
      </div>`;
      return;
    }

    // Category filter tabs
    const cats = [...new Set(videos.map(v => v.category).filter(Boolean))];

    el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h3 style="font-size:18px;font-weight:800;color:#1e293b"><i class="fas fa-play-circle" style="color:#7c3aed;margin-right:8px"></i>My Videos (${data.total || videos.length})</h3>
      <div style="display:flex;gap:6px">
        <button onclick="window._hgTab('videos')" style="padding:6px 12px;font-size:12px;background:#f1f5f9;color:#475569;border:none;border-radius:6px;cursor:pointer"><i class="fas fa-sync-alt" style="margin-right:4px"></i>Refresh</button>
        <button onclick="window._hgSyncProcessing()" style="padding:6px 12px;font-size:12px;background:#eff6ff;color:#2563eb;border:none;border-radius:6px;cursor:pointer"><i class="fas fa-bolt" style="margin-right:4px"></i>Sync Processing</button>
      </div>
    </div>
    ${cats.length > 1 ? `<div style="display:flex;gap:4px;margin-bottom:16px;flex-wrap:wrap">
      <button onclick="window._hgFilterVideos('')" style="padding:4px 10px;font-size:11px;background:#7c3aed;color:#fff;border:none;border-radius:12px;cursor:pointer">All</button>
      ${cats.map(c => `<button onclick="window._hgFilterVideos('${c}')" style="padding:4px 10px;font-size:11px;background:#f1f5f9;color:#475569;border:none;border-radius:12px;cursor:pointer">${c}</button>`).join('')}
    </div>` : ''}
    <div id="hg-video-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px">
      ${videos.map(v => videoCard(v)).join('')}
    </div>`;
  }

  function videoCard(v) {
    return `
    <div class="hg-video-card" data-category="${v.category||''}" style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;transition:box-shadow .2s" onmouseover="this.style.boxShadow='0 4px 20px rgba(0,0,0,0.08)'" onmouseout="this.style.boxShadow='none'">
      <div style="height:160px;background:#1a2332;display:flex;align-items:center;justify-content:center;position:relative">
        ${v.thumbnail_url ? `<img src="${v.thumbnail_url}" style="width:100%;height:100%;object-fit:cover">` : '<i class="fas fa-film" style="font-size:32px;color:#475569"></i>'}
        ${v.video_url ? `<a href="${v.video_url}" target="_blank" style="position:absolute;width:44px;height:44px;background:rgba(124,58,237,0.9);border-radius:50%;display:flex;align-items:center;justify-content:center;text-decoration:none"><i class="fas fa-play" style="color:#fff;font-size:16px;margin-left:2px"></i></a>` : ''}
        <span style="position:absolute;top:8px;right:8px;padding:3px 10px;border-radius:12px;font-size:10px;font-weight:600;${statusStyle(v.status)}">${v.status}</span>
        ${v.duration_seconds ? `<span style="position:absolute;bottom:8px;right:8px;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;background:rgba(0,0,0,0.7);color:#fff">${Math.round(v.duration_seconds)}s</span>` : ''}
      </div>
      <div style="padding:12px">
        <div style="font-size:13px;font-weight:700;color:#1e293b;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${v.title}</div>
        <div style="font-size:10px;color:#94a3b8;margin-bottom:10px">${v.category||'N/A'} &bull; ${v.avatar_name||'AI Agent'} &bull; ${new Date(v.created_at).toLocaleDateString()}</div>
        <div style="display:flex;gap:6px">
          ${v.status === 'processing' ? `<button onclick="window._hgPollStatus('${v.video_id}')" style="flex:1;padding:6px;font-size:11px;background:#eff6ff;color:#2563eb;border:1px solid #bfdbfe;border-radius:4px;cursor:pointer;font-weight:500"><i class="fas fa-sync" style="margin-right:3px"></i>Check</button>` : ''}
          ${v.video_url ? `<a href="${v.video_url}" target="_blank" style="flex:1;padding:6px;font-size:11px;background:#f0fdf4;color:#059669;border:1px solid #bbf7d0;border-radius:4px;text-align:center;text-decoration:none;font-weight:500"><i class="fas fa-download" style="margin-right:3px"></i>Download</a>` : ''}
          <button onclick="window._hgDeleteVideo(${v.id})" style="padding:6px 10px;font-size:11px;background:#fef2f2;color:#dc2626;border:1px solid #fecaca;border-radius:4px;cursor:pointer"><i class="fas fa-trash"></i></button>
        </div>
      </div>
    </div>`;
  }


  /* ========================================================================
     ACTION HANDLERS
     ======================================================================== */

  const SCRIPT_PRESETS = {
    product_demo: { title:'Roof Manager Product Demo', category:'marketing', script:"Welcome to Roof Manager \u2014 Canada\u2019s leading AI-powered roof measurement platform! In just minutes, our advanced satellite imagery analysis delivers professional-grade roof reports that used to take hours of manual work. Here\u2019s what you get: precise area measurements in square feet, detailed pitch analysis for every roof plane, complete edge measurements \u2014 eave, ridge, hip, and valley \u2014 all with linear foot totals. Plus, a professional architectural diagram and waste factor calculations. Whether you\u2019re a roofing contractor, insurance adjuster, or property manager, Roof Manager saves you time and money while delivering accuracy you can trust. Try it today at roofmanager.ca!" },
    social_ad: { title:'Roof Manager \u2014 30 Second Ad', category:'social', script:"Still climbing ladders to measure roofs? There\u2019s a better way. Roof Manager uses satellite imagery and artificial intelligence to measure any roof in minutes \u2014 not hours. Get precise area, pitch, edge measurements, and professional diagrams instantly. Trusted by hundreds of Canadian roofing contractors. Your first report is just 15 dollars. Try Roof Manager today!" },
    contractor_pitch: { title:'Why Contractors Choose Roof Manager', category:'marketing', script:"Hey there! If you\u2019re a roofing contractor, you know how time-consuming roof measurements can be. Climbing up, measuring by hand, doing the math \u2014 it eats into your profit margin. That\u2019s why leading contractors across Canada are switching to Roof Manager. Our AI analyzes satellite imagery to deliver accurate measurements in minutes. You get total area, pitch analysis, edge lengths, waste calculations, and a professional diagram \u2014 all in a beautiful PDF you can share with clients. Your team can order reports from anywhere, anytime. No ladders. No tape measures. No guesswork. Just accurate data that helps you quote faster and win more jobs." },
    homeowner_explainer: { title:'Homeowners \u2014 Get Your Roof Measured', category:'marketing', script:"Planning a roof repair or replacement? Getting an accurate measurement is the first step to a fair quote. With Roof Manager, you can get a professional roof measurement report without anyone climbing on your roof. We use advanced satellite imagery and AI technology to measure your roof precisely \u2014 total area, slope, and all the details a contractor needs. Simply enter your address, and within minutes you\u2019ll have a comprehensive report you can share with multiple contractors for competitive quotes. It\u2019s affordable, fast, and incredibly accurate. Visit roofmanager.ca to get started!" },
    report_walkthrough: { title:'Roof Report Walkthrough', category:'report_walkthrough', script:"Let me walk you through your Roof Manager roof measurement report. Page one shows the property overview with the total roof area, predominant pitch, and waste factor calculation. The diagram section gives you a bird\u2019s eye view of all roof planes with color-coded edges \u2014 green for eaves, red for ridges, amber for hips, and blue for valleys. Each edge is measured in linear feet. The material estimation section calculates everything you need: shingle bundles, underlayment rolls, ridge cap, starter strip, and drip edge quantities. This report gives you professional-grade data for accurate quoting." },
    pricing_explainer: { title:'Roof Manager Pricing', category:'marketing', script:"Let me break down our simple, transparent pricing. At Roof Manager, we use a credit-based system. Each roof measurement report costs one credit. You can buy credit packs at volume discounts \u2014 the more you buy, the less each report costs. Compare that to hiring someone at 100 to 200 dollars per roof for manual measurements, and our reports at just 15 to 25 dollars each represent massive savings. Plus, you get instant delivery, professional PDF quality, and no site visit needed. For enterprise users ordering hundreds of reports, we offer custom pricing packages. Visit roofmanager.ca to see current pricing!" },
  };

  const AGENT_PRESETS = {
    product_overview: "Create a professional 60-second marketing video for Roof Manager, Canada's #1 AI-powered roof measurement platform. The presenter should be a professional-looking person in business attire. They should explain how the platform uses satellite imagery and AI to generate accurate roof measurement reports in minutes. Highlight key features: precise area measurements, pitch analysis, edge measurements, architectural diagrams, and waste factor calculations. End with a call to action to visit roofmanager.ca.",
    social_30s: "Create a fast-paced 30-second social media ad for Roof Manager. Start with a hook: 'Still measuring roofs by hand?' Show benefits: AI satellite measurements, instant PDF reports, save hours. Use quick text overlays. Format: 9:16 portrait for TikTok/Reels. End with: 'Try Roof Manager \u2014 first report just $15!'",
    contractor_testimonial: "Create a testimonial-style video where a professional roofing contractor explains why they switched to Roof Manager. Mention: time savings, accuracy, professional reports, order from anywhere. Authentic, conversational tone. 60 seconds, landscape.",
    how_it_works: "Create a step-by-step 'How It Works' explainer for Roof Manager. Step 1: Enter address. Step 2: AI analyzes satellite imagery. Step 3: Receive report in minutes. Show what's included. Professional, clear. Text overlays for steps. 90 seconds, landscape.",
    pricing_explainer: "Create a pricing explainer for Roof Manager. Credit-based system, volume discounts. Compare to manual costs ($100-200+ per roof vs $15-25 per report). Value proposition: instant delivery, professional quality, no site visit. Transparent, friendly. 60 seconds.",
    before_after: "Create a before/after comparison for Roof Manager. Before: contractor on ladder with tape measure, hours of work, risk of errors. After: same contractor at desk, orders report, gets PDF in minutes. Message: Let AI do the measuring. 45 seconds, landscape.",
  };

  /* ── Avatar & Voice selection ── */
  window._hgSelectAvatar = function(id, name) {
    document.querySelectorAll('[id^="hg-av-"]').forEach(el => { el.style.borderColor = 'transparent'; const chk = el.querySelector('.hg-check'); if(chk) chk.remove(); });
    const el = document.getElementById('hg-av-' + id);
    if (el) {
      el.style.borderColor = '#7c3aed';
      el.insertAdjacentHTML('beforeend', '<div class="hg-check" style="position:absolute;top:2px;right:2px;width:14px;height:14px;background:#7c3aed;border-radius:50%;display:flex;align-items:center;justify-content:center"><i class="fas fa-check" style="color:#fff;font-size:7px"></i></div>');
    }
    const nameEl = document.getElementById('hg-selected-avatar-name');
    if (nameEl) nameEl.textContent = name || id;
  };

  window._hgFilterAvatars = function(q) {
    q = q.toLowerCase();
    const grid = document.getElementById('hg-avatar-grid');
    if (!grid) return;
    const selectedId = brandKit.default_avatar || avatars[0]?.avatar_id || '';
    const filtered = q ? avatars.filter(a => (a.avatar_name||'').toLowerCase().includes(q)) : avatars;
    grid.innerHTML = renderAvatarGrid(filtered, selectedId);
  };

  window._hgFilterVoices = function() {
    const lang = document.getElementById('hg-voice-lang')?.value || 'en';
    const sel = document.getElementById('hg-voice');
    if (!sel) return;
    const filtered = lang === 'all' ? voices : voices.filter(v => v.language && v.language.toLowerCase().includes(lang));
    sel.innerHTML = filtered.slice(0, 100).map(v => '<option value="' + v.voice_id + '">' + v.name + ' (' + (v.gender||'') + ')</option>').join('');
  };

  window._hgShowPresets = function() { const p = document.getElementById('hg-presets-panel'); if(p) p.style.display = p.style.display === 'none' ? 'block' : 'none'; };
  window._hgFillPreset = function(key) { const p = SCRIPT_PRESETS[key]; if(!p) return; const t=document.getElementById('hg-title'),c=document.getElementById('hg-category'),s=document.getElementById('hg-script'); if(t)t.value=p.title; if(c)c.value=p.category; if(s){s.value=p.script;s.dispatchEvent(new Event('input'));} document.getElementById('hg-presets-panel').style.display='none'; };
  window._hgFillAgentPreset = function(key) { const p = AGENT_PRESETS[key]; if(!p) return; const t=document.getElementById('hg-agent-title'),pr=document.getElementById('hg-agent-prompt'); if(t) t.value=key.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())+' \u2014 Roof Manager'; if(pr) pr.value=p; };
  window._hgSetupInteractive = function() { notify('Interactive Avatar','Interactive Avatar streaming requires HeyGen Enterprise plan. Contact HeyGen support to enable.','info'); };

  /* ── Generate video via Studio ── */
  window._hgGenerate = async function() {
    const btn=document.getElementById('hg-gen-btn'), status=document.getElementById('hg-gen-status');
    const title=document.getElementById('hg-title')?.value?.trim(), script=document.getElementById('hg-script')?.value?.trim(), voice=document.getElementById('hg-voice')?.value;
    if (!title||!script) { status.innerHTML=msg('Title and script are required','error'); return; }

    const selectedEl = document.querySelector('[id^="hg-av-"][style*="rgb(124, 58, 237)"]') || document.querySelector('[id^="hg-av-"][style*="#7c3aed"]');
    const avatarId = selectedEl?.id?.replace('hg-av-','') || avatars[0]?.avatar_id;
    const avatarName = avatars.find(a=>a.avatar_id===avatarId)?.avatar_name || '';

    btn.disabled=true; btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> Generating...';
    status.innerHTML=msg('Submitting to HeyGen API...','info');

    try {
      const aspectMap={'16:9':'1920x1080','9:16':'1080x1920','1:1':'1080x1080'};
      const aspect=document.getElementById('hg-aspect')?.value||'16:9';
      const bgType=document.getElementById('hg-bg-type')?.value||'color';
      const testMode = document.getElementById('hg-test-mode')?.checked || false;

      const payload = {
        title, category: document.getElementById('hg-category')?.value||'marketing',
        avatar_id: avatarId, avatar_name: avatarName,
        voice_id: voice, script,
        dimension: aspectMap[aspect]||'1920x1080', aspect_ratio: aspect,
        speed: parseFloat(document.getElementById('hg-speed')?.value||'1.0'),
        background_type: bgType,
        background_color: document.getElementById('hg-bg')?.value||'#ffffff',
        background_image_url: bgType!=='color' ? document.getElementById('hg-bg-url')?.value : undefined,
        test_mode: testMode,
      };

      const resp = await fetch(API+'/generate',{method:'POST',headers:hdrs(),body:JSON.stringify(payload)});
      const data = await resp.json();
      if (data.success) {
        status.innerHTML=msg('Video generation started! ID: <strong>'+data.video_id+'</strong>. Takes ~3-5 minutes.','success');
        startPolling(data.video_id);
      } else {
        status.innerHTML=msg('Failed: '+(data.error||JSON.stringify(data.detail||data)),'error');
      }
    } catch(e) { status.innerHTML=msg('Error: '+e.message,'error'); }
    btn.disabled=false; btn.innerHTML='<i class="fas fa-video" style="margin-right:8px"></i>Generate Video';
  };

  /* ── Generate via Agent ── */
  window._hgGenerateAgent = async function() {
    const btn=document.getElementById('hg-agent-btn'), status=document.getElementById('hg-agent-status');
    const title=document.getElementById('hg-agent-title')?.value?.trim(), prompt=document.getElementById('hg-agent-prompt')?.value?.trim();
    if (!title||!prompt) { status.innerHTML=msg('Title and prompt are required','error'); return; }
    btn.disabled=true; btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> Generating...';
    try {
      const resp = await fetch(API+'/generate-agent',{method:'POST',headers:hdrs(),body:JSON.stringify({title,prompt,category:document.getElementById('hg-agent-cat')?.value||'marketing',aspect_ratio:document.getElementById('hg-agent-aspect')?.value||'16:9'})});
      const data = await resp.json();
      if (data.success) {
        status.innerHTML=msg('Video Agent started! ID: <strong>'+data.video_id+'</strong>. Takes 3-8 min.','success');
        startPolling(data.video_id);
      } else { status.innerHTML=msg('Failed: '+(data.error||JSON.stringify(data.detail||data)),'error'); }
    } catch(e) { status.innerHTML=msg('Error: '+e.message,'error'); }
    btn.disabled=false; btn.innerHTML='<i class="fas fa-robot" style="margin-right:8px"></i>Generate with AI Agent';
  };

  /* ── Video Translate ── */
  window._hgTranslate = async function() {
    const btn=document.getElementById('hg-translate-btn'), status=document.getElementById('hg-translate-status');
    const url=document.getElementById('hg-translate-url')?.value?.trim();
    const lang=document.getElementById('hg-translate-lang')?.value;
    const title=document.getElementById('hg-translate-title')?.value?.trim()||'Translated Video';
    const audioOnly=document.getElementById('hg-translate-audio-only')?.checked||false;
    const speakers=parseInt(document.getElementById('hg-translate-speakers')?.value||'1');
    if (!url) { status.innerHTML=msg('Video URL is required','error'); return; }
    btn.disabled=true; btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> Translating...';
    try {
      const resp = await fetch(API+'/translate',{method:'POST',headers:hdrs(),body:JSON.stringify({video_url:url,output_language:lang,title,translate_audio_only:audioOnly,speaker_num:speakers})});
      const data = await resp.json();
      if (data.success) { status.innerHTML=msg('Translation submitted! ID: '+(data.video_translate_id||JSON.stringify(data))+'. Check My Videos for progress.','success'); }
      else { status.innerHTML=msg('Failed: '+(data.error||JSON.stringify(data)),'error'); }
    } catch(e) { status.innerHTML=msg('Error: '+e.message,'error'); }
    btn.disabled=false; btn.innerHTML='<i class="fas fa-language" style="margin-right:6px"></i>Translate Video';
  };

  /* ── Photo Avatar ── */
  window._hgCreatePhotoAvatar = async function() {
    const btn=document.getElementById('hg-photo-btn'), status=document.getElementById('hg-photo-status');
    const url=document.getElementById('hg-photo-url')?.value?.trim();
    const name=document.getElementById('hg-photo-name')?.value?.trim()||'Custom Avatar';
    if (!url) { status.innerHTML=msg('Photo URL is required','error'); return; }
    btn.disabled=true; btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> Creating...';
    try {
      const resp = await fetch(API+'/photo-avatar',{method:'POST',headers:hdrs(),body:JSON.stringify({image_url:url,name})});
      const data = await resp.json();
      if (data.success) { status.innerHTML=msg('Photo avatar creation started! Takes ~5 minutes.','success'); }
      else { status.innerHTML=msg('Failed: '+(data.error||JSON.stringify(data)),'error'); }
    } catch(e) { status.innerHTML=msg('Error: '+e.message,'error'); }
    btn.disabled=false; btn.innerHTML='<i class="fas fa-camera" style="margin-right:6px"></i>Create Photo Avatar';
  };

  /* ── Quota ── */
  window._hgCheckQuota = async function() {
    const data = await hgFetch(API + '/remaining-quota');
    if (data._error) { notify('Quota Error', data.error||'Failed to check','error'); return; }
    const q = data;
    const details = q.details || {};
    notify('HeyGen Credits', 'Paid: '+(q.remaining_quota??0)+' | Free: Avatar IV('+
      (details.avatar_iv_free_credit||0)+'), Video Agent('+
      (details.video_agent_v2_free_video||0)+'), Images('+
      (details.image_free_credit||0)+'), B-Roll('+
      (details.b_roll_free_credit||0)+')', 'info');
  };

  /* ── Brand Kit ── */
  window._hgSaveBrandKit = function() {
    brandKit = {
      primary: document.getElementById('bk-primary')?.value,
      secondary: document.getElementById('bk-secondary')?.value,
      bg_color: document.getElementById('bk-bg')?.value,
      text_color: document.getElementById('bk-text')?.value,
      logo_url: document.getElementById('bk-logo')?.value,
      company: document.getElementById('bk-company')?.value,
      tagline: document.getElementById('bk-tagline')?.value,
      default_avatar: document.getElementById('bk-avatar')?.value,
      default_voice: document.getElementById('bk-voice')?.value,
    };
    localStorage.setItem('hg_brand_kit', JSON.stringify(brandKit));
    notify('Brand Kit', 'Saved successfully!', 'success');
  };

  /* ── Templates ── */
  window._hgSaveAsTemplate = function() { window._hgTab('templates'); };
  window._hgUseTemplate = function(id) {
    window._hgTab('studio');
    setTimeout(async () => {
      const data = await hgFetch(API + '/templates');
      const tpl = (data.templates||[]).find(t => t.id === id);
      if (tpl) {
        const t=document.getElementById('hg-title'),s=document.getElementById('hg-script');
        if(t) t.value=tpl.name;
        if(s) { s.value=tpl.script_template||''; s.dispatchEvent(new Event('input')); }
      }
    }, 600);
  };
  window._hgSaveTemplate = async function() {
    const name=document.getElementById('hg-tpl-name')?.value?.trim();
    if (!name) return alert('Template name required');
    await fetch(API+'/templates',{method:'POST',headers:hdrs(),body:JSON.stringify({name,category:document.getElementById('hg-tpl-cat')?.value||'marketing',description:document.getElementById('hg-tpl-desc')?.value||'',script_template:document.getElementById('hg-tpl-script')?.value||''})});
    switchTab('templates');
  };
  window._hgDeleteTemplate = async function(id) { if(!confirm('Delete this template?')) return; await fetch(API+'/templates/'+id,{method:'DELETE',headers:hdrs()}); switchTab('templates'); };

  /* ── Video management ── */
  window._hgPollStatus = async function(videoId) {
    try {
      const data = await hgFetch(API+'/status/'+videoId);
      if (data.status==='completed' && data.video_url) {
        notify('Video Ready!','Your video is complete.','success');
        const prev=document.getElementById('hg-preview');
        if (prev) prev.innerHTML='<video controls style="max-width:100%;border-radius:8px" src="'+data.video_url+'"></video>';
        switchTab(currentTab);
      } else if (data.status==='failed') { notify('Video Failed',data.raw?.error||'Unknown error','error'); }
      else { notify('Processing','Status: '+data.status+'. Still working...','info'); }
    } catch(e) { notify('Error',e.message,'error'); }
  };

  window._hgDeleteVideo = async function(id) { if(!confirm('Delete this video?')) return; await fetch(API+'/videos/'+id,{method:'DELETE',headers:hdrs()}); switchTab('videos'); };

  window._hgFilterVideos = function(cat) {
    document.querySelectorAll('.hg-video-card').forEach(el => {
      el.style.display = (!cat || el.dataset.category === cat) ? '' : 'none';
    });
  };

  window._hgSyncProcessing = async function() {
    const data = await hgFetch(API+'/videos?status=processing&limit=20');
    if (data._error) return;
    const processing = data.videos || [];
    if (!processing.length) { notify('Sync','No processing videos to check.','info'); return; }
    let updated = 0;
    for (const v of processing) {
      if (v.video_id) {
        try { const s = await hgFetch(API+'/status/'+v.video_id); if (s.status !== 'processing') updated++; } catch(e) {}
      }
    }
    notify('Sync Complete','Checked '+processing.length+' videos. '+updated+' status updated.','success');
    switchTab('videos');
  };

  /* ── Polling ── */
  function startPolling(videoId) {
    if (pollingIntervals[videoId]) return;
    let attempts = 0;
    pollingIntervals[videoId] = setInterval(async () => {
      attempts++;
      if (attempts > 60) { clearInterval(pollingIntervals[videoId]); delete pollingIntervals[videoId]; return; }
      try {
        const data = await hgFetch(API+'/status/'+videoId);
        if (data.status === 'completed') {
          clearInterval(pollingIntervals[videoId]); delete pollingIntervals[videoId];
          notify('Video Ready!','Your HeyGen video is complete.','success');
          const prev = document.getElementById('hg-preview');
          if (prev && data.video_url) prev.innerHTML='<video controls style="max-width:100%;border-radius:8px" src="'+data.video_url+'"></video>';
        } else if (data.status === 'failed') {
          clearInterval(pollingIntervals[videoId]); delete pollingIntervals[videoId];
          notify('Video Failed','Check My Videos tab.','error');
        }
      } catch(e) {}
    }, 10000);
  }


  /* ========================================================================
     HELPER FUNCTIONS
     ======================================================================== */

  function updateApiBadge(data) {
    const dot = document.getElementById('hg-conn-dot');
    const label = document.getElementById('hg-conn-label');
    if (!dot || !label) return;
    if (!data || data._error) {
      dot.style.background = '#dc2626'; label.textContent = 'Error'; label.style.color = '#dc2626';
    } else if (!data.api_configured) {
      dot.style.background = '#f59e0b'; label.textContent = 'API Key Missing'; label.style.color = '#f59e0b';
    } else if (data.api_status === 'connected') {
      dot.style.background = '#22c55e'; label.textContent = 'Connected'; label.style.color = '#22c55e';
    } else {
      dot.style.background = '#f59e0b'; label.textContent = 'API Error'; label.style.color = '#f59e0b';
    }
  }

  function apiKeyMissing(extraMsg) {
    return `
    <div style="padding:60px;background:linear-gradient(135deg,#fef3c7,#fde68a);border:1px solid #f59e0b;border-radius:16px;text-align:center;max-width:600px;margin:40px auto">
      <i class="fas fa-key" style="font-size:52px;color:#d97706;margin-bottom:20px"></i>
      <h3 style="color:#92400e;margin-bottom:8px;font-size:20px;font-weight:800">HeyGen API Key Required</h3>
      <p style="color:#a16207;font-size:14px;margin-bottom:24px">Connect your HeyGen API key to unlock AI video generation.</p>
      <div style="background:#fff;padding:16px;border-radius:10px;text-align:left;margin-bottom:16px">
        <p style="font-size:12px;color:#6b7280;margin-bottom:8px"><strong>Step 1:</strong> Get your key from <a href="https://app.heygen.com/settings?nav=API" target="_blank" style="color:#7c3aed;font-weight:700">app.heygen.com/settings</a></p>
        <p style="font-size:12px;color:#6b7280;margin-bottom:8px"><strong>Step 2 (local dev):</strong> Add to <code style="background:#f1f5f9;padding:2px 4px;border-radius:3px">.dev.vars</code>:</p>
        <code style="display:block;background:#1e293b;color:#a5f3fc;padding:8px 12px;border-radius:6px;font-size:11px;margin-bottom:8px">HEYGEN_API_KEY=sk_your_key_here</code>
        <p style="font-size:12px;color:#6b7280"><strong>Step 2 (production):</strong></p>
        <code style="display:block;background:#1e293b;color:#a5f3fc;padding:8px 12px;border-radius:6px;font-size:11px">wrangler pages secret put HEYGEN_API_KEY --project-name roofing-measurement-tool</code>
      </div>
      ${extraMsg ? '<p style="font-size:11px;color:#92400e;margin-top:8px">'+extraMsg+'</p>' : ''}
    </div>`;
  }

  function loader() { return '<div style="text-align:center;padding:40px"><i class="fas fa-spinner fa-spin" style="font-size:24px;color:#7c3aed"></i><p style="color:#94a3b8;font-size:13px;margin-top:8px">Loading...</p></div>'; }
  function errBox(m) { return '<div style="padding:24px;background:#fef2f2;border:1px solid #fecaca;border-radius:12px;color:#dc2626;text-align:center"><i class="fas fa-exclamation-triangle" style="font-size:24px;margin-bottom:8px;display:block"></i><p style="font-weight:600;margin-bottom:4px">Error</p><p style="font-size:13px">'+m+'</p></div>'; }
  function msg(text, type) { const bg={success:'#ecfdf5',error:'#fef2f2',info:'#eff6ff'},clr={success:'#059669',error:'#dc2626',info:'#2563eb'},ico={success:'fa-check-circle',error:'fa-exclamation-triangle',info:'fa-info-circle'}; return '<div style="padding:10px 14px;background:'+bg[type]+';color:'+clr[type]+';border-radius:8px;font-size:12px"><i class="fas '+ico[type]+'" style="margin-right:4px"></i>'+text+'</div>'; }
  function statCard(l,v,i,c,bg) { return '<div style="background:'+bg+';border:1px solid '+c+'22;border-radius:12px;padding:16px;text-align:center"><i class="fas '+i+'" style="font-size:16px;color:'+c+';margin-bottom:4px;display:block"></i><div style="font-size:22px;font-weight:900;color:'+c+'">'+v+'</div><div style="font-size:10px;color:'+c+';font-weight:600;opacity:0.8">'+l+'</div></div>'; }
  function statusStyle(s) { return {completed:'background:#ecfdf5;color:#059669',processing:'background:#fffbeb;color:#d97706',pending:'background:#f1f5f9;color:#475569',failed:'background:#fef2f2;color:#dc2626'}[s]||'background:#f1f5f9;color:#475569'; }
  function quickCard(tab,icon,color,title,desc) { return '<button onclick="window._hgTab(\''+tab+'\')" style="padding:18px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;cursor:pointer;text-align:left;transition:all .2s" onmouseover="this.style.borderColor=\''+color+'\';this.style.boxShadow=\'0 4px 12px '+color+'20\'" onmouseout="this.style.borderColor=\'#e2e8f0\';this.style.boxShadow=\'none\'"><i class="fas '+icon+'" style="font-size:22px;color:'+color+';margin-bottom:8px;display:block"></i><div style="font-size:13px;font-weight:700;color:#1e293b;margin-bottom:3px">'+title+'</div><div style="font-size:11px;color:#64748b;line-height:1.4">'+desc+'</div></button>'; }
  function videoRow(v) { return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f1f5f9"><div style="width:48px;height:28px;background:#1a2332;border-radius:4px;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center">'+(v.thumbnail_url?'<img src="'+v.thumbnail_url+'" style="width:100%;height:100%;object-fit:cover">':'<i class="fas fa-film" style="color:#475569;font-size:10px"></i>')+'</div><div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:600;color:#1e293b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+v.title+'</div><div style="font-size:10px;color:#94a3b8">'+(v.category||'')+' &bull; '+new Date(v.created_at).toLocaleDateString()+'</div></div><span style="padding:2px 8px;border-radius:12px;font-size:10px;font-weight:600;'+statusStyle(v.status)+'">'+v.status+'</span></div>'; }
  function ideaRow(icon,color,title,tab,desc) { return '<button onclick="window._hgTab(\''+tab+'\')" style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;width:100%;text-align:left;transition:all .15s" onmouseover="this.style.borderColor=\''+color+'\'" onmouseout="this.style.borderColor=\'#e2e8f0\'"><i class="fas '+icon+'" style="font-size:12px;color:'+color+';width:16px;text-align:center"></i><div style="flex:1"><div style="font-size:12px;font-weight:600;color:#1e293b">'+title+'</div><div style="font-size:10px;color:#94a3b8">'+desc+'</div></div><i class="fas fa-chevron-right" style="font-size:9px;color:#d1d5db"></i></button>'; }
  function presetBtn(key,icon,title,desc) { return '<button onclick="window._hgFillPreset(\''+key+'\')" style="padding:10px;background:#fff;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;text-align:left;transition:all .15s" onmouseover="this.style.borderColor=\'#7c3aed\'" onmouseout="this.style.borderColor=\'#e2e8f0\'"><div style="display:flex;align-items:center;gap:6px;margin-bottom:3px"><i class="fas '+icon+'" style="font-size:11px;color:#7c3aed"></i><span style="font-size:12px;font-weight:700;color:#1e293b">'+title+'</span></div><div style="font-size:10px;color:#94a3b8">'+desc+'</div></button>'; }
  function agentPresetCard(key,icon,color,title,desc) { return '<button onclick="window._hgFillAgentPreset(\''+key+'\')" style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:#fff;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;width:100%;text-align:left;transition:all .15s" onmouseover="this.style.borderColor=\''+color+'\'" onmouseout="this.style.borderColor=\'#e2e8f0\'"><div style="width:32px;height:32px;background:'+color+'15;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="fas '+icon+'" style="font-size:12px;color:'+color+'"></i></div><div><div style="font-size:12px;font-weight:700;color:#1e293b">'+title+'</div><div style="font-size:10px;color:#94a3b8">'+desc+'</div></div></button>'; }
  function interactiveUseCase(icon,color,title,desc) { return '<div style="display:flex;align-items:center;gap:10px;padding:10px;border-bottom:1px solid #f1f5f9"><div style="width:36px;height:36px;background:'+color+'15;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="fas '+icon+'" style="font-size:14px;color:'+color+'"></i></div><div><div style="font-size:13px;font-weight:600;color:#1e293b">'+title+'</div><div style="font-size:11px;color:#64748b">'+desc+'</div></div></div>'; }
  function photoUseCase(title,desc) { return '<div style="display:flex;align-items:center;gap:8px;padding:6px 0"><i class="fas fa-check-circle" style="font-size:12px;color:#e11d48"></i><div><span style="font-size:12px;font-weight:600;color:#1e293b">'+title+'</span> &mdash; <span style="font-size:11px;color:#64748b">'+desc+'</span></div></div>'; }
  function notify(title,message,type) { const div=document.createElement('div'); div.style.cssText='position:fixed;top:20px;right:20px;padding:16px 20px;border-radius:12px;z-index:10000;box-shadow:0 4px 20px rgba(0,0,0,0.15);max-width:380px;transition:all .3s ease;transform:translateX(120%)'; div.style.background=type==='success'?'#059669':type==='error'?'#dc2626':'#2563eb'; div.style.color='#fff'; div.innerHTML='<div style="font-weight:700;font-size:14px;margin-bottom:2px">'+title+'</div><div style="font-size:12px;opacity:0.9">'+message+'</div>'; document.body.appendChild(div); requestAnimationFrame(()=>{div.style.transform='translateX(0)'}); setTimeout(()=>{div.style.transform='translateX(120%)';setTimeout(()=>div.remove(),300)},5000); }

})();

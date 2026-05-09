// ============================================================
// Website Builder — AI-Powered Contractor Site Generator
// ============================================================

(function() {
  'use strict';

  var root = document.getElementById('wb-root');
  if (!root) return;

  function getToken() { return localStorage.getItem('rc_customer_token') || ''; }
  function authHeaders() { return { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' }; }

  // ============================================================
  // STATE
  // ============================================================
  var state = {
    view: 'list',       // list | create | preview | leads | edit-page
    subscriptionActive: false,
    subscriptionChecked: false,
    sites: [],
    currentSite: null,
    currentPages: [],
    currentLeads: [],
    previewSlug: 'home',
    loading: false,
    createStep: 1,
    editingPageId: null,
    editingPageSections: [],
    editingPageMeta: { meta_title: '', meta_description: '' },
    intake: {
      business_name: '', phone: '', email: '', address: '', city: '', province: '', zip: '',
      years_in_business: '', owner_name: '', company_story: '', license_number: '',
      services_offered: [], service_areas: [], certifications: [],
      brand_vibe: 'professional',
      brand_colors: { primary: '#1E3A5F', secondary: '#1a1a2e', accent: '#e85c2b' },
      theme_id: 'clean-pro'
    }
  };

  var SERVICES = [
    'Asphalt Shingle Roofing', 'Metal Roofing', 'Flat / Low-Slope Roofing', 'Tile Roofing',
    'Cedar / Wood Shake Roofing', 'Roof Repairs', 'Roof Inspections', 'Storm Damage Repair',
    'Insurance Claims Assistance', 'Gutter Installation', 'Gutter Cleaning',
    'Skylight Installation', 'Chimney Flashing', 'Roof Ventilation',
    'Commercial Roofing', 'New Construction Roofing', 'Roof Replacement', 'Emergency Roofing'
  ];

  var CERTS = [
    'GAF Master Elite Contractor', 'Owens Corning Preferred Contractor',
    'CertainTeed SELECT ShingleMaster', 'HAAG Certified Inspector',
    'OSHA 10 Certified', 'OSHA 30 Certified', 'Better Business Bureau Accredited',
    'Angi Super Service Award', 'NRCA Member'
  ];

  // ============================================================
  // API
  // ============================================================
  async function api(path, opts) {
    try {
      var res = await fetch('/api/website-builder' + path, Object.assign({ headers: authHeaders() }, opts || {}));
      if (res.status === 401) { window.location.href = '/login'; return null; }
      return res.json();
    } catch (err) {
      console.error('[WB] API error:', err);
      return null;
    }
  }

  async function checkSubscription() {
    var data = await api('/subscription');
    if (data) {
      state.subscriptionActive = data.active;
    }
    state.subscriptionChecked = true;
  }

  async function loadSites() {
    state.loading = true; render();
    var data = await api('/sites');
    if (data && data.sites) state.sites = data.sites;
    state.loading = false; render();
  }

  async function loadSiteDetail(id) {
    try {
      var data = await api('/sites/' + id);
      if (data && data.site) {
        state.currentSite = data.site;
        state.currentPages = data.pages || [];
      } else {
        state.currentSite = null;
        state.currentPages = [];
      }
    } catch (err) {
      console.error('[WB] Failed to load site:', err);
      state.currentSite = null;
      state.currentPages = [];
    }
  }

  async function loadLeads(siteId) {
    try {
      var data = await api('/sites/' + siteId + '/leads');
      if (data && data.leads) state.currentLeads = data.leads;
      else state.currentLeads = [];
    } catch (err) {
      console.error('[WB] Failed to load leads:', err);
      state.currentLeads = [];
    }
  }

  // ============================================================
  // RENDER
  // ============================================================
  function render() {
    if (state.subscriptionChecked && !state.subscriptionActive) {
      root.innerHTML = renderPaywall();
      return;
    }
    if (state.view === 'list') renderSiteList();
    else if (state.view === 'create') renderCreateWizard();
    else if (state.view === 'preview') renderPreview();
    else if (state.view === 'leads') renderLeads();
    else if (state.view === 'edit-page') renderPageEditor();
  }

  // ============================================================
  // SITE LIST VIEW
  // ============================================================
  function renderSiteList() {
    var html = '<div style="max-width:1100px;margin:0 auto;padding:24px;">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:32px;">';
    html += '<div><h1 style="font-size:28px;font-weight:800;color:#1a1a2e;">AI Website Builder</h1>';
    html += '<p style="color:#6b7280;margin-top:4px;">Generate a professional roofing website in minutes</p></div>';
    html += '<button onclick="wbCreateNew()" style="background:#e85c2b;color:white;border:none;padding:12px 24px;border-radius:8px;font-weight:700;font-size:15px;cursor:pointer;">+ Create New Site</button>';
    html += '</div>';

    if (state.loading) {
      html += '<div style="text-align:center;padding:80px 0;color:#6b7280;"><div style="font-size:40px;margin-bottom:16px;">⏳</div>Loading your sites...</div>';
    } else if (state.sites.length === 0) {
      html += '<div style="text-align:center;padding:80px 0;background:white;border-radius:16px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">';
      html += '<div style="font-size:64px;margin-bottom:16px;">🏗️</div>';
      html += '<h2 style="font-size:22px;font-weight:700;margin-bottom:8px;">No Sites Yet</h2>';
      html += '<p style="color:#6b7280;margin-bottom:24px;">Create your first AI-powered roofing website in under 5 minutes.</p>';
      html += '<button onclick="wbCreateNew()" style="background:#e85c2b;color:white;border:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:16px;cursor:pointer;">Build My Website</button>';
      html += '</div>';
    } else {
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:20px;">';
      state.sites.forEach(function(site) {
        var statusColor = site.status === 'published' ? '#10b981' : site.status === 'preview' ? '#f59e0b' : site.status === 'generating' ? '#3b82f6' : '#6b7280';
        var statusLabel = site.status.charAt(0).toUpperCase() + site.status.slice(1);
        html += '<div style="background:white;border-radius:12px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,0.1);border-top:4px solid ' + statusColor + ';">';
        html += '<div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:16px;">';
        html += '<h3 style="font-size:18px;font-weight:700;">' + esc(site.business_name) + '</h3>';
        html += '<span style="background:' + statusColor + '20;color:' + statusColor + ';padding:4px 10px;border-radius:6px;font-size:12px;font-weight:700;">' + statusLabel + '</span>';
        html += '</div>';
        html += '<div style="color:#6b7280;font-size:14px;margin-bottom:4px;">📍 ' + esc(site.city) + ', ' + esc(site.province) + '</div>';
        html += '<div style="color:#6b7280;font-size:14px;margin-bottom:16px;">🌐 ' + esc(site.subdomain) + '.roofmanager.ca</div>';
        html += '<div style="display:flex;gap:12px;margin-bottom:16px;">';
        html += '<div style="flex:1;text-align:center;background:#f9fafb;padding:10px;border-radius:8px;"><div style="font-size:20px;font-weight:800;">' + (site.page_count || 0) + '</div><div style="font-size:11px;color:#6b7280;">Pages</div></div>';
        html += '<div style="flex:1;text-align:center;background:#f9fafb;padding:10px;border-radius:8px;"><div style="font-size:20px;font-weight:800;">' + (site.lead_count || 0) + '</div><div style="font-size:11px;color:#6b7280;">Leads</div></div>';
        html += '</div>';
        html += '<div style="display:flex;gap:8px;">';
        html += '<button onclick="wbPreview(' + site.id + ')" style="flex:1;background:#1a1a2e;color:white;border:none;padding:10px;border-radius:6px;font-weight:600;font-size:13px;cursor:pointer;">Preview</button>';
        if (site.status !== 'published') {
          html += '<button onclick="wbPublish(' + site.id + ')" style="flex:1;background:#10b981;color:white;border:none;padding:10px;border-radius:6px;font-weight:600;font-size:13px;cursor:pointer;">Publish</button>';
        }
        html += '<button onclick="wbLeads(' + site.id + ')" style="flex:1;background:#3b82f6;color:white;border:none;padding:10px;border-radius:6px;font-weight:600;font-size:13px;cursor:pointer;">Leads</button>';
        html += '</div>';
        html += '</div>';
      });
      html += '</div>';
    }
    html += '</div>';
    root.innerHTML = html;
  }

  // ============================================================
  // CREATE WIZARD
  // ============================================================
  function renderCreateWizard() {
    var s = state.createStep;
    var html = '<div style="max-width:700px;margin:0 auto;padding:24px;">';
    html += '<button onclick="wbBack()" style="background:none;border:none;color:#6b7280;cursor:pointer;font-size:14px;margin-bottom:16px;">← Back to Sites</button>';
    html += '<h1 style="font-size:24px;font-weight:800;margin-bottom:8px;">Build Your Website</h1>';
    html += '<p style="color:#6b7280;margin-bottom:24px;">Step ' + s + ' of 4</p>';

    html += '<div style="display:flex;gap:4px;margin-bottom:32px;">';
    for (var i = 1; i <= 4; i++) {
      html += '<div style="flex:1;height:4px;border-radius:2px;background:' + (i <= s ? '#e85c2b' : '#e5e7eb') + ';"></div>';
    }
    html += '</div>';

    html += '<div style="background:white;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">';

    if (s === 1) {
      html += '<h2 style="font-size:20px;font-weight:700;margin-bottom:24px;">Business Information</h2>';
      html += field('Business Name *', 'business_name', 'text', "Joe's Roofing");
      html += field('Phone *', 'phone', 'tel', '(555) 555-5555');
      html += field('Email *', 'email', 'email', 'info@joesroofing.com');
      html += field('Business Address', 'address', 'text', '123 Main St');
      html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">';
      html += field('City *', 'city', 'text', 'Edmonton');
      html += field('Province/State *', 'province', 'text', 'AB');
      html += field('ZIP/Postal', 'zip', 'text', 'T5A 0A1');
      html += '</div>';
      html += field('Owner Name', 'owner_name', 'text', 'Joe Smith');
      html += field('Years in Business', 'years_in_business', 'number', '15');
    } else if (s === 2) {
      html += '<h2 style="font-size:20px;font-weight:700;margin-bottom:24px;">Services Offered</h2>';
      html += '<p style="color:#6b7280;font-size:14px;margin-bottom:16px;">Select all services you provide:</p>';
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">';
      SERVICES.forEach(function(svc) {
        var checked = state.intake.services_offered.indexOf(svc) !== -1 ? 'checked' : '';
        html += '<label style="display:flex;align-items:center;gap:8px;padding:10px 12px;border:1px solid #e5e7eb;border-radius:8px;cursor:pointer;font-size:14px;' + (checked ? 'background:#e85c2b10;border-color:#e85c2b;' : '') + '">';
        html += '<input type="checkbox" onchange="wbToggleService(\'' + esc(svc) + '\')" ' + checked + ' style="accent-color:#e85c2b;"> ' + svc;
        html += '</label>';
      });
      html += '</div>';
    } else if (s === 3) {
      html += '<h2 style="font-size:20px;font-weight:700;margin-bottom:24px;">Service Areas & Credentials</h2>';
      html += '<label style="display:block;font-weight:600;margin-bottom:6px;font-size:14px;">Service Areas * (cities you serve)</label>';
      html += '<div id="areas-list" style="margin-bottom:8px;">';
      state.intake.service_areas.forEach(function(area, idx) {
        html += '<span style="display:inline-flex;align-items:center;gap:4px;background:#e85c2b15;color:#e85c2b;padding:4px 10px;border-radius:6px;font-size:13px;font-weight:600;margin:0 4px 4px 0;">' + esc(area) + ' <span onclick="wbRemoveArea(' + idx + ')" style="cursor:pointer;font-size:16px;">×</span></span>';
      });
      html += '</div>';
      html += '<div style="display:flex;gap:8px;margin-bottom:24px;">';
      html += '<input id="area-input" type="text" placeholder="Add a city..." style="flex:1;padding:10px 14px;border:2px solid #e5e7eb;border-radius:8px;font-size:14px;" onkeydown="if(event.key===\'Enter\'){event.preventDefault();wbAddArea()}">';
      html += '<button onclick="wbAddArea()" style="background:#1a1a2e;color:white;border:none;padding:10px 16px;border-radius:8px;font-weight:600;font-size:13px;cursor:pointer;">Add</button>';
      html += '</div>';

      html += '<label style="display:block;font-weight:600;margin-bottom:6px;font-size:14px;">Certifications (optional)</label>';
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:16px;">';
      CERTS.forEach(function(cert) {
        var checked = state.intake.certifications.indexOf(cert) !== -1 ? 'checked' : '';
        html += '<label style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid #e5e7eb;border-radius:6px;cursor:pointer;font-size:13px;' + (checked ? 'background:#10b98115;border-color:#10b981;' : '') + '">';
        html += '<input type="checkbox" onchange="wbToggleCert(\'' + esc(cert) + '\')" ' + checked + ' style="accent-color:#10b981;"> ' + cert;
        html += '</label>';
      });
      html += '</div>';

      html += '<label style="display:block;font-weight:600;margin-bottom:6px;font-size:14px;">Company Story (optional)</label>';
      html += '<textarea id="wb-story" oninput="wbIntake(\'company_story\',this.value)" placeholder="Tell homeowners about your company..." style="width:100%;padding:12px;border:2px solid #e5e7eb;border-radius:8px;font-size:14px;min-height:100px;resize:vertical;font-family:inherit;">' + esc(state.intake.company_story) + '</textarea>';
    } else if (s === 4) {
      html += '<h2 style="font-size:20px;font-weight:700;margin-bottom:24px;">Branding & Style</h2>';

      html += '<label style="display:block;font-weight:600;margin-bottom:12px;font-size:14px;">Brand Vibe</label>';
      html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:24px;">';
      ['professional', 'bold', 'friendly'].forEach(function(vibe) {
        var icons = { professional: '🏢', bold: '⚡', friendly: '🤝' };
        var descs = { professional: 'Trustworthy & expert', bold: 'Confident & direct', friendly: 'Warm & approachable' };
        var sel = state.intake.brand_vibe === vibe;
        html += '<div onclick="wbIntake(\'brand_vibe\',\'' + vibe + '\');wbRender()" style="padding:20px;text-align:center;border:2px solid ' + (sel ? '#e85c2b' : '#e5e7eb') + ';border-radius:12px;cursor:pointer;background:' + (sel ? '#e85c2b08' : 'white') + ';">';
        html += '<div style="font-size:32px;margin-bottom:8px;">' + icons[vibe] + '</div>';
        html += '<div style="font-weight:700;font-size:15px;text-transform:capitalize;">' + vibe + '</div>';
        html += '<div style="font-size:12px;color:#6b7280;margin-top:4px;">' + descs[vibe] + '</div>';
        html += '</div>';
      });
      html += '</div>';

      html += '<label style="display:block;font-weight:600;margin-bottom:8px;font-size:14px;">Brand Colors</label>';
      html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:24px;">';
      html += colorPicker('Primary', 'primary', state.intake.brand_colors.primary);
      html += colorPicker('Secondary', 'secondary', state.intake.brand_colors.secondary);
      html += colorPicker('Accent', 'accent', state.intake.brand_colors.accent);
      html += '</div>';

      html += '<label style="display:block;font-weight:600;margin-bottom:8px;font-size:14px;">Logo URL (optional)</label>';
      html += '<input type="url" value="' + esc(state.intake.logo_url || '') + '" oninput="wbIntake(\'logo_url\',this.value)" placeholder="https://example.com/logo.png" style="width:100%;padding:10px 14px;border:2px solid #e5e7eb;border-radius:8px;font-size:14px;margin-bottom:8px;">';
    }

    html += '</div>';

    html += '<div style="display:flex;justify-content:space-between;margin-top:24px;">';
    if (s > 1) {
      html += '<button onclick="wbPrevStep()" style="background:#f3f4f6;color:#374151;border:none;padding:12px 24px;border-radius:8px;font-weight:600;cursor:pointer;">← Previous</button>';
    } else {
      html += '<div></div>';
    }
    if (s < 4) {
      html += '<button onclick="wbNextStep()" style="background:#1a1a2e;color:white;border:none;padding:12px 24px;border-radius:8px;font-weight:700;cursor:pointer;">Next →</button>';
    } else {
      html += '<button id="wb-generate-btn" onclick="wbGenerate()" style="background:#e85c2b;color:white;border:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:16px;cursor:pointer;">🚀 Generate My Website</button>';
    }
    html += '</div></div>';
    root.innerHTML = html;
  }

  function field(label, key, type, placeholder) {
    var val = state.intake[key] || '';
    return '<div style="margin-bottom:16px;"><label style="display:block;font-weight:600;margin-bottom:6px;font-size:14px;">' + label + '</label>' +
      '<input type="' + type + '" value="' + esc(String(val)) + '" oninput="wbIntake(\'' + key + '\',this.value)" placeholder="' + placeholder + '" style="width:100%;padding:10px 14px;border:2px solid #e5e7eb;border-radius:8px;font-size:14px;font-family:inherit;"></div>';
  }

  function colorPicker(label, key, value) {
    return '<div style="text-align:center;">' +
      '<label style="font-size:13px;color:#6b7280;display:block;margin-bottom:6px;">' + label + '</label>' +
      '<input type="color" value="' + value + '" onchange="wbColor(\'' + key + '\',this.value)" style="width:60px;height:40px;border:2px solid #e5e7eb;border-radius:8px;cursor:pointer;padding:2px;">' +
      '</div>';
  }

  // ============================================================
  // PREVIEW VIEW
  // ============================================================
  function renderPreview() {
    var site = state.currentSite;
    if (!site) {
      root.innerHTML = '<div style="text-align:center;padding:80px;"><div style="font-size:48px;margin-bottom:16px;">⚠️</div><h2 style="font-size:20px;font-weight:700;">Site Not Found</h2><p style="color:#6b7280;margin-top:8px;">Could not load site details.</p><button onclick="wbBack()" style="margin-top:16px;background:#1a1a2e;color:white;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;">← Back to Sites</button></div>';
      return;
    }

    var html = '<div style="max-width:1200px;margin:0 auto;padding:24px;">';
    html += '<button onclick="wbBack()" style="background:none;border:none;color:#6b7280;cursor:pointer;font-size:14px;margin-bottom:16px;">← Back to Sites</button>';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">';
    html += '<h1 style="font-size:24px;font-weight:800;">' + esc(site.business_name) + '</h1>';
    html += '<div style="display:flex;gap:8px;">';
    html += '<button onclick="wbRegenerate(' + site.id + ')" style="background:#6b7280;color:white;border:none;padding:10px 20px;border-radius:8px;font-weight:600;cursor:pointer;">🔄 Regenerate</button>';
    if (site.status !== 'published') {
      html += '<button id="wb-publish-btn" onclick="wbPublish(' + site.id + ')" style="background:#10b981;color:white;border:none;padding:10px 20px;border-radius:8px;font-weight:700;cursor:pointer;">🚀 Publish Live</button>';
    } else {
      html += '<a href="/sites/' + esc(site.subdomain) + '" target="_blank" style="display:inline-flex;align-items:center;background:#3b82f6;color:white;padding:10px 20px;border-radius:8px;font-weight:700;text-decoration:none;">🌐 View Live Site</a>';
    }
    html += '</div></div>';

    // Custom domain section
    if (site.status === 'published') {
      html += '<div style="background:white;border-radius:12px;padding:16px 20px;box-shadow:0 1px 3px rgba(0,0,0,0.1);margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;">';
      html += '<div><strong style="font-size:14px;">Custom Domain</strong>';
      if (site.custom_domain) {
        html += '<div style="color:#10b981;font-size:13px;margin-top:2px;">🌐 ' + esc(site.custom_domain) + '</div>';
      } else {
        html += '<div style="color:#6b7280;font-size:13px;margin-top:2px;">Not configured — using ' + esc(site.subdomain) + '.roofmanager.ca</div>';
      }
      html += '</div>';
      html += '<button onclick="wbSetDomain(' + site.id + ')" style="background:#3b82f6;color:white;border:none;padding:8px 16px;border-radius:6px;font-weight:600;font-size:13px;cursor:pointer;">Set Domain</button>';
      html += '</div>';
    }

    // Page tabs
    html += '<div style="display:flex;gap:4px;margin-bottom:8px;overflow-x:auto;">';
    var slugs = [
      { slug: 'home', label: 'Home' },
      { slug: 'services', label: 'Services' },
      { slug: 'about', label: 'About' },
      { slug: 'service-areas', label: 'Areas' },
      { slug: 'contact', label: 'Contact' }
    ];
    slugs.forEach(function(p) {
      var active = state.previewSlug === p.slug;
      html += '<button onclick="wbPreviewPage(\'' + p.slug + '\')" style="padding:10px 18px;border-radius:8px 8px 0 0;border:none;font-weight:600;cursor:pointer;font-size:14px;' + (active ? 'background:#1a1a2e;color:white;' : 'background:#f3f4f6;color:#6b7280;') + '">' + p.label + '</button>';
    });
    html += '</div>';

    // Edit page button
    var currentPage = findCurrentPage();
    if (currentPage) {
      html += '<div style="margin-bottom:8px;"><button onclick="wbEditPage(' + currentPage.id + ')" style="background:#f59e0b;color:white;border:none;padding:8px 16px;border-radius:6px;font-weight:600;font-size:13px;cursor:pointer;">✏️ Edit This Page</button></div>';
    }

    // Preview iframe
    html += '<div style="border:2px solid #e5e7eb;border-radius:0 12px 12px 12px;overflow:hidden;background:white;">';
    html += '<iframe id="wb-preview-frame" src="/api/website-builder/sites/' + site.id + '/preview/' + state.previewSlug + '" style="width:100%;height:700px;border:none;"></iframe>';
    html += '</div>';
    html += '</div>';
    root.innerHTML = html;
  }

  function findCurrentPage() {
    var slug = state.previewSlug === 'home' ? '/' : '/' + state.previewSlug;
    return state.currentPages.find(function(p) { return p.slug === slug; }) || null;
  }

  // ============================================================
  // PAGE EDITOR VIEW
  // ============================================================
  function renderPageEditor() {
    var html = '<div style="max-width:900px;margin:0 auto;padding:24px;">';
    html += '<button onclick="wbCancelEdit()" style="background:none;border:none;color:#6b7280;cursor:pointer;font-size:14px;margin-bottom:16px;">← Back to Preview</button>';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">';
    html += '<h1 style="font-size:24px;font-weight:800;">Edit Page</h1>';
    html += '<button id="wb-save-btn" onclick="wbSavePage()" style="background:#e85c2b;color:white;border:none;padding:12px 24px;border-radius:8px;font-weight:700;cursor:pointer;">Save Changes</button>';
    html += '</div>';

    // Meta fields
    html += '<div style="background:white;border-radius:12px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,0.1);margin-bottom:20px;">';
    html += '<h3 style="font-size:16px;font-weight:700;margin-bottom:16px;">Page SEO</h3>';
    html += '<div style="margin-bottom:12px;"><label style="display:block;font-weight:600;font-size:13px;margin-bottom:4px;">Meta Title</label>';
    html += '<input type="text" value="' + esc(state.editingPageMeta.meta_title) + '" oninput="wbUpdateMeta(\'meta_title\',this.value)" style="width:100%;padding:8px 12px;border:2px solid #e5e7eb;border-radius:6px;font-size:14px;"></div>';
    html += '<div><label style="display:block;font-weight:600;font-size:13px;margin-bottom:4px;">Meta Description</label>';
    html += '<textarea oninput="wbUpdateMeta(\'meta_description\',this.value)" style="width:100%;padding:8px 12px;border:2px solid #e5e7eb;border-radius:6px;font-size:14px;min-height:60px;font-family:inherit;">' + esc(state.editingPageMeta.meta_description) + '</textarea></div>';
    html += '</div>';

    // Section editors
    state.editingPageSections.forEach(function(section, sIdx) {
      html += '<div style="background:white;border-radius:12px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,0.1);margin-bottom:16px;">';
      html += '<h3 style="font-size:16px;font-weight:700;margin-bottom:16px;text-transform:capitalize;color:#1a1a2e;">' + esc(section.type.replace(/_/g, ' ')) + ' Section</h3>';
      var data = section.data || {};
      Object.keys(data).forEach(function(key) {
        var val = data[key];
        if (typeof val === 'string') {
          var isLong = val.length > 100;
          html += '<div style="margin-bottom:12px;"><label style="display:block;font-weight:600;font-size:13px;margin-bottom:4px;color:#6b7280;">' + esc(key.replace(/_/g, ' ')) + '</label>';
          if (isLong) {
            html += '<textarea oninput="wbUpdateSection(' + sIdx + ',\'' + esc(key) + '\',this.value)" style="width:100%;padding:8px 12px;border:2px solid #e5e7eb;border-radius:6px;font-size:14px;min-height:80px;font-family:inherit;">' + esc(val) + '</textarea>';
          } else {
            html += '<input type="text" value="' + esc(val) + '" oninput="wbUpdateSection(' + sIdx + ',\'' + esc(key) + '\',this.value)" style="width:100%;padding:8px 12px;border:2px solid #e5e7eb;border-radius:6px;font-size:14px;">';
          }
          html += '</div>';
        } else if (typeof val === 'object' && val !== null) {
          html += '<div style="margin-bottom:12px;"><label style="display:block;font-weight:600;font-size:13px;margin-bottom:4px;color:#6b7280;">' + esc(key.replace(/_/g, ' ')) + ' (JSON)</label>';
          html += '<textarea oninput="try{wbUpdateSection(' + sIdx + ',\'' + esc(key) + '\',JSON.parse(this.value))}catch(e){}" style="width:100%;padding:8px 12px;border:2px solid #e5e7eb;border-radius:6px;font-size:13px;font-family:monospace;min-height:100px;background:#f9fafb;">' + esc(JSON.stringify(val, null, 2)) + '</textarea>';
          html += '</div>';
        }
      });
      html += '</div>';
    });

    html += '<div style="display:flex;gap:12px;justify-content:flex-end;margin-top:8px;">';
    html += '<button onclick="wbCancelEdit()" style="background:#f3f4f6;color:#374151;border:none;padding:12px 24px;border-radius:8px;font-weight:600;cursor:pointer;">Cancel</button>';
    html += '<button onclick="wbSavePage()" style="background:#e85c2b;color:white;border:none;padding:12px 24px;border-radius:8px;font-weight:700;cursor:pointer;">Save Changes</button>';
    html += '</div></div>';
    root.innerHTML = html;
  }

  // ============================================================
  // LEADS VIEW
  // ============================================================
  function renderLeads() {
    var site = state.currentSite;
    if (!site) {
      root.innerHTML = '<div style="text-align:center;padding:80px;"><div style="font-size:48px;margin-bottom:16px;">⚠️</div><h2 style="font-size:20px;font-weight:700;">Site Not Found</h2><p style="color:#6b7280;margin-top:8px;">Could not load site details.</p><button onclick="wbBack()" style="margin-top:16px;background:#1a1a2e;color:white;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;">← Back to Sites</button></div>';
      return;
    }

    var html = '<div style="max-width:1100px;margin:0 auto;padding:24px;">';
    html += '<button onclick="wbBack()" style="background:none;border:none;color:#6b7280;cursor:pointer;font-size:14px;margin-bottom:16px;">← Back to Sites</button>';
    html += '<h1 style="font-size:24px;font-weight:800;margin-bottom:24px;">Leads — ' + esc(site.business_name) + '</h1>';

    if (state.currentLeads.length === 0) {
      html += '<div style="text-align:center;padding:60px;background:white;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">';
      html += '<div style="font-size:48px;margin-bottom:12px;">📬</div>';
      html += '<h3 style="font-size:18px;font-weight:700;margin-bottom:8px;">No Leads Yet</h3>';
      html += '<p style="color:#6b7280;">Leads from your website contact form will appear here.</p>';
      html += '</div>';
    } else {
      html += '<div style="background:white;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.1);overflow:hidden;">';
      html += '<table style="width:100%;border-collapse:collapse;font-size:14px;">';
      html += '<thead><tr style="background:#f9fafb;"><th style="padding:12px 16px;text-align:left;font-weight:600;color:#6b7280;">Name</th><th style="padding:12px;text-align:left;font-weight:600;color:#6b7280;">Phone</th><th style="padding:12px;text-align:left;font-weight:600;color:#6b7280;">Email</th><th style="padding:12px;text-align:left;font-weight:600;color:#6b7280;">Service</th><th style="padding:12px;text-align:left;font-weight:600;color:#6b7280;">Date</th></tr></thead>';
      html += '<tbody>';
      state.currentLeads.forEach(function(lead) {
        html += '<tr style="border-top:1px solid #f3f4f6;">';
        html += '<td style="padding:12px 16px;font-weight:600;">' + esc(lead.name) + '</td>';
        html += '<td style="padding:12px;"><a href="tel:' + esc(lead.phone) + '" style="color:#e85c2b;">' + esc(lead.phone) + '</a></td>';
        html += '<td style="padding:12px;">' + esc(lead.email || '-') + '</td>';
        html += '<td style="padding:12px;">' + esc(lead.service_type || '-') + '</td>';
        html += '<td style="padding:12px;color:#6b7280;">' + formatDate(lead.created_at) + '</td>';
        html += '</tr>';
        if (lead.message) {
          html += '<tr style="background:#f9fafb;"><td colspan="5" style="padding:8px 16px;font-size:13px;color:#6b7280;">💬 ' + esc(lead.message) + '</td></tr>';
        }
      });
      html += '</tbody></table></div>';
    }
    html += '</div>';
    root.innerHTML = html;
  }

  // ============================================================
  // PAYWALL
  // ============================================================
  function renderPaywall() {
    return '<div style="max-width:600px;margin:40px auto;text-align:center;padding:0 20px">' +
      '<div style="background:#111;border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:40px;margin-bottom:20px">' +
        '<div style="width:64px;height:64px;background:rgba(0,255,136,0.1);border-radius:16px;display:flex;align-items:center;justify-content:center;margin:0 auto 20px"><i class="fas fa-globe" style="color:#00FF88;font-size:28px"></i></div>' +
        '<h2 style="color:white;font-size:28px;font-weight:800;margin:0 0 8px">AI Website Builder</h2>' +
        '<div style="display:inline-flex;align-items:baseline;gap:4px;margin-bottom:16px"><span style="color:#00FF88;font-size:42px;font-weight:900">$99</span><span style="color:#888;font-size:16px">/month</span></div>' +
        '<p style="color:#999;font-size:14px;line-height:1.6;margin:0 0 24px">Get a professional AI-generated website for your roofing business in under 5 minutes. No design skills needed.</p>' +
        '<div style="text-align:left;margin-bottom:28px">' +
          '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.05)"><i class="fas fa-check-circle" style="color:#00FF88;font-size:14px"></i><span style="color:#ccc;font-size:13px">5-page professional website (Home, Services, About, Areas, Contact)</span></div>' +
          '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.05)"><i class="fas fa-check-circle" style="color:#00FF88;font-size:14px"></i><span style="color:#ccc;font-size:13px">AI-written copy tailored to your business &amp; services</span></div>' +
          '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.05)"><i class="fas fa-check-circle" style="color:#00FF88;font-size:14px"></i><span style="color:#ccc;font-size:13px">Built-in lead capture forms synced to your CRM</span></div>' +
          '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.05)"><i class="fas fa-check-circle" style="color:#00FF88;font-size:14px"></i><span style="color:#ccc;font-size:13px">Mobile-responsive design with your brand colors</span></div>' +
          '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.05)"><i class="fas fa-check-circle" style="color:#00FF88;font-size:14px"></i><span style="color:#ccc;font-size:13px">Custom subdomain (yourcompany.roofmanager.ca)</span></div>' +
          '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.05)"><i class="fas fa-check-circle" style="color:#00FF88;font-size:14px"></i><span style="color:#ccc;font-size:13px">SEO-optimized for local search rankings</span></div>' +
          '<div style="display:flex;align-items:center;gap:10px;padding:10px 0"><i class="fas fa-check-circle" style="color:#00FF88;font-size:14px"></i><span style="color:#ccc;font-size:13px">Edit content anytime &mdash; regenerate with AI on demand</span></div>' +
        '</div>' +
        '<button onclick="wbSubscribe()" id="wb-subscribe-btn" style="width:100%;background:#00FF88;color:#0a0a0a;border:none;padding:16px;border-radius:12px;font-size:16px;font-weight:800;cursor:pointer;margin-bottom:12px">Subscribe &amp; Build Your Site &rarr;</button>' +
        '<p style="color:#666;font-size:11px;margin:0">Cancel anytime. No contracts. 30-day billing cycle.</p>' +
      '</div>' +
    '</div>';
  }

  // ============================================================
  // ACTIONS
  // ============================================================
  window.wbCreateNew = function() {
    state.view = 'create'; state.createStep = 1;
    state.intake = {
      business_name: '', phone: '', email: '', address: '', city: '', province: '', zip: '',
      years_in_business: '', owner_name: '', company_story: '', license_number: '',
      services_offered: [], service_areas: [], certifications: [],
      brand_vibe: 'professional',
      brand_colors: { primary: '#1E3A5F', secondary: '#1a1a2e', accent: '#e85c2b' },
      theme_id: 'clean-pro'
    };
    render();
  };

  window.wbBack = function() {
    state.view = 'list'; state.currentSite = null; state.currentLeads = [];
    loadSites();
  };

  window.wbIntake = function(key, val) { state.intake[key] = val; };
  window.wbRender = render;

  window.wbColor = function(key, val) { state.intake.brand_colors[key] = val; };

  window.wbToggleService = function(svc) {
    var idx = state.intake.services_offered.indexOf(svc);
    if (idx === -1) state.intake.services_offered.push(svc);
    else state.intake.services_offered.splice(idx, 1);
    render();
  };

  window.wbToggleCert = function(cert) {
    var idx = state.intake.certifications.indexOf(cert);
    if (idx === -1) state.intake.certifications.push(cert);
    else state.intake.certifications.splice(idx, 1);
    render();
  };

  window.wbAddArea = function() {
    var input = document.getElementById('area-input');
    if (input && input.value.trim()) {
      state.intake.service_areas.push(input.value.trim());
      input.value = '';
      render();
    }
  };

  window.wbRemoveArea = function(idx) { state.intake.service_areas.splice(idx, 1); render(); };

  window.wbNextStep = function() {
    if (state.createStep === 1) {
      if (!state.intake.business_name || !state.intake.phone || !state.intake.email || !state.intake.city || !state.intake.province) {
        window.rmToast('Please fill in all required fields.', 'warning'); return;
      }
    }
    if (state.createStep === 2 && state.intake.services_offered.length === 0) {
      window.rmToast('Please select at least one service.', 'warning'); return;
    }
    if (state.createStep === 3 && state.intake.service_areas.length === 0) {
      window.rmToast('Please add at least one service area.', 'warning'); return;
    }
    state.createStep++;
    render();
  };

  window.wbPrevStep = function() {
    if (state.createStep > 1) { state.createStep--; render(); }
  };

  window.wbGenerate = async function() {
    var btn = document.getElementById('wb-generate-btn');
    if (btn) { btn.textContent = '⏳ Generating... (30-60 seconds)'; btn.disabled = true; btn.style.opacity = '0.6'; }

    try {
      var intake = Object.assign({}, state.intake);
      intake.years_in_business = parseInt(intake.years_in_business) || undefined;

      var data = await api('/intake', { method: 'POST', body: JSON.stringify(intake) });
      if (data && data.success) {
        await loadSiteDetail(data.site_id);
        state.view = 'preview';
        state.previewSlug = 'home';
        render();
      } else if (data && data.error === 'subscription_required') {
        state.subscriptionActive = false;
        render();
      } else {
        window.rmToast('Generation failed: ' + (data ? data.error : 'Unknown error'), 'error');
        if (btn) { btn.textContent = '🚀 Generate My Website'; btn.disabled = false; btn.style.opacity = '1'; }
      }
    } catch (err) {
      window.rmToast('Error: ' + err.message, 'error');
      if (btn) { btn.textContent = '🚀 Generate My Website'; btn.disabled = false; btn.style.opacity = '1'; }
    }
  };

  window.wbPreview = async function(siteId) {
    state.loading = true; render();
    await loadSiteDetail(siteId);
    state.view = 'preview';
    state.previewSlug = 'home';
    state.loading = false;
    render();
  };

  window.wbPreviewPage = function(slug) {
    state.previewSlug = slug;
    render();
  };

  window.wbPublish = async function(siteId) {
    if (!(await window.rmConfirm('Publish this site live? It will be accessible at a public URL.'))) return
    var btn = document.getElementById('wb-publish-btn');
    if (btn) { btn.textContent = '⏳ Publishing...'; btn.disabled = true; btn.style.opacity = '0.6'; }

    var data = await api('/sites/' + siteId + '/publish', { method: 'POST', body: JSON.stringify({ site_id: siteId }) });
    if (data && data.success) {
      window.rmToast('Site published! Live at: ' + data.url, 'info');
      state.view = 'list';
      await loadSites();
    } else {
      window.rmToast('Publish failed: ' + (data ? data.error : 'Unknown error'), 'error');
      if (btn) { btn.textContent = '🚀 Publish Live'; btn.disabled = false; btn.style.opacity = '1'; }
    }
  };

  window.wbRegenerate = async function(siteId) {
    if (!(await window.rmConfirm('Regenerate all content with AI? Current pages will be replaced.'))) return
    root.innerHTML = '<div style="text-align:center;padding:120px 0;"><div style="font-size:48px;margin-bottom:16px;">🤖</div><h2 style="font-size:22px;font-weight:700;margin-bottom:8px;">Regenerating Content...</h2><p style="color:#6b7280;">This may take 30-60 seconds</p></div>';
    var data = await api('/sites/' + siteId + '/regenerate', { method: 'POST' });
    if (data && data.success) {
      await loadSiteDetail(siteId);
      state.view = 'preview';
      state.previewSlug = 'home';
      render();
    } else {
      window.rmToast('Regeneration failed: ' + (data ? data.error : 'Unknown error'), 'error');
      wbBack();
    }
  };

  window.wbLeads = async function(siteId) {
    state.loading = true; render();
    await loadSiteDetail(siteId);
    await loadLeads(siteId);
    state.view = 'leads';
    state.loading = false;
    render();
  };

  // Page editing
  window.wbEditPage = async function(pageId) {
    var data = await api('/sites/' + state.currentSite.id + '/pages/' + pageId);
    if (data && data.page) {
      state.editingPageId = pageId;
      state.editingPageSections = data.page.sections || [];
      state.editingPageMeta = { meta_title: data.page.meta_title || '', meta_description: data.page.meta_description || '' };
      state.view = 'edit-page';
      render();
    } else {
      window.rmToast('Failed to load page for editing.', 'error');
    }
  };

  window.wbSavePage = async function() {
    var btn = document.getElementById('wb-save-btn');
    if (btn) { btn.textContent = '⏳ Saving...'; btn.disabled = true; }

    var data = await api('/sites/' + state.currentSite.id + '/pages/' + state.editingPageId, {
      method: 'PATCH',
      body: JSON.stringify({
        meta_title: state.editingPageMeta.meta_title,
        meta_description: state.editingPageMeta.meta_description,
        sections: state.editingPageSections
      })
    });
    if (data && data.success) {
      window.rmToast('Page saved!', 'success');
      state.view = 'preview';
      state.editingPageId = null;
      render();
    } else {
      window.rmToast('Save failed: ' + (data ? data.error : 'Unknown error'), 'error');
      if (btn) { btn.textContent = 'Save Changes'; btn.disabled = false; }
    }
  };

  window.wbCancelEdit = function() {
    state.view = 'preview';
    state.editingPageId = null;
    render();
  };

  window.wbUpdateSection = function(sectionIdx, fieldKey, value) {
    if (state.editingPageSections[sectionIdx] && state.editingPageSections[sectionIdx].data) {
      state.editingPageSections[sectionIdx].data[fieldKey] = value;
    }
  };

  window.wbUpdateMeta = function(key, value) {
    state.editingPageMeta[key] = value;
  };

  // Custom domain
  window.wbSetDomain = async function(siteId) {
    var domain = prompt('Enter your custom domain (e.g., www.joesroofing.com):\n\nAfter setting this, point your domain\'s CNAME record to roofmanager.ca');
    if (!domain) return;
    domain = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
    if (!domain) return;

    var data = await api('/sites/' + siteId, {
      method: 'PATCH',
      body: JSON.stringify({ custom_domain: domain })
    });
    if (data && data.success) {
      window.rmToast('Custom domain set to: ' + domain + '\n\nTo complete setup:\n1. Go to your domain registrar\n2. Add a CNAME record pointing to roofmanager.ca\n3. Wait for DNS propagation (up to 24 hours).', 'success');
      await loadSiteDetail(siteId);
      render();
    } else {
      window.rmToast('Failed to set domain: ' + (data ? data.error : 'Unknown error'), 'error');
    }
  };

  // Subscription
  window.wbSubscribe = async function() {
    var btn = document.getElementById('wb-subscribe-btn');
    if (btn) { btn.textContent = 'Redirecting to checkout...'; btn.disabled = true; btn.style.opacity = '0.6'; }

    var data = await api('/subscribe', { method: 'POST' });
    if (data && data.checkout_url) {
      window.location.href = data.checkout_url;
    } else if (data && data.active) {
      // Already subscribed
      state.subscriptionActive = true;
      await loadSites();
      render();
    } else {
      window.rmToast('Payment setup failed. Please try again or contact support.', 'error');
      if (btn) { btn.textContent = 'Subscribe & Build Your Site \u2192'; btn.disabled = false; btn.style.opacity = '1'; }
    }
  };

  // ============================================================
  // UTILS
  // ============================================================
  function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function formatDate(dateStr) {
    if (!dateStr) return '-';
    try { return new Date(dateStr).toLocaleDateString(); } catch(e) { return dateStr; }
  }

  // ============================================================
  // INIT
  // ============================================================
  // Check for payment redirect
  var urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('wb_payment') === 'success') {
    // Confirm subscription after Square payment redirect
    api('/subscribe/confirm', { method: 'POST' }).then(function() {
      state.subscriptionActive = true;
      state.subscriptionChecked = true;
      // Clean up URL
      window.history.replaceState({}, '', window.location.pathname);
      loadSites();
    });
  } else {
    // Normal load — check subscription first
    checkSubscription().then(function() {
      if (state.subscriptionActive) {
        loadSites();
      } else {
        render();
      }
    });
  }
})();

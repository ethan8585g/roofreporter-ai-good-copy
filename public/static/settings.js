// ============================================================
// Settings Page - Company Configuration, API Keys, Pricing & Billing
// ============================================================
// SECURITY MODEL:
// - API keys are stored in Cloudflare environment variables
// - Keys are NEVER stored in the database or exposed to frontend
// - Pricing/packages are stored in DB (non-sensitive)
// ============================================================

const settingsState = {
  loading: true,
  activeSection: 'company',
  masterCompany: null,
  settings: [],
  envStatus: null,
  pricingConfig: null,
  squareStatus: null,
  saving: false
};

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  renderSettings();
});

function settingsHeaders() {
  const token = localStorage.getItem('rc_token');
  return token ? { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

async function loadSettings() {
  settingsState.loading = true;
  try {
    const [compRes, settRes, envRes] = await Promise.all([
      fetch('/api/companies/master'),
      fetch('/api/settings', { headers: settingsHeaders() }),
      fetch('/api/health')
    ]);
    const compData = await compRes.json();
    settingsState.masterCompany = compData.company;
    const settData = await settRes.json();
    settingsState.settings = settData.settings || [];
    const envData = await envRes.json();
    settingsState.envStatus = envData.env_configured || {};
  } catch (e) {
    console.error('Settings load error:', e);
  }
  settingsState.loading = false;
}

async function loadPricingData() {
  try {
    const [pricingRes, squareRes] = await Promise.all([
      fetch('/api/settings/pricing/config', { headers: settingsHeaders() }),
      fetch('/api/settings/square/status', { headers: settingsHeaders() })
    ]);
    if (pricingRes.ok) {
      settingsState.pricingConfig = await pricingRes.json();
    } else {
      console.error('Pricing API error:', pricingRes.status);
    }
    if (squareRes.ok) {
      settingsState.squareStatus = await squareRes.json();
    }
  } catch (e) {
    console.error('Pricing load error:', e);
  }
}

function renderSettings() {
  const root = document.getElementById('settings-root');
  if (!root) return;

  if (settingsState.loading) {
    root.innerHTML = `
      <div class="flex items-center justify-center py-12">
        <div class="spinner" style="border-color: rgba(16,185,129,0.3); border-top-color: #10b981; width: 40px; height: 40px;"></div>
        <span class="ml-3 text-gray-500">Loading settings...</span>
      </div>
    `;
    return;
  }

  // Material Defaults & Proposal Pricing moved to /customer/profile —
  // those are per-contractor settings, not platform-wide. Super admin keeps
  // company profile, API keys, billing, and SIP/telephony only.
  const sections = [
    { id: 'company', label: 'Company Profile', icon: 'fa-building' },
    { id: 'apikeys', label: 'API Keys', icon: 'fa-key' },
    { id: 'pricing', label: 'Pricing & Billing', icon: 'fa-dollar-sign' },
    { id: 'sip', label: 'SIP Bridge / Telephony', icon: 'fa-phone-alt' },
  ];

  root.innerHTML = `
    <div class="grid md:grid-cols-4 gap-6">
      <!-- Sidebar -->
      <div class="md:col-span-1">
        <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
          ${sections.map(s => `
            <button onclick="switchSection('${s.id}')"
              class="w-full px-4 py-3 text-left text-sm font-medium flex items-center space-x-2 transition-colors
              ${settingsState.activeSection === s.id ? 'bg-brand-50 text-brand-700 border-l-4 border-brand-500' : 'text-gray-600 hover:bg-gray-50 border-l-4 border-transparent'}">
              <i class="fas ${s.icon} w-5"></i>
              <span>${s.label}</span>
            </button>
          `).join('')}
        </div>
      </div>

      <!-- Content -->
      <div class="md:col-span-3">
        ${settingsState.activeSection === 'company' ? renderCompanySection() : ''}
        ${settingsState.activeSection === 'materials' ? renderMaterialsSection() : ''}
        ${settingsState.activeSection === 'proposal_pricing' ? renderProposalPricingSection() : ''}
        ${settingsState.activeSection === 'apikeys' ? renderApiKeysSection() : ''}
        ${settingsState.activeSection === 'pricing' ? renderPricingSection() : ''}
        ${settingsState.activeSection === 'sip' ? renderSipSection() : ''}
      </div>
    </div>
  `;

  // Load SIP data when SIP tab is selected
  if (settingsState.activeSection === 'sip') {
    loadSipTrunks();
  }

  // Load material preferences when materials tab is selected
  if (settingsState.activeSection === 'materials') {
    loadMaterialPreferences().then(() => {
      const contentEl = document.querySelector('.md\\:col-span-3');
      if (contentEl && settingsState.activeSection === 'materials') {
        contentEl.innerHTML = renderMaterialsSection();
      }
    });
  }

  // Load proposal pricing presets when that tab is selected
  if (settingsState.activeSection === 'proposal_pricing') {
    loadProposalPricingPresets().then(() => {
      const contentEl = document.querySelector('.md\\:col-span-3');
      if (contentEl && settingsState.activeSection === 'proposal_pricing') {
        contentEl.innerHTML = renderProposalPricingSection();
      }
    });
  }

  // ALWAYS reload pricing data when pricing tab is selected (never use stale cache)
  if (settingsState.activeSection === 'pricing') {
    settingsState.pricingConfig = null;
    loadPricingData().then(() => {
      const contentEl = document.querySelector('.md\\:col-span-3');
      if (contentEl && settingsState.activeSection === 'pricing') {
        contentEl.innerHTML = renderPricingSection();
      }
    });
  }
}

function switchSection(section) {
  settingsState.activeSection = section;
  renderSettings();
}

// ============================================================
// COMPANY PROFILE
// ============================================================
function renderCompanySection() {
  const c = settingsState.masterCompany || {};
  return `
    <div class="bg-white rounded-xl border border-gray-200 p-6">
      <h3 class="text-lg font-semibold text-gray-800 mb-1">
        <i class="fas fa-building mr-2 text-brand-500"></i>Master Company Profile
      </h3>
      <p class="text-sm text-gray-500 mb-6">This identifies your business on all reports and API requests</p>

      <div class="space-y-4">
        <div class="grid md:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Company Name <span class="text-red-500">*</span></label>
            <input type="text" id="mcName" value="${c.company_name || ''}" class="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500" placeholder="Roof Manager" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Contact Name <span class="text-red-500">*</span></label>
            <input type="text" id="mcContact" value="${c.contact_name || ''}" class="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500" />
          </div>
        </div>
        <div class="grid md:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Email <span class="text-red-500">*</span></label>
            <input type="email" id="mcEmail" value="${c.email || ''}" class="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Phone</label>
            <input type="tel" id="mcPhone" value="${c.phone || ''}" class="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500" />
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Street Address</label>
          <input type="text" id="mcAddress" value="${c.address || ''}" class="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500" />
        </div>
        <div class="grid md:grid-cols-3 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">City</label>
            <input type="text" id="mcCity" value="${c.city || ''}" class="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Province</label>
            <input type="text" id="mcProvince" value="${c.province || ''}" class="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Postal Code</label>
            <input type="text" id="mcPostal" value="${c.postal_code || ''}" class="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500" />
          </div>
        </div>
      </div>

      <div class="mt-6 flex items-center space-x-3">
        <button onclick="saveMasterCompany()" class="px-6 py-2.5 bg-brand-600 text-white rounded-lg hover:bg-brand-700 font-medium text-sm">
          <i class="fas fa-save mr-1"></i>Save Company Profile
        </button>
        <span id="compSaveStatus" class="text-sm text-gray-400"></span>
      </div>
    </div>
  `;
}

async function saveMasterCompany() {
  const data = {
    company_name: document.getElementById('mcName')?.value,
    contact_name: document.getElementById('mcContact')?.value,
    email: document.getElementById('mcEmail')?.value,
    phone: document.getElementById('mcPhone')?.value,
    address: document.getElementById('mcAddress')?.value,
    city: document.getElementById('mcCity')?.value,
    province: document.getElementById('mcProvince')?.value,
    postal_code: document.getElementById('mcPostal')?.value
  };

  if (!data.company_name || !data.contact_name || !data.email) {
    window.rmToast('Company name, contact name, and email are required', 'warning');
    return;
  }

  try {
    const res = await fetch('/api/companies/master', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (res.ok) {
      const el = document.getElementById('compSaveStatus');
      if (el) { el.textContent = 'Saved successfully!'; el.className = 'text-sm text-green-600'; }
      setTimeout(() => { if (el) el.textContent = ''; }, 3000);
    }
  } catch (e) {
    window.rmToast('Failed to save: ' + e.message, 'error');
  }
}

// ============================================================
// API KEYS — Environment Variable Status (Read-Only)
// ============================================================
function renderApiKeysSection() {
  const env = settingsState.envStatus || {};

  const keys = [
    {
      envVar: 'GOOGLE_SOLAR_API_KEY',
      label: 'Google Solar API Key',
      desc: 'Required for real roof measurement data from Google. Powers the core measurement engine.',
      icon: 'fa-sun', color: 'amber',
      configured: env.GOOGLE_SOLAR_API_KEY,
      setupCmd: 'npx wrangler pages secret put GOOGLE_SOLAR_API_KEY',
      localFile: '.dev.vars',
      getUrl: 'https://console.cloud.google.com/apis/library/solar.googleapis.com'
    },
    {
      envVar: 'GOOGLE_MAPS_API_KEY',
      label: 'Google Maps API Key',
      desc: 'Required for interactive satellite map and address geocoding.',
      icon: 'fa-map', color: 'blue',
      configured: env.GOOGLE_MAPS_API_KEY,
      setupCmd: 'npx wrangler pages secret put GOOGLE_MAPS_API_KEY',
      localFile: '.dev.vars',
      getUrl: 'https://console.cloud.google.com/apis/library/maps-backend.googleapis.com'
    },
    {
      envVar: 'SQUARE_ACCESS_TOKEN',
      label: 'Square Access Token',
      desc: 'Server-side only. Used for creating payment links and processing charges via Square API.',
      icon: 'fa-lock', color: 'purple',
      configured: env.SQUARE_ACCESS_TOKEN,
      setupCmd: 'npx wrangler pages secret put SQUARE_ACCESS_TOKEN',
      localFile: '.dev.vars',
      getUrl: 'https://developer.squareup.com/apps'
    },
    {
      envVar: 'SQUARE_APPLICATION_ID',
      label: 'Square Application ID',
      desc: 'Identifies your Square application (not a secret).',
      icon: 'fa-credit-card', color: 'purple',
      configured: env.SQUARE_APPLICATION_ID,
      setupCmd: 'npx wrangler pages secret put SQUARE_APPLICATION_ID',
      localFile: '.dev.vars',
      getUrl: 'https://developer.squareup.com/apps'
    }
  ];

  return `
    <div class="bg-white rounded-xl border border-gray-200 p-6 mb-6">
      <h3 class="text-lg font-semibold text-gray-800 mb-1">
        <i class="fas fa-shield-alt mr-2 text-brand-500"></i>API Key Configuration
      </h3>
      <p class="text-sm text-gray-500 mb-2">
        API keys are stored as <strong>environment variables</strong> for security.
      </p>

      <div class="bg-brand-50 border border-brand-200 rounded-lg p-4 mb-6">
        <h4 class="text-sm font-semibold text-brand-800 flex items-center">
          <i class="fas fa-shield-alt mr-2"></i>Security Architecture
        </h4>
        <ul class="mt-2 text-xs text-brand-700 space-y-1">
          <li><i class="fas fa-check mr-1"></i> API keys live in environment variables, not in code or database</li>
          <li><i class="fas fa-check mr-1"></i> Secret keys are server-side only</li>
          <li><i class="fas fa-check mr-1"></i> For production, use <code class="bg-brand-100 px-1 rounded">wrangler pages secret put</code></li>
        </ul>
      </div>

      <div class="space-y-4">
        ${keys.map(k => `
          <div class="border ${k.configured ? 'border-green-200 bg-green-50' : 'border-yellow-200 bg-yellow-50'} rounded-lg p-4">
            <div class="flex items-center justify-between">
              <div class="flex items-center space-x-3">
                <div class="w-10 h-10 bg-${k.color}-100 rounded-lg flex items-center justify-center">
                  <i class="fas ${k.icon} text-${k.color}-500"></i>
                </div>
                <div>
                  <h4 class="text-sm font-semibold text-gray-800">${k.label}</h4>
                  <p class="text-xs text-gray-500">${k.desc}</p>
                </div>
              </div>
              ${k.configured
                ? '<span class="px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium"><i class="fas fa-check-circle mr-1"></i>Active</span>'
                : '<span class="px-3 py-1 bg-yellow-100 text-yellow-700 rounded-full text-xs font-medium"><i class="fas fa-exclamation-triangle mr-1"></i>Not Set</span>'
              }
            </div>
            ${!k.configured ? `
              <div class="mt-3 bg-white rounded border border-gray-200 p-3">
                <p class="text-xs font-medium text-gray-700 mb-2">How to configure:</p>
                <div class="space-y-2 text-xs text-gray-600">
                  <div><span class="font-medium">Local:</span> Add to <code class="bg-gray-100 px-1 rounded">${k.localFile}</code>: <pre class="mt-1 bg-gray-800 text-green-400 p-2 rounded text-xs">${k.envVar}=your_key_here</pre></div>
                  <div><span class="font-medium">Production:</span><pre class="mt-1 bg-gray-800 text-green-400 p-2 rounded text-xs">${k.setupCmd}</pre></div>
                  <a href="${k.getUrl}" target="_blank" class="inline-block text-brand-600 hover:underline mt-1"><i class="fas fa-external-link-alt mr-0.5"></i>Get this API key</a>
                </div>
              </div>
            ` : `
              <div class="mt-2 text-xs text-green-600">
                <i class="fas fa-info-circle mr-1"></i>
                Environment variable <code class="bg-green-100 px-1 rounded">${k.envVar}</code> is configured and active.
              </div>
            `}
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// ============================================================
// PRICING & BILLING — Full pricing management
// ============================================================
function renderPricingSection() {
  const cfg = settingsState.pricingConfig;
  const sq = settingsState.squareStatus;

  if (!cfg) {
    return `
      <div class="bg-white rounded-xl border border-gray-200 p-6">
        <div class="flex items-center justify-center py-12">
          <div class="spinner" style="border-color: rgba(239,68,68,0.3); border-top-color: #ef4444; width: 32px; height: 32px;"></div>
          <span class="ml-3 text-gray-500">Loading pricing configuration...</span>
        </div>
      </div>`;
  }

  const p = cfg.pricing || {};
  const packages = cfg.packages || [];
  const activePackages = packages.filter(x => x.is_active);
  const inactivePackages = packages.filter(x => !x.is_active);

  return `
    <!-- Square Payment Terminal Status -->
    <div class="rounded-xl p-4 mb-6 ${sq && sq.connected ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl flex items-center justify-center ${sq && sq.connected ? 'bg-green-100' : 'bg-red-100'}">
            <i class="fas ${sq && sq.connected ? 'fa-check-circle text-green-600' : 'fa-exclamation-triangle text-red-600'} text-lg"></i>
          </div>
          <div>
            <h4 class="font-bold text-sm ${sq && sq.connected ? 'text-green-800' : 'text-red-800'}">
              ${sq && sq.connected ? 'Square Payment Terminal Connected' : 'Square Not Connected'}
            </h4>
            <p class="text-xs ${sq && sq.connected ? 'text-green-600' : 'text-red-600'}">
              ${sq && sq.connected
                ? (sq.merchant?.business_name || 'Connected') + (sq.location?.name ? ' — ' + sq.location.name : '') + (sq.location?.currency ? ' (' + sq.location.currency + ')' : '')
                : (sq?.error || 'Configure SQUARE_ACCESS_TOKEN in Cloudflare secrets')}
            </p>
          </div>
        </div>
        ${sq && sq.stats ? '<div class="text-right text-xs text-gray-500"><p>' + (sq.stats.total_payments || 0) + ' payments</p><p>' + (sq.stats.total_webhooks || 0) + ' webhooks</p></div>' : ''}
      </div>
    </div>

    <!-- Core Pricing -->
    <div class="bg-white rounded-xl border border-gray-200 p-6 mb-6">
      <h3 class="text-lg font-semibold text-gray-800 mb-1">
        <i class="fas fa-tag mr-2 text-red-500"></i>Core Pricing
      </h3>
      <p class="text-sm text-gray-500 mb-6">Set prices for reports, subscriptions, and services. All values in CAD.</p>

      <form id="settingsPricingForm" onsubmit="saveSettingsPricing(event)">
        <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-5">

          <!-- Price Per Report -->
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-1">
              <i class="fas fa-file-alt mr-1 text-blue-500"></i> Price Per Report
            </label>
            <div class="relative">
              <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">$</span>
              <input type="number" step="0.01" min="0" id="sp_report_price"
                value="${(p.price_per_report_cents / 100).toFixed(2)}"
                class="w-full pl-8 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-brand-500">
            </div>
            <p class="text-[10px] text-gray-400 mt-1">Single roof measurement report charge</p>
          </div>

          <!-- Free Trial Reports -->
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-1">
              <i class="fas fa-gift mr-1 text-purple-500"></i> Free Trial Reports
            </label>
            <input type="number" min="0" max="99" id="sp_free_trial"
              value="${p.free_trial_reports || 3}"
              class="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-brand-500">
            <p class="text-[10px] text-gray-400 mt-1">Free reports for new sign-ups</p>
          </div>

          <!-- Monthly Subscription -->
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-1">
              <i class="fas fa-calendar-alt mr-1 text-green-500"></i> Monthly Subscription
            </label>
            <div class="relative">
              <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">$</span>
              <input type="number" step="0.01" min="0" id="sp_sub_monthly"
                value="${(p.subscription_monthly_price_cents / 100).toFixed(2)}"
                class="w-full pl-8 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-brand-500">
            </div>
            <p class="text-[10px] text-gray-400 mt-1">Monthly CRM + unlimited reports (after trial)</p>
          </div>

          <!-- Annual Subscription -->
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-1">
              <i class="fas fa-calendar-check mr-1 text-indigo-500"></i> Annual Subscription
            </label>
            <div class="relative">
              <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">$</span>
              <input type="number" step="0.01" min="0" id="sp_sub_annual"
                value="${(p.subscription_annual_price_cents / 100).toFixed(2)}"
                class="w-full pl-8 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-brand-500">
            </div>
            <p class="text-[10px] text-gray-400 mt-1">Annual fee (discounted) for full CRM access</p>
          </div>

          <!-- Roofer Secretary Monthly -->
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-1">
              <i class="fas fa-headset mr-1 text-amber-500"></i> Roofer Secretary / mo
            </label>
            <div class="relative">
              <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">$</span>
              <input type="number" step="0.01" min="0" id="sp_sec_monthly"
                value="${(p.secretary_monthly_price_cents / 100).toFixed(2)}"
                class="w-full pl-8 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-brand-500">
            </div>
            <p class="text-[10px] text-gray-400 mt-1">AI receptionist monthly subscription</p>
          </div>

          <!-- Roofer Secretary Per-Call -->
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-1">
              <i class="fas fa-phone-alt mr-1 text-teal-500"></i> Secretary Per Call
            </label>
            <div class="relative">
              <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">$</span>
              <input type="number" step="0.01" min="0" id="sp_sec_percall"
                value="${(p.secretary_per_call_price_cents / 100).toFixed(2)}"
                class="w-full pl-8 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-brand-500">
            </div>
            <p class="text-[10px] text-gray-400 mt-1">Per-call fee for pay-as-you-go model</p>
          </div>
        </div>

        <!-- Subscription Features -->
        <div class="mt-5">
          <label class="block text-sm font-semibold text-gray-700 mb-1">
            <i class="fas fa-list-check mr-1 text-sky-500"></i> Subscription Features (comma-separated)
          </label>
          <textarea id="sp_sub_features" rows="2"
            class="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500"
            placeholder="Unlimited reports, Full CRM, AI Secretary, Custom branding, Priority support">${p.subscription_features || ''}</textarea>
          <p class="text-[10px] text-gray-400 mt-1">Shown on the public pricing page</p>
        </div>

        <div class="mt-5 flex items-center justify-between">
          <p class="text-xs text-gray-400"><i class="fas fa-info-circle mr-1"></i>Changes take effect immediately for new transactions</p>
          <button type="submit" id="spSaveBtn" class="px-6 py-2.5 bg-brand-600 text-white rounded-lg hover:bg-brand-700 font-medium text-sm transition-colors">
            <i class="fas fa-save mr-1"></i>Save Pricing
          </button>
        </div>
      </form>
    </div>

    <!-- Credit Report Packages -->
    <div class="bg-white rounded-xl border border-gray-200 p-6 mb-6">
      <div class="flex items-center justify-between mb-1">
        <h3 class="text-lg font-semibold text-gray-800">
          <i class="fas fa-box-open mr-2 text-amber-500"></i>Credit Report Packages
        </h3>
        <button onclick="showSettingsAddPkg()" class="px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 text-xs font-medium transition-colors">
          <i class="fas fa-plus mr-1"></i>Add Package
        </button>
      </div>
      <p class="text-sm text-gray-500 mb-5">Bulk credit packs purchased through Square checkout. Each credit = 1 roof report.</p>

      <!-- Active Packages -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        ${activePackages.map(pkg => settingsPackageCard(pkg, true)).join('')}
        ${activePackages.length === 0 ? '<p class="text-gray-400 text-sm col-span-4 py-4 text-center">No active packages. Click "Add Package" to create one.</p>' : ''}
      </div>

      ${inactivePackages.length > 0 ? `
        <div class="border-t border-gray-100 pt-4">
          <p class="text-xs text-gray-400 mb-3"><i class="fas fa-eye-slash mr-1"></i>Inactive Packages (hidden from customers)</p>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            ${inactivePackages.map(pkg => settingsPackageCard(pkg, false)).join('')}
          </div>
        </div>
      ` : ''}
    </div>

    <!-- Package Edit Modal -->
    <div id="spPkgModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" style="display:none">
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
        <div class="flex items-center justify-between mb-5">
          <h3 class="text-lg font-bold text-gray-800" id="spPkgTitle">Edit Package</h3>
          <button onclick="closeSettingsPkgModal()" class="text-gray-400 hover:text-gray-600"><i class="fas fa-times text-lg"></i></button>
        </div>
        <form onsubmit="saveSettingsPkg(event)">
          <input type="hidden" id="spPkgId" value="">
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Package Name</label>
              <input type="text" id="spPkgName" required placeholder="e.g. 10 Pack"
                class="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <input type="text" id="spPkgDesc" placeholder="e.g. 10 reports, $9 each"
                class="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500">
            </div>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Credits (Reports)</label>
                <input type="number" id="spPkgCredits" min="1" required
                  class="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-brand-500"
                  oninput="updateSettingsPkgPreview()">
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Total Price (CAD)</label>
                <div class="relative">
                  <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">$</span>
                  <input type="number" step="0.01" min="0.01" id="spPkgPrice" required
                    class="w-full pl-8 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-brand-500"
                    oninput="updateSettingsPkgPreview()">
                </div>
              </div>
            </div>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Sort Order</label>
                <input type="number" id="spPkgSort" min="0" value="0"
                  class="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-brand-500">
              </div>
              <div class="flex items-end">
                <label class="flex items-center gap-2 cursor-pointer py-2.5">
                  <input type="checkbox" id="spPkgActive" checked class="w-4 h-4 text-brand-600 rounded focus:ring-brand-500">
                  <span class="text-sm font-medium text-gray-700">Active (visible)</span>
                </label>
              </div>
            </div>
            <div id="spPkgPreview" class="text-center py-3 bg-gray-50 rounded-lg">
              <p class="text-xs text-gray-500">Enter credits and price to see per-report cost</p>
            </div>
          </div>
          <div class="flex gap-3 mt-6">
            <button type="button" onclick="closeSettingsPkgModal()" class="flex-1 px-4 py-2.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium transition-colors">Cancel</button>
            <button type="submit" id="spPkgSaveBtn" class="flex-1 px-4 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm font-semibold transition-colors">
              <i class="fas fa-save mr-1"></i> Save
            </button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function settingsPackageCard(pkg, isActive) {
  const perReport = pkg.credits > 0 ? (pkg.price_cents / 100 / pkg.credits).toFixed(2) : '0.00';
  const escName = (pkg.name || '').replace(/'/g, "\\'");
  const escDesc = (pkg.description || '').replace(/'/g, "\\'");
  return `
    <div class="border ${isActive ? 'border-gray-200' : 'border-gray-100 opacity-60'} rounded-xl p-4 ${isActive ? 'bg-white' : 'bg-gray-50'} relative hover:shadow-md transition-all">
      ${!isActive ? '<span class="absolute top-2 right-2 text-[9px] bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded-full font-medium">INACTIVE</span>' : ''}
      <div class="text-center mb-2">
        <p class="text-2xl font-black text-gray-900">${pkg.credits}</p>
        <p class="text-xs font-semibold text-gray-500 uppercase">${pkg.name}</p>
      </div>
      <div class="text-center mb-2">
        <p class="text-lg font-bold text-brand-600">$${(pkg.price_cents / 100).toFixed(2)}</p>
        <p class="text-[10px] text-gray-400">$${perReport} / report</p>
      </div>
      <p class="text-[10px] text-gray-400 text-center mb-3 min-h-[14px]">${pkg.description || ''}</p>
      <div class="flex gap-2">
        <button onclick="editSettingsPkg(${pkg.id}, '${escName}', '${escDesc}', ${pkg.credits}, ${pkg.price_cents}, ${pkg.sort_order || 0}, ${pkg.is_active})"
          class="flex-1 px-2 py-1.5 bg-gray-100 hover:bg-gray-200 rounded text-xs font-medium text-gray-700 transition-colors">
          <i class="fas fa-edit mr-1"></i>Edit
        </button>
        ${isActive
          ? '<button onclick="deactivateSettingsPkg(' + pkg.id + ')" class="px-2 py-1.5 bg-red-50 hover:bg-red-100 rounded text-xs font-medium text-red-600 transition-colors" title="Deactivate"><i class="fas fa-eye-slash"></i></button>'
          : '<button onclick="activateSettingsPkg(' + pkg.id + ')" class="px-2 py-1.5 bg-green-50 hover:bg-green-100 rounded text-xs font-medium text-green-600 transition-colors" title="Reactivate"><i class="fas fa-eye"></i></button>'
        }
      </div>
    </div>`;
}

// ============================================================
// PRICING ACTION HANDLERS
// ============================================================

async function saveSettingsPricing(e) {
  e.preventDefault();
  const btn = document.getElementById('spSaveBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Saving...';

  try {
    const body = {
      price_per_report_cents: Math.round(parseFloat(document.getElementById('sp_report_price').value) * 100),
      free_trial_reports: parseInt(document.getElementById('sp_free_trial').value) || 3,
      subscription_monthly_price_cents: Math.round(parseFloat(document.getElementById('sp_sub_monthly').value) * 100),
      subscription_annual_price_cents: Math.round(parseFloat(document.getElementById('sp_sub_annual').value) * 100),
      secretary_monthly_price_cents: Math.round(parseFloat(document.getElementById('sp_sec_monthly').value) * 100),
      secretary_per_call_price_cents: Math.round(parseFloat(document.getElementById('sp_sec_percall').value) * 100),
      subscription_features: document.getElementById('sp_sub_features').value.trim(),
    };

    const res = await fetch('/api/settings/pricing/config', {
      method: 'PUT',
      headers: settingsHeaders(),
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to save');
    }

    btn.innerHTML = '<i class="fas fa-check mr-1"></i> Saved!';
    btn.classList.replace('bg-brand-600', 'bg-green-600');
    // Reload pricing data from DB and re-render to show updated values
    settingsState.pricingConfig = null;
    await loadPricingData();
    setTimeout(() => {
      const contentEl = document.querySelector('.md\\:col-span-3');
      if (contentEl && settingsState.activeSection === 'pricing') {
        contentEl.innerHTML = renderPricingSection();
      }
    }, 1200);
  } catch (err) {
    window.rmToast('Error saving pricing: ' + err.message, 'error');
    btn.innerHTML = '<i class="fas fa-save mr-1"></i> Save Pricing';
    btn.disabled = false;
  }
}

function showSettingsAddPkg() {
  document.getElementById('spPkgTitle').textContent = 'Add New Package';
  document.getElementById('spPkgId').value = '';
  document.getElementById('spPkgName').value = '';
  document.getElementById('spPkgDesc').value = '';
  document.getElementById('spPkgCredits').value = '';
  document.getElementById('spPkgPrice').value = '';
  document.getElementById('spPkgSort').value = '0';
  document.getElementById('spPkgActive').checked = true;
  document.getElementById('spPkgPreview').innerHTML = '<p class="text-xs text-gray-500">Enter credits and price to see per-report cost</p>';
  document.getElementById('spPkgModal').style.display = 'flex';
}

function editSettingsPkg(id, name, desc, credits, priceCents, sortOrder, isActive) {
  document.getElementById('spPkgTitle').textContent = 'Edit Package';
  document.getElementById('spPkgId').value = id;
  document.getElementById('spPkgName').value = name;
  document.getElementById('spPkgDesc').value = desc;
  document.getElementById('spPkgCredits').value = credits;
  document.getElementById('spPkgPrice').value = (priceCents / 100).toFixed(2);
  document.getElementById('spPkgSort').value = sortOrder;
  document.getElementById('spPkgActive').checked = !!isActive;
  updateSettingsPkgPreview();
  document.getElementById('spPkgModal').style.display = 'flex';
}

function closeSettingsPkgModal() {
  document.getElementById('spPkgModal').style.display = 'none';
}

function updateSettingsPkgPreview() {
  const credits = parseInt(document.getElementById('spPkgCredits')?.value) || 0;
  const price = parseFloat(document.getElementById('spPkgPrice')?.value) || 0;
  const preview = document.getElementById('spPkgPreview');
  if (!preview) return;
  if (credits > 0 && price > 0) {
    const perReport = (price / credits).toFixed(2);
    preview.innerHTML = '<p class="text-sm font-bold text-green-700">$' + perReport + ' per report</p><p class="text-[10px] text-gray-400">' + credits + ' credits for $' + price.toFixed(2) + ' CAD</p>';
  } else {
    preview.innerHTML = '<p class="text-xs text-gray-500">Enter credits and price to see per-report cost</p>';
  }
}

async function saveSettingsPkg(e) {
  e.preventDefault();
  const btn = document.getElementById('spPkgSaveBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Saving...';

  const id = document.getElementById('spPkgId').value;
  const body = {
    name: document.getElementById('spPkgName').value.trim(),
    description: document.getElementById('spPkgDesc').value.trim(),
    credits: parseInt(document.getElementById('spPkgCredits').value),
    price_cents: Math.round(parseFloat(document.getElementById('spPkgPrice').value) * 100),
    sort_order: parseInt(document.getElementById('spPkgSort').value) || 0,
    is_active: document.getElementById('spPkgActive').checked,
  };

  if (!body.name || !body.credits || !body.price_cents) {
    window.rmToast('Name, credits, and price are required.', 'warning');
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-save mr-1"></i> Save';
    return;
  }

  try {
    const url = id ? '/api/settings/packages/' + id : '/api/settings/packages';
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: settingsHeaders(),
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to save package');
    }

    closeSettingsPkgModal();
    // Reload pricing data and re-render
    settingsState.pricingConfig = null;
    await loadPricingData();
    const contentEl = document.querySelector('.md\\:col-span-3');
    if (contentEl) contentEl.innerHTML = renderPricingSection();
  } catch (err) {
    window.rmToast('Error: ' + err.message, 'error');
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-save mr-1"></i> Save';
  }
}

async function deactivateSettingsPkg(id) {
  if (!(await window.rmConfirm('Deactivate this package? It will be hidden from customers.'))) return
  try {
    const res = await fetch('/api/settings/packages/' + id, { method: 'DELETE', headers: settingsHeaders() });
    if (!res.ok) throw new Error('Failed');
    settingsState.pricingConfig = null;
    await loadPricingData();
    const contentEl = document.querySelector('.md\\:col-span-3');
    if (contentEl) contentEl.innerHTML = renderPricingSection();
  } catch (err) {
    window.rmToast('Error deactivating package: ' + err.message, 'error');
  }
}

async function activateSettingsPkg(id) {
  try {
    const res = await fetch('/api/settings/packages/' + id + '/activate', { method: 'PUT', headers: settingsHeaders() });
    if (!res.ok) throw new Error('Failed');
    settingsState.pricingConfig = null;
    await loadPricingData();
    const contentEl = document.querySelector('.md\\:col-span-3');
    if (contentEl) contentEl.innerHTML = renderPricingSection();
  } catch (err) {
    window.rmToast('Error activating package: ' + err.message, 'error');
  }
}

// ============================================================
// SIP BRIDGE / TELEPHONY SECTION
// ============================================================
let sipTrunksData = null;
let sipLoading = false;

async function loadSipTrunks() {
  sipLoading = true;
  try {
    const res = await fetch('/api/secretary/sip/trunks', { headers: settingsHeaders() });
    const data = await res.json();
    if (res.ok) sipTrunksData = data;
    else sipTrunksData = { error: data.error || 'Failed to load SIP trunks' };
  } catch (e) {
    sipTrunksData = { error: e.message };
  }
  sipLoading = false;
  const el = document.getElementById('sipContent');
  if (el) el.innerHTML = renderSipContent();
}

function renderSipSection() {
  return `
    <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div class="bg-gradient-to-r from-violet-600 to-purple-600 text-white px-6 py-4">
        <h3 class="text-lg font-bold"><i class="fas fa-phone-alt mr-2"></i>SIP Bridge / Telephony</h3>
        <p class="text-purple-200 text-sm mt-1">Connect AI Secretary to real phone numbers via LiveKit SIP</p>
      </div>
      <div class="p-6" id="sipContent">${sipLoading ? '<div class="text-center py-6"><i class="fas fa-spinner fa-spin text-2xl text-gray-300"></i></div>' : renderSipContent()}</div>
    </div>
  `;
}

function renderSipContent() {
  if (!sipTrunksData) return '<div class="text-center py-6 text-gray-400"><i class="fas fa-spinner fa-spin mr-2"></i>Loading SIP configuration...</div>';
  if (sipTrunksData.error) return '<div class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm"><i class="fas fa-exclamation-triangle mr-1"></i>' + sipTrunksData.error + '</div>';

  const inbound = sipTrunksData.inbound_trunks || [];
  const outbound = sipTrunksData.outbound_trunks || [];
  const rules = sipTrunksData.dispatch_rules || [];

  return `
    <!-- Quick Actions -->
    <div class="grid md:grid-cols-2 gap-4 mb-6">
      <div class="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl border border-green-200 p-5">
        <h4 class="font-bold text-green-800 mb-2"><i class="fas fa-phone-volume mr-2"></i>Outbound Trunk</h4>
        <p class="text-xs text-green-600 mb-3">Create a trunk so your AI can dial out to real phone numbers</p>
        <div class="space-y-2">
          <input type="text" id="sipOutPhone" placeholder="+17805551234" class="w-full px-3 py-2 border border-green-300 rounded-lg text-sm" />
          <input type="text" id="sipOutName" placeholder="Trunk name (optional)" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          <details class="text-xs text-gray-500">
            <summary class="cursor-pointer font-medium text-green-700">Advanced: Custom SIP Provider</summary>
            <div class="mt-2 space-y-2 pl-2 border-l-2 border-green-200">
              <input type="text" id="sipOutAddress" placeholder="SIP address (e.g. proxy1.dynsipt.broadconnect.ca)" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
              <input type="text" id="sipOutUser" placeholder="Auth username (e.g. Telus pilot number)" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
              <input type="password" id="sipOutPass" placeholder="Auth password" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
              <p class="text-xs text-gray-400">Leave blank to use LiveKit Cloud's built-in PSTN (simplest)</p>
            </div>
          </details>
          <button onclick="createOutboundTrunk()" class="w-full py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-bold transition-colors">
            <i class="fas fa-plus mr-1"></i>Create Outbound Trunk
          </button>
        </div>
      </div>

      <div class="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl border border-blue-200 p-5">
        <h4 class="font-bold text-blue-800 mb-2"><i class="fas fa-phone mr-2"></i>Quick Dial</h4>
        <p class="text-xs text-blue-600 mb-3">Test: Dial a phone number from your AI agent</p>
        <div class="space-y-2">
          <input type="text" id="sipDialNumber" placeholder="+17805551234" class="w-full px-3 py-2 border border-blue-300 rounded-lg text-sm" />
          <input type="text" id="sipDialRoom" placeholder="Room name (auto-generated if blank)" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          <button onclick="dialOut()" class="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold transition-colors" ${outbound.length === 0 ? 'disabled title="Create an outbound trunk first"' : ''}>
            <i class="fas fa-phone mr-1"></i>Dial Out
          </button>
          ${outbound.length === 0 ? '<p class="text-xs text-amber-600"><i class="fas fa-exclamation-circle mr-1"></i>Create an outbound trunk first</p>' : ''}
        </div>
      </div>
    </div>

    <!-- Existing Trunks -->
    <div class="space-y-4">
      <h4 class="text-sm font-bold text-gray-500 uppercase tracking-wide">Active SIP Trunks</h4>

      ${outbound.length === 0 && inbound.length === 0 ? '<div class="bg-gray-50 rounded-lg p-6 text-center text-gray-400"><i class="fas fa-plug text-3xl mb-2"></i><p class="text-sm">No SIP trunks configured yet</p><p class="text-xs mt-1">Create an outbound trunk to start making calls</p></div>' : ''}

      ${outbound.map(t => '<div class="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-lg">' +
        '<div class="flex items-center gap-3">' +
          '<div class="w-8 h-8 bg-green-200 rounded-lg flex items-center justify-center"><i class="fas fa-arrow-up text-green-700 text-xs"></i></div>' +
          '<div>' +
            '<p class="text-sm font-medium text-gray-800">' + (t.name || 'Outbound') + '</p>' +
            '<p class="text-xs text-gray-500">' + (t.numbers || []).join(', ') + ' &middot; ' + (t.address || 'LiveKit PSTN') + '</p>' +
          '</div>' +
        '</div>' +
        '<div class="flex items-center gap-2">' +
          '<span class="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-[10px] font-bold">OUTBOUND</span>' +
          '<button onclick="deleteTrunk(\'' + t.sip_trunk_id + '\')" class="p-1 text-gray-400 hover:text-red-600"><i class="fas fa-trash text-xs"></i></button>' +
        '</div></div>').join('')}

      ${inbound.map(t => '<div class="flex items-center justify-between p-3 bg-blue-50 border border-blue-200 rounded-lg">' +
        '<div class="flex items-center gap-3">' +
          '<div class="w-8 h-8 bg-blue-200 rounded-lg flex items-center justify-center"><i class="fas fa-arrow-down text-blue-700 text-xs"></i></div>' +
          '<div>' +
            '<p class="text-sm font-medium text-gray-800">' + (t.name || 'Inbound') + '</p>' +
            '<p class="text-xs text-gray-500">' + (t.numbers || []).join(', ') + '</p>' +
          '</div>' +
        '</div>' +
        '<div class="flex items-center gap-2">' +
          '<span class="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-[10px] font-bold">INBOUND</span>' +
          '<button onclick="deleteTrunk(\'' + t.sip_trunk_id + '\')" class="p-1 text-gray-400 hover:text-red-600"><i class="fas fa-trash text-xs"></i></button>' +
        '</div></div>').join('')}

      ${rules.length > 0 ? '<h4 class="text-sm font-bold text-gray-500 uppercase tracking-wide mt-4">Dispatch Rules</h4>' +
        rules.map(r => '<div class="flex items-center justify-between p-2 bg-gray-50 rounded-lg text-sm">' +
          '<span class="text-gray-600"><i class="fas fa-route text-xs mr-2 text-purple-400"></i>' + (r.name || r.sip_dispatch_rule_id) + '</span>' +
          '<span class="text-xs text-gray-400">' + (r.trunk_ids || []).join(', ') + '</span>' +
        '</div>').join('') : ''}
    </div>

    <div id="sipMsg" class="hidden mt-4 p-3 rounded-lg text-sm"></div>
  `;
}

async function createOutboundTrunk() {
  const phone = document.getElementById('sipOutPhone')?.value?.trim();
  if (!phone) { window.rmToast('Enter a phone number', 'info'); return; }
  const name = document.getElementById('sipOutName')?.value?.trim() || 'Roof Manager Outbound';
  const address = document.getElementById('sipOutAddress')?.value?.trim() || '';
  const auth_username = document.getElementById('sipOutUser')?.value?.trim() || '';
  const auth_password = document.getElementById('sipOutPass')?.value?.trim() || '';

  try {
    const res = await fetch('/api/secretary/sip/outbound-trunk', {
      method: 'POST', headers: settingsHeaders(),
      body: JSON.stringify({ name, phone_number: phone, address, auth_username, auth_password })
    });
    const data = await res.json();
    if (data.success) {
      showSipMsg('success', '<i class="fas fa-check-circle mr-1"></i>' + data.message);
      loadSipTrunks();
    } else {
      showSipMsg('error', data.error || 'Failed');
    }
  } catch (e) {
    showSipMsg('error', 'Network error: ' + e.message);
  }
}

async function dialOut() {
  const phone = document.getElementById('sipDialNumber')?.value?.trim();
  if (!phone) { window.rmToast('Enter a phone number to dial', 'info'); return; }
  const room = document.getElementById('sipDialRoom')?.value?.trim() || '';

  try {
    const res = await fetch('/api/secretary/sip/dial', {
      method: 'POST', headers: settingsHeaders(),
      body: JSON.stringify({ phone_number: phone, room_name: room })
    });
    const data = await res.json();
    if (data.success) {
      showSipMsg('success', '<i class="fas fa-phone mr-1"></i>Dialing ' + phone + '... Room: ' + data.room_name);
    } else {
      showSipMsg('error', data.error || 'Dial failed');
    }
  } catch (e) {
    showSipMsg('error', 'Network error: ' + e.message);
  }
}

async function deleteTrunk(trunkId) {
  if (!(await window.rmConfirm('Delete this SIP trunk?'))) return
  try {
    const res = await fetch('/api/secretary/sip/trunk/' + trunkId, {
      method: 'DELETE', headers: settingsHeaders()
    });
    const data = await res.json();
    if (data.success) {
      showSipMsg('success', 'Trunk deleted');
      loadSipTrunks();
    } else {
      showSipMsg('error', data.error || 'Delete failed');
    }
  } catch (e) {
    showSipMsg('error', 'Network error: ' + e.message);
  }
}

function showSipMsg(type, msg) {
  const el = document.getElementById('sipMsg');
  if (!el) return;
  el.className = type === 'error'
    ? 'mt-4 p-3 rounded-lg text-sm bg-red-50 text-red-700 border border-red-200'
    : 'mt-4 p-3 rounded-lg text-sm bg-green-50 text-green-700 border border-green-200';
  el.innerHTML = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 8000);
}

// ============================================================
// PROPOSAL PRICING PRESETS — Markup, Per Square, Per Bundle
// ============================================================

let proposalPricingPresets = null;

async function loadProposalPricingPresets() {
  try {
    const res = await fetch('/api/admin/material-preferences', { headers: settingsHeaders() });
    if (res.ok) {
      const data = await res.json();
      proposalPricingPresets = data.preferences?.proposal_pricing || {
        pricing_mode: 'markup',
        markup_percent: 30,
        price_per_square: 350,
        price_per_bundle: 125,
        include_labor: true,
        labor_per_square: 180,
        include_tearoff: true,
        tearoff_per_square: 45,
        tax_rate_override: null,
      };
    }
  } catch (e) {
    console.error('Proposal pricing load error:', e);
  }
}

function selectPricingMode(mode) {
  if (!proposalPricingPresets) proposalPricingPresets = {};
  proposalPricingPresets.pricing_mode = mode;
  const contentEl = document.querySelector('.md\\:col-span-3');
  if (contentEl) contentEl.innerHTML = renderProposalPricingSection();
}

function renderProposalPricingSection() {
  const p = proposalPricingPresets || {
    pricing_mode: 'markup',
    markup_percent: 30,
    price_per_square: 350,
    price_per_bundle: 125,
    include_labor: true,
    labor_per_square: 180,
    include_tearoff: true,
    tearoff_per_square: 45,
    tax_rate_override: null,
  };

  const modes = [
    { id: 'markup', label: 'Markup %', icon: 'fa-percentage', desc: 'Set a markup percentage on top of your material costs' },
    { id: 'per_square', label: 'Price per Square', icon: 'fa-th-large', desc: 'Set a flat rate per roofing square (100 sq ft)' },
    { id: 'per_bundle', label: 'Price per Bundle', icon: 'fa-boxes', desc: 'Set a price per shingle bundle — auto-calculates from report bundle count' },
  ];

  return `
    <div class="bg-white rounded-xl border border-gray-200 p-6">
      <h3 class="text-lg font-semibold text-gray-800 mb-1">
        <i class="fas fa-file-invoice-dollar mr-2 text-brand-500"></i>Proposal Pricing Presets
      </h3>
      <p class="text-sm text-gray-500 mb-6">Set your default pricing method. When you create a proposal from a roof measurement report, these presets auto-fill your pricing so the proposal is ready to send.</p>

      <div id="ppMsg" class="hidden mb-4"></div>

      <!-- Pricing Mode Selector -->
      <label class="block text-sm font-semibold text-gray-700 mb-3">Pricing Method</label>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        ${modes.map(m => `
          <div onclick="selectPricingMode('${m.id}')" id="pp-mode-${m.id}"
            class="cursor-pointer rounded-xl border-2 p-4 transition-all hover:shadow-md text-center
            ${p.pricing_mode === m.id ? 'border-brand-500 bg-brand-50 shadow-md ring-2 ring-brand-200' : 'border-gray-200 bg-white hover:border-gray-300'}">
            <div class="w-12 h-12 mx-auto mb-3 rounded-full flex items-center justify-center ${p.pricing_mode === m.id ? 'bg-brand-100' : 'bg-gray-100'}">
              <i class="fas ${m.icon} text-lg ${p.pricing_mode === m.id ? 'text-brand-600' : 'text-gray-400'}"></i>
            </div>
            <div class="font-bold text-sm ${p.pricing_mode === m.id ? 'text-brand-700' : 'text-gray-700'}">${m.label}</div>
            <p class="text-xs text-gray-500 mt-1">${m.desc}</p>
            ${p.pricing_mode === m.id ? '<div class="mt-2"><i class="fas fa-check-circle text-brand-500 text-sm"></i></div>' : ''}
          </div>
        `).join('')}
      </div>

      <!-- Mode-specific settings -->
      <div class="bg-gray-50 rounded-xl border border-gray-200 p-5 mb-6">
        ${p.pricing_mode === 'markup' ? `
          <h4 class="font-semibold text-gray-700 text-sm mb-4"><i class="fas fa-percentage mr-2 text-brand-500"></i>Markup Settings</h4>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-600 mb-1">Markup Percentage (%)</label>
              <input id="ppMarkupPct" type="number" step="1" min="0" max="500" value="${p.markup_percent || 30}"
                class="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm font-bold text-lg focus:ring-2 focus:ring-brand-400 focus:border-brand-400">
              <p class="text-xs text-gray-400 mt-1">Customer price = your cost + markup %</p>
            </div>
            <div class="flex items-center justify-center">
              <div class="text-center p-4 bg-white rounded-lg border border-gray-200">
                <div class="text-xs text-gray-500 mb-1">Example: $10,000 cost</div>
                <div class="text-2xl font-bold text-brand-600">$${((10000 * (1 + (p.markup_percent || 30) / 100))).toLocaleString()}</div>
                <div class="text-xs text-gray-400">customer price</div>
              </div>
            </div>
          </div>
        ` : p.pricing_mode === 'per_square' ? `
          <h4 class="font-semibold text-gray-700 text-sm mb-4"><i class="fas fa-th-large mr-2 text-brand-500"></i>Price Per Square Settings</h4>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-600 mb-1">Customer Price per Square ($)</label>
              <input id="ppPricePerSq" type="number" step="5" min="0" value="${p.price_per_square || 350}"
                class="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm font-bold text-lg focus:ring-2 focus:ring-brand-400 focus:border-brand-400">
              <p class="text-xs text-gray-400 mt-1">1 square = 100 sq ft of roofing</p>
            </div>
            <div class="flex items-center justify-center">
              <div class="text-center p-4 bg-white rounded-lg border border-gray-200">
                <div class="text-xs text-gray-500 mb-1">Example: 25-square roof</div>
                <div class="text-2xl font-bold text-brand-600">$${(25 * (p.price_per_square || 350)).toLocaleString()}</div>
                <div class="text-xs text-gray-400">total customer price</div>
              </div>
            </div>
          </div>
        ` : `
          <h4 class="font-semibold text-gray-700 text-sm mb-4"><i class="fas fa-boxes mr-2 text-brand-500"></i>Price Per Bundle Settings</h4>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-600 mb-1">Price per Shingle Bundle ($)</label>
              <input id="ppPricePerBundle" type="number" step="5" min="0" value="${p.price_per_bundle || 125}"
                class="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm font-bold text-lg focus:ring-2 focus:ring-brand-400 focus:border-brand-400">
              <p class="text-xs text-gray-400 mt-1">Typically 3 bundles = 1 square (100 sq ft)</p>
            </div>
            <div class="flex items-center justify-center">
              <div class="text-center p-4 bg-white rounded-lg border border-gray-200">
                <div class="text-xs text-gray-500 mb-1">Example: 75 bundles</div>
                <div class="text-2xl font-bold text-brand-600">$${(75 * (p.price_per_bundle || 125)).toLocaleString()}</div>
                <div class="text-xs text-gray-400">shingle cost to customer</div>
              </div>
            </div>
          </div>
        `}
      </div>

      <!-- Additional cost options -->
      <div class="bg-gray-50 rounded-xl border border-gray-200 p-5 mb-6">
        <h4 class="font-semibold text-gray-700 text-sm mb-4"><i class="fas fa-tools mr-2 text-brand-500"></i>Additional Line Items (auto-added to proposals)</h4>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <div class="flex items-center gap-3 mb-2">
              <button onclick="togglePPPref('include_labor')" id="ppLabor"
                class="px-3 py-1.5 rounded-lg text-xs font-bold transition-all
                ${p.include_labor !== false ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-500'}">
                ${p.include_labor !== false ? 'Included' : 'Excluded'}
              </button>
              <label class="text-sm font-medium text-gray-600">Installation Labor</label>
            </div>
            ${p.include_labor !== false ? `
              <input id="ppLaborPerSq" type="number" step="5" min="0" value="${p.labor_per_square || 180}"
                class="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-brand-400 focus:border-brand-400"
                placeholder="$/square for labor">
              <p class="text-xs text-gray-400 mt-1">Labor cost per square added as line item</p>
            ` : ''}
          </div>
          <div>
            <div class="flex items-center gap-3 mb-2">
              <button onclick="togglePPPref('include_tearoff')" id="ppTearoff"
                class="px-3 py-1.5 rounded-lg text-xs font-bold transition-all
                ${p.include_tearoff !== false ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-500'}">
                ${p.include_tearoff !== false ? 'Included' : 'Excluded'}
              </button>
              <label class="text-sm font-medium text-gray-600">Tear-off & Disposal</label>
            </div>
            ${p.include_tearoff !== false ? `
              <input id="ppTearoffPerSq" type="number" step="5" min="0" value="${p.tearoff_per_square || 45}"
                class="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-brand-400 focus:border-brand-400"
                placeholder="$/square for tear-off">
              <p class="text-xs text-gray-400 mt-1">Tear-off & disposal cost per square</p>
            ` : ''}
          </div>
        </div>
      </div>

      <!-- How it works explanation -->
      <div class="bg-blue-50 rounded-xl border border-blue-200 p-4 mb-6">
        <h4 class="font-semibold text-blue-800 text-sm mb-2"><i class="fas fa-info-circle mr-2"></i>How it works</h4>
        <ol class="text-xs text-blue-700 space-y-1 list-decimal list-inside">
          <li>Order a roof measurement report for your customer's property</li>
          <li>Go to Proposals and click <strong>Create Proposal</strong></li>
          <li>Select the roof measurement report — pricing auto-fills from these presets</li>
          <li>Add the customer and send — the proposal is ready in seconds</li>
        </ol>
      </div>

      <!-- Save Button -->
      <button onclick="saveProposalPricingPresets()" id="ppSaveBtn"
        class="w-full sm:w-auto px-8 py-3 rounded-xl font-bold text-white bg-brand-500 hover:bg-brand-600 transition-all shadow-md">
        <i class="fas fa-save mr-2"></i>Save Pricing Presets
      </button>
    </div>
  `;
}

function togglePPPref(field) {
  if (!proposalPricingPresets) proposalPricingPresets = {};
  proposalPricingPresets[field] = !proposalPricingPresets[field];
  const contentEl = document.querySelector('.md\\:col-span-3');
  if (contentEl) contentEl.innerHTML = renderProposalPricingSection();
}

async function saveProposalPricingPresets() {
  const btn = document.getElementById('ppSaveBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Saving...'; }

  const mode = proposalPricingPresets?.pricing_mode || 'markup';
  const markupEl = document.getElementById('ppMarkupPct');
  const perSqEl = document.getElementById('ppPricePerSq');
  const perBundleEl = document.getElementById('ppPricePerBundle');
  const laborEl = document.getElementById('ppLaborPerSq');
  const tearoffEl = document.getElementById('ppTearoffPerSq');

  const presets = {
    pricing_mode: mode,
    markup_percent: markupEl ? parseFloat(markupEl.value) : (proposalPricingPresets?.markup_percent || 30),
    price_per_square: perSqEl ? parseFloat(perSqEl.value) : (proposalPricingPresets?.price_per_square || 350),
    price_per_bundle: perBundleEl ? parseFloat(perBundleEl.value) : (proposalPricingPresets?.price_per_bundle || 125),
    include_labor: proposalPricingPresets?.include_labor !== false,
    labor_per_square: laborEl ? parseFloat(laborEl.value) : (proposalPricingPresets?.labor_per_square || 180),
    include_tearoff: proposalPricingPresets?.include_tearoff !== false,
    tearoff_per_square: tearoffEl ? parseFloat(tearoffEl.value) : (proposalPricingPresets?.tearoff_per_square || 45),
  };

  try {
    // First load existing prefs, then merge proposal_pricing into them
    const getRes = await fetch('/api/admin/material-preferences', { headers: settingsHeaders() });
    let existingPrefs = {};
    if (getRes.ok) {
      const getData = await getRes.json();
      existingPrefs = getData.preferences || {};
    }
    existingPrefs.proposal_pricing = presets;

    const res = await fetch('/api/admin/proposal-pricing', {
      method: 'PUT',
      headers: settingsHeaders(),
      body: JSON.stringify(presets)
    });
    const data = await res.json();
    if (data.success) {
      proposalPricingPresets = presets;
      showPPMsg('success', '<i class="fas fa-check-circle mr-1"></i>Proposal pricing presets saved! These will auto-apply when creating proposals from reports.');
    } else {
      showPPMsg('error', data.error || 'Save failed');
    }
  } catch (e) {
    showPPMsg('error', 'Network error: ' + e.message);
  }
  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save mr-2"></i>Save Pricing Presets'; }
}

function showPPMsg(type, msg) {
  const el = document.getElementById('ppMsg');
  if (!el) return;
  el.className = type === 'error'
    ? 'mb-4 p-3 rounded-lg text-sm bg-red-50 text-red-700 border border-red-200'
    : 'mb-4 p-3 rounded-lg text-sm bg-green-50 text-green-700 border border-green-200';
  el.innerHTML = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 8000);
}

// ============================================================
// MATERIAL DEFAULTS — Shingle type, waste factor, tax rate
// ============================================================

const SHINGLE_CATALOG = {
  '3tab':             { name: '3-Tab Standard',           price: '$32/bdl', warranty: '25-year', wind: '96 km/h',  weight: '210 lbs/sq', examples: 'IKO Marathon, GAF Royal Sovereign, CertainTeed XT 25', desc: 'Budget-friendly strip shingle. Flat, uniform look.' },
  'architectural':    { name: 'Architectural (Laminate)',  price: '$42/bdl', warranty: '30-year', wind: '210 km/h', weight: '250 lbs/sq', examples: 'IKO Cambridge, GAF Timberline HDZ, CertainTeed Landmark', desc: 'Industry standard. Dimensional shadow lines, enhanced wind resistance.' },
  'premium':          { name: 'Premium Architectural',     price: '$55/bdl', warranty: 'Ltd. Lifetime', wind: '210 km/h', weight: '280 lbs/sq', examples: 'IKO Dynasty, GAF Timberline AS II, CertainTeed Landmark PRO', desc: 'SBS-modified bitumen, algae resistant, superior flexibility.' },
  'designer':         { name: 'Designer / Luxury',         price: '$72/bdl', warranty: 'Lifetime', wind: '210 km/h', weight: '350 lbs/sq', examples: 'GAF Camelot II, CertainTeed Grand Manor, Owens Corning Berkshire', desc: 'Multi-layered premium. Mimics slate or cedar shake.' },
  'impact_resistant': { name: 'Impact-Resistant (Class 4)', price: '$62/bdl', warranty: 'Ltd. Lifetime', wind: '210 km/h', weight: '290 lbs/sq', examples: 'IKO Nordic IR, GAF Armor Shield II, CertainTeed Landmark IR', desc: 'UL 2218 Class 4 hail rated. May qualify for insurance discounts.' },
  'metal':            { name: 'Steel / Metal Shingles',    price: '$95/bdl', warranty: '50-year', wind: '200 km/h', weight: '150 lbs/sq', examples: 'EDCO Infiniti, Decra Shingle XD', desc: 'Interlocking steel panels. Fireproof, lightweight, extremely durable.' },
};

let materialPrefs = null;

async function loadMaterialPreferences() {
  try {
    const res = await fetch('/api/admin/material-preferences', { headers: settingsHeaders() });
    if (res.ok) {
      const data = await res.json();
      materialPrefs = data.preferences;
    }
  } catch (e) {
    console.error('Material preferences load error:', e);
  }
}

function renderMaterialsSection() {
  const p = materialPrefs || { shingle_type: 'architectural', waste_factor_pct: 15, tax_rate: 0.05, include_ventilation: true, include_pipe_boots: true };
  const wastOptions = [10, 12, 15, 17, 20];

  return `
    <div class="bg-white rounded-xl border border-gray-200 p-6">
      <h3 class="text-lg font-semibold text-gray-800 mb-1">
        <i class="fas fa-layer-group mr-2 text-brand-500"></i>Material Defaults
      </h3>
      <p class="text-sm text-gray-500 mb-6">Set your preferred shingle type and material settings. These defaults apply automatically to every new report.</p>

      <div id="materialMsg" class="hidden mb-4"></div>

      <!-- Shingle Type -->
      <label class="block text-sm font-semibold text-gray-700 mb-2">Shingle Type</label>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6" id="shingleGrid">
        ${Object.entries(SHINGLE_CATALOG).map(([key, s]) => `
          <div onclick="selectShingle('${key}')" id="shingle-${key}"
            class="cursor-pointer rounded-xl border-2 p-4 transition-all hover:shadow-md
            ${p.shingle_type === key ? 'border-brand-500 bg-brand-50 shadow-md ring-2 ring-brand-200' : 'border-gray-200 bg-white hover:border-gray-300'}">
            <div class="flex items-start justify-between mb-2">
              <span class="font-bold text-sm text-gray-800">${s.name}</span>
              ${p.shingle_type === key ? '<span class="text-brand-600 text-xs font-bold"><i class="fas fa-check-circle"></i></span>' : ''}
            </div>
            <p class="text-xs text-gray-500 mb-3">${s.desc}</p>
            <div class="grid grid-cols-2 gap-1 text-xs">
              <div class="text-gray-600"><i class="fas fa-dollar-sign text-green-500 mr-1"></i>${s.price}</div>
              <div class="text-gray-600"><i class="fas fa-shield-alt text-blue-500 mr-1"></i>${s.warranty}</div>
              <div class="text-gray-600"><i class="fas fa-wind text-cyan-500 mr-1"></i>${s.wind}</div>
              <div class="text-gray-600"><i class="fas fa-weight-hanging text-amber-500 mr-1"></i>${s.weight}</div>
            </div>
            <div class="mt-2 text-[10px] text-gray-400 italic truncate" title="${s.examples}">${s.examples}</div>
          </div>
        `).join('')}
      </div>

      <!-- Waste Factor -->
      <label class="block text-sm font-semibold text-gray-700 mb-2">Default Waste Factor</label>
      <div class="flex gap-2 mb-6">
        ${wastOptions.map(w => `
          <button onclick="selectWaste(${w})" id="waste-${w}"
            class="px-4 py-2 rounded-lg text-sm font-bold transition-all
            ${p.waste_factor_pct === w ? 'bg-brand-500 text-white shadow-md' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}">
            ${w}%
          </button>
        `).join('')}
      </div>

      <!-- Tax Rate & Toggles -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div>
          <label class="block text-sm font-semibold text-gray-700 mb-1">Tax Rate (%)</label>
          <input id="matTaxRate" type="number" step="0.5" min="0" max="20" value="${(p.tax_rate * 100).toFixed(1)}"
            class="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-brand-400 focus:border-brand-400">
          <p class="text-xs text-gray-400 mt-1">Alberta GST = 5%, Ontario HST = 13%</p>
        </div>
        <div>
          <label class="block text-sm font-semibold text-gray-700 mb-1">Include Ridge Vent</label>
          <button onclick="toggleMatPref('include_ventilation')" id="matVent"
            class="px-4 py-2 rounded-lg text-sm font-bold transition-all
            ${p.include_ventilation ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-500'}">
            ${p.include_ventilation ? 'Yes' : 'No'}
          </button>
        </div>
        <div>
          <label class="block text-sm font-semibold text-gray-700 mb-1">Include Pipe Boots</label>
          <button onclick="toggleMatPref('include_pipe_boots')" id="matPipe"
            class="px-4 py-2 rounded-lg text-sm font-bold transition-all
            ${p.include_pipe_boots ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-500'}">
            ${p.include_pipe_boots ? 'Yes' : 'No'}
          </button>
        </div>
      </div>

      <!-- Save Button -->
      <button onclick="saveMaterialPreferences()" id="matSaveBtn"
        class="w-full sm:w-auto px-8 py-3 rounded-xl font-bold text-white bg-brand-500 hover:bg-brand-600 transition-all shadow-md">
        <i class="fas fa-save mr-2"></i>Save Material Defaults
      </button>
    </div>
  `;
}

function selectShingle(key) {
  if (!materialPrefs) materialPrefs = {};
  materialPrefs.shingle_type = key;
  const contentEl = document.querySelector('.md\\:col-span-3');
  if (contentEl) contentEl.innerHTML = renderMaterialsSection();
}

function selectWaste(pct) {
  if (!materialPrefs) materialPrefs = {};
  materialPrefs.waste_factor_pct = pct;
  [10, 12, 15, 17, 20].forEach(w => {
    const btn = document.getElementById('waste-' + w);
    if (btn) {
      btn.className = w === pct
        ? 'px-4 py-2 rounded-lg text-sm font-bold transition-all bg-brand-500 text-white shadow-md'
        : 'px-4 py-2 rounded-lg text-sm font-bold transition-all bg-gray-100 text-gray-600 hover:bg-gray-200';
    }
  });
}

function toggleMatPref(field) {
  if (!materialPrefs) materialPrefs = {};
  materialPrefs[field] = !materialPrefs[field];
  const contentEl = document.querySelector('.md\\:col-span-3');
  if (contentEl) contentEl.innerHTML = renderMaterialsSection();
}

async function saveMaterialPreferences() {
  const btn = document.getElementById('matSaveBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Saving...'; }

  const taxInput = document.getElementById('matTaxRate');
  const taxVal = taxInput ? parseFloat(taxInput.value) : 5;

  const prefs = {
    shingle_type: materialPrefs?.shingle_type || 'architectural',
    waste_factor_pct: materialPrefs?.waste_factor_pct || 15,
    tax_rate: Math.max(0, Math.min(20, taxVal)) / 100,
    include_ventilation: materialPrefs?.include_ventilation !== false,
    include_pipe_boots: materialPrefs?.include_pipe_boots !== false,
  };

  try {
    const res = await fetch('/api/admin/material-preferences', {
      method: 'PUT',
      headers: settingsHeaders(),
      body: JSON.stringify(prefs)
    });
    const data = await res.json();
    if (data.success) {
      materialPrefs = prefs;
      showMatMsg('success', '<i class="fas fa-check-circle mr-1"></i>Material defaults saved. All future reports will use these settings automatically.');
    } else {
      showMatMsg('error', data.error || 'Save failed');
    }
  } catch (e) {
    showMatMsg('error', 'Network error: ' + e.message);
  }
  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save mr-2"></i>Save Material Defaults'; }
}

function showMatMsg(type, msg) {
  const el = document.getElementById('materialMsg');
  if (!el) return;
  el.className = type === 'error'
    ? 'mb-4 p-3 rounded-lg text-sm bg-red-50 text-red-700 border border-red-200'
    : 'mb-4 p-3 rounded-lg text-sm bg-green-50 text-green-700 border border-green-200';
  el.innerHTML = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 8000);
}

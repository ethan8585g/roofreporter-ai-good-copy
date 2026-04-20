// ============================================================
// Certificate Automations — Template designer + automation triggers
// ============================================================

const certState = {
  loading: true,
  designs: [],
  activeDesignId: null,
  automationSettings: {},
  sendLog: [],
  showLogPanel: false,
  // Current design being edited
  design: {
    name: 'Standard Certificate',
    template_style: 'classic',
    primary_color: '#1a5c38',
    secondary_color: '#f5b041',
    font_family: 'EB Garamond',
    license_number: '',
    custom_message: '',
    watermark_enabled: false,
    logo_alignment: 'left',
    is_default: true,
    cert_title: '',
    cert_subtitle: '',
    cert_body_text: '',
    footer_text: '',
    sig_left_label: '',
    sig_right_label: '',
  },
  // Active tab for customize panel
  activeTab: 'design',
  // Logo upload state
  logoPreview: null,
  logoUploading: false,
  dirty: false,
  previewLoading: false,
  // Invoicing automation
  invoicingSettings: {
    auto_invoice_enabled: false,
    invoice_pricing_mode: 'per_square',
    invoice_price_per_square: 350,
    invoice_price_per_bundle: 125,
  },
};

function authHeaders() {
  const t = localStorage.getItem('rc_customer_token');
  return t ? { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

// ── Bootstrap ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await Promise.all([loadDesigns(), loadAutomationSettings(), loadSendLog(), loadInvoicingSettings()]);
  certState.loading = false;
  render();
  // Auto-load preview after first render
  setTimeout(() => refreshPreview(), 300);
});

async function loadDesigns() {
  try {
    const r = await fetch('/api/crm/certificate-designs', { headers: authHeaders() });
    const d = await r.json();
    certState.designs = d.designs || [];
    if (certState.designs.length > 0) {
      const def = certState.designs.find(x => x.is_default) || certState.designs[0];
      selectDesign(def, true);
    }
  } catch (e) { console.error('Load designs:', e); }
}

async function loadAutomationSettings() {
  try {
    const r = await fetch('/api/crm/proposals/automation/settings', { headers: authHeaders() });
    certState.automationSettings = await r.json();
  } catch (e) { console.error('Load automation settings:', e); }
}

async function loadSendLog() {
  try {
    const r = await fetch('/api/crm/certificate-log', { headers: authHeaders() });
    const d = await r.json();
    certState.sendLog = d.log || [];
  } catch (e) { console.error('Load send log:', e); }
}

function selectDesign(design, skipRender) {
  certState.activeDesignId = design.id;
  certState.design = {
    name: design.name || 'Standard Certificate',
    template_style: design.template_style || 'classic',
    primary_color: design.primary_color || '#1a5c38',
    secondary_color: design.secondary_color || '#f5b041',
    font_family: design.font_family || 'EB Garamond',
    license_number: design.license_number || '',
    custom_message: design.custom_message || '',
    watermark_enabled: !!design.watermark_enabled,
    logo_alignment: design.logo_alignment || 'left',
    is_default: !!design.is_default,
    cert_title: design.cert_title || '',
    cert_subtitle: design.cert_subtitle || '',
    cert_body_text: design.cert_body_text || '',
    footer_text: design.footer_text || '',
    sig_left_label: design.sig_left_label || '',
    sig_right_label: design.sig_right_label || '',
  };
  certState.dirty = false;
  if (!skipRender) { render(); refreshPreview(); }
}

function markDirty() {
  certState.dirty = true;
  render();
}

// ── Preview ────────────────────────────────────────────────
async function refreshPreview() {
  certState.previewLoading = true;
  const iframe = document.getElementById('cert-preview-iframe');
  if (iframe) iframe.style.opacity = '0.4';
  try {
    const r = await fetch('/api/crm/certificate-preview', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(certState.design),
    });
    const html = await r.text();
    if (iframe) {
      iframe.srcdoc = html;
      iframe.style.opacity = '1';
    }
  } catch (e) {
    console.error('Preview error:', e);
  }
  certState.previewLoading = false;
}

// Debounced preview refresh
let previewTimer = null;
function debouncedPreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => refreshPreview(), 600);
}

// ── Save / Create / Delete ─────────────────────────────────
async function saveDesign() {
  const isNew = !certState.activeDesignId;
  const url = isNew
    ? '/api/crm/certificate-designs'
    : `/api/crm/certificate-designs/${certState.activeDesignId}`;
  const method = isNew ? 'POST' : 'PUT';
  try {
    const r = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(certState.design) });
    const d = await r.json();
    if (d.success) {
      if (isNew && d.id) certState.activeDesignId = d.id;
      showToast('Certificate design saved!');
      await loadDesigns();
      render();
    }
  } catch (e) { showToast('Failed to save', true); }
  certState.dirty = false;
}

async function createNewDesign() {
  certState.activeDesignId = null;
  certState.design = {
    name: 'New Certificate',
    template_style: 'classic',
    primary_color: '#1a5c38',
    secondary_color: '#f5b041',
    font_family: 'EB Garamond',
    license_number: '',
    custom_message: '',
    watermark_enabled: false,
    logo_alignment: 'left',
    is_default: false,
    cert_title: '',
    cert_subtitle: '',
    cert_body_text: '',
    footer_text: '',
    sig_left_label: '',
    sig_right_label: '',
  };
  certState.dirty = true;
  render();
  refreshPreview();
}

async function deleteDesign(id) {
  if (!confirm('Delete this certificate design?')) return;
  try {
    await fetch(`/api/crm/certificate-designs/${id}`, { method: 'DELETE', headers: authHeaders() });
    showToast('Design deleted');
    await loadDesigns();
    if (certState.designs.length > 0) {
      selectDesign(certState.designs[0]);
    } else {
      certState.activeDesignId = null;
      render();
    }
  } catch (e) { showToast('Failed to delete', true); }
}

async function saveAutomationSettings(updates) {
  Object.assign(certState.automationSettings, updates);
  render();
  try {
    await fetch('/api/crm/proposals/automation/settings', {
      method: 'PUT', headers: authHeaders(),
      body: JSON.stringify(updates),
    });
    showToast('Automation settings saved!');
  } catch (e) { showToast('Failed to save', true); }
}

// ── Invoicing Automation ──────────────────────────────────
async function loadInvoicingSettings() {
  try {
    const r = await fetch('/api/crm/invoicing-automation/settings', { headers: authHeaders() });
    const d = await r.json();
    certState.invoicingSettings = {
      auto_invoice_enabled: !!d.auto_invoice_enabled,
      invoice_pricing_mode: d.invoice_pricing_mode || 'per_square',
      invoice_price_per_square: d.invoice_price_per_square ?? 350,
      invoice_price_per_bundle: d.invoice_price_per_bundle ?? 125,
    };
  } catch (e) { console.warn('Failed to load invoicing settings', e); }
}

async function saveInvoicingSettings(updates) {
  Object.assign(certState.invoicingSettings, updates);
  render();
  try {
    await fetch('/api/crm/invoicing-automation/settings', {
      method: 'PUT', headers: authHeaders(),
      body: JSON.stringify(updates),
    });
    showToast('Invoicing automation settings saved!');
  } catch (e) { showToast('Failed to save', true); }
}

// ── Toast ──────────────────────────────────────────────────
function showToast(msg, isError) {
  const el = document.createElement('div');
  el.className = 'cert-toast';
  el.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:9999;padding:14px 24px;border-radius:12px;font-size:14px;font-weight:600;color:white;background:${isError ? '#dc2626' : '#16a34a'};box-shadow:0 8px 24px rgba(0,0,0,0.2);transform:translateY(20px);opacity:0;transition:all 0.3s ease`;
  el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(() => { el.style.transform = 'translateY(0)'; el.style.opacity = '1'; });
  setTimeout(() => { el.style.transform = 'translateY(20px)'; el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3000);
}

// ── Template thumbnails ────────────────────────────────────
const TEMPLATES = [
  { id: 'classic', name: 'Classic', desc: 'Elegant double border, serif type', icon: 'fa-scroll', color: '#1a5c38' },
  { id: 'modern', name: 'Modern', desc: 'Gradient header, clean cards', icon: 'fa-layer-group', color: '#1e40af' },
  { id: 'bold', name: 'Bold', desc: 'Dark header, strong contrast', icon: 'fa-bolt', color: '#b91c1c' },
  { id: 'minimal', name: 'Minimal', desc: 'Ultra-clean, lots of whitespace', icon: 'fa-feather-alt', color: '#374151' },
];

const FONTS = [
  { name: 'EB Garamond', label: 'EB Garamond', type: 'Serif' },
  { name: 'Playfair Display', label: 'Playfair Display', type: 'Serif' },
  { name: 'Lora', label: 'Lora', type: 'Serif' },
  { name: 'Merriweather', label: 'Merriweather', type: 'Serif' },
  { name: 'Montserrat', label: 'Montserrat', type: 'Sans-serif' },
  { name: 'Raleway', label: 'Raleway', type: 'Sans-serif' },
];

const PALETTES = [
  { primary: '#1a5c38', secondary: '#f5b041', name: 'Forest & Gold' },
  { primary: '#1e40af', secondary: '#3b82f6', name: 'Blue Professional' },
  { primary: '#7c3aed', secondary: '#a78bfa', name: 'Royal Purple' },
  { primary: '#b91c1c', secondary: '#f59e0b', name: 'Red & Amber' },
  { primary: '#374151', secondary: '#6b7280', name: 'Slate Neutral' },
  { primary: '#0e7490', secondary: '#06b6d4', name: 'Teal Ocean' },
];

// ── Tab switching ─────────────────────────────────────────
function switchTab(tab) {
  certState.activeTab = tab;
  render();
  if (tab === 'logo') loadCurrentLogo();
}

// ── Logo upload ───────────────────────────────────────────
async function loadCurrentLogo() {
  try {
    const r = await fetch('/api/customer/me', { headers: authHeaders() });
    const d = await r.json();
    certState.logoPreview = d.brand_logo_url || null;
    render();
  } catch (e) { console.error('Load logo:', e); }
}

function handleLogoFileSelect(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    showToast('Logo must be under 2 MB', true);
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    certState.logoPreview = e.target.result;
    render();
  };
  reader.readAsDataURL(file);
}

async function uploadLogo() {
  if (!certState.logoPreview) return;
  certState.logoUploading = true;
  render();
  try {
    const r = await fetch('/api/customer/branding/logo', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ logo_data: certState.logoPreview }),
    });
    const d = await r.json();
    if (d.success) {
      showToast('Logo saved! It will appear on all certificates.');
      refreshPreview();
    } else {
      showToast('Failed to save logo', true);
    }
  } catch (e) {
    showToast('Failed to upload logo', true);
  }
  certState.logoUploading = false;
  render();
}

async function removeLogo() {
  if (!confirm('Remove your company logo?')) return;
  try {
    const r = await fetch('/api/customer/branding/logo', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ logo_data: null }),
    });
    const d = await r.json();
    if (d.success) {
      certState.logoPreview = null;
      showToast('Logo removed');
      render();
      refreshPreview();
    }
  } catch (e) { showToast('Failed to remove logo', true); }
}

// ── Render ──────────────────────────────────────────────────
function render() {
  const root = document.getElementById('cert-auto-root');
  if (!root) return;

  if (certState.loading) {
    root.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;padding:80px 0"><div style="width:40px;height:40px;border:3px solid #e5e7eb;border-top-color:#16a34a;border-radius:50%;animation:spin 0.8s linear infinite"></div></div>';
    return;
  }

  const s = certState.design;
  const a = certState.automationSettings;
  const activeTemplate = s.template_style || 'classic';

  root.innerHTML = `
    <!-- Page Title -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:28px;flex-wrap:wrap;gap:12px">
      <div>
        <h2 style="font-size:24px;font-weight:800;color:#111;margin:0">Auto-Send Certificate of Installation</h2>
        <p style="font-size:14px;color:#6b7280;margin-top:4px">Design professional certificates and automate delivery to your customers</p>
      </div>
      <button onclick="window.open('/api/crm/certificate-preview','_blank',JSON.stringify(certState.design))" style="display:none">hidden</button>
    </div>

    <!-- Template Strip -->
    <div style="background:white;border-radius:16px;border:1px solid #e5e7eb;padding:20px 24px;margin-bottom:20px;box-shadow:0 1px 3px rgba(0,0,0,0.04)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <p style="font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:1px;margin:0"><i class="fas fa-palette" style="margin-right:6px"></i>Choose Template</p>
        <button onclick="createNewDesign()" style="font-size:12px;color:#16a34a;font-weight:600;background:none;border:none;cursor:pointer"><i class="fas fa-plus" style="margin-right:4px"></i>Start from Scratch</button>
      </div>
      <div style="display:flex;gap:12px;overflow-x:auto;padding-bottom:4px">
        ${TEMPLATES.map(t => `
          <button onclick="certState.design.template_style='${t.id}';markDirty();debouncedPreview()"
            style="flex:0 0 auto;width:160px;padding:16px;border-radius:12px;border:2px solid ${activeTemplate === t.id ? t.color : '#e5e7eb'};background:${activeTemplate === t.id ? t.color + '08' : 'white'};cursor:pointer;text-align:left;transition:all 0.2s">
            <div style="width:36px;height:36px;border-radius:8px;background:${t.color}15;display:flex;align-items:center;justify-content:center;margin-bottom:10px">
              <i class="fas ${t.icon}" style="color:${t.color};font-size:16px"></i>
            </div>
            <div style="font-size:13px;font-weight:700;color:#111">${t.name}</div>
            <div style="font-size:11px;color:#9ca3af;margin-top:2px">${t.desc}</div>
          </button>
        `).join('')}
      </div>
    </div>

    <!-- Main 2-column layout: Customize + Preview -->
    <div style="display:grid;grid-template-columns:380px 1fr;gap:20px;align-items:start">

      <!-- LEFT: Customize Panel -->
      <div style="background:white;border-radius:16px;border:1px solid #e5e7eb;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.04)">
        <!-- Tab Bar -->
        <div style="display:flex;border-bottom:1px solid #e5e7eb">
          <button onclick="switchTab('design')" style="flex:1;padding:14px 12px;font-size:12px;font-weight:700;border:none;cursor:pointer;background:${certState.activeTab === 'design' ? 'white' : '#f9fafb'};color:${certState.activeTab === 'design' ? '#111' : '#9ca3af'};border-bottom:2px solid ${certState.activeTab === 'design' ? '#111' : 'transparent'};transition:all 0.2s">
            <i class="fas fa-sliders-h" style="margin-right:5px"></i>Design
          </button>
          <button onclick="switchTab('content')" style="flex:1;padding:14px 12px;font-size:12px;font-weight:700;border:none;cursor:pointer;background:${certState.activeTab === 'content' ? 'white' : '#f9fafb'};color:${certState.activeTab === 'content' ? '#111' : '#9ca3af'};border-bottom:2px solid ${certState.activeTab === 'content' ? '#111' : 'transparent'};transition:all 0.2s">
            <i class="fas fa-pen-fancy" style="margin-right:5px"></i>Content
          </button>
          <button onclick="switchTab('logo')" style="flex:1;padding:14px 12px;font-size:12px;font-weight:700;border:none;cursor:pointer;background:${certState.activeTab === 'logo' ? 'white' : '#f9fafb'};color:${certState.activeTab === 'logo' ? '#111' : '#9ca3af'};border-bottom:2px solid ${certState.activeTab === 'logo' ? '#111' : 'transparent'};transition:all 0.2s">
            <i class="fas fa-image" style="margin-right:5px"></i>Logo
          </button>
        </div>

        ${certState.activeTab === 'design' ? `
        <!-- ═══ DESIGN TAB ═══ -->
        <!-- Design Name -->
        <div style="padding:16px 24px;border-bottom:1px solid #f1f5f9">
          <label style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:6px">Design Name</label>
          <input type="text" value="${s.name}" oninput="certState.design.name=this.value;markDirty()"
            style="width:100%;padding:8px 12px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;outline:none" placeholder="e.g. Standard Warranty">
        </div>

        <!-- Color Palette -->
        <div style="padding:16px 24px;border-bottom:1px solid #f1f5f9">
          <label style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:10px">Color Palette</label>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
            ${PALETTES.map(p => `
              <button onclick="certState.design.primary_color='${p.primary}';certState.design.secondary_color='${p.secondary}';markDirty();debouncedPreview()"
                title="${p.name}"
                style="width:32px;height:32px;border-radius:50%;border:${s.primary_color === p.primary ? '3px solid #111' : '2px solid #e5e7eb'};cursor:pointer;background:linear-gradient(135deg, ${p.primary} 50%, ${p.secondary} 50%);flex-shrink:0"></button>
            `).join('')}
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div>
              <label style="font-size:10px;color:#9ca3af;display:block;margin-bottom:3px">Primary</label>
              <div style="display:flex;align-items:center;gap:6px">
                <input type="color" value="${s.primary_color}" onchange="certState.design.primary_color=this.value;markDirty();debouncedPreview()"
                  style="width:28px;height:28px;border:1px solid #e5e7eb;border-radius:6px;cursor:pointer;padding:1px">
                <input type="text" value="${s.primary_color}" onchange="certState.design.primary_color=this.value;markDirty();debouncedPreview()"
                  style="flex:1;padding:6px 8px;border:1px solid #e5e7eb;border-radius:6px;font-size:11px;font-family:monospace;outline:none">
              </div>
            </div>
            <div>
              <label style="font-size:10px;color:#9ca3af;display:block;margin-bottom:3px">Secondary</label>
              <div style="display:flex;align-items:center;gap:6px">
                <input type="color" value="${s.secondary_color}" onchange="certState.design.secondary_color=this.value;markDirty();debouncedPreview()"
                  style="width:28px;height:28px;border:1px solid #e5e7eb;border-radius:6px;cursor:pointer;padding:1px">
                <input type="text" value="${s.secondary_color}" onchange="certState.design.secondary_color=this.value;markDirty();debouncedPreview()"
                  style="flex:1;padding:6px 8px;border:1px solid #e5e7eb;border-radius:6px;font-size:11px;font-family:monospace;outline:none">
              </div>
            </div>
          </div>
        </div>

        <!-- Font -->
        <div style="padding:16px 24px;border-bottom:1px solid #f1f5f9">
          <label style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:6px">Font Pairing</label>
          <select onchange="certState.design.font_family=this.value;markDirty();debouncedPreview()"
            style="width:100%;padding:8px 12px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;outline:none;background:white">
            ${FONTS.map(f => `<option value="${f.name}" ${s.font_family === f.name ? 'selected' : ''}>${f.label} (${f.type})</option>`).join('')}
          </select>
        </div>

        <!-- Logo Alignment -->
        <div style="padding:16px 24px;border-bottom:1px solid #f1f5f9">
          <label style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:8px">Logo Alignment</label>
          <div style="display:flex;gap:4px">
            ${['left','center','right'].map(pos => `
              <button onclick="certState.design.logo_alignment='${pos}';markDirty();debouncedPreview()"
                style="flex:1;padding:8px;border-radius:8px;border:1px solid ${s.logo_alignment === pos ? '#111' : '#e5e7eb'};background:${s.logo_alignment === pos ? '#111' : 'white'};color:${s.logo_alignment === pos ? 'white' : '#6b7280'};font-size:11px;font-weight:600;cursor:pointer;text-transform:capitalize">
                <i class="fas fa-align-${pos}" style="margin-right:4px"></i>${pos}
              </button>
            `).join('')}
          </div>
        </div>

        <!-- License Number -->
        <div style="padding:16px 24px;border-bottom:1px solid #f1f5f9">
          <label style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:6px">Contractor License #</label>
          <input type="text" value="${s.license_number}" oninput="certState.design.license_number=this.value;markDirty()"
            placeholder="e.g. MB-12345" style="width:100%;padding:8px 12px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;outline:none">
          <p style="font-size:10px;color:#9ca3af;margin-top:4px">Required by most insurance companies</p>
        </div>

        <!-- Watermark Toggle -->
        <div style="padding:16px 24px;border-bottom:1px solid #f1f5f9">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <div>
              <div style="font-size:12px;font-weight:600;color:#374151">Watermark</div>
              <div style="font-size:10px;color:#9ca3af;margin-top:2px">Subtle company name in background</div>
            </div>
            <button onclick="certState.design.watermark_enabled=!certState.design.watermark_enabled;markDirty();debouncedPreview()"
              style="position:relative;width:44px;height:24px;border-radius:12px;border:none;cursor:pointer;background:${s.watermark_enabled ? '#16a34a' : '#d1d5db'};transition:background 0.2s">
              <span style="position:absolute;top:2px;left:${s.watermark_enabled ? '22px' : '2px'};width:20px;height:20px;border-radius:50%;background:white;box-shadow:0 1px 3px rgba(0,0,0,0.2);transition:left 0.2s"></span>
            </button>
          </div>
        </div>
        ` : certState.activeTab === 'content' ? `
        <!-- ═══ CONTENT TAB ═══ -->
        <!-- Certificate Title -->
        <div style="padding:16px 24px;border-bottom:1px solid #f1f5f9">
          <label style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:6px">Certificate Title</label>
          <input type="text" value="${s.cert_title}" oninput="certState.design.cert_title=this.value;markDirty();debouncedPreview()"
            style="width:100%;padding:8px 12px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;outline:none"
            placeholder="Certificate of New Roof Installation">
          <p style="font-size:10px;color:#9ca3af;margin-top:4px">The main heading on the certificate</p>
        </div>

        <!-- Subtitle -->
        <div style="padding:16px 24px;border-bottom:1px solid #f1f5f9">
          <label style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:6px">Subtitle</label>
          <input type="text" value="${s.cert_subtitle}" oninput="certState.design.cert_subtitle=this.value;markDirty();debouncedPreview()"
            style="width:100%;padding:8px 12px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;outline:none"
            placeholder="Official Documentation for Insurance Purposes">
          <p style="font-size:10px;color:#9ca3af;margin-top:4px">Appears below the title</p>
        </div>

        <!-- Body Text -->
        <div style="padding:16px 24px;border-bottom:1px solid #f1f5f9">
          <label style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:6px">Certification Body Text</label>
          <textarea oninput="certState.design.cert_body_text=this.value;markDirty();debouncedPreview()"
            placeholder="Leave blank for default. Use {company}, {customer}, {address}, {date} as placeholders."
            rows="4" style="width:100%;padding:8px 12px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;outline:none;resize:vertical">${s.cert_body_text || ''}</textarea>
          <p style="font-size:10px;color:#9ca3af;margin-top:4px">The main certification paragraph. Leave blank to use the default text.</p>
        </div>

        <!-- Custom Message -->
        <div style="padding:16px 24px;border-bottom:1px solid #f1f5f9">
          <label style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:6px">Custom Message</label>
          <textarea oninput="certState.design.custom_message=this.value;markDirty()"
            placeholder="e.g. Thank you for trusting XYZ Roofing with your home..."
            rows="3" style="width:100%;padding:8px 12px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;outline:none;resize:vertical">${s.custom_message || ''}</textarea>
          <p style="font-size:10px;color:#9ca3af;margin-top:4px">Optional extra message shown below the certification text</p>
        </div>

        <!-- Footer / Insurance Notice -->
        <div style="padding:16px 24px;border-bottom:1px solid #f1f5f9">
          <label style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:6px">Footer / Insurance Notice</label>
          <textarea oninput="certState.design.footer_text=this.value;markDirty();debouncedPreview()"
            placeholder="Leave blank for default insurance notice text."
            rows="3" style="width:100%;padding:8px 12px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;outline:none;resize:vertical">${s.footer_text || ''}</textarea>
          <p style="font-size:10px;color:#9ca3af;margin-top:4px">The notice at the bottom of the certificate</p>
        </div>

        <!-- Signature Labels -->
        <div style="padding:16px 24px;border-bottom:1px solid #f1f5f9">
          <label style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:10px">Signature Labels</label>
          <div style="display:grid;gap:10px">
            <div>
              <label style="font-size:10px;color:#9ca3af;display:block;margin-bottom:3px">Left Signature (Contractor)</label>
              <input type="text" value="${s.sig_left_label}" oninput="certState.design.sig_left_label=this.value;markDirty();debouncedPreview()"
                style="width:100%;padding:8px 12px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;outline:none"
                placeholder="Authorized by Roofing Contractor">
            </div>
            <div>
              <label style="font-size:10px;color:#9ca3af;display:block;margin-bottom:3px">Right Signature (Client)</label>
              <input type="text" value="${s.sig_right_label}" oninput="certState.design.sig_right_label=this.value;markDirty();debouncedPreview()"
                style="width:100%;padding:8px 12px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;outline:none"
                placeholder="Acknowledged by Homeowner">
            </div>
          </div>
        </div>
        ` : `
        <!-- ═══ LOGO TAB ═══ -->
        <div style="padding:24px">
          <div style="text-align:center;margin-bottom:20px">
            <div style="font-size:14px;font-weight:700;color:#111;margin-bottom:4px">Company Logo</div>
            <p style="font-size:12px;color:#6b7280;margin:0">Upload your company logo to display on all certificates</p>
          </div>

          <!-- Logo Preview -->
          <div style="display:flex;align-items:center;justify-content:center;margin-bottom:20px">
            ${certState.logoPreview
              ? `<div style="position:relative">
                  <img src="${certState.logoPreview}" alt="Company Logo" style="max-width:200px;max-height:120px;object-fit:contain;border-radius:12px;border:1px solid #e5e7eb;padding:12px;background:white">
                  <button onclick="removeLogo()" style="position:absolute;top:-8px;right:-8px;width:24px;height:24px;border-radius:50%;background:#dc2626;color:white;border:none;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.2)"><i class="fas fa-times"></i></button>
                </div>`
              : `<div style="width:200px;height:120px;border:2px dashed #d1d5db;border-radius:12px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#9ca3af">
                  <i class="fas fa-image" style="font-size:32px;margin-bottom:8px"></i>
                  <span style="font-size:12px">No logo uploaded</span>
                </div>`
            }
          </div>

          <!-- Upload Button -->
          <div style="text-align:center">
            <label style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;border-radius:10px;background:#111;color:white;font-size:13px;font-weight:600;cursor:pointer;transition:background 0.2s">
              <i class="fas fa-cloud-upload-alt"></i>
              Choose Image
              <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" onchange="handleLogoFileSelect(this)" style="display:none">
            </label>
          </div>

          <!-- Save Logo Button -->
          ${certState.logoPreview ? `
          <div style="text-align:center;margin-top:16px">
            <button onclick="uploadLogo()" style="padding:10px 24px;border-radius:10px;border:none;font-size:13px;font-weight:700;cursor:pointer;background:#16a34a;color:white;transition:all 0.2s" ${certState.logoUploading ? 'disabled' : ''}>
              ${certState.logoUploading ? '<i class="fas fa-spinner fa-spin" style="margin-right:6px"></i>Saving...' : '<i class="fas fa-save" style="margin-right:6px"></i>Save Logo'}
            </button>
          </div>
          ` : ''}

          <!-- Tips -->
          <div style="margin-top:24px;padding:16px;background:#f9fafb;border-radius:10px;border:1px solid #f1f5f9">
            <p style="font-size:11px;font-weight:600;color:#6b7280;margin:0 0 8px"><i class="fas fa-lightbulb" style="margin-right:4px;color:#f59e0b"></i>Tips for best results</p>
            <ul style="font-size:11px;color:#9ca3af;line-height:1.8;margin:0;padding-left:16px">
              <li>Use a transparent PNG for cleanest look</li>
              <li>Recommended size: 400px+ wide</li>
              <li>Square or horizontal logos work best</li>
              <li>Max file size: 2 MB</li>
              <li>Formats: PNG, JPEG, SVG, WebP</li>
            </ul>
          </div>
        </div>
        `}

        <!-- Actions (always visible) -->
        <div style="padding:16px 24px;border-top:1px solid #f1f5f9;display:flex;gap:8px;flex-wrap:wrap">
          <button onclick="saveDesign()" style="flex:1;padding:10px 16px;border-radius:10px;border:none;font-size:13px;font-weight:700;cursor:pointer;background:${certState.dirty ? '#111' : '#f1f5f9'};color:${certState.dirty ? 'white' : '#9ca3af'};transition:all 0.2s">
            <i class="fas fa-save" style="margin-right:6px"></i>Save Design
          </button>
          <button onclick="refreshPreview()" style="padding:10px 16px;border-radius:10px;border:1px solid #e5e7eb;font-size:13px;font-weight:600;cursor:pointer;background:white;color:#374151">
            <i class="fas fa-sync-alt" style="margin-right:4px"></i>Refresh
          </button>
          ${certState.activeDesignId ? `<button onclick="deleteDesign(${certState.activeDesignId})" style="padding:10px 12px;border-radius:10px;border:1px solid #fecaca;font-size:13px;cursor:pointer;background:#fef2f2;color:#dc2626" title="Delete this design"><i class="fas fa-trash"></i></button>` : ''}
        </div>
      </div>

      <!-- RIGHT: Live Preview -->
      <div style="background:white;border-radius:16px;border:1px solid #e5e7eb;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.04)">
        <div style="padding:16px 24px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;justify-content:space-between">
          <p style="font-size:14px;font-weight:700;color:#111;margin:0"><i class="fas fa-eye" style="margin-right:8px;color:#6b7280"></i>Live Preview</p>
          <span style="font-size:11px;color:#9ca3af">${certState.previewLoading ? '<i class="fas fa-spinner fa-spin"></i> Loading...' : 'Updates in real time'}</span>
        </div>
        <div style="padding:16px;background:#f8fafc;min-height:600px;display:flex;align-items:flex-start;justify-content:center">
          <iframe id="cert-preview-iframe" srcdoc="" style="width:100%;height:860px;border:none;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.08);background:white;transition:opacity 0.3s"></iframe>
        </div>
      </div>
    </div>

    <!-- Saved Designs Strip -->
    ${certState.designs.length > 0 ? `
    <div style="background:white;border-radius:16px;border:1px solid #e5e7eb;padding:20px 24px;margin-top:20px;box-shadow:0 1px 3px rgba(0,0,0,0.04)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <p style="font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:1px;margin:0"><i class="fas fa-folder-open" style="margin-right:6px"></i>Saved Designs (${certState.designs.length})</p>
        <button onclick="createNewDesign()" style="font-size:12px;color:#16a34a;font-weight:600;background:none;border:none;cursor:pointer"><i class="fas fa-plus" style="margin-right:4px"></i>New Design</button>
      </div>
      <div style="display:flex;gap:10px;overflow-x:auto;padding-bottom:4px">
        ${certState.designs.map(d => `
          <button onclick="selectDesign(${JSON.stringify(d).replace(/"/g, '&quot;')})"
            style="flex:0 0 auto;min-width:180px;padding:14px 16px;border-radius:12px;border:2px solid ${certState.activeDesignId === d.id ? '#111' : '#e5e7eb'};background:${certState.activeDesignId === d.id ? '#f9fafb' : 'white'};cursor:pointer;text-align:left;transition:all 0.2s">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <div style="width:8px;height:8px;border-radius:50%;background:${d.primary_color || '#1a5c38'}"></div>
              <span style="font-size:13px;font-weight:700;color:#111">${d.name}</span>
              ${d.is_default ? '<span style="font-size:9px;background:#dcfce7;color:#16a34a;padding:2px 6px;border-radius:4px;font-weight:600">DEFAULT</span>' : ''}
            </div>
            <div style="font-size:11px;color:#9ca3af;text-transform:capitalize">${d.template_style} · ${d.font_family}</div>
          </button>
        `).join('')}
      </div>
    </div>
    ` : ''}

    <!-- Trigger Settings -->
    <div style="background:white;border-radius:16px;border:1px solid #e5e7eb;padding:24px;margin-top:20px;box-shadow:0 1px 3px rgba(0,0,0,0.04)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
        <div>
          <p style="font-size:16px;font-weight:700;color:#111;margin:0"><i class="fas fa-bolt" style="margin-right:8px;color:#f59e0b"></i>Trigger Settings</p>
          <p style="font-size:12px;color:#6b7280;margin-top:4px">Choose when certificates are automatically sent</p>
        </div>
        <button onclick="saveAutomationSettings({ auto_send_certificate: !certState.automationSettings.auto_send_certificate })"
          style="position:relative;width:52px;height:28px;border-radius:14px;border:none;cursor:pointer;background:${a.auto_send_certificate ? '#16a34a' : '#d1d5db'};transition:background 0.2s">
          <span style="position:absolute;top:3px;left:${a.auto_send_certificate ? '27px' : '3px'};width:22px;height:22px;border-radius:50%;background:white;box-shadow:0 1px 3px rgba(0,0,0,0.2);transition:left 0.2s"></span>
        </button>
      </div>

      ${a.auto_send_certificate ? `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
        <!-- Trigger: Proposal Signed -->
        <button onclick="saveAutomationSettings({ cert_trigger_type: 'proposal_signed' })"
          style="padding:20px;border-radius:12px;border:2px solid ${(a.cert_trigger_type || 'proposal_signed') === 'proposal_signed' ? '#16a34a' : '#e5e7eb'};background:${(a.cert_trigger_type || 'proposal_signed') === 'proposal_signed' ? '#f0fdf4' : 'white'};cursor:pointer;text-align:left;transition:all 0.2s">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
            <div style="width:40px;height:40px;border-radius:10px;background:#dcfce7;display:flex;align-items:center;justify-content:center"><i class="fas fa-file-signature" style="color:#16a34a;font-size:18px"></i></div>
            <div style="font-size:14px;font-weight:700;color:#111">When Proposal is Signed</div>
          </div>
          <p style="font-size:12px;color:#6b7280;line-height:1.5;margin:0">Send a pre-completion certificate for customers who need proof for insurance or HOA approval before work begins.</p>
        </button>

        <!-- Trigger: Job Installed -->
        <button onclick="saveAutomationSettings({ cert_trigger_type: 'job_installed' })"
          style="padding:20px;border-radius:12px;border:2px solid ${a.cert_trigger_type === 'job_installed' ? '#16a34a' : '#e5e7eb'};background:${a.cert_trigger_type === 'job_installed' ? '#f0fdf4' : 'white'};cursor:pointer;text-align:left;transition:all 0.2s">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
            <div style="width:40px;height:40px;border-radius:10px;background:#dbeafe;display:flex;align-items:center;justify-content:center"><i class="fas fa-hard-hat" style="color:#2563eb;font-size:18px"></i></div>
            <div style="font-size:14px;font-weight:700;color:#111">When Job is Installed</div>
          </div>
          <p style="font-size:12px;color:#6b7280;line-height:1.5;margin:0">Automatically send after the crew finishes work. Best for insurance documentation after completion.</p>
        </button>
      </div>

      <!-- Delay + Approval -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;padding-top:16px;border-top:1px solid #f1f5f9">
        <div>
          <label style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:6px">Delay Send By</label>
          <select onchange="saveAutomationSettings({ cert_delay_days: parseInt(this.value) })"
            style="width:100%;padding:10px 12px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;outline:none;background:white">
            <option value="0" ${(a.cert_delay_days || 0) === 0 ? 'selected' : ''}>Immediately (no delay)</option>
            <option value="1" ${a.cert_delay_days === 1 ? 'selected' : ''}>1 day after trigger</option>
            <option value="2" ${a.cert_delay_days === 2 ? 'selected' : ''}>2 days after trigger</option>
            <option value="3" ${a.cert_delay_days === 3 ? 'selected' : ''}>3 days after trigger</option>
            <option value="5" ${a.cert_delay_days === 5 ? 'selected' : ''}>5 days after trigger</option>
            <option value="7" ${a.cert_delay_days === 7 ? 'selected' : ''}>7 days after trigger</option>
          </select>
          <p style="font-size:10px;color:#9ca3af;margin-top:4px">e.g. send 2 days after completion to allow final inspection</p>
        </div>
        <div>
          <label style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:6px">Require Manual Approval?</label>
          <div style="display:flex;align-items:center;gap:12px;padding:10px 0">
            <button onclick="saveAutomationSettings({ cert_require_approval: !certState.automationSettings.cert_require_approval })"
              style="position:relative;width:44px;height:24px;border-radius:12px;border:none;cursor:pointer;background:${a.cert_require_approval ? '#16a34a' : '#d1d5db'};transition:background 0.2s">
              <span style="position:absolute;top:2px;left:${a.cert_require_approval ? '22px' : '2px'};width:20px;height:20px;border-radius:50%;background:white;box-shadow:0 1px 3px rgba(0,0,0,0.2);transition:left 0.2s"></span>
            </button>
            <span style="font-size:12px;color:#6b7280">${a.cert_require_approval ? 'Yes — review before sending' : 'No — send automatically'}</span>
          </div>
        </div>
      </div>
      ` : `
      <div style="padding:24px;text-align:center;background:#f9fafb;border-radius:12px;border:1px dashed #d1d5db">
        <i class="fas fa-toggle-off" style="font-size:32px;color:#d1d5db;margin-bottom:12px"></i>
        <p style="font-size:14px;font-weight:600;color:#6b7280;margin:0">Auto-send is disabled</p>
        <p style="font-size:12px;color:#9ca3af;margin-top:4px">Toggle on to automatically send certificates when triggers fire</p>
      </div>
      `}
    </div>

    <!-- Send History -->
    <div style="background:white;border-radius:16px;border:1px solid #e5e7eb;padding:24px;margin-top:20px;box-shadow:0 1px 3px rgba(0,0,0,0.04)">
      <button onclick="certState.showLogPanel=!certState.showLogPanel;render()" style="width:100%;display:flex;align-items:center;justify-content:space-between;background:none;border:none;cursor:pointer;padding:0">
        <div style="display:flex;align-items:center;gap:8px">
          <p style="font-size:14px;font-weight:700;color:#111;margin:0"><i class="fas fa-history" style="margin-right:8px;color:#6b7280"></i>Send History</p>
          <span style="background:#f1f5f9;color:#6b7280;font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px">${certState.sendLog.length}</span>
        </div>
        <i class="fas fa-chevron-${certState.showLogPanel ? 'up' : 'down'}" style="color:#9ca3af"></i>
      </button>

      ${certState.showLogPanel ? `
      <div style="margin-top:16px;border-top:1px solid #f1f5f9;padding-top:16px">
        ${certState.sendLog.length === 0 ? `
          <div style="text-align:center;padding:24px;color:#9ca3af">
            <i class="fas fa-inbox" style="font-size:24px;margin-bottom:8px;display:block"></i>
            <p style="font-size:13px;margin:0">No certificates sent yet</p>
          </div>
        ` : `
          <div style="display:flex;flex-direction:column;gap:8px;max-height:300px;overflow-y:auto">
            ${certState.sendLog.map(log => `
              <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-radius:10px;background:#f9fafb;border:1px solid #f1f5f9">
                <div style="width:32px;height:32px;border-radius:8px;background:${log.status === 'sent' ? '#dcfce7' : log.status === 'failed' ? '#fef2f2' : '#fef3c7'};display:flex;align-items:center;justify-content:center;flex-shrink:0">
                  <i class="fas ${log.status === 'sent' ? 'fa-check' : log.status === 'failed' ? 'fa-times' : 'fa-clock'}" style="font-size:12px;color:${log.status === 'sent' ? '#16a34a' : log.status === 'failed' ? '#dc2626' : '#d97706'}"></i>
                </div>
                <div style="flex:1;min-width:0">
                  <div style="font-size:13px;font-weight:600;color:#111;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${log.recipient_name || log.recipient_email || 'Unknown'}</div>
                  <div style="font-size:11px;color:#9ca3af">${log.property_address || ''} · ${log.trigger_type || 'manual'}</div>
                </div>
                <div style="text-align:right;flex-shrink:0">
                  <div style="font-size:11px;color:#6b7280">${log.sent_at ? new Date(log.sent_at).toLocaleDateString() : ''}</div>
                  <div style="font-size:10px;color:#9ca3af;text-transform:capitalize">${log.status}</div>
                </div>
              </div>
            `).join('')}
          </div>
        `}
      </div>
      ` : ''}
    </div>

    <!-- Analytics nudge -->
    ${certState.sendLog.length > 0 ? `
    <div style="background:linear-gradient(135deg,#f0fdf4,#ecfdf5);border-radius:16px;border:1px solid #bbf7d0;padding:20px 24px;margin-top:20px;display:flex;align-items:center;gap:16px">
      <div style="width:48px;height:48px;border-radius:12px;background:#16a34a;display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <i class="fas fa-chart-line" style="color:white;font-size:20px"></i>
      </div>
      <div>
        <p style="font-size:14px;font-weight:700;color:#166534;margin:0">${certState.sendLog.length} certificate${certState.sendLog.length !== 1 ? 's' : ''} sent — saving you time on manual paperwork</p>
        <p style="font-size:12px;color:#16a34a;margin-top:2px">Each automated certificate saves ~10 minutes of manual work</p>
      </div>
    </div>
    ` : ''}

    <!-- ════════════════════════════════════════════════════════ -->
    <!-- INVOICING AUTOMATION -->
    <!-- ════════════════════════════════════════════════════════ -->
    <div style="margin-top:48px;padding-top:40px;border-top:2px solid #e5e7eb">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:28px;flex-wrap:wrap;gap:12px">
        <div>
          <h2 style="font-size:24px;font-weight:800;color:#111;margin:0"><i class="fas fa-file-invoice-dollar" style="margin-right:10px;color:#2563eb"></i>Invoicing Automation</h2>
          <p style="font-size:14px;color:#6b7280;margin-top:4px">Automatically generate and send invoices when you order a measurement report</p>
        </div>
      </div>

      <!-- How it works -->
      <div style="background:linear-gradient(135deg,#eff6ff,#dbeafe);border-radius:16px;border:1px solid #93c5fd;padding:20px 24px;margin-bottom:20px">
        <p style="font-size:13px;font-weight:700;color:#1e40af;margin:0 0 10px"><i class="fas fa-info-circle" style="margin-right:6px"></i>How it works</p>
        <ol style="font-size:13px;color:#1e3a5f;line-height:1.8;margin:0;padding-left:20px">
          <li>Turn on the automation and set your pricing below</li>
          <li>When ordering a report, fill out the optional customer details form</li>
          <li>Once the report generates, an invoice is automatically created and emailed to your customer</li>
        </ol>
      </div>

      <!-- Master Toggle -->
      <div style="background:white;border-radius:16px;border:1px solid #e5e7eb;padding:24px;margin-bottom:20px;box-shadow:0 1px 3px rgba(0,0,0,0.04)">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div>
            <p style="font-size:16px;font-weight:700;color:#111;margin:0"><i class="fas fa-bolt" style="margin-right:8px;color:#2563eb"></i>Auto-Invoice</p>
            <p style="font-size:12px;color:#6b7280;margin-top:4px">When enabled, invoices are sent automatically after each report you order (if customer details are provided)</p>
          </div>
          <button onclick="saveInvoicingSettings({ auto_invoice_enabled: !certState.invoicingSettings.auto_invoice_enabled })"
            style="position:relative;width:52px;height:28px;border-radius:14px;border:none;cursor:pointer;background:${certState.invoicingSettings.auto_invoice_enabled ? '#2563eb' : '#d1d5db'};transition:background 0.2s">
            <span style="position:absolute;top:3px;left:${certState.invoicingSettings.auto_invoice_enabled ? '27px' : '3px'};width:22px;height:22px;border-radius:50%;background:white;box-shadow:0 1px 3px rgba(0,0,0,0.2);transition:left 0.2s"></span>
          </button>
        </div>

        ${certState.invoicingSettings.auto_invoice_enabled ? `
        <div style="margin-top:24px;padding-top:20px;border-top:1px solid #f1f5f9">
          <!-- Pricing Mode Selector -->
          <label style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:10px">Pricing Mode</label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px">
            <button onclick="saveInvoicingSettings({ invoice_pricing_mode: 'per_square' })"
              style="padding:18px;border-radius:12px;border:2px solid ${certState.invoicingSettings.invoice_pricing_mode === 'per_square' ? '#2563eb' : '#e5e7eb'};background:${certState.invoicingSettings.invoice_pricing_mode === 'per_square' ? '#eff6ff' : 'white'};cursor:pointer;text-align:left;transition:all 0.2s">
              <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
                <div style="width:36px;height:36px;border-radius:8px;background:#dbeafe;display:flex;align-items:center;justify-content:center"><i class="fas fa-th-large" style="color:#2563eb;font-size:16px"></i></div>
                <div style="font-size:14px;font-weight:700;color:#111">Price per Square</div>
              </div>
              <p style="font-size:12px;color:#6b7280;line-height:1.4;margin:0">Set a dollar amount per roofing square (100 sq ft). Invoice total = squares x price.</p>
            </button>
            <button onclick="saveInvoicingSettings({ invoice_pricing_mode: 'per_bundle' })"
              style="padding:18px;border-radius:12px;border:2px solid ${certState.invoicingSettings.invoice_pricing_mode === 'per_bundle' ? '#2563eb' : '#e5e7eb'};background:${certState.invoicingSettings.invoice_pricing_mode === 'per_bundle' ? '#eff6ff' : 'white'};cursor:pointer;text-align:left;transition:all 0.2s">
              <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
                <div style="width:36px;height:36px;border-radius:8px;background:#fef3c7;display:flex;align-items:center;justify-content:center"><i class="fas fa-boxes" style="color:#d97706;font-size:16px"></i></div>
                <div style="font-size:14px;font-weight:700;color:#111">Price per Bundle</div>
              </div>
              <p style="font-size:12px;color:#6b7280;line-height:1.4;margin:0">Set a dollar amount per shingle bundle. Invoice total = bundles x price.</p>
            </button>
          </div>

          <!-- Price Input -->
          <div>
            <label style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:6px">
              ${certState.invoicingSettings.invoice_pricing_mode === 'per_square' ? 'Your Price per Square ($)' : 'Your Price per Bundle ($)'}
            </label>
            <div style="position:relative;max-width:240px">
              <span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);font-size:16px;font-weight:700;color:#6b7280">$</span>
              <input type="number" step="5" min="0"
                value="${certState.invoicingSettings.invoice_pricing_mode === 'per_square' ? certState.invoicingSettings.invoice_price_per_square : certState.invoicingSettings.invoice_price_per_bundle}"
                onchange="saveInvoicingSettings({ ${certState.invoicingSettings.invoice_pricing_mode === 'per_square' ? 'invoice_price_per_square' : 'invoice_price_per_bundle'}: parseFloat(this.value) || 0 })"
                style="width:100%;padding:12px 14px 12px 32px;border:1px solid #e5e7eb;border-radius:10px;font-size:16px;font-weight:600;outline:none;transition:border 0.2s"
                onfocus="this.style.borderColor='#2563eb'" onblur="this.style.borderColor='#e5e7eb'">
            </div>
            <p style="font-size:11px;color:#9ca3af;margin-top:6px">
              ${certState.invoicingSettings.invoice_pricing_mode === 'per_square'
                ? 'Example: 25 squares x $' + certState.invoicingSettings.invoice_price_per_square + ' = $' + (25 * certState.invoicingSettings.invoice_price_per_square).toLocaleString() + ' CAD'
                : 'Example: 75 bundles x $' + certState.invoicingSettings.invoice_price_per_bundle + ' = $' + (75 * certState.invoicingSettings.invoice_price_per_bundle).toLocaleString() + ' CAD'}
            </p>
          </div>
        </div>
        ` : `
        <div style="margin-top:20px;padding:24px;text-align:center;background:#f9fafb;border-radius:12px;border:1px dashed #d1d5db">
          <i class="fas fa-toggle-off" style="font-size:32px;color:#d1d5db;margin-bottom:12px"></i>
          <p style="font-size:14px;font-weight:600;color:#6b7280;margin:0">Invoicing automation is disabled</p>
          <p style="font-size:12px;color:#9ca3af;margin-top:4px">Toggle on to auto-send invoices when you order reports with customer details</p>
        </div>
        `}
      </div>
    </div>
  `;
}

// ── CSS animations ─────────────────────────────────────────
const style = document.createElement('style');
style.textContent = `
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (max-width: 900px) {
    #cert-auto-root > div:nth-child(3) {
      grid-template-columns: 1fr !important;
    }
    #cert-auto-root > div:nth-child(3) > div:last-child {
      order: -1;
    }
  }
`;
document.head.appendChild(style);

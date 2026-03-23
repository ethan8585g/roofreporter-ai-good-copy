// ============================================================
// Customer Dashboard — Roofr-Inspired SaaS Dashboard
// Clean blue-primary color scheme, sidebar nav, metric cards,
// performance charts, and professional data-dense layout.
// ============================================================

var custState = { loading: true, orders: [], billing: null, customer: null, crmStats: null, view: 'overview' };

function getToken() { return localStorage.getItem('rc_customer_token') || ''; }
function authHeaders() { return { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' }; }

// ── Color Palette (Roofr-inspired) ──
var COLORS = {
  primary: '#2563EB',      // Blue 600
  primaryDark: '#1D4ED8',  // Blue 700
  primaryLight: '#DBEAFE', // Blue 100
  primaryBg: '#EFF6FF',    // Blue 50
  surface: '#FFFFFF',
  bg: '#F8FAFC',           // Slate 50
  border: '#E2E8F0',       // Slate 200
  borderLight: '#F1F5F9',  // Slate 100
  textPrimary: '#0F172A',  // Slate 900
  textSecondary: '#64748B', // Slate 500
  textMuted: '#94A3B8',    // Slate 400
  success: '#10B981',
  successBg: '#D1FAE5',
  warning: '#F59E0B',
  warningBg: '#FEF3C7',
  danger: '#EF4444',
  dangerBg: '#FEE2E2',
  purple: '#7C3AED',
  purpleBg: '#EDE9FE',
};

// ============================================================
// CUSTOMER SETTINGS PANEL — In-page modal for account settings
// Gmail Integration, Calendar, Profile, Notifications
// ============================================================
window._openCustomerSettings = function() {
  // Remove any existing settings overlay
  var existing = document.getElementById('custSettingsOverlay');
  if (existing) existing.remove();

  var overlay = document.createElement('div');
  overlay.id = 'custSettingsOverlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;animation:fadeIn .2s ease';
  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };

  var panel = document.createElement('div');
  panel.style.cssText = 'background:white;border-radius:16px;width:90%;max-width:640px;max-height:85vh;overflow-y:auto;box-shadow:0 25px 50px rgba(0,0,0,0.25);position:relative;';

  // Header
  panel.innerHTML = '<div style="padding:20px 24px;border-bottom:1px solid #E2E8F0;display:flex;align-items:center;justify-content:space-between">' +
    '<div><h2 style="font-size:18px;font-weight:700;color:#0F172A;margin:0">Settings</h2><p style="font-size:12px;color:#94A3B8;margin:2px 0 0">Account, integrations & preferences</p></div>' +
    '<button onclick="document.getElementById(\'custSettingsOverlay\').remove()" style="width:32px;height:32px;border-radius:8px;border:1px solid #E2E8F0;background:white;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#64748B;font-size:14px"><i class="fas fa-times"></i></button>' +
  '</div>' +
  '<div id="custSettingsBody" style="padding:20px 24px"><div style="text-align:center;padding:40px"><i class="fas fa-spinner fa-spin" style="font-size:24px;color:#94A3B8"></i></div></div>';

  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  // Load settings content
  _loadSettingsContent();
};

function _loadSettingsContent() {
  var body = document.getElementById('custSettingsBody');
  if (!body) return;

  // Check Gmail status
  fetch('/api/crm/gmail/status', { headers: authHeaders() })
    .then(function(r) { return r.json(); })
    .then(function(gmailData) {
      var c = custState.customer || {};
      var gmailConnected = !!gmailData.connected;
      var gmailEmail = gmailData.email || '';

      var html = '';

      // Profile Section
      html += '<div style="margin-bottom:24px">' +
        '<h3 style="font-size:14px;font-weight:600;color:#0F172A;margin:0 0 12px"><i class="fas fa-user" style="color:#2563EB;margin-right:8px"></i>Account</h3>' +
        '<div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;padding:16px">' +
          '<div style="display:flex;gap:16px;flex-wrap:wrap">' +
            '<div style="flex:1;min-width:200px"><p style="font-size:11px;color:#94A3B8;margin:0 0 2px">Name</p><p style="font-size:13px;font-weight:500;color:#0F172A;margin:0">' + (c.name || 'Not set') + '</p></div>' +
            '<div style="flex:1;min-width:200px"><p style="font-size:11px;color:#94A3B8;margin:0 0 2px">Email</p><p style="font-size:13px;font-weight:500;color:#0F172A;margin:0">' + (c.email || 'Not set') + '</p></div>' +
          '</div>' +
          '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:12px">' +
            '<div style="flex:1;min-width:200px"><p style="font-size:11px;color:#94A3B8;margin:0 0 2px">Company</p><p style="font-size:13px;font-weight:500;color:#0F172A;margin:0">' + (c.company_name || 'Not set') + '</p></div>' +
            '<div style="flex:1;min-width:200px"><p style="font-size:11px;color:#94A3B8;margin:0 0 2px">Plan</p><p style="font-size:13px;font-weight:500;color:#0F172A;margin:0">' + (c.plan || 'Free Trial') + '</p></div>' +
          '</div>' +
        '</div>' +
      '</div>';

      // Gmail Integration Section
      html += '<div style="margin-bottom:24px">' +
        '<h3 style="font-size:14px;font-weight:600;color:#0F172A;margin:0 0 12px"><i class="fab fa-google" style="color:#EA4335;margin-right:8px"></i>Gmail Integration</h3>' +
        '<div style="background:' + (gmailConnected ? '#F0FDF4' : '#FFFBEB') + ';border:1px solid ' + (gmailConnected ? '#BBF7D0' : '#FDE68A') + ';border-radius:12px;padding:16px">';

      if (gmailConnected) {
        html += '<div style="display:flex;align-items:center;gap:12px">' +
          '<div style="width:40px;height:40px;border-radius:10px;background:#DCFCE7;display:flex;align-items:center;justify-content:center"><i class="fas fa-check-circle" style="color:#16A34A;font-size:18px"></i></div>' +
          '<div style="flex:1"><p style="font-size:13px;font-weight:600;color:#166534;margin:0">Gmail Connected</p><p style="font-size:12px;color:#15803D;margin:2px 0 0">' + gmailEmail + '</p></div>' +
          '<button onclick="window._settingsDisconnectGmail()" style="padding:6px 12px;border:1px solid #FCA5A5;background:#FEF2F2;color:#DC2626;border-radius:8px;font-size:12px;cursor:pointer">Disconnect</button>' +
        '</div>' +
        '<p style="font-size:11px;color:#166534;margin:8px 0 0;padding-top:8px;border-top:1px solid #BBF7D0"><i class="fas fa-info-circle" style="margin-right:4px"></i>Send proposals & receive calendar sync via this connected account.</p>';
      } else {
        html += '<div style="display:flex;align-items:center;gap:12px">' +
          '<div style="width:40px;height:40px;border-radius:10px;background:#FEF3C7;display:flex;align-items:center;justify-content:center"><i class="fas fa-exclamation-triangle" style="color:#D97706;font-size:18px"></i></div>' +
          '<div style="flex:1"><p style="font-size:13px;font-weight:600;color:#92400E;margin:0">Gmail Not Connected</p><p style="font-size:12px;color:#A16207;margin:2px 0 0">Connect Gmail to send proposals and sync your calendar.</p></div>' +
        '</div>' +
        '<button onclick="window._settingsConnectGmail()" style="margin-top:12px;width:100%;padding:10px;background:#2563EB;color:white;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px"><i class="fab fa-google"></i>Connect Gmail Account</button>';
      }
      html += '</div></div>';

      // Quick Links
      html += '<div style="margin-bottom:16px">' +
        '<h3 style="font-size:14px;font-weight:600;color:#0F172A;margin:0 0 12px"><i class="fas fa-link" style="color:#6366F1;margin-right:8px"></i>Quick Links</h3>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
          '<a href="/customer/calendar" style="display:flex;align-items:center;gap:8px;padding:12px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;text-decoration:none;color:#475569;font-size:13px;transition:all .15s" onmouseover="this.style.background=\'#F1F5F9\';this.style.borderColor=\'#CBD5E1\'" onmouseout="this.style.background=\'#F8FAFC\';this.style.borderColor=\'#E2E8F0\'"><i class="fas fa-calendar" style="color:#0891B2"></i>Calendar</a>' +
          '<a href="/customer/team" style="display:flex;align-items:center;gap:8px;padding:12px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;text-decoration:none;color:#475569;font-size:13px;transition:all .15s" onmouseover="this.style.background=\'#F1F5F9\';this.style.borderColor=\'#CBD5E1\'" onmouseout="this.style.background=\'#F8FAFC\';this.style.borderColor=\'#E2E8F0\'"><i class="fas fa-user-friends" style="color:#7C3AED"></i>Team</a>' +
          '<a href="/pricing" style="display:flex;align-items:center;gap:8px;padding:12px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;text-decoration:none;color:#475569;font-size:13px;transition:all .15s" onmouseover="this.style.background=\'#F1F5F9\';this.style.borderColor=\'#CBD5E1\'" onmouseout="this.style.background=\'#F8FAFC\';this.style.borderColor=\'#E2E8F0\'"><i class="fas fa-coins" style="color:#D97706"></i>Buy Credits</a>' +
          '<a href="#" onclick="custLogout();return false;" style="display:flex;align-items:center;gap:8px;padding:12px;background:#FEF2F2;border:1px solid #FECACA;border-radius:10px;text-decoration:none;color:#DC2626;font-size:13px;transition:all .15s" onmouseover="this.style.background=\'#FEE2E2\'" onmouseout="this.style.background=\'#FEF2F2\'"><i class="fas fa-sign-out-alt"></i>Sign Out</a>' +
        '</div>' +
      '</div>';

      body.innerHTML = html;
    }).catch(function() {
      body.innerHTML = '<div style="text-align:center;padding:40px"><p style="color:#EF4444"><i class="fas fa-exclamation-triangle" style="margin-right:8px"></i>Failed to load settings.</p><button onclick="window._openCustomerSettings()" style="margin-top:12px;padding:8px 16px;background:#2563EB;color:white;border:none;border-radius:8px;cursor:pointer">Retry</button></div>';
    });
}

// Gmail connect/disconnect from settings panel
window._settingsConnectGmail = function() {
  fetch('/api/crm/gmail/connect', { headers: authHeaders() })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.auth_url) {
        window.open(data.auth_url, 'gmailOAuth', 'width=600,height=700');
      } else {
        alert(data.error || 'Gmail not configured. Contact support.');
      }
    }).catch(function(e) { alert('Failed to start Gmail connection: ' + (e.message || 'Network error')); });
};

window._settingsDisconnectGmail = function() {
  if (!confirm('Disconnect Gmail? You won\'t be able to email proposals until you reconnect.')) return;
  fetch('/api/crm/gmail/disconnect', { method: 'POST', headers: authHeaders() })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.success) { _loadSettingsContent(); }
    }).catch(function(e) { alert('Failed: ' + (e.message || 'Network error')); });
};

// Listen for Gmail OAuth popup completion (for settings panel)
window.addEventListener('message', function(e) {
  if (e.data && e.data.type === 'gmail_connected') {
    // Reload settings panel if open
    if (document.getElementById('custSettingsOverlay')) {
      _loadSettingsContent();
    }
  }
});

document.addEventListener('DOMContentLoaded', async function() {
  var params = new URLSearchParams(window.location.search);
  if (params.get('payment') === 'success') {
    var sid = params.get('session_id');
    if (sid) { try { await fetch('/api/square/verify-payment', { headers: authHeaders() }); } catch(e) {} }
    window.history.replaceState({}, '', '/customer/dashboard');
  }
  injectDashboardStyles();
  await loadDashData();
  renderDashboard();
  startEnhancementPolling();
  loadAutoEmailPref();
  // Auto-open settings panel if redirected from Calendar or other pages with ?open=settings
  if (params.get('open') === 'settings') {
    window.history.replaceState({}, '', '/customer/dashboard');
    setTimeout(function() { if (window._openCustomerSettings) window._openCustomerSettings(); }, 300);
  }
  // Auto-trigger enhancement for completed reports
  setTimeout(function() {
    (custState.orders || []).forEach(function(o) {
      if (o.status === 'completed' && o.report_status === 'completed' &&
          (!o.enhancement_status || o.enhancement_status === 'none' || o.enhancement_status === null)) {
        triggerAsyncEnhancement(o.id);
      }
    });
  }, 2000);
});

// ── Inject Roofr-style CSS ──
function injectDashboardStyles() {
  if (document.getElementById('roofr-dash-styles')) return;
  var s = document.createElement('style');
  s.id = 'roofr-dash-styles';
  s.textContent = `
    /* ── Roofr Dashboard Reset ── */
    .rfr-sidebar { width: 240px; background: #fff; border-right: 1px solid #E2E8F0; min-height: calc(100vh - 64px); position: sticky; top: 64px; overflow-y: auto; }
    .rfr-sidebar-collapsed { width: 64px; }
    .rfr-sidebar-collapsed .rfr-nav-label, .rfr-sidebar-collapsed .rfr-nav-section-title, .rfr-sidebar-collapsed .rfr-sidebar-profile-info, .rfr-sidebar-collapsed .rfr-nav-badge { display: none; }
    .rfr-sidebar-collapsed .rfr-nav-item { justify-content: center; padding: 10px; }
    .rfr-sidebar-collapsed .rfr-nav-item i { margin-right: 0; font-size: 18px; }
    .rfr-sidebar-collapsed .rfr-sidebar-profile { justify-content: center; padding: 12px 8px; }
    .rfr-sidebar-collapsed .rfr-sidebar-profile-avatar { margin-right: 0; }
    
    .rfr-nav-section-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #94A3B8; padding: 16px 16px 6px; }
    .rfr-nav-item { display: flex; align-items: center; padding: 8px 16px; font-size: 13px; color: #475569; cursor: pointer; transition: all 0.15s; border-radius: 0; text-decoration: none; border-left: 3px solid transparent; }
    .rfr-nav-item:hover { background: #F8FAFC; color: #1E293B; }
    .rfr-nav-item.active { color: #2563EB; background: #EFF6FF; border-left-color: #2563EB; font-weight: 600; }
    .rfr-nav-item i { width: 20px; text-align: center; margin-right: 10px; font-size: 14px; color: #94A3B8; }
    .rfr-nav-item.active i { color: #2563EB; }
    .rfr-nav-item:hover i { color: #64748B; }
    .rfr-nav-badge { margin-left: auto; font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 10px; }
    
    .rfr-sidebar-profile { display: flex; align-items: center; padding: 14px 16px; border-bottom: 1px solid #E2E8F0; }
    .rfr-sidebar-profile-avatar { width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13px; color: white; margin-right: 10px; flex-shrink: 0; }
    .rfr-sidebar-profile-info { flex: 1; min-width: 0; }
    .rfr-sidebar-profile-name { font-size: 13px; font-weight: 600; color: #0F172A; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .rfr-sidebar-profile-company { font-size: 11px; color: #94A3B8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    
    .rfr-main { flex: 1; min-width: 0; background: #F8FAFC; }
    .rfr-content { padding: 24px 32px; max-width: 1200px; }
    
    /* Metric Cards */
    .rfr-metric-card { background: white; border: 1px solid #E2E8F0; border-radius: 12px; padding: 20px; transition: box-shadow 0.2s; }
    .rfr-metric-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.06); }
    .rfr-metric-label { font-size: 12px; color: #64748B; font-weight: 500; display: flex; align-items: center; gap: 6px; }
    .rfr-metric-value { font-size: 28px; font-weight: 800; color: #0F172A; margin-top: 8px; line-height: 1; }
    .rfr-metric-sub { font-size: 12px; color: #94A3B8; margin-top: 4px; }
    
    /* Chart card */
    .rfr-chart-card { background: white; border: 1px solid #E2E8F0; border-radius: 12px; overflow: hidden; }
    .rfr-chart-header { padding: 20px 24px 0; display: flex; align-items: center; justify-content: space-between; }
    .rfr-chart-title { font-size: 16px; font-weight: 700; color: #0F172A; }
    .rfr-chart-body { padding: 16px 24px 20px; }
    
    /* Table */
    .rfr-table { width: 100%; border-collapse: collapse; }
    .rfr-table thead th { font-size: 12px; font-weight: 600; color: #64748B; text-transform: uppercase; letter-spacing: 0.04em; padding: 12px 16px; text-align: left; border-bottom: 1px solid #E2E8F0; background: #F8FAFC; }
    .rfr-table tbody td { padding: 12px 16px; font-size: 13px; color: #334155; border-bottom: 1px solid #F1F5F9; }
    .rfr-table tbody tr:hover { background: #F8FAFC; }
    .rfr-table tbody tr:last-child td { border-bottom: none; }
    
    /* Status badges */
    .rfr-badge { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 600; padding: 3px 10px; border-radius: 20px; }
    .rfr-badge-green { background: #D1FAE5; color: #065F46; }
    .rfr-badge-blue { background: #DBEAFE; color: #1E40AF; }
    .rfr-badge-amber { background: #FEF3C7; color: #92400E; }
    .rfr-badge-red { background: #FEE2E2; color: #991B1B; }
    .rfr-badge-purple { background: #EDE9FE; color: #5B21B6; }
    .rfr-badge-gray { background: #F1F5F9; color: #475569; }
    
    /* Buttons */
    .rfr-btn { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; padding: 8px 16px; border-radius: 8px; cursor: pointer; transition: all 0.15s; border: none; text-decoration: none; }
    .rfr-btn-primary { background: #2563EB; color: white; }
    .rfr-btn-primary:hover { background: #1D4ED8; }
    .rfr-btn-outline { background: white; color: #334155; border: 1px solid #E2E8F0; }
    .rfr-btn-outline:hover { background: #F8FAFC; border-color: #CBD5E1; }
    
    /* Quick action cards */
    .rfr-action-card { display: flex; align-items: center; gap: 12px; padding: 14px 16px; background: white; border: 1px solid #E2E8F0; border-radius: 10px; cursor: pointer; transition: all 0.2s; text-decoration: none; }
    .rfr-action-card:hover { border-color: #2563EB; box-shadow: 0 2px 8px rgba(37,99,235,0.1); transform: translateY(-1px); }
    .rfr-action-icon { width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .rfr-action-label { font-size: 13px; font-weight: 600; color: #0F172A; }
    .rfr-action-desc { font-size: 11px; color: #94A3B8; margin-top: 1px; }
    
    /* Tabs */
    .rfr-tabs { display: flex; gap: 0; border-bottom: 1px solid #E2E8F0; margin-bottom: 24px; }
    .rfr-tab { padding: 10px 20px; font-size: 13px; font-weight: 500; color: #64748B; cursor: pointer; border-bottom: 2px solid transparent; transition: all 0.15s; }
    .rfr-tab:hover { color: #334155; }
    .rfr-tab.active { color: #2563EB; border-bottom-color: #2563EB; font-weight: 600; }
    
    /* Secretary panel */
    .rfr-secretary-panel { background: linear-gradient(135deg, #1E40AF, #2563EB); border-radius: 12px; padding: 24px; color: white; }
    .rfr-secretary-stat { background: rgba(255,255,255,0.1); border-radius: 10px; padding: 14px; backdrop-filter: blur(4px); }
    
    /* Generating animation */
    @keyframes rfrPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
    @keyframes rfrSlideStripes { from { transform: translateX(0); } to { transform: translateX(-50%); } }
    @keyframes rfrSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    @keyframes rfrSlideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
    @keyframes rfrSlideOut { from { transform: translateX(0); opacity: 1; } to { transform: translateX(100%); opacity: 0; } }
    @keyframes rfrCelebrate { 0% { transform: scale(0.8); opacity: 0; } 50% { transform: scale(1.05); } 100% { transform: scale(1); opacity: 1; } }
    .rfr-spin { animation: rfrSpin 1s linear infinite; }
    .rfr-pulse { animation: rfrPulse 2s ease-in-out infinite; }
    
    /* Mini bar chart */
    .rfr-bar-chart { display: flex; align-items: flex-end; gap: 4px; height: 120px; padding-top: 8px; }
    .rfr-bar { flex: 1; background: #DBEAFE; border-radius: 4px 4px 0 0; min-height: 4px; transition: all 0.3s; cursor: pointer; position: relative; }
    .rfr-bar:hover { background: #2563EB; }
    .rfr-bar-tooltip { display: none; position: absolute; bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%); background: #0F172A; color: white; font-size: 11px; padding: 4px 8px; border-radius: 6px; white-space: nowrap; z-index: 10; }
    .rfr-bar:hover .rfr-bar-tooltip { display: block; }
    .rfr-bar-labels { display: flex; gap: 4px; margin-top: 6px; }
    .rfr-bar-labels span { flex: 1; text-align: center; font-size: 10px; color: #94A3B8; }
    
    /* Mobile responsive */
    @media (max-width: 1024px) {
      .rfr-sidebar { display: none; }
      .rfr-sidebar.mobile-open { display: block; position: fixed; top: 0; left: 0; z-index: 50; height: 100vh; box-shadow: 0 0 40px rgba(0,0,0,0.2); }
      .rfr-content { padding: 16px; }
    }
    @media (max-width: 640px) {
      .rfr-metric-value { font-size: 22px; }
      .rfr-content { padding: 12px; }
    }
  `;
  document.head.appendChild(s);
}

// ── Data Loading ──
async function loadDashData() {
  custState.loading = true;
  try {
    var [profileRes, ordersRes, billingRes, crmCustRes, crmInvRes, crmPropRes, crmJobRes, secRes, teamRes] = await Promise.all([
      fetch('/api/customer/me', { headers: authHeaders() }),
      fetch('/api/customer/orders', { headers: authHeaders() }),
      fetch('/api/square/billing', { headers: authHeaders() }),
      fetch('/api/crm/customers', { headers: authHeaders() }).catch(function() { return { ok: false }; }),
      fetch('/api/crm/invoices', { headers: authHeaders() }).catch(function() { return { ok: false }; }),
      fetch('/api/crm/proposals', { headers: authHeaders() }).catch(function() { return { ok: false }; }),
      fetch('/api/crm/jobs', { headers: authHeaders() }).catch(function() { return { ok: false }; }),
      fetch('/api/secretary/status', { headers: authHeaders() }).catch(function() { return { ok: false }; }),
      fetch('/api/team/members', { headers: authHeaders() }).catch(function() { return { ok: false }; })
    ]);
    if (profileRes.ok) {
      var pd = await profileRes.json();
      custState.customer = pd.customer;
      localStorage.setItem('rc_customer', JSON.stringify(pd.customer));
    } else {
      localStorage.removeItem('rc_customer'); localStorage.removeItem('rc_customer_token');
      window.location.href = '/customer/login'; return;
    }
    if (ordersRes.ok) custState.orders = (await ordersRes.json()).orders || [];
    if (billingRes.ok) custState.billing = (await billingRes.json()).billing || null;

    var stats = { customers: 0, invoices_owing: 0, invoices_paid: 0, proposals_open: 0, proposals_sold: 0, jobs_total: 0, jobs_scheduled: 0, jobs_in_progress: 0 };
    if (crmCustRes.ok) { var d = await crmCustRes.json(); stats.customers = (d.stats && d.stats.total) || 0; }
    if (crmInvRes.ok) { var d2 = await crmInvRes.json(); stats.invoices_owing = (d2.stats && d2.stats.total_owing) || 0; stats.invoices_paid = (d2.stats && d2.stats.total_paid) || 0; }
    if (crmPropRes.ok) { var d3 = await crmPropRes.json(); stats.proposals_open = (d3.stats && d3.stats.open_count) || 0; stats.proposals_sold = (d3.stats && d3.stats.sold_count) || 0; }
    if (crmJobRes.ok) { var d4 = await crmJobRes.json(); stats.jobs_total = (d4.stats && d4.stats.total) || 0; stats.jobs_scheduled = (d4.stats && d4.stats.scheduled) || 0; stats.jobs_in_progress = (d4.stats && d4.stats.in_progress) || 0; }
    custState.crmStats = stats;
    // Secretary status
    custState.secretaryActive = false;
    custState.secretaryCalls = 0;
    custState.secretaryStats = null;
    if (secRes.ok) { var secData = await secRes.json(); custState.secretaryActive = secData.has_active_subscription; custState.secretaryCalls = secData.total_calls || 0; }
    if (custState.secretaryActive) {
      try {
        var statsRes = await fetch('/api/secretary/call-stats', { headers: authHeaders() });
        if (statsRes.ok) custState.secretaryStats = await statsRes.json();
      } catch(e) {}
    }
    // Team members
    custState.teamMembers = 0;
    custState.isTeamMember = false;
    custState.teamOwnerName = '';
    custState.teamOwnerCompany = '';
    custState.teamRole = '';
    if (teamRes.ok) { var teamData = await teamRes.json(); custState.teamMembers = (teamData.billing && teamData.billing.active_seats) || (teamData.members || []).length; custState.isTeamMember = teamData.is_team_member || false; }
    if (custState.customer) {
      custState.isTeamMember = custState.customer.is_team_member || false;
      custState.teamOwnerName = custState.customer.team_owner_name || '';
      custState.teamOwnerCompany = custState.customer.team_owner_company || '';
      custState.teamRole = custState.customer.team_role || '';
    }
  } catch(e) { console.error('Dashboard load error:', e); }
  custState.loading = false;
}

// ============================================================
// MAIN RENDER
// ============================================================
function renderDashboard() {
  var root = document.getElementById('customer-root');
  if (!root) return;
  if (custState.loading) {
    root.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;padding:80px 0"><div class="rfr-spin" style="width:36px;height:36px;border:3px solid #E2E8F0;border-top-color:#2563EB;border-radius:50%"></div><span style="margin-left:14px;color:#64748B;font-size:14px">Loading dashboard...</span></div>';
    return;
  }

  var c = custState.customer || {};
  var b = custState.billing || {};
  var s = custState.crmStats || {};

  root.innerHTML =
    '<div style="display:flex;min-height:calc(100vh - 64px)">' +
      // ═══ SIDEBAR ═══
      renderSidebar(c, s) +
      // ═══ MAIN CONTENT ═══
      '<div class="rfr-main">' +
        // Mobile menu bar
        '<div style="display:none;padding:12px 16px;border-bottom:1px solid #E2E8F0;background:white" class="rfr-mobile-bar">' +
          '<button onclick="toggleMobileSidebar()" style="background:none;border:1px solid #E2E8F0;border-radius:8px;padding:6px 12px;font-size:13px;color:#475569;cursor:pointer"><i class="fas fa-bars" style="margin-right:6px"></i>Menu</button>' +
        '</div>' +
        '<div class="rfr-content">' +
          renderMainContent(c, b, s) +
        '</div>' +
      '</div>' +
    '</div>';

  // Add mobile responsive class
  addMobileResponsive();
}

// ============================================================
// SIDEBAR — Roofr-style with sections and icons
// ============================================================
function renderSidebar(c, s) {
  var freeTrialRemaining = c.free_trial_remaining || 0;
  var paidCredits = c.paid_credits_remaining || 0;
  var completedReports = custState.orders.filter(function(o) { return o.status === 'completed'; }).length;
  var initials = getInitials(c.name || c.email || 'U');
  var avatarColors = ['#2563EB','#7C3AED','#059669','#DC2626','#D97706','#0891B2'];
  var avatarColor = avatarColors[(c.name || '').length % avatarColors.length];

  var nav = [
    { section: null, items: [
      { href: '/customer/dashboard', icon: 'fa-th-large', label: 'Dashboard', active: true },
    ]},
    { section: 'Roof Reports', items: [
      { href: '/customer/order', icon: 'fa-plus-circle', label: 'New Report', badge: freeTrialRemaining > 0 ? freeTrialRemaining + ' free' : (paidCredits > 0 ? paidCredits : ''), badgeClass: freeTrialRemaining > 0 ? 'rfr-badge-green' : 'rfr-badge-blue' },
      { href: '/customer/reports', icon: 'fa-file-alt', label: 'Report History', badge: completedReports > 0 ? completedReports : '', badgeClass: 'rfr-badge-gray' },
      { href: '/customer/virtual-tryon', icon: 'fa-magic', label: 'Virtual Try-On' },
      { href: '/customer/home-designer', icon: 'fa-home', label: 'Home Designer' },
    ]},
    { section: 'CRM', items: [
      { href: '/customer/customers', icon: 'fa-address-book', label: 'Contacts', badge: s.customers > 0 ? s.customers : '', badgeClass: 'rfr-badge-gray' },
      { href: '/customer/invoices', icon: 'fa-file-invoice-dollar', label: 'Invoices', badge: s.invoices_owing > 0 ? '$' + Number(s.invoices_owing).toFixed(0) : '', badgeClass: 'rfr-badge-amber' },
      { href: '/customer/proposals', icon: 'fa-file-signature', label: 'Proposals', badge: s.proposals_open > 0 ? s.proposals_open : '', badgeClass: 'rfr-badge-blue' },
      { href: '/customer/pipeline', icon: 'fa-chart-bar', label: 'Pipeline' },
    ]},
    { section: 'Operations', items: [
      { href: '/customer/jobs', icon: 'fa-hard-hat', label: 'Jobs', badge: s.jobs_in_progress > 0 ? s.jobs_in_progress + ' active' : '', badgeClass: 'rfr-badge-amber' },
      { href: '/customer/calendar', icon: 'fa-calendar', label: 'Calendar' },
      { href: '/customer/d2d', icon: 'fa-route', label: 'D2D Manager' },
      { href: '/customer/sales', icon: 'fa-chart-line', label: 'Sales Engine' },
    ]},
    { section: 'Team & AI', items: [
      { href: '/customer/team', icon: 'fa-user-friends', label: 'Team', badge: custState.teamMembers > 0 ? custState.teamMembers : '', badgeClass: 'rfr-badge-gray' },
      { href: '/customer/secretary', icon: 'fa-headset', label: 'AI Secretary', badge: custState.secretaryActive ? 'Active' : '', badgeClass: custState.secretaryActive ? 'rfr-badge-green' : '' },
    ]},
  ];

  var html = '<aside class="rfr-sidebar" id="rfrSidebar">';

  // Profile card
  html += '<div class="rfr-sidebar-profile">' +
    (c.google_avatar ? '<img src="' + c.google_avatar + '" style="width:32px;height:32px;border-radius:8px;margin-right:10px;flex-shrink:0" alt="">' :
      '<div class="rfr-sidebar-profile-avatar" style="background:' + avatarColor + '">' + initials + '</div>') +
    '<div class="rfr-sidebar-profile-info">' +
      '<div class="rfr-sidebar-profile-name">' + (c.name || 'User') + '</div>' +
      '<div class="rfr-sidebar-profile-company">' + (c.company_name || c.email || '') + '</div>' +
    '</div>' +
    '<i class="fas fa-chevron-down" style="color:#94A3B8;font-size:10px;cursor:pointer" onclick="document.getElementById(\'profileDropdown\').style.display=document.getElementById(\'profileDropdown\').style.display===\'block\'?\'none\':\'block\'"></i>' +
  '</div>';
  // Profile dropdown
  html += '<div id="profileDropdown" style="display:none;background:white;border-bottom:1px solid #E2E8F0;padding:8px">' +
    '<a href="/customer/dashboard" style="display:block;padding:6px 12px;font-size:12px;color:#475569;text-decoration:none;border-radius:6px" onmouseover="this.style.background=\'#F8FAFC\'" onmouseout="this.style.background=\'\'"><i class="fas fa-user" style="width:16px;margin-right:6px;color:#94A3B8"></i>My Account</a>' +
    '<a href="/pricing" style="display:block;padding:6px 12px;font-size:12px;color:#475569;text-decoration:none;border-radius:6px" onmouseover="this.style.background=\'#F8FAFC\'" onmouseout="this.style.background=\'\'"><i class="fas fa-coins" style="width:16px;margin-right:6px;color:#94A3B8"></i>Buy Credits</a>' +
    '<div style="height:1px;background:#F1F5F9;margin:4px 0"></div>' +
    '<a href="/customer/login" onclick="localStorage.removeItem(\'rc_customer\');localStorage.removeItem(\'rc_customer_token\')" style="display:block;padding:6px 12px;font-size:12px;color:#EF4444;text-decoration:none;border-radius:6px" onmouseover="this.style.background=\'#FEF2F2\'" onmouseout="this.style.background=\'\'"><i class="fas fa-sign-out-alt" style="width:16px;margin-right:6px"></i>Sign Out</a>' +
  '</div>';

  // Nav sections
  nav.forEach(function(sec) {
    if (sec.section) {
      html += '<div class="rfr-nav-section-title">' + sec.section + '</div>';
    }
    sec.items.forEach(function(item) {
      var active = item.active || window.location.pathname === item.href;
      html += '<a href="' + item.href + '" class="rfr-nav-item' + (active ? ' active' : '') + '">' +
        '<i class="fas ' + item.icon + '"></i>' +
        '<span class="rfr-nav-label">' + item.label + '</span>' +
        (item.badge ? '<span class="rfr-nav-badge rfr-badge ' + (item.badgeClass || 'rfr-badge-gray') + '">' + item.badge + '</span>' : '') +
      '</a>';
    });
  });

  // Sidebar footer
  html += '<div style="margin-top:auto;padding:12px 16px;border-top:1px solid #E2E8F0">' +
    '<a href="/pricing" class="rfr-nav-item" style="border-left:none;border-radius:8px;margin-bottom:2px"><i class="fas fa-arrow-circle-up" style="color:#2563EB"></i><span class="rfr-nav-label" style="color:#2563EB;font-weight:600">Upgrade</span></a>' +
    '<a href="#" class="rfr-nav-item" style="border-left:none;border-radius:8px;margin-bottom:2px"><i class="fas fa-question-circle"></i><span class="rfr-nav-label">Help & Support</span></a>' +
    '<a href="#" onclick="window._openCustomerSettings();return false;" class="rfr-nav-item" style="border-left:none;border-radius:8px"><i class="fas fa-cog"></i><span class="rfr-nav-label">Settings</span></a>' +
  '</div>';

  html += '</aside>';
  return html;
}

// ============================================================
// MAIN CONTENT AREA
// ============================================================
function renderMainContent(c, b, s) {
  var freeTrialRemaining = c.free_trial_remaining || 0;
  var paidCredits = c.paid_credits_remaining || 0;
  var completedReports = custState.orders.filter(function(o) { return o.status === 'completed'; }).length;
  var processingReports = custState.orders.filter(function(o) { return o.status === 'processing'; }).length;

  var html = '';

  // ── Page Header ──
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px">' +
    '<div>' +
      '<h1 style="font-size:24px;font-weight:800;color:#0F172A;margin:0">Dashboard</h1>' +
      '<p style="font-size:13px;color:#64748B;margin-top:2px">Welcome back, ' + (c.name ? c.name.split(' ')[0] : 'there') + '</p>' +
    '</div>' +
    '<div style="display:flex;gap:8px;align-items:center">' +
      (processingReports > 0 ? '<span class="rfr-badge rfr-badge-blue rfr-pulse" style="font-size:12px;padding:5px 12px"><i class="fas fa-spinner rfr-spin" style="margin-right:4px"></i>' + processingReports + ' generating</span>' : '') +
      '<a href="/customer/order" class="rfr-btn rfr-btn-primary"><i class="fas fa-plus"></i>New Report</a>' +
    '</div>' +
  '</div>';

  // ── Team Banner ──
  if (custState.isTeamMember) {
    html += '<div style="background:linear-gradient(135deg,#1E40AF,#3B82F6);border-radius:10px;padding:14px 20px;margin-bottom:20px;display:flex;align-items:center;gap:12px">' +
      '<div style="width:36px;height:36px;background:rgba(255,255,255,0.15);border-radius:8px;display:flex;align-items:center;justify-content:center"><i class="fas fa-users" style="color:white;font-size:14px"></i></div>' +
      '<div style="flex:1"><span style="color:white;font-size:13px;font-weight:600">Team Access</span><span class="rfr-badge" style="background:rgba(255,255,255,0.15);color:#BFDBFE;margin-left:8px;font-size:10px">' + (custState.teamRole || 'member') + '</span><p style="color:#93C5FD;font-size:11px;margin-top:1px">Accessing <strong style="color:white">' + (custState.teamOwnerCompany || custState.teamOwnerName || 'Team') + '</strong></p></div>' +
    '</div>';
  }

  // ── Generating Reports Progress ──
  html += renderGeneratingReports();

  // ── Trial Exhausted Banner ──
  if (freeTrialRemaining <= 0 && paidCredits <= 0) {
    html += '<div style="background:linear-gradient(135deg,#0F172A,#1E293B);border-radius:12px;padding:20px 24px;margin-bottom:24px;display:flex;align-items:center;gap:16px;border:1px solid #334155">' +
      '<div style="width:44px;height:44px;background:#F59E0B;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="fas fa-crown" style="color:white;font-size:18px"></i></div>' +
      '<div style="flex:1"><h3 style="color:white;font-size:15px;font-weight:700;margin:0">Unlock More Reports</h3><p style="color:#94A3B8;font-size:12px;margin-top:2px">Credit packs start at <strong style="color:#F59E0B">$5.00/report</strong> — save up to 38%</p></div>' +
      '<a href="/pricing" class="rfr-btn" style="background:#F59E0B;color:#0F172A;font-weight:700"><i class="fas fa-tags"></i>View Plans</a>' +
    '</div>';
  }

  // ── Metric Cards Row ──
  html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px">' +
    rfrMetricCard('fa-file-alt', 'Reports', completedReports, completedReports > 0 ? 'Total completed' : 'Order your first', '#2563EB', '#EFF6FF') +
    rfrMetricCard('fa-coins', 'Credits', freeTrialRemaining > 0 ? freeTrialRemaining + ' free' : (paidCredits > 0 ? paidCredits : '0'), freeTrialRemaining > 0 ? 'Free trial' : 'Available credits', '#059669', '#D1FAE5') +
    rfrMetricCard('fa-users', 'Contacts', s.customers || 0, s.customers > 0 ? 'In your CRM' : 'Add contacts', '#7C3AED', '#EDE9FE') +
    rfrMetricCard('fa-file-invoice-dollar', 'Invoices', s.invoices_owing > 0 ? '$' + Number(s.invoices_owing).toFixed(0) : '$0', s.invoices_paid > 0 ? '$' + Number(s.invoices_paid).toFixed(0) + ' paid' : 'None outstanding', '#D97706', '#FEF3C7') +
  '</div>';

  // ── Two Column: Chart + Secretary ──
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px">';
  // Left: Reports chart
  html += renderReportsChart();
  // Right: Secretary panel or CRM stats
  if (custState.secretaryActive) {
    html += renderSecretaryPanel();
  } else {
    html += renderCRMStatsCard(s);
  }
  html += '</div>';

  // ── Recent Reports Table ──
  html += renderReportsTable();

  // ── Quick Actions ──
  html += '<div style="margin-bottom:24px">' +
    '<h3 style="font-size:14px;font-weight:700;color:#0F172A;margin-bottom:12px">Quick Actions</h3>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px">' +
      rfrActionCard('/customer/order', 'fa-plus-circle', '#2563EB', '#EFF6FF', 'Order Report', 'Generate a roof measurement report') +
      rfrActionCard('/customer/customers', 'fa-user-plus', '#059669', '#D1FAE5', 'Add Contact', 'Add a new customer to your CRM') +
      rfrActionCard('/customer/invoices', 'fa-receipt', '#D97706', '#FEF3C7', 'Create Invoice', 'Send a professional invoice') +
      rfrActionCard('/customer/proposals', 'fa-file-signature', '#7C3AED', '#EDE9FE', 'New Proposal', 'Create a proposal estimate') +
    '</div>' +
  '</div>';

  // ── Auto-Email Toggle ──
  html += '<div class="rfr-metric-card" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px">' +
    '<div>' +
      '<p style="font-size:13px;font-weight:600;color:#0F172A"><i class="fas fa-envelope" style="color:#0891B2;margin-right:8px"></i>Auto-email reports when ready</p>' +
      '<p style="font-size:12px;color:#94A3B8;margin-top:2px">Completed reports sent to ' + (c.email || 'your email') + '</p>' +
    '</div>' +
    '<label style="position:relative;display:inline-flex;align-items:center;cursor:pointer">' +
      '<input type="checkbox" id="auto-email-toggle" style="position:absolute;opacity:0;width:0;height:0" onchange="toggleAutoEmail(this.checked)">' +
      '<div style="width:44px;height:24px;background:#E2E8F0;border-radius:12px;transition:background 0.2s;position:relative" id="autoEmailTrack">' +
        '<div style="position:absolute;top:2px;left:2px;width:20px;height:20px;background:white;border-radius:10px;transition:transform 0.2s;box-shadow:0 1px 3px rgba(0,0,0,0.15)" id="autoEmailThumb"></div>' +
      '</div>' +
    '</label>' +
  '</div>';

  // ── Footer ──
  html += '<div style="text-align:center;padding:20px 0;font-size:11px;color:#CBD5E1">' +
    'Powered by <strong>RoofReporterAI</strong> &middot; Antigravity Gemini Roof Measurement Suite' +
  '</div>';

  return html;
}

// ── Metric Card Component ──
function rfrMetricCard(icon, label, value, sub, iconColor, iconBg) {
  return '<div class="rfr-metric-card">' +
    '<div class="rfr-metric-label">' +
      '<div style="width:28px;height:28px;background:' + iconBg + ';border-radius:8px;display:flex;align-items:center;justify-content:center"><i class="fas ' + icon + '" style="font-size:12px;color:' + iconColor + '"></i></div>' +
      '<span>' + label + '</span>' +
    '</div>' +
    '<div class="rfr-metric-value">' + value + '</div>' +
    '<div class="rfr-metric-sub">' + sub + '</div>' +
  '</div>';
}

// ── Action Card Component ──
function rfrActionCard(href, icon, iconColor, iconBg, label, desc) {
  return '<a href="' + href + '" class="rfr-action-card">' +
    '<div class="rfr-action-icon" style="background:' + iconBg + '"><i class="fas ' + icon + '" style="font-size:16px;color:' + iconColor + '"></i></div>' +
    '<div><div class="rfr-action-label">' + label + '</div><div class="rfr-action-desc">' + desc + '</div></div>' +
  '</a>';
}

// ── Reports Mini Bar Chart ──
function renderReportsChart() {
  // Build monthly data from orders
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var now = new Date();
  var monthData = [];
  for (var i = 5; i >= 0; i--) {
    var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    var m = d.getMonth();
    var y = d.getFullYear();
    var count = custState.orders.filter(function(o) {
      var od = new Date(o.created_at);
      return od.getMonth() === m && od.getFullYear() === y;
    }).length;
    monthData.push({ label: months[m], count: count, month: m, year: y });
  }
  var maxCount = Math.max.apply(null, monthData.map(function(d) { return d.count; })) || 1;

  var html = '<div class="rfr-chart-card">' +
    '<div class="rfr-chart-header">' +
      '<div class="rfr-chart-title"><i class="fas fa-chart-bar" style="color:#2563EB;margin-right:8px;font-size:14px"></i>Report Activity</div>' +
      '<span class="rfr-badge rfr-badge-blue" style="font-size:11px">Last 6 months</span>' +
    '</div>' +
    '<div class="rfr-chart-body">' +
      '<div class="rfr-bar-chart">';
  monthData.forEach(function(d) {
    var pct = Math.max(4, (d.count / maxCount) * 100);
    html += '<div class="rfr-bar" style="height:' + pct + '%"><div class="rfr-bar-tooltip">' + d.count + ' report' + (d.count !== 1 ? 's' : '') + '</div></div>';
  });
  html += '</div>' +
    '<div class="rfr-bar-labels">';
  monthData.forEach(function(d) {
    html += '<span>' + d.label + '</span>';
  });
  html += '</div>';

  // Summary metrics row
  var totalReports = custState.orders.length;
  var avgPerMonth = totalReports > 0 ? (totalReports / 6).toFixed(1) : '0';
  html += '<div style="display:flex;gap:0;margin-top:16px;border-top:1px solid #F1F5F9;padding-top:12px">' +
    '<div style="flex:1;text-align:center;border-right:1px solid #F1F5F9"><div style="font-size:20px;font-weight:800;color:#0F172A">' + totalReports + '</div><div style="font-size:11px;color:#94A3B8">Total Reports</div></div>' +
    '<div style="flex:1;text-align:center;border-right:1px solid #F1F5F9"><div style="font-size:20px;font-weight:800;color:#0F172A">' + avgPerMonth + '</div><div style="font-size:11px;color:#94A3B8">Avg/Month</div></div>' +
    '<div style="flex:1;text-align:center"><div style="font-size:20px;font-weight:800;color:#0F172A">' + (monthData[5] ? monthData[5].count : 0) + '</div><div style="font-size:11px;color:#94A3B8">This Month</div></div>' +
  '</div>';
  html += '</div></div>';
  return html;
}

// ── Secretary Panel ──
function renderSecretaryPanel() {
  var st = custState.secretaryStats || {};
  var totalCalls = st.total_calls || 0;
  var todayCalls = st.today_calls || 0;
  var newLeads = st.new_leads || 0;
  var avgDur = st.avg_duration_seconds || 0;
  var avgMin = Math.floor(avgDur / 60);
  var avgSec = avgDur % 60;
  var recentCalls = (st.recent_calls || []).slice(0, 4);

  var html = '<div class="rfr-secretary-panel">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">' +
      '<div style="display:flex;align-items:center;gap:10px">' +
        '<div style="width:36px;height:36px;background:rgba(255,255,255,0.15);border-radius:8px;display:flex;align-items:center;justify-content:center"><i class="fas fa-headset" style="color:white;font-size:16px"></i></div>' +
        '<div><div style="font-size:15px;font-weight:700">AI Secretary</div><div style="font-size:11px;color:#93C5FD"><i class="fas fa-circle" style="color:#34D399;font-size:6px;margin-right:4px"></i>Live — answering calls</div></div>' +
      '</div>' +
      '<a href="/customer/secretary" class="rfr-btn" style="background:rgba(255,255,255,0.15);color:white;font-size:12px;border:1px solid rgba(255,255,255,0.2)"><i class="fas fa-cog"></i>Manage</a>' +
    '</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">' +
      '<div class="rfr-secretary-stat"><div style="font-size:11px;color:#93C5FD">Total Calls</div><div style="font-size:22px;font-weight:800">' + totalCalls + '</div></div>' +
      '<div class="rfr-secretary-stat"><div style="font-size:11px;color:#93C5FD">Today</div><div style="font-size:22px;font-weight:800">' + todayCalls + '</div></div>' +
      '<div class="rfr-secretary-stat"><div style="font-size:11px;color:#93C5FD">New Leads</div><div style="font-size:22px;font-weight:800;color:#FCD34D">' + newLeads + '</div></div>' +
      '<div class="rfr-secretary-stat"><div style="font-size:11px;color:#93C5FD">Avg Duration</div><div style="font-size:22px;font-weight:800">' + (avgMin > 0 ? avgMin + 'm ' : '') + avgSec + 's</div></div>' +
    '</div>';
  // Alert banners
  if (newLeads > 0) {
    html += '<div style="background:rgba(245,158,11,0.2);border:1px solid rgba(245,158,11,0.3);border-radius:8px;padding:10px 14px;display:flex;align-items:center;gap:10px;margin-bottom:10px">' +
      '<i class="fas fa-fire-alt" style="color:#FCD34D;font-size:14px"></i>' +
      '<div style="flex:1;font-size:12px"><strong>' + newLeads + ' new lead' + (newLeads > 1 ? 's' : '') + '</strong> — follow up to close</div>' +
      '<a href="/customer/secretary?tab=leads" style="color:#FCD34D;font-size:11px;font-weight:700;text-decoration:none">View <i class="fas fa-arrow-right"></i></a>' +
    '</div>';
  }
  // Recent calls
  if (recentCalls.length > 0) {
    html += '<div style="border-top:1px solid rgba(255,255,255,0.1);padding-top:10px">' +
      '<div style="font-size:11px;color:#93C5FD;margin-bottom:8px;font-weight:600">RECENT CALLS</div>';
    recentCalls.forEach(function(call) {
      var durSec = call.call_duration_seconds || 0;
      var durStr = Math.floor(durSec / 60) > 0 ? Math.floor(durSec / 60) + ':' + ((durSec % 60) < 10 ? '0' : '') + (durSec % 60) : durSec + 's';
      html += '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05)">' +
        '<div style="width:28px;height:28px;background:rgba(255,255,255,0.1);border-radius:6px;display:flex;align-items:center;justify-content:center"><i class="fas ' + (call.is_lead ? 'fa-fire' : 'fa-phone') + '" style="font-size:11px;color:' + (call.is_lead ? '#FCD34D' : '#93C5FD') + '"></i></div>' +
        '<div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + (call.caller_name || 'Unknown') + '</div><div style="font-size:10px;color:#93C5FD">' + (call.caller_phone || '') + '</div></div>' +
        '<div style="text-align:right;flex-shrink:0"><div style="font-size:11px;font-weight:600">' + durStr + '</div><div style="font-size:10px;color:#93C5FD">' + getTimeAgo(call.created_at) + '</div></div>' +
      '</div>';
    });
    html += '</div>';
  }
  html += '</div>';
  return html;
}

// ── CRM Stats Card (when no secretary) ──
function renderCRMStatsCard(s) {
  return '<div class="rfr-chart-card">' +
    '<div class="rfr-chart-header">' +
      '<div class="rfr-chart-title"><i class="fas fa-briefcase" style="color:#7C3AED;margin-right:8px;font-size:14px"></i>Business Overview</div>' +
    '</div>' +
    '<div class="rfr-chart-body">' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
        crmStatTile('fa-file-signature', 'Proposals Open', s.proposals_open || 0, '#7C3AED', '#EDE9FE') +
        crmStatTile('fa-check-circle', 'Proposals Sold', s.proposals_sold || 0, '#059669', '#D1FAE5') +
        crmStatTile('fa-hard-hat', 'Active Jobs', s.jobs_in_progress || 0, '#D97706', '#FEF3C7') +
        crmStatTile('fa-calendar-check', 'Scheduled', s.jobs_scheduled || 0, '#0891B2', '#CFFAFE') +
      '</div>' +
      // Secretary upsell
      '<div style="margin-top:16px;padding:14px;background:#F8FAFC;border-radius:10px;border:1px solid #E2E8F0">' +
        '<div style="display:flex;align-items:center;gap:10px">' +
          '<div style="width:36px;height:36px;background:#EDE9FE;border-radius:8px;display:flex;align-items:center;justify-content:center"><i class="fas fa-headset" style="color:#7C3AED;font-size:14px"></i></div>' +
          '<div style="flex:1"><div style="font-size:13px;font-weight:600;color:#0F172A">AI Secretary</div><div style="font-size:11px;color:#94A3B8">Never miss a call — AI answers 24/7</div></div>' +
          '<a href="/customer/secretary" class="rfr-btn rfr-btn-primary" style="font-size:11px;padding:6px 12px">Setup</a>' +
        '</div>' +
      '</div>' +
    '</div>' +
  '</div>';
}

function crmStatTile(icon, label, value, color, bg) {
  return '<div style="background:' + bg + ';border-radius:10px;padding:14px">' +
    '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px"><i class="fas ' + icon + '" style="font-size:12px;color:' + color + '"></i><span style="font-size:11px;color:#64748B">' + label + '</span></div>' +
    '<div style="font-size:24px;font-weight:800;color:#0F172A">' + value + '</div>' +
  '</div>';
}

// ── Reports Table ──
function renderReportsTable() {
  var orders = custState.orders.slice(0, 8);
  var html = '<div class="rfr-chart-card" style="margin-bottom:24px">' +
    '<div class="rfr-chart-header" style="padding-bottom:0">' +
      '<div class="rfr-chart-title"><i class="fas fa-list" style="color:#2563EB;margin-right:8px;font-size:14px"></i>Recent Reports</div>' +
      '<a href="/customer/reports" style="font-size:12px;color:#2563EB;text-decoration:none;font-weight:600">View all <i class="fas fa-arrow-right" style="margin-left:4px;font-size:10px"></i></a>' +
    '</div>';

  if (orders.length === 0) {
    html += '<div style="text-align:center;padding:48px 20px">' +
      '<div style="width:56px;height:56px;background:#F1F5F9;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 12px"><i class="fas fa-clipboard-list" style="color:#94A3B8;font-size:22px"></i></div>' +
      '<p style="font-size:14px;color:#475569;margin:0 0 8px">No reports yet</p>' +
      '<a href="/customer/order" class="rfr-btn rfr-btn-primary" style="font-size:12px"><i class="fas fa-plus"></i>Order your first report</a>' +
    '</div>';
  } else {
    html += '<div style="overflow-x:auto"><table class="rfr-table"><thead><tr>' +
      '<th>Status</th><th>Address</th><th>Date</th><th>Roof Area</th><th>Actions</th>' +
    '</tr></thead><tbody>';
    orders.forEach(function(o) {
      var isEnhancing = o.report_status === 'enhancing' || o.enhancement_status === 'sent' || o.enhancement_status === 'pending';
      var isProcessing = o.status === 'processing' || o.report_status === 'generating' || o.report_status === 'pending';
      var reportReady = (o.report_status === 'completed' || o.status === 'completed') && !isEnhancing && !isProcessing;
      var badgeClass = reportReady ? 'rfr-badge-green' : (isEnhancing ? 'rfr-badge-purple' : (isProcessing ? 'rfr-badge-blue' : 'rfr-badge-gray'));
      var statusLabel = isEnhancing ? 'Enhancing' : (isProcessing ? 'Generating' : (reportReady ? 'Completed' : o.status));
      var statusIcon = reportReady ? 'fa-check-circle' : (isEnhancing ? 'fa-wand-magic-sparkles' : (isProcessing ? 'fa-spinner rfr-spin' : 'fa-circle'));
      var enhancedBadge = o.enhancement_status === 'enhanced' ? ' <span class="rfr-badge rfr-badge-purple" style="font-size:9px"><i class="fas fa-magic"></i> AI+</span>' : '';
      var imageryBadge = o.ai_imagery_status === 'completed' ? ' <span class="rfr-badge rfr-badge-amber" style="font-size:9px"><i class="fas fa-images"></i></span>' : '';

      html += '<tr>' +
        '<td><span class="rfr-badge ' + badgeClass + '"><i class="fas ' + statusIcon + '"></i> ' + statusLabel + '</span>' + enhancedBadge + imageryBadge + '</td>' +
        '<td style="font-weight:600;color:#0F172A;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><i class="fas fa-map-marker-alt" style="color:#EF4444;margin-right:6px;font-size:11px"></i>' + (o.property_address || 'Unknown') + '</td>' +
        '<td style="white-space:nowrap">' + new Date(o.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + '</td>' +
        '<td>' + (o.roof_area_sqft ? Math.round(o.roof_area_sqft).toLocaleString() + ' sq ft' : '—') + '</td>' +
        '<td style="white-space:nowrap">' +
          (reportReady ? '<a href="/api/reports/' + o.id + '/html" target="_blank" style="color:#2563EB;text-decoration:none;font-size:12px;font-weight:600;margin-right:12px"><i class="fas fa-eye" style="margin-right:3px"></i>View</a>' : '') +
          (reportReady ? '<a href="/visualizer/' + o.id + '" target="_blank" style="color:#7C3AED;text-decoration:none;font-size:12px;font-weight:600"><i class="fas fa-cube" style="margin-right:3px"></i>3D</a>' : '') +
          (isProcessing ? '<span style="font-size:12px;color:#2563EB" class="rfr-pulse">Processing...</span>' : '') +
          (isEnhancing ? '<span style="font-size:12px;color:#7C3AED" class="rfr-pulse">Polishing...</span>' : '') +
        '</td>' +
      '</tr>';
    });
    html += '</tbody></table></div>';
  }

  html += '</div>';
  return html;
}

// ── Generating Reports Progress Cards ──
function renderGeneratingReports() {
  var generatingOrders = custState.orders.filter(function(o) {
    return o.status === 'processing' || o.report_status === 'generating' || o.report_status === 'pending' ||
           o.report_status === 'enhancing' || o.enhancement_status === 'sent' || o.enhancement_status === 'pending' ||
           o.ai_imagery_status === 'generating';
  });
  if (generatingOrders.length === 0) return '';

  var html = '<div style="margin-bottom:20px">';
  generatingOrders.forEach(function(go) {
    var isEnhancing = go.report_status === 'enhancing' || go.enhancement_status === 'sent' || go.enhancement_status === 'pending';
    var isGenerating = !isEnhancing && (go.status === 'processing' || go.report_status === 'generating' || go.report_status === 'pending');
    var isImagery = go.ai_imagery_status === 'generating';
    var cardTitle = isImagery && !isGenerating && !isEnhancing ? 'Creating AI Imagery' : (isEnhancing ? 'AI Enhancing Report' : 'Generating Roof Report');
    var createdAt = new Date(go.created_at).getTime();
    var elapsed = Math.round((Date.now() - createdAt) / 1000);
    var progressPercent = Math.min(95, Math.round((elapsed / 90) * 100));
    var stepLabel = 'Initializing...';
    if (elapsed < 5) stepLabel = 'Placing order...';
    else if (elapsed < 12) stepLabel = 'Analyzing satellite imagery...';
    else if (elapsed < 20) stepLabel = 'Measuring roof segments...';
    else if (elapsed < 30) stepLabel = 'Computing materials & edges...';
    else if (elapsed < 40) stepLabel = 'Building professional report...';
    else if (isEnhancing) stepLabel = 'AI polishing report...';
    else if (elapsed < 55) stepLabel = 'Enhancing with AI insights...';
    else if (elapsed < 75) stepLabel = 'Generating AI imagery...';
    else if (elapsed < 85) stepLabel = 'Creating professional visuals...';
    else stepLabel = 'Finalizing report...';
    if (isEnhancing) {
      progressPercent = Math.min(95, 70 + Math.round((elapsed - 30) / 60 * 25));
      stepLabel = 'AI polishing your report...';
    }

    html += '<div style="background:linear-gradient(135deg,#1E40AF,#2563EB,#3B82F6);border-radius:12px;padding:20px;margin-bottom:12px;position:relative;overflow:hidden;border:1px solid rgba(59,130,246,0.3)">' +
      '<div style="position:absolute;inset:0;opacity:0.08"><div style="background:repeating-linear-gradient(90deg,transparent,transparent 20px,rgba(255,255,255,0.3) 20px,rgba(255,255,255,0.3) 40px);width:200%;height:100%;animation:rfrSlideStripes 2s linear infinite"></div></div>' +
      '<div style="position:relative;z-index:1">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">' +
          '<div style="display:flex;align-items:center;gap:10px">' +
            '<div style="width:40px;height:40px;background:rgba(255,255,255,0.15);border-radius:10px;display:flex;align-items:center;justify-content:center">' +
              '<div style="width:24px;height:24px;border:3px solid rgba(255,255,255,0.3);border-top-color:white;border-radius:50%;animation:rfrSpin 1s linear infinite"></div>' +
            '</div>' +
            '<div><div style="color:white;font-size:14px;font-weight:700">' + cardTitle + '</div><div style="color:#93C5FD;font-size:12px"><i class="fas fa-map-marker-alt" style="margin-right:4px"></i>' + (go.property_address || 'Processing...') + '</div></div>' +
          '</div>' +
          '<div style="text-align:right"><div style="color:white;font-size:22px;font-weight:800">' + progressPercent + '%</div><div style="color:#93C5FD;font-size:11px">' + elapsed + 's</div></div>' +
        '</div>' +
        '<div style="background:rgba(255,255,255,0.2);border-radius:6px;height:6px;overflow:hidden"><div style="height:100%;border-radius:6px;transition:width 1s ease-out;background:linear-gradient(90deg,#60A5FA,#818CF8,#A78BFA);width:' + progressPercent + '%"></div></div>' +
        '<div style="display:flex;justify-content:space-between;margin-top:8px"><span style="color:#BFDBFE;font-size:11px"><i class="fas fa-cog rfr-spin" style="margin-right:4px"></i>' + stepLabel + '</span><span style="color:#93C5FD;font-size:11px">~45-90s total</span></div>' +
      '</div>' +
    '</div>';
  });
  html += '</div>';
  return html;
}

// ── Utility Functions ──
function getInitials(name) {
  if (!name) return 'U';
  var parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length-1][0]).toUpperCase();
  return name.substring(0, 2).toUpperCase();
}

function getTimeAgo(dateStr) {
  if (!dateStr) return '';
  var now = Date.now();
  var then = new Date(dateStr).getTime();
  var diff = Math.floor((now - then) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
  return new Date(dateStr).toLocaleDateString();
}

function toggleMobileSidebar() {
  var sidebar = document.getElementById('rfrSidebar');
  if (sidebar) sidebar.classList.toggle('mobile-open');
}

function addMobileResponsive() {
  // Show mobile bar on smaller screens
  var style = document.createElement('style');
  style.textContent = '@media(max-width:1024px){.rfr-mobile-bar{display:flex!important}}';
  document.head.appendChild(style);
}

// ============================================================
// AUTO-POLLING: Refresh dashboard when reports are generating
// ============================================================
var _enhancePollTimer = null;
var _prevProcessingIds = [];
function startEnhancementPolling() {
  if (_enhancePollTimer) clearInterval(_enhancePollTimer);
  var hasActive = custState.orders.some(function(o) {
    return o.report_status === 'enhancing' || o.status === 'processing' || o.report_status === 'generating' || o.report_status === 'pending' || o.enhancement_status === 'sent' || o.enhancement_status === 'pending' || o.ai_imagery_status === 'generating';
  });
  _prevProcessingIds = custState.orders.filter(function(o) {
    return o.status === 'processing' || o.report_status === 'generating' || o.report_status === 'pending' || o.report_status === 'enhancing' || o.enhancement_status === 'sent' || o.enhancement_status === 'pending' || o.ai_imagery_status === 'generating';
  }).map(function(o) { return o.id; });

  if (!hasActive) return;
  console.log('[Dashboard] Reports generating — auto-refreshing every 3s');
  _enhancePollTimer = setInterval(async function() {
    try {
      var ordersRes = await fetch('/api/customer/orders', { headers: authHeaders() });
      if (ordersRes.ok) {
        var data = await ordersRes.json();
        custState.orders = data.orders || [];
        var nowProcessingIds = custState.orders.filter(function(o) {
          return o.status === 'processing' || o.report_status === 'generating' || o.report_status === 'pending' || o.report_status === 'enhancing' || o.enhancement_status === 'sent' || o.enhancement_status === 'pending' || o.ai_imagery_status === 'generating';
        }).map(function(o) { return o.id; });
        var newlyCompleted = _prevProcessingIds.filter(function(id) { return nowProcessingIds.indexOf(id) === -1; });
        _prevProcessingIds = nowProcessingIds;
        if (newlyCompleted.length > 0) {
          newlyCompleted.forEach(function(orderId) {
            var order = custState.orders.find(function(o) { return o.id === orderId; });
            showReportReadyToast(order);
            triggerAsyncEnhancement(orderId);
          });
        }
        renderDashboard();
        var stillActive = custState.orders.some(function(o) {
          return o.report_status === 'enhancing' || o.status === 'processing' || o.report_status === 'generating' || o.report_status === 'pending' || o.enhancement_status === 'sent' || o.enhancement_status === 'pending' || o.ai_imagery_status === 'generating';
        });
        if (!stillActive) {
          console.log('[Dashboard] All reports complete — stopping auto-refresh');
          clearInterval(_enhancePollTimer);
          _enhancePollTimer = null;
        }
      }
    } catch(e) { /* silent */ }
  }, 3000);
}

// ============================================================
// CELEBRATION TOAST
// ============================================================
function showReportReadyToast(order) {
  var address = (order && order.property_address) || 'Your property';
  var orderId = order ? order.id : '';
  var toast = document.createElement('div');
  toast.style.cssText = 'position:fixed;top:20px;right:20px;z-index:9999;max-width:380px;animation:rfrSlideIn 0.4s ease-out';
  toast.innerHTML =
    '<div style="background:#059669;border-radius:12px;padding:14px 18px;box-shadow:0 10px 30px rgba(5,150,105,0.35);border:1px solid rgba(255,255,255,0.1)">' +
      '<div style="display:flex;align-items:center;gap:10px">' +
        '<div style="width:36px;height:36px;background:rgba(255,255,255,0.15);border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="fas fa-check-circle" style="color:white;font-size:18px"></i></div>' +
        '<div style="flex:1;min-width:0"><p style="color:white;font-weight:700;font-size:13px;margin:0">Report Ready!</p><p style="color:rgba(255,255,255,0.8);font-size:11px;margin:2px 0 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + address + '</p></div>' +
        (orderId ? '<a href="/api/reports/' + orderId + '/html" target="_blank" style="background:white;color:#059669;padding:6px 14px;border-radius:8px;font-size:11px;font-weight:700;text-decoration:none;white-space:nowrap">View <i class="fas fa-arrow-right" style="margin-left:3px"></i></a>' : '') +
      '</div>' +
    '</div>';
  document.body.appendChild(toast);
  setTimeout(function() {
    toast.style.animation = 'rfrSlideOut 0.4s ease-in forwards';
    setTimeout(function() { toast.remove(); }, 500);
  }, 8000);
}

// ============================================================
// Auto-Email Toggle
// ============================================================
async function loadAutoEmailPref() {
  try {
    var res = await fetch('/api/agents/auto-email', { headers: authHeaders() });
    if (res.ok) {
      var data = await res.json();
      var toggle = document.getElementById('auto-email-toggle');
      var track = document.getElementById('autoEmailTrack');
      var thumb = document.getElementById('autoEmailThumb');
      if (toggle && data.auto_email_reports) {
        toggle.checked = true;
        if (track) track.style.background = '#2563EB';
        if (thumb) thumb.style.transform = 'translateX(20px)';
      }
    }
  } catch(e) {}
}

async function toggleAutoEmail(enabled) {
  var track = document.getElementById('autoEmailTrack');
  var thumb = document.getElementById('autoEmailThumb');
  if (track) track.style.background = enabled ? '#2563EB' : '#E2E8F0';
  if (thumb) thumb.style.transform = enabled ? 'translateX(20px)' : 'translateX(0)';
  try {
    await fetch('/api/agents/auto-email', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ enabled: enabled })
    });
  } catch(e) {}
}

// ============================================================
// ASYNC ENHANCEMENT & IMAGERY
// ============================================================
var _enhancedOrderIds = {};
async function triggerAsyncEnhancement(orderId) {
  if (_enhancedOrderIds[orderId]) return;
  _enhancedOrderIds[orderId] = true;
  try {
    console.log('[Dashboard] Triggering async enhancement for order', orderId);
    var res = await fetch('/api/reports/' + orderId + '/enhance-async', {
      method: 'POST', headers: authHeaders()
    });
    var data = await res.json();
    console.log('[Dashboard] Enhancement result:', data);
    if (data.success || data.already_enhanced) {
      triggerAsyncImagery(orderId);
    }
  } catch(e) {
    console.warn('[Dashboard] Enhancement trigger failed:', e.message);
  }
}

async function triggerAsyncImagery(orderId) {
  try {
    console.log('[Dashboard] Triggering AI imagery for order', orderId);
    var res = await fetch('/api/reports/' + orderId + '/generate-imagery', {
      method: 'POST', headers: authHeaders()
    });
    var data = await res.json();
    console.log('[Dashboard] Imagery result:', data);
  } catch(e) {
    console.warn('[Dashboard] Imagery trigger failed:', e.message);
  }
}

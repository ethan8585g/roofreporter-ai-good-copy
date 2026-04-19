// ============================================================
// Automations Module — Certificate & Workflow Automation Settings
// Available to both Roofing and Solar Sales companies
// ============================================================

(function() {
  var state = {
    loading: true,
    autoSendCertificate: false,
    certLicenseNumber: '',
    certAccentColor: '#1a5c38',
    certSettingsDirty: false,
    gmailStatus: null
  };

  function getToken() { return localStorage.getItem('rc_customer_token') || ''; }
  function headers() { return { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' }; }

  function toast(msg, type) {
    var t = document.createElement('div');
    t.className = 'fixed top-4 right-4 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-semibold transition-all';
    t.style.cssText = 'animation:fadeIn 0.3s ease-out';
    if (type === 'success') { t.style.background = '#065f46'; t.style.color = '#d1fae5'; }
    else if (type === 'error') { t.style.background = '#991b1b'; t.style.color = '#fecaca'; }
    else { t.style.background = '#1e3a5f'; t.style.color = '#bfdbfe'; }
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function() { t.remove(); }, 3500);
  }

  async function load() {
    state.loading = true;
    render();
    try {
      var [certAutoRes, profileRes, gmailRes] = await Promise.all([
        fetch('/api/crm/proposals/automation/settings', { headers: headers() }).catch(function() { return { ok: false }; }),
        fetch('/api/customer/profile', { headers: headers() }).catch(function() { return { ok: false }; }),
        fetch('/api/auth/gmail/status', { headers: headers() }).catch(function() { return { ok: false }; })
      ]);
      if (certAutoRes.ok) { var d = await certAutoRes.json(); state.autoSendCertificate = !!d.auto_send_certificate; }
      if (profileRes.ok) {
        var d2 = await profileRes.json();
        state.certLicenseNumber = d2.brand_license_number || '';
        state.certAccentColor = d2.brand_primary_color || '#1a5c38';
      }
      if (gmailRes.ok) { var d3 = await gmailRes.json(); state.gmailStatus = d3.gmail_oauth2 || null; }
    } catch(e) {
      console.error('Failed to load automation settings', e);
    }
    state.loading = false;
    render();
  }

  function render() {
    var root = document.getElementById('automations-root');
    if (!root) return;

    if (state.loading) {
      root.innerHTML = '<div class="flex items-center justify-center py-16"><div class="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2" style="border-color:var(--brand-500, #10b981)"></div></div>';
      return;
    }

    root.innerHTML =
      // Page header
      '<div class="mb-6">' +
        '<h2 class="text-xl font-bold" style="color:var(--text-primary, #111)">Automations</h2>' +
        '<p class="text-sm mt-1" style="color:var(--text-muted, #6b7280)">Configure automated workflows that save you time after proposals are accepted and installations are completed.</p>' +
      '</div>' +

      // Gmail connection banner (if not connected)
      (!state.gmailStatus ?
        '<div class="rounded-xl p-4 mb-5 flex items-center gap-3" style="background:var(--bg-elevated, #fffbeb);border:1px solid var(--border-color, #fde68a)">' +
          '<div style="width:36px;height:36px;border-radius:8px;background:#fef3c7;display:flex;align-items:center;justify-content:center;flex-shrink:0">' +
            '<i class="fas fa-exclamation-triangle" style="color:#d97706;font-size:16px"></i>' +
          '</div>' +
          '<div class="flex-1">' +
            '<p class="text-sm font-semibold" style="color:var(--text-primary, #111)">Gmail Not Connected</p>' +
            '<p class="text-xs mt-0.5" style="color:var(--text-muted, #6b7280)">Connect your Gmail account to enable automatic certificate delivery to customers.</p>' +
          '</div>' +
          '<a href="/customer/profile" class="px-3 py-1.5 text-xs font-semibold rounded-lg" style="background:#f59e0b;color:white">Connect Gmail</a>' +
        '</div>'
      : '') +

      // Certificate Automation Card
      '<div class="rounded-xl overflow-hidden mb-5" style="background:var(--bg-card, white);border:1px solid var(--border-color, #e5e7eb)">' +

        // Auto-send toggle row
        '<div class="p-5 flex items-center justify-between gap-4">' +
          '<div class="flex items-center gap-3">' +
            '<div style="width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,#f0fdf4,#dcfce7);display:flex;align-items:center;justify-content:center;flex-shrink:0">' +
              '<i class="fas fa-certificate" style="color:#16a34a;font-size:20px"></i>' +
            '</div>' +
            '<div>' +
              '<p class="text-sm font-bold" style="color:var(--text-primary, #111)">Auto-Send Certificate of Installation</p>' +
              '<p class="text-xs mt-0.5" style="color:var(--text-muted, #6b7280)">Automatically email a Certificate of New Roof Installation to the customer when you mark the installation as complete — so they can submit it to their insurance company.</p>' +
            '</div>' +
          '</div>' +
          '<button onclick="window._automations.toggleAutoSend()" class="flex-shrink-0 relative inline-flex items-center h-7 rounded-full w-12 transition-colors focus:outline-none" style="background:' + (state.autoSendCertificate ? '#16a34a' : 'var(--bg-elevated, #d1d5db)') + '" title="' + (state.autoSendCertificate ? 'Automation ON — click to disable' : 'Click to enable auto-send') + '">' +
            '<span class="inline-block w-5 h-5 transform rounded-full bg-white shadow transition-transform" style="transform:translateX(' + (state.autoSendCertificate ? '24px' : '4px') + ')"></span>' +
          '</button>' +
        '</div>' +

        // Status indicator
        '<div class="px-5 pb-3">' +
          '<div class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold" style="background:' + (state.autoSendCertificate ? '#f0fdf4' : 'var(--bg-elevated, #f9fafb)') + ';color:' + (state.autoSendCertificate ? '#166534' : 'var(--text-muted, #6b7280)') + '">' +
            '<span class="w-2 h-2 rounded-full" style="background:' + (state.autoSendCertificate ? '#16a34a' : '#9ca3af') + '"></span>' +
            (state.autoSendCertificate ? 'Active — certificates will be sent automatically' : 'Inactive — certificates must be sent manually from Proposals') +
          '</div>' +
        '</div>' +

        // Certificate Settings
        '<div style="border-top:1px solid var(--border-color, #f1f5f9);background:var(--bg-elevated, #fafafa);padding:20px">' +
          '<p class="text-xs font-bold uppercase tracking-wider mb-4" style="color:var(--text-muted, #6b7280)"><i class="fas fa-sliders-h mr-1.5"></i>Certificate Customization</p>' +
          '<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">' +

            // License Number
            '<div>' +
              '<label class="block text-xs font-semibold mb-1.5" style="color:var(--text-secondary, #374151)">Contractor License / Registration #</label>' +
              '<input type="text" id="cert-license-input" value="' + (state.certLicenseNumber || '') + '"' +
                ' oninput="window._automations.setLicense(this.value)"' +
                ' placeholder="e.g. MB-12345 or ROC-789012"' +
                ' class="w-full px-3 py-2.5 rounded-lg text-sm outline-none" style="background:var(--bg-card, white);border:1px solid var(--border-color, #e5e7eb);color:var(--text-primary, #111)">' +
              '<p class="text-xs mt-1" style="color:var(--text-muted, #9ca3af)">Appears on the certificate — required by most insurance companies</p>' +
            '</div>' +

            // Color picker
            '<div>' +
              '<label class="block text-xs font-semibold mb-1.5" style="color:var(--text-secondary, #374151)">Certificate Accent Color</label>' +
              '<div class="flex items-center gap-2 flex-wrap">' +
                ['#1a5c38','#1e40af','#7c3aed','#b91c1c','#92400e','#374151'].map(function(c) {
                  return '<button onclick="window._automations.setColor(\'' + c + '\')" style="width:30px;height:30px;border-radius:50%;background:' + c + ';border:' + ((state.certAccentColor || '#1a5c38') === c ? '3px solid var(--text-primary, #1a1a1a)' : '2px solid transparent') + ';cursor:pointer;flex-shrink:0" title="' + c + '"></button>';
                }).join('') +
                '<input type="color" value="' + (state.certAccentColor || '#1a5c38') + '"' +
                  ' onchange="window._automations.setColor(this.value)"' +
                  ' title="Custom color"' +
                  ' style="width:30px;height:30px;border-radius:50%;border:2px solid var(--border-color, #e5e7eb);cursor:pointer;padding:1px;background:none">' +
              '</div>' +
              '<p class="text-xs mt-1" style="color:var(--text-muted, #9ca3af)">Sets the border and heading color on the certificate</p>' +
            '</div>' +

          '</div>' +

          // Action buttons
          '<div class="flex items-center gap-3 flex-wrap">' +
            '<button onclick="window._automations.saveSettings()" class="px-4 py-2.5 text-xs font-bold rounded-lg transition-all" style="background:' + (state.certSettingsDirty ? 'var(--text-primary, #111)' : 'var(--bg-card, #f3f4f6)') + ';color:' + (state.certSettingsDirty ? 'white' : 'var(--text-muted, #9ca3af)') + ';cursor:' + (state.certSettingsDirty ? 'pointer' : 'default') + '">' +
              '<i class="fas fa-save mr-1.5"></i>Save Certificate Settings' +
            '</button>' +
            '<a href="/api/invoices/certificate/preview?token=' + encodeURIComponent(getToken()) + '&color=' + encodeURIComponent(state.certAccentColor || '#1a5c38') + '&license=' + encodeURIComponent(state.certLicenseNumber || '') + '" target="_blank" class="px-4 py-2.5 text-xs font-bold rounded-lg transition-all cursor-pointer" style="background:#fffbeb;color:#92400e;border:1px solid #fde68a"><i class="fas fa-eye mr-1.5"></i>Preview Certificate</a>' +
            '<a href="/customer/profile" class="text-xs font-medium ml-auto" style="color:var(--brand-500, #10b981)"><i class="fas fa-building mr-1"></i>Update logo & company info</a>' +
          '</div>' +
        '</div>' +
      '</div>' +

      // Future automations placeholder
      '<div class="rounded-xl p-6 text-center" style="background:var(--bg-card, white);border:1px dashed var(--border-color, #d1d5db)">' +
        '<div style="width:48px;height:48px;border-radius:12px;background:var(--bg-elevated, #f3f4f6);display:inline-flex;align-items:center;justify-content:center;margin-bottom:12px">' +
          '<i class="fas fa-magic" style="color:var(--text-muted, #9ca3af);font-size:20px"></i>' +
        '</div>' +
        '<p class="text-sm font-semibold" style="color:var(--text-secondary, #6b7280)">More automations coming soon</p>' +
        '<p class="text-xs mt-1" style="color:var(--text-muted, #9ca3af)">Auto-follow-up emails, proposal reminders, payment notifications, and more.</p>' +
      '</div>';
  }

  // Public API
  window._automations = {
    toggleAutoSend: async function() {
      var newVal = !state.autoSendCertificate;
      try {
        var res = await fetch('/api/crm/proposals/automation/settings', {
          method: 'PUT',
          headers: headers(),
          body: JSON.stringify({ auto_send_certificate: newVal })
        });
        if (res.ok) {
          state.autoSendCertificate = newVal;
          toast(newVal ? 'Certificate auto-send enabled — customers will receive a certificate when you mark the installation complete' : 'Certificate auto-send disabled', newVal ? 'success' : 'info');
          render();
        } else {
          toast('Failed to update setting', 'error');
        }
      } catch(e) {
        toast('Error updating setting', 'error');
      }
    },
    setLicense: function(val) {
      state.certLicenseNumber = val;
      state.certSettingsDirty = true;
    },
    setColor: function(color) {
      state.certAccentColor = color;
      state.certSettingsDirty = true;
      render();
    },
    saveSettings: async function() {
      if (!state.certSettingsDirty) return;
      try {
        var res = await fetch('/api/customer/branding', {
          method: 'PUT',
          headers: headers(),
          body: JSON.stringify({
            brand_license_number: state.certLicenseNumber || null,
            brand_primary_color: state.certAccentColor || null,
          })
        });
        if (res.ok) {
          state.certSettingsDirty = false;
          toast('Certificate settings saved!', 'success');
          render();
        } else {
          toast('Failed to save settings', 'error');
        }
      } catch(e) {
        toast('Error saving settings', 'error');
      }
    }
  };

  load();
})();

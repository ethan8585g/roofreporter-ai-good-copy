// ============================================================
// Global Exit-Intent Popup — Social-Aware Lead Capture
// Loaded on all public pages via analytics middleware injection
// Detects Instagram/Facebook traffic and shows tailored messaging
// ============================================================
(function() {
  'use strict';

  // Skip if already injected by landing.js
  if (document.getElementById('exit-popup')) return;

  // Skip on admin, dashboard, and auth pages
  var p = location.pathname;
  if (p.startsWith('/admin') || p.startsWith('/super-admin') || p.startsWith('/customer/dashboard')) return;

  // Skip for logged-in users (admin or customer)
  if (localStorage.getItem('rc_user') || localStorage.getItem('rc_customer')) return;

  // Persist UTM params in sessionStorage for cross-page use
  var params = new URLSearchParams(location.search);
  var utmSource = params.get('utm_source') || '';
  var utmMedium = params.get('utm_medium') || '';
  var utmCampaign = params.get('utm_campaign') || '';
  if (utmSource) sessionStorage.setItem('_rm_utm_source', utmSource);
  if (utmMedium) sessionStorage.setItem('_rm_utm_medium', utmMedium);
  if (utmCampaign) sessionStorage.setItem('_rm_utm_campaign', utmCampaign);

  // Read from session if not in current URL
  if (!utmSource) utmSource = sessionStorage.getItem('_rm_utm_source') || '';

  var isSocial = /instagram|facebook|fb|ig/i.test(utmSource);

  // Don't show if already dismissed
  if (localStorage.getItem('rr_exit_dismissed_global')) return;

  // Build popup HTML
  var popup = document.createElement('div');
  popup.id = 'exit-popup-global';
  popup.style.cssText = 'position:fixed;inset:0;z-index:10000;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)';

  var headline = isSocial
    ? 'Special Offer for Our Social Followers'
    : 'Wait! Get 3 Free Roof Reports';
  var subtext = isSocial
    ? 'Exclusive for Instagram & Facebook followers — 3 free professional satellite roof reports. No credit card.'
    : 'Get 3 free professional roof measurement reports — satellite-powered, insurance-ready. No credit card required.';
  var sourcePage = isSocial ? 'exit-popup-social' : 'exit-popup-global';
  var accentColor = isSocial ? '#E1306C' : '#00FF88';
  var accentBg = isSocial ? 'rgba(225,48,108,0.1)' : 'rgba(0,255,136,0.1)';
  var btnBg = isSocial ? 'linear-gradient(135deg,#E1306C,#C13584)' : '#00FF88';
  var btnColor = isSocial ? '#fff' : '#0A0A0A';

  popup.innerHTML = '<div id="exit-popup-global-inner" style="background:#111111;border-radius:16px;max-width:420px;width:calc(100% - 32px);overflow:hidden;transform:scale(0.95);opacity:0;transition:all 0.3s;border:1px solid rgba(255,255,255,0.1)">' +
    '<div style="background:' + accentBg + ';padding:24px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.1)">' +
      (isSocial ? '<div style="margin-bottom:8px"><i class="fab fa-instagram" style="color:#E1306C;font-size:24px;margin-right:8px"></i><i class="fab fa-facebook" style="color:#1877F2;font-size:24px"></i></div>' : '') +
      '<h3 style="color:#fff;font-size:22px;font-weight:800;margin:0 0 6px">' + headline + '</h3>' +
      '<p style="color:#9ca3af;font-size:13px;margin:0">' + subtext + '</p>' +
    '</div>' +
    '<div style="padding:24px">' +
      '<div style="display:flex;flex-direction:column;gap:12px;margin-bottom:16px">' +
        '<div style="display:flex;align-items:center;gap:10px"><div style="width:32px;height:32px;background:' + accentBg + ';border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="fas fa-file-alt" style="color:' + accentColor + ';font-size:12px"></i></div><span style="font-size:13px;color:#d1d5db"><strong style="color:#fff">3 Free Reports</strong> — PDF with 3D area, pitch, BOM</span></div>' +
        '<div style="display:flex;align-items:center;gap:10px"><div style="width:32px;height:32px;background:' + accentBg + ';border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="fas fa-bolt" style="color:' + accentColor + ';font-size:12px"></i></div><span style="font-size:13px;color:#d1d5db"><strong style="color:#fff">60-Second Delivery</strong> — satellite-powered, no site visit</span></div>' +
        '<div style="display:flex;align-items:center;gap:10px"><div style="width:32px;height:32px;background:' + accentBg + ';border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="fas fa-th-large" style="color:' + accentColor + ';font-size:12px"></i></div><span style="font-size:13px;color:#d1d5db"><strong style="color:#fff">Full CRM Access</strong> — customers, invoices, proposals</span></div>' +
      '</div>' +
      '<form id="exit-global-form" style="position:relative">' +
        '<input name="website" style="position:absolute;left:-9999px;opacity:0" tabindex="-1" autocomplete="off">' +
        '<input name="e" type="email" required placeholder="Enter your email" style="width:100%;padding:12px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:#fff;font-size:14px;outline:none;margin-bottom:10px;box-sizing:border-box">' +
        '<input name="a" placeholder="Property address (optional)" style="width:100%;padding:12px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:#fff;font-size:14px;outline:none;margin-bottom:10px;box-sizing:border-box">' +
        '<button type="submit" style="width:100%;background:' + btnBg + ';color:' + btnColor + ';font-weight:800;padding:13px;border:none;border-radius:10px;font-size:14px;cursor:pointer;min-height:46px">' +
          (isSocial ? '<i class="fas fa-gift" style="margin-right:6px"></i>Claim My Free Reports' : '<i class="fas fa-gift" style="margin-right:6px"></i>Get My 3 Free Reports') +
        '</button>' +
      '</form>' +
      '<button id="exit-global-close" style="width:100%;margin-top:10px;background:none;border:none;color:#6b7280;font-size:11px;cursor:pointer;padding:8px">No thanks, I\'ll pass</button>' +
    '</div>' +
  '</div>';

  document.body.appendChild(popup);

  // Form submission
  var form = document.getElementById('exit-global-form');
  form.addEventListener('submit', function(e) {
    e.preventDefault();
    if (form.querySelector('[name=website]').value) return;
    var btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
    fetch('/api/agents/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: form.querySelector('[name=e]').value,
        address: form.querySelector('[name=a]').value || '',
        source_page: sourcePage,
        utm_source: utmSource || ''
      })
    }).then(function(r) {
      if (r.ok) {
        form.innerHTML = '<div style="text-align:center;padding:16px"><div style="width:44px;height:44px;background:' + accentColor + ';border-radius:50%;display:inline-flex;align-items:center;justify-content:center;margin-bottom:10px"><i class="fas fa-check" style="color:#0A0A0A;font-size:18px"></i></div><p style="color:' + accentColor + ';font-weight:700;font-size:15px;margin:0 0 4px">Thank you!</p><p style="color:#9ca3af;font-size:12px;margin:0">We\'ll send your free reports shortly.</p></div>';
        if (typeof window.fireMetaLeadEvent === 'function') window.fireMetaLeadEvent({ content_name: sourcePage });
        setTimeout(closePopup, 3000);
      } else {
        btn.disabled = false;
        btn.textContent = 'Try Again';
      }
    }).catch(function() {
      btn.disabled = false;
      btn.textContent = 'Try Again';
    });
  });

  // Close handler
  function closePopup() {
    var inner = document.getElementById('exit-popup-global-inner');
    if (inner) { inner.style.transform = 'scale(0.95)'; inner.style.opacity = '0'; }
    setTimeout(function() { popup.style.display = 'none'; }, 300);
    localStorage.setItem('rr_exit_dismissed_global', '1');
  }

  document.getElementById('exit-global-close').addEventListener('click', closePopup);
  popup.addEventListener('click', function(e) { if (e.target === popup) closePopup(); });

  // Show popup
  function showPopup() {
    if (localStorage.getItem('rr_exit_dismissed_global')) return;
    popup.style.display = 'flex';
    var inner = document.getElementById('exit-popup-global-inner');
    setTimeout(function() { inner.style.transform = 'scale(1)'; inner.style.opacity = '1'; }, 10);
    if (typeof rrTrack === 'function') rrTrack('exit_popup_global_shown', { social: isSocial });
  }

  // Exit intent detection (desktop)
  var shown = false;
  document.addEventListener('mouseout', function(e) {
    if (shown) return;
    if (e.clientY < 10 && !e.relatedTarget) {
      shown = true;
      showPopup();
    }
  });

  // Timed fallback — show after 45 seconds for social traffic, 90 seconds otherwise
  var delay = isSocial ? 45000 : 90000;
  setTimeout(function() {
    if (!shown && !localStorage.getItem('rr_exit_dismissed_global')) {
      shown = true;
      showPopup();
    }
  }, delay);
})();

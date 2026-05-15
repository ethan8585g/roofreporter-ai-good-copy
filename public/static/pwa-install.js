/* PWA install prompt — captures beforeinstallprompt, shows a small banner
   on logged-in customer pages, and gates re-prompting to once per 30 days.
   No-op on iOS (which doesn't fire beforeinstallprompt); iOS users can still
   add via Share → Add to Home Screen, which the manifest already supports. */
(function() {
  var STORAGE_KEY = 'rm_pwa_prompt_state';
  var COOLDOWN_DAYS = 30;

  function getState() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch (_) { return {}; }
  }
  function setState(s) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (_) {}
  }

  // Only prompt on customer surfaces (post-signup). Skip public marketing pages.
  var path = location.pathname;
  var isEligible = /^\/customer\//.test(path) || /^\/onboarding\b/.test(path);
  if (!isEligible) return;

  // Skip if already running as installed PWA (display-mode: standalone).
  if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return;
  if (window.navigator && window.navigator.standalone) return; // iOS

  var deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', function(e) {
    e.preventDefault();
    deferredPrompt = e;

    // Honor user's recent dismissal.
    var state = getState();
    if (state.dismissed_at) {
      var ageDays = (Date.now() - state.dismissed_at) / (1000 * 60 * 60 * 24);
      if (ageDays < COOLDOWN_DAYS) return;
    }
    if (state.installed_at) return;

    // Render banner after a short delay so it doesn't compete with first paint.
    setTimeout(showBanner, 1500);
  });

  window.addEventListener('appinstalled', function() {
    setState({ installed_at: Date.now() });
    var b = document.getElementById('pwa-install-banner');
    if (b) b.remove();
  });

  function showBanner() {
    if (!deferredPrompt || document.getElementById('pwa-install-banner')) return;
    var banner = document.createElement('div');
    banner.id = 'pwa-install-banner';
    banner.style.cssText = [
      'position:fixed',
      'left:12px', 'right:12px',
      'bottom:max(12px, env(safe-area-inset-bottom))',
      'z-index:99996',
      'background:#0A0A0A',
      'border:1px solid rgba(0,255,136,0.4)',
      'border-radius:14px',
      'box-shadow:0 12px 40px rgba(0,0,0,0.4)',
      'padding:12px 14px',
      'display:flex',
      'align-items:center',
      'gap:12px',
      'font-family:Inter,-apple-system,BlinkMacSystemFont,sans-serif',
      'color:#fff',
      'max-width:520px',
      'margin:0 auto'
    ].join(';');
    banner.innerHTML =
      '<div style="width:40px;height:40px;border-radius:10px;background:#00FF88;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:20px">📱</div>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-weight:700;font-size:14px;line-height:1.2;margin-bottom:2px">Install Roof Manager</div>' +
        '<div style="font-size:12px;color:#9ca3af;line-height:1.3">One-tap access from your home screen.</div>' +
      '</div>' +
      '<button id="pwa-install-yes" style="background:#00FF88;color:#0A0A0A;border:0;font-weight:700;padding:8px 14px;border-radius:8px;font-size:13px;cursor:pointer;flex-shrink:0">Install</button>' +
      '<button id="pwa-install-no" aria-label="Dismiss" style="background:transparent;color:#9ca3af;border:0;font-size:22px;line-height:1;cursor:pointer;padding:4px 6px">&times;</button>';
    document.body.appendChild(banner);

    document.getElementById('pwa-install-yes').addEventListener('click', function() {
      banner.remove();
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function(choice) {
        if (choice.outcome !== 'accepted') {
          setState({ dismissed_at: Date.now() });
        }
        deferredPrompt = null;
      });
    });
    document.getElementById('pwa-install-no').addEventListener('click', function() {
      banner.remove();
      setState({ dismissed_at: Date.now() });
    });
  }
})();

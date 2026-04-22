/**
 * Cross-platform PWA install prompt.
 *
 * Install paths:
 *   1. Android Chrome/Edge, Desktop Chrome/Edge → real Install button
 *      (capture `beforeinstallprompt`, call prompt() on click).
 *   2. iOS Safari → Share → Add to Home Screen (instructions only).
 *   3. macOS Safari 17+ → File → Add to Dock (instructions only; no JS API).
 *   4. Desktop Chromium fallback → address-bar install icon (if event never fires).
 *
 * For variants without a programmatic install path, instructions render
 * inline immediately — no "Show me how" hoop to jump through.
 * Dismissal is remembered for 30 days via localStorage.
 */
(function () {
  'use strict';

  var DISMISS_KEY = 'rm_pwa_install_dismissed_until';
  var DISMISS_DAYS = 30;
  var SHOW_AFTER_MS = 3500;
  var DESKTOP_FALLBACK_MS = 6000;

  var ua = navigator.userAgent || '';
  var platform = navigator.platform || '';

  var isIPad = /iPad/.test(ua) ||
    (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var isIPhone = /iPhone|iPod/.test(ua);
  var isIOS = isIPhone || isIPad;
  var isAndroid = /Android/.test(ua);
  var isMac = /Macintosh/.test(ua) && !isIPad;
  var isIOSSafari = isIOS &&
    /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|YaBrowser/.test(ua);
  var isMacSafari = isMac && /Safari/.test(ua) &&
    !/Chrome|Chromium|CriOS|FxiOS|EdgiOS|Edg\//.test(ua);
  var isDesktopChromium = !isIOS && !isAndroid &&
    /Chrome|Chromium|Edg\//.test(ua);

  var isStandalone = (('standalone' in navigator) && navigator.standalone) ||
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches;

  if (isStandalone) return;

  try {
    var dismissedUntil = parseInt(localStorage.getItem(DISMISS_KEY) || '0', 10);
    if (dismissedUntil && dismissedUntil > Date.now()) return;
  } catch (e) { /* storage blocked */ }

  var deferredPrompt = null;
  var bannerEl = null;
  var shown = false;
  var beforeInstallFired = false;

  function injectStyles() {
    if (document.getElementById('rm-install-styles')) return;
    var css = [
      // Isolated container — high z-index, pointer-events explicit on all children
      '#rm-install,#rm-install *{box-sizing:border-box;pointer-events:auto;}',
      '#rm-install{position:fixed !important;left:12px;right:12px;bottom:12px;z-index:2147483646;',
      'background:#0A0A0A;color:#fff;border:1px solid rgba(0,255,136,0.4);border-radius:16px;',
      'box-shadow:0 12px 40px rgba(0,0,0,0.6),0 0 0 1px rgba(255,255,255,0.05);',
      'padding:16px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
      'transform:translateY(160%);transition:transform .35s cubic-bezier(.2,.9,.3,1.2);',
      'max-width:520px;margin:0 auto;opacity:1;}',
      '#rm-install.show{transform:translateY(0) !important;}',
      '#rm-install .rm-row{display:flex;align-items:flex-start;gap:12px;padding-right:30px;}',
      '#rm-install .rm-icon{flex:0 0 44px;width:44px;height:44px;border-radius:10px;',
      'background:linear-gradient(135deg,#00FF88,#00C853);display:flex;align-items:center;justify-content:center;',
      'font-size:22px;user-select:none;}',
      '#rm-install .rm-body{flex:1;min-width:0;}',
      '#rm-install .rm-title{font-size:16px;font-weight:700;margin:0 0 3px;color:#fff;line-height:1.3;}',
      '#rm-install .rm-sub{font-size:13px;line-height:1.5;color:#d0d0d0;margin:0;}',
      '#rm-install .rm-sub b{color:#00FF88;font-weight:600;}',
      // Action buttons
      '#rm-install .rm-actions{display:flex;gap:10px;margin-top:14px;}',
      '#rm-install button{font-family:inherit;cursor:pointer;pointer-events:auto;',
      'user-select:none;-webkit-appearance:none;appearance:none;outline:none;}',
      '#rm-install button:focus-visible{box-shadow:0 0 0 3px rgba(0,255,136,0.4);}',
      '#rm-install .rm-btn-primary{flex:1;background:#00FF88;color:#0A0A0A;border:0;',
      'border-radius:10px;padding:12px 16px;font-size:14px;font-weight:700;',
      'transition:background .15s,transform .1s;}',
      '#rm-install .rm-btn-primary:hover{background:#00E077;}',
      '#rm-install .rm-btn-primary:active{transform:scale(0.97);background:#00CC66;}',
      '#rm-install .rm-btn-secondary{background:rgba(255,255,255,0.08);color:#d0d0d0;border:0;',
      'border-radius:10px;padding:12px 16px;font-size:14px;font-weight:500;',
      'transition:background .15s,color .15s;}',
      '#rm-install .rm-btn-secondary:hover{background:rgba(255,255,255,0.16);color:#fff;}',
      // Close button (X) — top-right corner
      '#rm-install .rm-close{position:absolute;top:10px;right:10px;width:30px;height:30px;border-radius:15px;',
      'background:rgba(255,255,255,0.08);border:0;color:#fff;font-size:20px;line-height:1;',
      'display:flex;align-items:center;justify-content:center;padding:0;',
      'transition:background .15s;z-index:1;}',
      '#rm-install .rm-close:hover{background:rgba(255,255,255,0.2);}',
      // iOS arrow pointing to Share button below
      '#rm-install .rm-arrow{position:absolute;left:50%;bottom:-9px;transform:translateX(-50%) rotate(45deg);',
      'width:16px;height:16px;background:#0A0A0A;border-right:1px solid rgba(0,255,136,0.4);',
      'border-bottom:1px solid rgba(0,255,136,0.4);display:none;}',
      '#rm-install.rm-anchor-bottom-arrow .rm-arrow{display:block;}',
      '#rm-install.rm-anchor-top{top:12px;bottom:auto;}',
      // Desktop layout
      '@media (min-width:900px){#rm-install.rm-desktop{left:auto;right:24px;bottom:24px;',
      'max-width:420px;margin:0;padding:20px;}}',
      // Inline step list — always visible for instruction variants
      '#rm-install .rm-steps{margin:14px 0 0;padding:14px;background:rgba(0,255,136,0.07);',
      'border:1px solid rgba(0,255,136,0.22);border-radius:10px;}',
      '#rm-install .rm-steps ol{margin:0;padding:0 0 0 22px;font-size:13px;line-height:1.7;color:#e8e8e8;}',
      '#rm-install .rm-steps li{margin:0 0 4px;}',
      '#rm-install .rm-steps li:last-child{margin-bottom:0;}',
      '#rm-install .rm-steps li b{color:#00FF88;font-weight:600;}',
      '#rm-install .rm-steps kbd{display:inline-block;background:rgba(255,255,255,0.14);',
      'border:1px solid rgba(255,255,255,0.22);border-radius:4px;padding:1px 7px;',
      'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#fff;',
      'vertical-align:baseline;}',
      '@media (prefers-reduced-motion: reduce){#rm-install{transition:none;}}'
    ].join('');
    var style = document.createElement('style');
    style.id = 'rm-install-styles';
    style.appendChild(document.createTextNode(css));
    document.head.appendChild(style);
  }

  function buildBanner(variant) {
    var el = document.createElement('div');
    el.id = 'rm-install';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Install Roof Manager');

    var title = 'Install Roof Manager';
    var subHtml = '';
    var actionsHtml = '';
    var stepsHtml = '';
    var classes = [];

    if (variant === 'native') {
      // Real install path — big primary button triggers prompt()
      subHtml = 'Get one-tap access with the app. No store, no download.';
      actionsHtml =
        '<div class="rm-actions">' +
          '<button class="rm-btn-primary" type="button" data-action="install">Install now</button>' +
          '<button class="rm-btn-secondary" type="button" data-action="later">Not now</button>' +
        '</div>';
      if (window.innerWidth >= 900) classes.push('rm-desktop');
    } else if (variant === 'ios') {
      // iPhone/iPad: arrow points at Share button + numbered steps + Got it button
      classes.push(isIPad ? 'rm-anchor-top' : 'rm-anchor-bottom-arrow');
      var sharePosition = isIPad ? 'at the top' : 'at the bottom';
      subHtml = 'Install Roof Manager to your Home Screen — no App Store needed.';
      stepsHtml =
        '<div class="rm-steps">' +
          '<ol>' +
            '<li>Tap the <b>Share</b> button ' + sharePosition + ' of Safari (square with ↑).</li>' +
            '<li>Scroll down and tap <b>Add to Home Screen</b>.</li>' +
            '<li>Tap <b>Add</b> in the top-right corner.</li>' +
          '</ol>' +
        '</div>';
      actionsHtml =
        '<div class="rm-actions">' +
          '<button class="rm-btn-secondary" type="button" data-action="later" style="flex:1">Got it</button>' +
        '</div>';
    } else if (variant === 'mac-safari') {
      // macOS Safari has NO JS install API — instructions only, rendered inline
      classes.push('rm-desktop');
      subHtml = 'Install it as a desktop app in two clicks:';
      stepsHtml =
        '<div class="rm-steps">' +
          '<ol>' +
            '<li>Open the <b>File</b> menu at the top of your screen.</li>' +
            '<li>Choose <b>Add to Dock…</b></li>' +
            '<li>Click <b>Add</b> — the app appears in your Dock.</li>' +
          '</ol>' +
        '</div>';
      actionsHtml =
        '<div class="rm-actions">' +
          '<button class="rm-btn-secondary" type="button" data-action="later" style="flex:1">Got it</button>' +
        '</div>';
    } else if (variant === 'desktop-chromium-fallback') {
      // Chromium without beforeinstallprompt — give them a clear path
      classes.push('rm-desktop');
      subHtml = 'Install it as a desktop app — no store, no download:';
      stepsHtml =
        '<div class="rm-steps">' +
          '<ol>' +
            '<li>Look at the right side of the <b>address bar</b> for a small monitor/install icon.</li>' +
            '<li>Click it, then click <b>Install</b>.</li>' +
            '<li>Or: open the <kbd>⋮</kbd> menu → <b>Save and share</b> → <b>Install page as app</b>.</li>' +
          '</ol>' +
        '</div>';
      actionsHtml =
        '<div class="rm-actions">' +
          '<button class="rm-btn-secondary" type="button" data-action="later" style="flex:1">Got it</button>' +
        '</div>';
    }

    if (classes.length) el.className = classes.join(' ');

    el.innerHTML =
      '<button class="rm-close" type="button" data-action="close" aria-label="Dismiss">×</button>' +
      '<div class="rm-row">' +
        '<div class="rm-icon" aria-hidden="true">🏠</div>' +
        '<div class="rm-body">' +
          '<p class="rm-title">' + title + '</p>' +
          '<p class="rm-sub">' + subHtml + '</p>' +
          stepsHtml +
          actionsHtml +
        '</div>' +
      '</div>' +
      (variant === 'ios' && !isIPad ? '<div class="rm-arrow" aria-hidden="true"></div>' : '');

    // Single delegated click handler so every button responds regardless of variant
    el.addEventListener('click', function (ev) {
      var btn = ev.target.closest && ev.target.closest('button[data-action]');
      if (!btn) return;
      var action = btn.getAttribute('data-action');
      if (action === 'install') {
        triggerNativeInstall();
      } else if (action === 'later' || action === 'close') {
        dismiss();
      }
    });

    return el;
  }

  function triggerNativeInstall() {
    if (!deferredPrompt) { swapToFallback(); return; }
    try {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function () {
        dismiss();
        deferredPrompt = null;
      }, function () {
        deferredPrompt = null;
      });
    } catch (err) {
      deferredPrompt = null;
      swapToFallback();
    }
  }

  function swapToFallback() {
    if (!bannerEl || !bannerEl.parentNode) return;
    var newEl = buildBanner('desktop-chromium-fallback');
    bannerEl.parentNode.replaceChild(newEl, bannerEl);
    bannerEl = newEl;
    void bannerEl.offsetHeight;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (bannerEl) bannerEl.classList.add('show');
      });
    });
  }

  function dismiss() {
    try {
      var until = Date.now() + DISMISS_DAYS * 24 * 60 * 60 * 1000;
      localStorage.setItem(DISMISS_KEY, String(until));
    } catch (e) { /* ignore */ }
    if (!bannerEl) return;
    bannerEl.classList.remove('show');
    var el = bannerEl;
    bannerEl = null;
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 400);
  }

  function show(variant) {
    if (shown) return;
    shown = true;
    injectStyles();
    bannerEl = buildBanner(variant);
    document.body.appendChild(bannerEl);
    // Force a layout then add .show — double-rAF alone can be flaky in some paths
    void bannerEl.offsetHeight;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (bannerEl) bannerEl.classList.add('show');
      });
    });
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    beforeInstallFired = true;
    deferredPrompt = e;
    setTimeout(function () { show('native'); }, SHOW_AFTER_MS);
  });

  window.addEventListener('appinstalled', dismiss);

  function initInstructional() {
    if (isIOSSafari) {
      setTimeout(function () { show('ios'); }, SHOW_AFTER_MS);
    } else if (isMacSafari) {
      setTimeout(function () { show('mac-safari'); }, SHOW_AFTER_MS);
    } else if (isDesktopChromium) {
      setTimeout(function () {
        if (!beforeInstallFired && !shown) show('desktop-chromium-fallback');
      }, DESKTOP_FALLBACK_MS);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initInstructional);
  } else {
    initInstructional();
  }
})();

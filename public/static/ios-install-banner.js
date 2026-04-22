/**
 * Cross-platform PWA install prompt.
 *
 * Install paths:
 *   1. Android Chrome/Edge, Desktop Chrome/Edge → real Install button
 *      (capture `beforeinstallprompt`, call prompt() on click).
 *   2. iOS Safari → Share → Add to Home Screen instructions.
 *   3. macOS Safari 17+ → File → Add to Dock instructions (expandable guide).
 *   4. Desktop Chromium fallback (event didn't fire) → address-bar install icon
 *      instructions (expandable guide).
 *
 * macOS Safari cannot install via JS — Apple doesn't expose the API. The banner
 * there is guidance only: a "Show me how" button expands a numbered step list.
 * Already-installed / unsupported browsers get no banner.
 * Dismissal is remembered for 30 days via localStorage.
 */
(function () {
  'use strict';

  var DISMISS_KEY = 'rm_pwa_install_dismissed_until';
  var DISMISS_DAYS = 30;
  var SHOW_AFTER_MS = 3500;
  var DESKTOP_FALLBACK_MS = 6000; // if beforeinstallprompt never fires

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
    /Chrome|Chromium|Edg\//.test(ua) && !/Edge\//.test(ua);

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
      '#rm-install{position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483000;',
      'background:#0A0A0A;color:#fff;border:1px solid rgba(0,255,136,0.35);border-radius:16px;',
      'box-shadow:0 12px 40px rgba(0,0,0,0.55),0 0 0 1px rgba(255,255,255,0.04);',
      'padding:14px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
      'transform:translateY(140%);transition:transform .35s cubic-bezier(.2,.9,.3,1.2);',
      'max-width:520px;margin:0 auto;}',
      '#rm-install.show{transform:translateY(0);}',
      '#rm-install .rm-row{display:flex;align-items:flex-start;gap:12px;}',
      '#rm-install .rm-icon{flex:0 0 44px;width:44px;height:44px;border-radius:10px;',
      'background:linear-gradient(135deg,#00FF88,#00C853);display:flex;align-items:center;justify-content:center;',
      'font-size:22px;}',
      '#rm-install .rm-body{flex:1;min-width:0;}',
      '#rm-install .rm-title{font-size:15px;font-weight:700;margin:0 0 2px;color:#fff;line-height:1.3;}',
      '#rm-install .rm-sub{font-size:13px;line-height:1.45;color:#d0d0d0;margin:0;}',
      '#rm-install .rm-sub b{color:#00FF88;font-weight:600;}',
      '#rm-install .rm-actions{display:flex;gap:8px;margin-top:10px;}',
      '#rm-install .rm-btn-install,#rm-install .rm-btn-show{flex:1;background:#00FF88;color:#0A0A0A;border:0;',
      'border-radius:10px;padding:10px 14px;font-size:14px;font-weight:700;cursor:pointer;',
      'font-family:inherit;}',
      '#rm-install .rm-btn-install:hover,#rm-install .rm-btn-show:hover{background:#00E077;}',
      '#rm-install .rm-btn-later{background:rgba(255,255,255,0.08);color:#d0d0d0;border:0;',
      'border-radius:10px;padding:10px 14px;font-size:14px;font-weight:500;cursor:pointer;',
      'font-family:inherit;}',
      '#rm-install .rm-btn-later:hover{background:rgba(255,255,255,0.16);color:#fff;}',
      '#rm-install .rm-close{position:absolute;top:8px;right:8px;width:28px;height:28px;border-radius:14px;',
      'background:rgba(255,255,255,0.08);border:0;color:#fff;font-size:18px;line-height:1;',
      'cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;font-family:inherit;}',
      '#rm-install .rm-close:hover{background:rgba(255,255,255,0.18);}',
      '#rm-install .rm-arrow{position:absolute;left:50%;bottom:-9px;transform:translateX(-50%) rotate(45deg);',
      'width:16px;height:16px;background:#0A0A0A;border-right:1px solid rgba(0,255,136,0.35);',
      'border-bottom:1px solid rgba(0,255,136,0.35);display:none;}',
      '#rm-install.rm-anchor-bottom-arrow .rm-arrow{display:block;}',
      '#rm-install.rm-anchor-top{top:12px;bottom:auto;}',
      '@media (min-width:900px){#rm-install.rm-desktop{left:auto;right:20px;bottom:20px;',
      'max-width:400px;margin:0;}}',
      '#rm-install .rm-steps{margin:10px 0 0;padding:12px;background:rgba(0,255,136,0.06);',
      'border:1px solid rgba(0,255,136,0.18);border-radius:10px;display:none;}',
      '#rm-install.rm-expanded .rm-steps{display:block;}',
      '#rm-install.rm-expanded .rm-btn-show{display:none;}',
      '#rm-install .rm-steps ol{margin:0;padding:0 0 0 22px;font-size:13px;line-height:1.6;color:#e0e0e0;}',
      '#rm-install .rm-steps li{margin:0 0 4px;}',
      '#rm-install .rm-steps li b{color:#00FF88;}',
      '#rm-install .rm-steps kbd{display:inline-block;background:rgba(255,255,255,0.12);',
      'border:1px solid rgba(255,255,255,0.2);border-radius:4px;padding:1px 6px;',
      'font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#fff;}',
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
      subHtml = 'Get one-tap access with the app. No store, no download.';
      actionsHtml =
        '<div class="rm-actions">' +
          '<button class="rm-btn-install" type="button">Install</button>' +
          '<button class="rm-btn-later" type="button">Not now</button>' +
        '</div>';
      if (window.innerWidth >= 900) classes.push('rm-desktop');
    } else if (variant === 'ios') {
      classes.push(isIPad ? 'rm-anchor-top' : 'rm-anchor-bottom-arrow');
      subHtml = 'Tap <b>⬆︎ Share</b>' +
        (isIPad ? ' at the top' : ' below') +
        ', then <b>Add to Home Screen</b>.';
    } else if (variant === 'mac-safari') {
      classes.push('rm-desktop');
      subHtml = 'Install it as a desktop app in two clicks.';
      actionsHtml =
        '<div class="rm-actions">' +
          '<button class="rm-btn-show" type="button">Show me how</button>' +
          '<button class="rm-btn-later" type="button">Not now</button>' +
        '</div>';
      stepsHtml =
        '<div class="rm-steps">' +
          '<ol>' +
            '<li>Click <b>File</b> in the Safari menu bar at the top of your screen.</li>' +
            '<li>Choose <b>Add to Dock…</b> from the menu.</li>' +
            '<li>Click <b>Add</b> to confirm — the app will appear in your Dock.</li>' +
          '</ol>' +
        '</div>';
    } else if (variant === 'desktop-chromium-fallback') {
      classes.push('rm-desktop');
      subHtml = 'Install it as a desktop app — no store, no download.';
      actionsHtml =
        '<div class="rm-actions">' +
          '<button class="rm-btn-show" type="button">Show me how</button>' +
          '<button class="rm-btn-later" type="button">Not now</button>' +
        '</div>';
      stepsHtml =
        '<div class="rm-steps">' +
          '<ol>' +
            '<li>Look in the address bar for the <b>install icon</b> (⊕ or a small monitor icon on the right).</li>' +
            '<li>Click it, then click <b>Install</b>.</li>' +
            '<li>Or open the <kbd>⋮</kbd> menu → <b>Cast, save and share</b> → <b>Install page as app</b>.</li>' +
          '</ol>' +
        '</div>';
    }

    if (classes.length) el.className = classes.join(' ');

    el.innerHTML =
      '<button class="rm-close" type="button" aria-label="Dismiss">×</button>' +
      '<div class="rm-row">' +
        '<div class="rm-icon" aria-hidden="true">🏠</div>' +
        '<div class="rm-body">' +
          '<p class="rm-title">' + title + '</p>' +
          '<p class="rm-sub">' + subHtml + '</p>' +
          actionsHtml +
          stepsHtml +
        '</div>' +
      '</div>' +
      (variant === 'ios' && !isIPad ? '<div class="rm-arrow" aria-hidden="true"></div>' : '');

    el.querySelector('.rm-close').addEventListener('click', dismiss);

    var laterBtn = el.querySelector('.rm-btn-later');
    if (laterBtn) laterBtn.addEventListener('click', dismiss);

    if (variant === 'native') {
      el.querySelector('.rm-btn-install').addEventListener('click', triggerNativeInstall);
    }

    var showBtn = el.querySelector('.rm-btn-show');
    if (showBtn) {
      showBtn.addEventListener('click', function () {
        el.classList.add('rm-expanded');
      });
    }

    return el;
  }

  function triggerNativeInstall() {
    if (!deferredPrompt) { dismiss(); return; }
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(function () {
      dismiss();
      deferredPrompt = null;
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
      // Fallback: if beforeinstallprompt didn't fire (already-installed-ish state,
      // user previously dismissed Chrome's own prompt, etc.) show guidance after
      // a longer delay so we don't race the native path.
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

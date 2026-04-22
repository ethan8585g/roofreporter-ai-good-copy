/**
 * Cross-platform PWA install prompt.
 *
 * Handles three install paths:
 *   1. Android Chrome/Edge, Desktop Chrome/Edge → real install button
 *      (capture `beforeinstallprompt`, call prompt() on click).
 *   2. iOS Safari → instructional banner pointing at Share → Add to Home Screen
 *      (Apple blocks the JS install API).
 *   3. macOS Safari 17+ → instructional banner pointing at File → Add to Dock.
 *
 * Already-installed / unsupported browsers get no banner.
 * Dismissal is remembered for 30 days via localStorage.
 */
(function () {
  'use strict';

  var DISMISS_KEY = 'rm_pwa_install_dismissed_until';
  var DISMISS_DAYS = 30;
  var SHOW_AFTER_MS = 3500;

  var ua = navigator.userAgent || '';
  var platform = navigator.platform || '';

  var isIPad = /iPad/.test(ua) ||
    (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var isIPhone = /iPhone|iPod/.test(ua);
  var isIOS = isIPhone || isIPad;
  var isMacSafari = /Macintosh/.test(ua) && /Safari/.test(ua) &&
    !/Chrome|Chromium|CriOS|FxiOS|EdgiOS|Edg\//.test(ua) && !isIPad;
  var isIOSSafari = isIOS &&
    /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|YaBrowser/.test(ua);

  var isStandalone = (('standalone' in navigator) && navigator.standalone) ||
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches;

  if (isStandalone) return;

  try {
    var dismissedUntil = parseInt(localStorage.getItem(DISMISS_KEY) || '0', 10);
    if (dismissedUntil && dismissedUntil > Date.now()) return;
  } catch (e) { /* storage blocked, show anyway */ }

  var deferredPrompt = null;
  var bannerEl = null;
  var shown = false;

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
      '#rm-install .rm-title{font-size:15px;font-weight:700;margin:0 0 2px;color:#fff;line-height:1.2;}',
      '#rm-install .rm-sub{font-size:13px;line-height:1.4;color:#d0d0d0;margin:0;}',
      '#rm-install .rm-sub b{color:#00FF88;font-weight:600;}',
      '#rm-install .rm-actions{display:flex;gap:8px;margin-top:10px;}',
      '#rm-install .rm-btn-install{flex:1;background:#00FF88;color:#0A0A0A;border:0;',
      'border-radius:10px;padding:10px 14px;font-size:14px;font-weight:700;cursor:pointer;',
      'font-family:inherit;}',
      '#rm-install .rm-btn-install:active{background:#00E077;}',
      '#rm-install .rm-btn-later{background:rgba(255,255,255,0.08);color:#d0d0d0;border:0;',
      'border-radius:10px;padding:10px 14px;font-size:14px;font-weight:500;cursor:pointer;',
      'font-family:inherit;}',
      '#rm-install .rm-btn-later:active{background:rgba(255,255,255,0.16);}',
      '#rm-install .rm-close{position:absolute;top:8px;right:8px;width:28px;height:28px;border-radius:14px;',
      'background:rgba(255,255,255,0.08);border:0;color:#fff;font-size:18px;line-height:1;',
      'cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;',
      'font-family:inherit;}',
      '#rm-install .rm-close:active{background:rgba(255,255,255,0.18);}',
      '#rm-install .rm-arrow{position:absolute;left:50%;bottom:-9px;transform:translateX(-50%) rotate(45deg);',
      'width:16px;height:16px;background:#0A0A0A;border-right:1px solid rgba(0,255,136,0.35);',
      'border-bottom:1px solid rgba(0,255,136,0.35);display:none;}',
      '#rm-install.rm-anchor-bottom-arrow .rm-arrow{display:block;}',
      '#rm-install.rm-anchor-top{top:12px;bottom:auto;}',
      '@media (min-width:900px){#rm-install.rm-desktop{left:auto;right:20px;bottom:20px;',
      'max-width:380px;margin:0;}}',
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
      subHtml = 'In Safari, open <b>File → Add to Dock</b> to install.';
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
        '</div>' +
      '</div>' +
      (variant === 'ios' && !isIPad ? '<div class="rm-arrow" aria-hidden="true"></div>' : '');

    el.querySelector('.rm-close').addEventListener('click', function () { dismiss(); });

    if (variant === 'native') {
      el.querySelector('.rm-btn-install').addEventListener('click', triggerNativeInstall);
      el.querySelector('.rm-btn-later').addEventListener('click', function () { dismiss(); });
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

  // Android / Desktop Chromium: capture the real install event
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    setTimeout(function () { show('native'); }, SHOW_AFTER_MS);
  });

  window.addEventListener('appinstalled', function () { dismiss(); });

  // iOS Safari / macOS Safari: no install event, show instructions
  function initInstructional() {
    if (isIOSSafari) {
      setTimeout(function () { show('ios'); }, SHOW_AFTER_MS);
    } else if (isMacSafari) {
      setTimeout(function () { show('mac-safari'); }, SHOW_AFTER_MS);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initInstructional);
  } else {
    initInstructional();
  }
})();

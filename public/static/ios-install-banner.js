/**
 * iOS PWA install prompt.
 *
 * iOS Safari does not fire `beforeinstallprompt`, so the only way to install
 * a PWA on iPhone/iPad is through Share → Add to Home Screen. This banner
 * detects iOS Safari (not already installed) and shows a one-time dismissible
 * hint pointing at the Share button.
 *
 * Dismissal is remembered for 30 days via localStorage.
 */
(function () {
  'use strict';

  var DISMISS_KEY = 'rm_ios_install_dismissed_until';
  var DISMISS_DAYS = 30;
  var SHOW_AFTER_MS = 3500; // let the page render + user start engaging first

  var ua = window.navigator.userAgent || '';
  var isIPad = /iPad/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS reports as Mac
  var isIPhone = /iPhone|iPod/.test(ua);
  var isIOS = isIPhone || isIPad;

  // Safari only — Chrome/Firefox/Edge on iOS all include "CriOS"/"FxiOS"/"EdgiOS"
  var isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|YaBrowser/.test(ua);

  // Already installed? standalone mode returns true in iOS PWA.
  var isStandalone = ('standalone' in navigator && navigator.standalone) ||
    window.matchMedia('(display-mode: standalone)').matches;

  if (!isIOS || !isSafari || isStandalone) return;

  try {
    var dismissedUntil = parseInt(localStorage.getItem(DISMISS_KEY) || '0', 10);
    if (dismissedUntil && dismissedUntil > Date.now()) return;
  } catch (e) { /* storage blocked, show anyway */ }

  function injectStyles() {
    if (document.getElementById('rm-ios-install-styles')) return;
    var css = [
      '#rm-ios-install{position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483000;',
      'background:#0A0A0A;color:#fff;border:1px solid rgba(0,255,136,0.35);border-radius:16px;',
      'box-shadow:0 12px 40px rgba(0,0,0,0.55),0 0 0 1px rgba(255,255,255,0.04);',
      'padding:14px 14px 14px 14px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
      'transform:translateY(140%);transition:transform .35s cubic-bezier(.2,.9,.3,1.2);',
      'max-width:520px;margin:0 auto;}',
      '#rm-ios-install.show{transform:translateY(0);}',
      '#rm-ios-install .rm-ios-row{display:flex;align-items:flex-start;gap:12px;}',
      '#rm-ios-install .rm-ios-icon{flex:0 0 44px;width:44px;height:44px;border-radius:10px;',
      'background:linear-gradient(135deg,#00FF88,#00C853);display:flex;align-items:center;justify-content:center;',
      'font-size:22px;}',
      '#rm-ios-install .rm-ios-body{flex:1;min-width:0;}',
      '#rm-ios-install .rm-ios-title{font-size:15px;font-weight:700;margin:0 0 2px 0;color:#fff;line-height:1.2;}',
      '#rm-ios-install .rm-ios-sub{font-size:13px;line-height:1.4;color:#d0d0d0;margin:0;}',
      '#rm-ios-install .rm-ios-sub b{color:#00FF88;font-weight:600;}',
      '#rm-ios-install .rm-ios-close{flex:0 0 28px;width:28px;height:28px;border-radius:14px;',
      'background:rgba(255,255,255,0.08);border:0;color:#fff;font-size:18px;line-height:1;',
      'cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;}',
      '#rm-ios-install .rm-ios-close:active{background:rgba(255,255,255,0.18);}',
      '#rm-ios-install .rm-ios-arrow{position:absolute;left:50%;bottom:-9px;transform:translateX(-50%) rotate(45deg);',
      'width:16px;height:16px;background:#0A0A0A;border-right:1px solid rgba(0,255,136,0.35);',
      'border-bottom:1px solid rgba(0,255,136,0.35);display:none;}',
      // iPhone — Share button lives in the BOTTOM bar (Safari 15+), so anchor to bottom
      '#rm-ios-install.rm-anchor-bottom{bottom:72px;}',
      '#rm-ios-install.rm-anchor-bottom .rm-ios-arrow{display:block;}',
      // iPad — Share button is in the TOP bar, so dock to the top
      '#rm-ios-install.rm-anchor-top{top:12px;bottom:auto;}',
      '@media (prefers-reduced-motion: reduce){#rm-ios-install{transition:none;}}'
    ].join('');
    var style = document.createElement('style');
    style.id = 'rm-ios-install-styles';
    style.appendChild(document.createTextNode(css));
    document.head.appendChild(style);
  }

  function buildBanner() {
    var el = document.createElement('div');
    el.id = 'rm-ios-install';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Install Roof Manager');
    el.className = isIPad ? 'rm-anchor-top' : 'rm-anchor-bottom';

    // Unicode share glyph matches iOS Safari's share icon closely enough to be recognisable.
    var shareGlyph = '⬆︎'; // upward arrow — simple & works across iOS versions

    el.innerHTML =
      '<div class="rm-ios-row">' +
        '<div class="rm-ios-icon" aria-hidden="true">🏠</div>' +
        '<div class="rm-ios-body">' +
          '<p class="rm-ios-title">Install Roof Manager</p>' +
          '<p class="rm-ios-sub">Tap <b>' + shareGlyph + ' Share</b>' +
          (isIPad ? ' at the top' : ' below') +
          ', then <b>Add to Home Screen</b>.</p>' +
        '</div>' +
        '<button class="rm-ios-close" type="button" aria-label="Dismiss install prompt">×</button>' +
      '</div>' +
      '<div class="rm-ios-arrow" aria-hidden="true"></div>';

    el.querySelector('.rm-ios-close').addEventListener('click', function () {
      dismiss(el);
    });

    return el;
  }

  function dismiss(el) {
    try {
      var until = Date.now() + DISMISS_DAYS * 24 * 60 * 60 * 1000;
      localStorage.setItem(DISMISS_KEY, String(until));
    } catch (e) { /* ignore */ }
    el.classList.remove('show');
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 400);
  }

  function show() {
    injectStyles();
    var el = buildBanner();
    document.body.appendChild(el);
    // double rAF so the transform transition actually fires
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { el.classList.add('show'); });
    });
  }

  function init() {
    setTimeout(show, SHOW_AFTER_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

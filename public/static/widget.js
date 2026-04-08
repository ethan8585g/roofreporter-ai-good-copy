/**
 * Roof Manager — Instant Estimator Widget Embed Script
 * Usage: <script src="https://www.roofmanager.ca/static/widget.js" data-key="YOUR_KEY" async></script>
 * Options: data-mode="inline" (default) | data-mode="floating"
 */
(function() {
  'use strict';
  var script = document.currentScript || (function() {
    var scripts = document.getElementsByTagName('script');
    for (var i = scripts.length - 1; i >= 0; i--) {
      if (scripts[i].src && scripts[i].src.indexOf('widget.js') !== -1) return scripts[i];
    }
  })();

  if (!script) return;

  var key = script.getAttribute('data-key');
  if (!key) { console.error('[RoofManager] Missing data-key attribute'); return; }

  var mode = script.getAttribute('data-mode') || 'inline';
  var BASE = script.src.replace('/static/widget.js', '');

  function createInlineWidget() {
    var container = document.getElementById('rm-estimator-widget');
    if (!container) {
      container = document.createElement('div');
      container.id = 'rm-estimator-widget';
      script.parentNode.insertBefore(container, script.nextSibling);
    }
    var iframe = document.createElement('iframe');
    iframe.src = BASE + '/widget/view?key=' + encodeURIComponent(key);
    iframe.style.cssText = 'width:100%;border:none;min-height:520px;display:block;border-radius:12px;overflow:hidden;';
    iframe.setAttribute('scrolling', 'no');
    iframe.setAttribute('title', 'Instant Roof Estimate');
    container.appendChild(iframe);
    return iframe;
  }

  function createFloatingWidget() {
    // Floating button
    var btn = document.createElement('div');
    btn.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:99999;cursor:pointer;' +
      'background:#1e3a5f;color:#fff;padding:14px 22px;border-radius:50px;font-family:system-ui,sans-serif;' +
      'font-size:15px;font-weight:600;box-shadow:0 4px 20px rgba(0,0,0,0.25);transition:transform 0.2s;';
    btn.textContent = 'Get Roof Estimate';
    btn.onmouseenter = function() { btn.style.transform = 'scale(1.05)'; };
    btn.onmouseleave = function() { btn.style.transform = 'scale(1)'; };
    document.body.appendChild(btn);

    // Modal overlay
    var overlay = document.createElement('div');
    overlay.style.cssText = 'display:none;position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,0.5);' +
      'justify-content:center;align-items:center;padding:20px;';
    var modal = document.createElement('div');
    modal.style.cssText = 'background:#fff;border-radius:16px;width:100%;max-width:480px;max-height:90vh;' +
      'overflow:hidden;position:relative;box-shadow:0 20px 60px rgba(0,0,0,0.3);';
    var close = document.createElement('div');
    close.style.cssText = 'position:absolute;top:12px;right:16px;z-index:10;cursor:pointer;font-size:24px;' +
      'color:#666;width:32px;height:32px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:#f3f4f6;';
    close.innerHTML = '&times;';
    var iframe = document.createElement('iframe');
    iframe.src = BASE + '/widget/view?key=' + encodeURIComponent(key);
    iframe.style.cssText = 'width:100%;border:none;min-height:520px;display:block;';
    iframe.setAttribute('scrolling', 'no');
    iframe.setAttribute('title', 'Instant Roof Estimate');

    modal.appendChild(close);
    modal.appendChild(iframe);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    btn.onclick = function() { overlay.style.display = 'flex'; };
    close.onclick = function() { overlay.style.display = 'none'; };
    overlay.onclick = function(e) { if (e.target === overlay) overlay.style.display = 'none'; };

    return iframe;
  }

  // Listen for resize messages from the iframe
  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'rm-widget-resize' && e.data.height) {
      var iframes = document.querySelectorAll('iframe[title="Instant Roof Estimate"]');
      for (var i = 0; i < iframes.length; i++) {
        if (iframes[i].contentWindow === e.source) {
          iframes[i].style.height = e.data.height + 'px';
        }
      }
    }
  });

  // Init on DOM ready
  function init() {
    if (mode === 'floating') {
      createFloatingWidget();
    } else {
      createInlineWidget();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

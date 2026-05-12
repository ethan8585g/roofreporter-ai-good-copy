// ============================================================
// Customer 3D House Modal
//
// Fullscreen overlay that iframes /3d-verify?orderId=X — the same
// CesiumJS + Google Photorealistic 3D Tiles environment the super-admin
// trace tool uses. Right-side slide-out panel previews roof materials
// and links into /customer/virtual-tryon for the full AI try-on flow.
//
// Public API:
//   window.openHouse3D(orderId, address) — opens the modal
// ============================================================
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  var MATERIALS = [
    { key: 'asphalt', label: 'Asphalt Shingle', colors: ['Charcoal', 'Slate Gray', 'Weathered Wood', 'Forest Green'] },
    { key: 'metal',   label: 'Standing Seam Metal', colors: ['Charcoal', 'Hunter Green', 'Copper', 'Matte Black'] },
    { key: 'tile',    label: 'Clay Tile', colors: ['Terracotta', 'Sand', 'Slate Black'] },
    { key: 'slate',   label: 'Natural Slate', colors: ['Black', 'Gray', 'Plum'] },
    { key: 'cedar',   label: 'Cedar Shake', colors: ['Natural', 'Weathered', 'Cinnamon'] }
  ];

  var COLOR_HEX = {
    'Charcoal': '#2b2b2b', 'Slate Gray': '#5a6470', 'Weathered Wood': '#7a6a55', 'Forest Green': '#2f4a3a',
    'Hunter Green': '#28503a', 'Copper': '#b87333', 'Matte Black': '#1a1a1a',
    'Terracotta': '#b35947', 'Sand': '#c9a878', 'Slate Black': '#1f2125',
    'Black': '#101010', 'Gray': '#6b6b6b', 'Plum': '#5b3a4a',
    'Natural': '#a07a4a', 'Weathered': '#7a6855', 'Cinnamon': '#8a4a2a'
  };

  function injectStylesOnce() {
    if (document.getElementById('rm-3d-modal-styles')) return;
    var style = document.createElement('style');
    style.id = 'rm-3d-modal-styles';
    style.textContent = [
      '.rm-3d-overlay{position:fixed;inset:0;z-index:9999;background:#000;display:flex;flex-direction:column;animation:rm3dFade .18s ease}',
      '@keyframes rm3dFade{from{opacity:0}to{opacity:1}}',
      '.rm-3d-iframe{flex:1;width:100%;height:100%;border:0;display:block}',
      '.rm-3d-close{position:absolute;top:14px;right:14px;width:44px;height:44px;border-radius:999px;background:rgba(0,0,0,.78);color:#fff;border:1px solid rgba(255,255,255,.18);font-size:22px;line-height:1;cursor:pointer;z-index:10001;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);transition:transform .12s ease,background .12s ease}',
      '.rm-3d-close:hover{background:#ef4444;transform:scale(1.05)}',
      '.rm-3d-addr{position:absolute;top:14px;left:14px;background:rgba(0,0,0,.65);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);color:#fff;padding:8px 14px;border-radius:999px;border:1px solid rgba(255,255,255,.12);font-size:12px;font-weight:600;z-index:10001;max-width:60vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.rm-3d-tryon-toggle{position:absolute;bottom:18px;right:18px;background:#00FF88;color:#0A0A0A;border:0;padding:12px 18px;border-radius:999px;font-weight:800;font-size:13px;cursor:pointer;z-index:10001;box-shadow:0 6px 20px rgba(0,255,136,.25);display:inline-flex;align-items:center;gap:8px}',
      '.rm-3d-tryon-toggle:hover{transform:translateY(-1px)}',
      '.rm-3d-panel{position:absolute;top:0;right:0;height:100%;width:340px;max-width:90vw;background:#0a0a0a;border-left:1px solid rgba(255,255,255,.12);z-index:10002;transform:translateX(100%);transition:transform .25s ease;display:flex;flex-direction:column;color:#fff;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Inter,sans-serif}',
      '.rm-3d-panel.open{transform:translateX(0)}',
      '.rm-3d-panel-head{padding:16px;border-bottom:1px solid rgba(255,255,255,.08);display:flex;align-items:center;justify-content:space-between}',
      '.rm-3d-panel-head h3{margin:0;font-size:15px;font-weight:700}',
      '.rm-3d-panel-close{background:transparent;border:0;color:#9ca3af;font-size:20px;cursor:pointer;width:28px;height:28px;border-radius:6px}',
      '.rm-3d-panel-close:hover{background:rgba(255,255,255,.08);color:#fff}',
      '.rm-3d-panel-body{flex:1;overflow-y:auto;padding:16px}',
      '.rm-3d-mat{margin-bottom:18px}',
      '.rm-3d-mat-label{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#9ca3af;margin-bottom:8px;font-weight:600}',
      '.rm-3d-swatches{display:flex;flex-wrap:wrap;gap:8px}',
      '.rm-3d-swatch{cursor:pointer;border:2px solid transparent;border-radius:10px;padding:4px;background:rgba(255,255,255,.04);display:flex;align-items:center;gap:6px;font-size:11px;color:#e5e7eb;transition:border-color .12s ease,background .12s ease}',
      '.rm-3d-swatch:hover{background:rgba(255,255,255,.08);border-color:rgba(0,255,136,.4)}',
      '.rm-3d-swatch.sel{border-color:#00FF88;background:rgba(0,255,136,.1)}',
      '.rm-3d-swatch-dot{width:18px;height:18px;border-radius:50%;flex-shrink:0;border:1px solid rgba(255,255,255,.25)}',
      '.rm-3d-cta{display:block;width:100%;padding:12px;background:#00FF88;color:#0A0A0A;border:0;border-radius:10px;font-weight:800;font-size:13px;cursor:pointer;text-align:center;text-decoration:none;margin-top:6px}',
      '.rm-3d-cta:hover{background:#00e07a}',
      '.rm-3d-note{font-size:11px;color:#9ca3af;line-height:1.5;margin-top:12px}',
      '@media (max-width:480px){.rm-3d-panel{width:90vw}.rm-3d-addr{max-width:50vw;font-size:11px}.rm-3d-tryon-toggle{padding:10px 14px;font-size:12px;bottom:12px;right:12px}}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function buildPanelBody(orderId) {
    var html = '<div class="rm-3d-mat"><div class="rm-3d-mat-label" style="color:#00FF88">Pick a material</div>';
    html += '<p class="rm-3d-note" style="margin-top:0;margin-bottom:12px">Preview swatches below, then open the full Roof Visualizer to apply your choice to a photo of this house.</p></div>';
    for (var i = 0; i < MATERIALS.length; i++) {
      var m = MATERIALS[i];
      html += '<div class="rm-3d-mat"><div class="rm-3d-mat-label">' + m.label + '</div><div class="rm-3d-swatches">';
      for (var j = 0; j < m.colors.length; j++) {
        var c = m.colors[j];
        var hex = COLOR_HEX[c] || '#666';
        html += '<div class="rm-3d-swatch" data-style="' + m.key + '" data-color="' + c + '">';
        html += '<span class="rm-3d-swatch-dot" style="background:' + hex + '"></span>';
        html += '<span>' + c + '</span></div>';
      }
      html += '</div></div>';
    }
    html += '<a href="/customer/virtual-tryon?order_id=' + encodeURIComponent(orderId) + '" target="_blank" class="rm-3d-cta">Open Full Roof Visualizer →</a>';
    html += '<p class="rm-3d-note">The 3D environment shows real Google imagery of the house. The Roof Visualizer uses AI to repaint a photo of the house with the material you choose.</p>';
    return html;
  }

  function close() {
    var el = document.getElementById('rm-3d-overlay');
    if (el) el.parentNode.removeChild(el);
    document.removeEventListener('keydown', escHandler);
    document.body.style.overflow = '';
  }

  function escHandler(e) {
    if (e.key === 'Escape') close();
  }

  function open(orderId, address) {
    if (!orderId) return;
    injectStylesOnce();
    close(); // tear down any previous

    var overlay = document.createElement('div');
    overlay.id = 'rm-3d-overlay';
    overlay.className = 'rm-3d-overlay';

    var addr = document.createElement('div');
    addr.className = 'rm-3d-addr';
    addr.textContent = address || ('Order #' + orderId);

    var closeBtn = document.createElement('button');
    closeBtn.className = 'rm-3d-close';
    closeBtn.innerHTML = '×';
    closeBtn.setAttribute('aria-label', 'Close 3D view');
    closeBtn.onclick = close;

    var iframe = document.createElement('iframe');
    iframe.className = 'rm-3d-iframe';
    // customer=1 enables the customer-only Tilt ⬇ / Tilt ⬆ controls in
    // /3d-verify — kept out of the super-admin trace iframe so the admin
    // chrome stays unchanged.
    iframe.src = '/3d-verify?orderId=' + encodeURIComponent(orderId) + '&customer=1';
    iframe.allow = 'fullscreen';
    // Match the working trace-tool pattern (customer-order.js:4430). The GCP
    // GOOGLE_MAPS_API_KEY has HTTP-referrer restrictions that REQUIRE a Referer
    // matching https://www.roofmanager.ca/*. 'no-referrer' was rejected with 401;
    // 'strict-origin-when-cross-origin' sends https://www.roofmanager.ca/ which
    // matches and is accepted.
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';

    var tryonToggle = document.createElement('button');
    tryonToggle.className = 'rm-3d-tryon-toggle';
    tryonToggle.innerHTML = '<i class="fas fa-palette"></i> Try Roof Materials';

    var panel = document.createElement('div');
    panel.className = 'rm-3d-panel';
    panel.innerHTML =
      '<div class="rm-3d-panel-head"><h3>Try Roof Materials</h3>' +
      '<button class="rm-3d-panel-close" aria-label="Close panel">×</button></div>' +
      '<div class="rm-3d-panel-body">' + buildPanelBody(orderId) + '</div>';

    var panelClose = panel.querySelector('.rm-3d-panel-close');
    panelClose.onclick = function () { panel.classList.remove('open'); };

    tryonToggle.onclick = function () {
      panel.classList.toggle('open');
    };

    panel.addEventListener('click', function (e) {
      var sw = e.target.closest && e.target.closest('.rm-3d-swatch');
      if (!sw) return;
      var prev = panel.querySelector('.rm-3d-swatch.sel');
      if (prev) prev.classList.remove('sel');
      sw.classList.add('sel');
    });

    overlay.appendChild(iframe);
    overlay.appendChild(addr);
    overlay.appendChild(closeBtn);
    overlay.appendChild(tryonToggle);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', escHandler);
  }

  window.openHouse3D = open;
})();

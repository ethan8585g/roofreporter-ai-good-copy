/**
 * Dashboard Utilities — shared across CRM, Super Admin BI, D2D, and Crew dashboards
 */
(function () {
  'use strict';

  // ── Animated Counter ──────────────────────────────────────────────
  // Smoothly counts from 0 to target value using easeOutExpo easing.
  // Usage: animateCounter(el, 12500, 1200, '$', '')
  window.animateCounter = function (el, target, duration, prefix, suffix) {
    if (!el) return;
    prefix = prefix || '';
    suffix = suffix || '';
    duration = duration || 1000;
    var start = performance.now();
    var isDecimal = String(target).indexOf('.') !== -1;

    function easeOutExpo(t) {
      return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
    }

    function tick(now) {
      var elapsed = now - start;
      var progress = Math.min(elapsed / duration, 1);
      var eased = easeOutExpo(progress);
      var current = eased * target;
      if (isDecimal) {
        el.textContent = prefix + current.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + suffix;
      } else {
        el.textContent = prefix + Math.round(current).toLocaleString('en-US') + suffix;
      }
      if (progress < 1) requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  };

  // Helper: find all [data-counter] elements within a container and animate them
  window.animateAllCounters = function (container) {
    if (!container) container = document;
    var els = container.querySelectorAll('[data-counter]');
    els.forEach(function (el) {
      var target = parseFloat(el.getAttribute('data-counter'));
      var prefix = el.getAttribute('data-counter-prefix') || '';
      var suffix = el.getAttribute('data-counter-suffix') || '';
      var duration = parseInt(el.getAttribute('data-counter-duration')) || 1000;
      window.animateCounter(el, target, duration, prefix, suffix);
    });
  };

  // ── Glassmorphism Card ────────────────────────────────────────────
  // Returns HTML string wrapping content in a frosted-glass styled card.
  window.glassCard = function (content, opts) {
    opts = opts || {};
    var padding = opts.padding || 'p-5';
    var rounded = opts.rounded || 'rounded-2xl';
    var extra = opts.className || '';
    return '<div class="' + padding + ' ' + rounded + ' ' + extra + '" ' +
      'style="backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);' +
      'background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);' +
      'box-shadow:0 4px 24px rgba(0,0,0,0.15)">' +
      content + '</div>';
  };

  // ── Pulse Indicator ───────────────────────────────────────────────
  // Returns HTML for an animated pulsing dot — use for "live" indicators.
  window.pulseIndicator = function (color) {
    color = color || '#22c55e';
    return '<span style="position:relative;display:inline-flex;width:8px;height:8px">' +
      '<span style="position:absolute;inset:0;border-radius:50%;background:' + color + ';opacity:0.4;animation:dashPulse 1.5s ease-in-out infinite"></span>' +
      '<span style="position:relative;display:block;width:8px;height:8px;border-radius:50%;background:' + color + '"></span>' +
      '</span>';
  };

  // Inject pulse keyframes if not present
  if (!document.getElementById('dash-utils-styles')) {
    var style = document.createElement('style');
    style.id = 'dash-utils-styles';
    style.textContent =
      '@keyframes dashPulse{0%,100%{transform:scale(1);opacity:0.4}50%{transform:scale(2.2);opacity:0}}' +
      '@keyframes dashFadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}' +
      '.dash-fade-in{animation:dashFadeIn 0.4s ease-out both}';
    document.head.appendChild(style);
  }

  // ── Confetti Celebration ──────────────────────────────────────────
  // Fires a burst of confetti — requires canvas-confetti CDN to be loaded.
  window.celebrateWin = function () {
    if (typeof confetti !== 'function') return;
    confetti({ particleCount: 120, spread: 80, origin: { y: 0.65 }, colors: ['#22c55e', '#4ade80', '#10b981', '#fbbf24', '#60a5fa'] });
    setTimeout(function () {
      confetti({ particleCount: 60, spread: 50, origin: { x: 0.3, y: 0.7 } });
    }, 250);
    setTimeout(function () {
      confetti({ particleCount: 60, spread: 50, origin: { x: 0.7, y: 0.7 } });
    }, 400);
  };

  // ── ApexCharts Dark Theme Base ────────────────────────────────────
  // Merge with chart-specific config: Object.assign({}, APEX_DARK, { ... })
  window.APEX_DARK = {
    chart: { background: 'transparent', foreColor: '#9ca3af', fontFamily: 'Inter, system-ui, sans-serif' },
    theme: { mode: 'dark' },
    grid: { borderColor: 'rgba(255,255,255,0.06)', strokeDashArray: 3 },
    tooltip: { theme: 'dark', style: { fontSize: '12px' } },
    stroke: { curve: 'smooth' },
    xaxis: { axisBorder: { show: false }, axisTicks: { show: false } },
    yaxis: { labels: { style: { colors: '#6b7280' } } }
  };

  // ── Initials Avatar ───────────────────────────────────────────────
  // Returns HTML for a circular avatar with initials and hashed color.
  window.initialsAvatar = function (name, size) {
    size = size || 28;
    var initials = (name || '?').split(/\s+/).map(function (w) { return w.charAt(0).toUpperCase(); }).slice(0, 2).join('');
    // Simple hash for consistent color
    var hash = 0;
    for (var i = 0; i < (name || '').length; i++) { hash = (name || '').charCodeAt(i) + ((hash << 5) - hash); }
    var hue = ((hash % 360) + 360) % 360;
    return '<span style="display:inline-flex;align-items:center;justify-content:center;width:' + size + 'px;height:' + size + 'px;border-radius:50%;' +
      'background:hsl(' + hue + ',55%,35%);color:#fff;font-size:' + Math.round(size * 0.4) + 'px;font-weight:700;flex-shrink:0">' +
      initials + '</span>';
  };

  // ── Deep merge utility for ApexCharts configs ─────────────────────
  window.mergeApexConfig = function (base, override) {
    var result = {};
    var keys = Object.keys(base).concat(Object.keys(override));
    keys.forEach(function (k) {
      if (base[k] && override[k] && typeof base[k] === 'object' && typeof override[k] === 'object' && !Array.isArray(base[k])) {
        result[k] = window.mergeApexConfig(base[k], override[k]);
      } else if (override.hasOwnProperty(k)) {
        result[k] = override[k];
      } else {
        result[k] = base[k];
      }
    });
    return result;
  };

})();

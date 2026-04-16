// ============================================================
// Lightweight A/B Testing Framework
// Server-side variant assignment via deterministic hash of a
// visitor identifier (stored in a cookie or localStorage key).
// ============================================================

/**
 * Deterministically assign a variant based on a visitor/session ID.
 * Uses a simple djb2 hash so the same visitor always sees the same variant.
 *
 * @param visitorId  Any stable string ID (e.g. UUID from cookie/localStorage)
 * @param testName   Experiment name (kept separate so the same visitor can be
 *                   in variant A for one test and variant B for another)
 * @param variants   Array of variant names (must be non-empty).  Defaults to ['control','treatment']
 * @returns          One element from the variants array
 */
export function assignVariant(
  visitorId: string,
  testName: string,
  variants: string[] = ['control', 'treatment']
): string {
  if (variants.length === 0) return 'control'
  const key = `${testName}__${visitorId}`
  let hash = 5381
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) + hash) ^ key.charCodeAt(i)
  }
  const idx = Math.abs(hash) % variants.length
  return variants[idx]
}

/**
 * Client-side A/B script injected into every page via the middleware.
 * Reads/creates a stable visitor ID in localStorage, assigns variants
 * for active experiments, and exposes window.__ab for JS access.
 *
 * Fires a gtag event so GA4 can segment by variant.
 */
export const AB_SCRIPT = `
<script>
(function(){
  // Stable visitor ID
  var vid = localStorage.getItem('_rr_vid');
  if (!vid) { vid = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('_rr_vid', vid); }

  // Deterministic hash assign (mirrors server-side assignVariant)
  function djb2(str) {
    var h = 5381; for (var i=0;i<str.length;i++) h=((h<<5)+h)^str.charCodeAt(i); return Math.abs(h);
  }
  function variant(testName, variants) {
    variants = variants || ['control','treatment'];
    return variants[djb2(testName+'__'+vid) % variants.length];
  }

  // ── Active experiments ────────────────────────────────────
  window.__ab = {
    hero_cta: variant('hero_cta_v1', ['control', 'treatment']),
    pricing_highlight: variant('pricing_highlight_v1', ['control', 'treatment']),
  };

  // Report to GA4 (if loaded)
  function reportAB() {
    if (typeof gtag !== 'function') return;
    Object.keys(window.__ab).forEach(function(k){
      gtag('event', 'ab_variant_assigned', { test_name: k, variant: window.__ab[k] });
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', reportAB);
  } else {
    setTimeout(reportAB, 1000); // wait for gtag to init
  }

  // ── Social proof toasts ───────────────────────────────────
  var toasts = [
    'Mike D. from Calgary just generated a report',
    'Sarah K. from Toronto got a quote in 60 seconds',
    'James R. from Edmonton ordered a 100-report pack',
    'A contractor in Vancouver just signed up',
    'Pedro M. from Winnipeg just closed a $14k job',
    'A roofer in Ottawa got their first free report',
    'Lena S. from Saskatoon just booked a demo',
  ];
  var shownToasts = 0;
  var maxToasts = 3;

  function showToast(msg) {
    var t = document.createElement('div');
    t.setAttribute('role','status');
    t.setAttribute('aria-live','polite');
    t.style.cssText = [
      'position:fixed','bottom:80px','left:20px','z-index:9999',
      'background:#fff','border:1px solid #e5e7eb','border-radius:12px',
      'padding:12px 16px','box-shadow:0 8px 32px rgba(0,0,0,0.12)',
      'display:flex','align-items:center','gap:10px',
      'font-size:13px','color:#374151','max-width:280px',
      'transform:translateX(-120%)','transition:transform 0.4s cubic-bezier(.34,1.56,.64,1)',
      'cursor:pointer'
    ].join(';');
    t.innerHTML = '<span style="font-size:18px">&#x1F3E0;</span><span>' + msg + '</span>';
    t.onclick = function(){ dismiss(t); };
    document.body.appendChild(t);
    requestAnimationFrame(function(){
      requestAnimationFrame(function(){ t.style.transform = 'translateX(0)'; });
    });
    var timer = setTimeout(function(){ dismiss(t); }, 5000);
    function dismiss(el) {
      clearTimeout(timer);
      el.style.transform = 'translateX(-120%)';
      setTimeout(function(){ if (el.parentNode) el.parentNode.removeChild(el); }, 400);
    }
  }

  function maybeShowToast() {
    // Only on landing, register, pricing — not on dashboard/auth
    var p = location.pathname;
    var ok = p === '/' || p === '/register' || p.startsWith('/pricing') || p.startsWith('/lander');
    if (!ok || shownToasts >= maxToasts) return;
    // Don't show if user is already signed in
    try { if (localStorage.getItem('rc_customer_token')) return; } catch(e){}
    var msg = toasts[Math.floor(Math.random() * toasts.length)];
    shownToasts++;
    showToast(msg);
  }

  // Start toasts after 8s, then every 25–45s
  var firstDelay = 8000 + Math.random() * 7000;
  setTimeout(function loop(){
    maybeShowToast();
    if (shownToasts < maxToasts) {
      setTimeout(loop, 25000 + Math.random() * 20000);
    }
  }, firstDelay);
})();
</script>`

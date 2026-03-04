// ============================================================
// RoofReporterAI — Site Analytics Tracker
// Lightweight client-side tracking: pageviews, clicks, scroll, time
// Auto-injects on every page. No cookies — uses localStorage UUID.
// ============================================================
(function() {
  'use strict';
  
  // Don't track bots or admin/superadmin paths (they have their own tracking)
  const path = location.pathname;
  if (navigator.userAgent.match(/bot|crawl|spider|slurp|mediapartners/i)) return;
  
  // ── Visitor & Session IDs ──
  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
  
  // Persistent visitor ID (survives browser close)
  let visitorId = localStorage.getItem('_rc_vid');
  if (!visitorId) {
    visitorId = uuid();
    localStorage.setItem('_rc_vid', visitorId);
  }
  
  // Session ID (survives page navigation, expires on tab close)
  let sessionId = sessionStorage.getItem('_rc_sid');
  if (!sessionId) {
    sessionId = uuid();
    sessionStorage.setItem('_rc_sid', sessionId);
  }
  
  // ── UTM parameters (persist for session) ──
  const params = new URLSearchParams(location.search);
  const utm = {
    source: params.get('utm_source') || sessionStorage.getItem('_rc_utm_s') || null,
    medium: params.get('utm_medium') || sessionStorage.getItem('_rc_utm_m') || null,
    campaign: params.get('utm_campaign') || sessionStorage.getItem('_rc_utm_c') || null,
    term: params.get('utm_term') || sessionStorage.getItem('_rc_utm_t') || null,
    content: params.get('utm_content') || sessionStorage.getItem('_rc_utm_co') || null
  };
  // Save UTMs for the session
  if (utm.source) sessionStorage.setItem('_rc_utm_s', utm.source);
  if (utm.medium) sessionStorage.setItem('_rc_utm_m', utm.medium);
  if (utm.campaign) sessionStorage.setItem('_rc_utm_c', utm.campaign);
  if (utm.term) sessionStorage.setItem('_rc_utm_t', utm.term);
  if (utm.content) sessionStorage.setItem('_rc_utm_co', utm.content);
  
  // ── Get logged-in user ID if available ──
  function getUserId() {
    try {
      const u = JSON.parse(localStorage.getItem('rc_user') || '{}');
      return u.id || null;
    } catch(e) { return null; }
  }
  
  // ── Event queue + batch sender ──
  let queue = [];
  let sendTimer = null;
  
  function enqueue(event) {
    event.session_id = sessionId;
    event.visitor_id = visitorId;
    event.user_id = getUserId();
    event.page_url = location.pathname + location.search;
    event.page_title = document.title;
    event.referrer = document.referrer || null;
    event.screen_width = screen.width;
    event.screen_height = screen.height;
    event.language = navigator.language;
    event.utm_source = utm.source;
    event.utm_medium = utm.medium;
    event.utm_campaign = utm.campaign;
    event.utm_term = utm.term;
    event.utm_content = utm.content;
    
    queue.push(event);
    
    // Batch send: wait 2s for more events, then flush
    if (sendTimer) clearTimeout(sendTimer);
    sendTimer = setTimeout(flush, 2000);
  }
  
  function flush() {
    if (queue.length === 0) return;
    const batch = queue.splice(0, 20);
    
    // Use sendBeacon for reliability (works even during page unload)
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/analytics/track', JSON.stringify(batch));
    } else {
      fetch('/api/analytics/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
        keepalive: true
      }).catch(function() {});
    }
  }
  
  // ── 1. PAGEVIEW — fires immediately on load ──
  enqueue({ event_type: 'pageview' });
  
  // ── 2. CLICK TRACKING — every click on the page ──
  document.addEventListener('click', function(e) {
    const el = e.target.closest('a, button, [onclick], input[type="submit"], .sa-nav-item, [role="button"]') || e.target;
    const tag = el.tagName || 'UNKNOWN';
    const id = el.id ? '#' + el.id : '';
    const cls = el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').slice(0, 3).join('.') : '';
    const text = (el.innerText || el.value || el.alt || el.title || '').substring(0, 100).trim();
    
    enqueue({
      event_type: 'click',
      click_element: tag + id + cls,
      click_text: text,
      click_x: Math.round(e.pageX),
      click_y: Math.round(e.pageY)
    });
  }, { passive: true, capture: true });
  
  // ── 3. SCROLL DEPTH — track max scroll ──
  let maxScroll = 0;
  let scrollTimer = null;
  function trackScroll() {
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const docHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    const winHeight = window.innerHeight;
    const pct = Math.round((scrollTop + winHeight) / docHeight * 100);
    if (pct > maxScroll) maxScroll = Math.min(pct, 100);
  }
  window.addEventListener('scroll', function() {
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(trackScroll, 200);
  }, { passive: true });
  
  // ── 4. TIME ON PAGE — send on unload ──
  const pageLoadTime = Date.now();
  
  function sendExitEvent() {
    const timeOnPage = Math.round((Date.now() - pageLoadTime) / 1000);
    // Quick sync send — use sendBeacon
    const exitEvent = [{
      event_type: 'page_exit',
      session_id: sessionId,
      visitor_id: visitorId,
      user_id: getUserId(),
      page_url: location.pathname + location.search,
      page_title: document.title,
      scroll_depth: maxScroll,
      time_on_page: timeOnPage,
      screen_width: screen.width,
      screen_height: screen.height,
      language: navigator.language
    }];
    
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/analytics/track', JSON.stringify(exitEvent));
    }
  }
  
  // Use multiple exit handlers for reliability
  window.addEventListener('pagehide', sendExitEvent);
  window.addEventListener('beforeunload', sendExitEvent);
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'hidden') sendExitEvent();
  });
  
  // Flush any remaining events before page close
  window.addEventListener('pagehide', flush);
  
})();

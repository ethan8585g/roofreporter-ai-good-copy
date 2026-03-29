// ============================================================
// RoofReporterAI — Ad Manager
//
// Handles display ads for non-subscribers on both:
//   - Web (Google AdSense — responsive display units)
//   - iOS app (Google AdMob — banner + interstitial via Capacitor)
//
// Usage:
//   window.RRAds.init(showAds)
//     Called after /api/customer/me resolves with show_ads flag.
//     Activates AdSense on web, AdMob on Capacitor iOS.
//
//   window.RRAds.showInterstitial()
//     Call before navigating to a report to show a full-screen ad.
//     No-ops silently if user is a subscriber or ad not ready.
//
// Setup checklist:
//   Web:  Set ADSENSE_PUBLISHER_ID wrangler secret → ca-pub-XXXXXXXXXXXXXXXXX
//   iOS:  Replace __RRA_ADMOB_APP_ID__ in Info.plist with real AdMob App ID
//         Replace __RRA_BANNER_AD_ID__ / __RRA_INTERSTITIAL_AD_ID__ below
//         Install: npm install @capacitor-community/admob
//         Then: npx cap sync ios
// ============================================================

(function () {
  'use strict';

  // ── AdMob unit IDs ────────────────────────────────────────
  // Replace these with your real AdMob ad unit IDs from:
  //   https://apps.admob.com → Apps → Ad units
  //
  // Google test IDs (safe to use during development/review):
  var ADMOB_BANNER_ID       = 'ca-app-pub-3940256099942544/2934735716'; // iOS test banner
  var ADMOB_INTERSTITIAL_ID = 'ca-app-pub-3940256099942544/4411468910'; // iOS test interstitial
  //
  // Once approved by AdMob, swap test IDs above for your real unit IDs:
  //   ADMOB_BANNER_ID       = 'ca-app-pub-XXXXXXXXXXXXXXXXX/XXXXXXXXXX';
  //   ADMOB_INTERSTITIAL_ID = 'ca-app-pub-XXXXXXXXXXXXXXXXX/XXXXXXXXXX';

  // ── State ─────────────────────────────────────────────────
  var showAds = false;
  var publisherId = '';
  var isCapacitor = !!(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AdMob);
  var interstitialReady = false;
  var interstitialShownThisSession = false;

  // ── Public API ────────────────────────────────────────────
  window.RRAds = {

    // Call once after /api/customer/me resolves.
    // publisherIdOverride is optional — falls back to window.__rraPublisherId.
    init: function (shouldShowAds, publisherIdOverride) {
      showAds = !!shouldShowAds;
      publisherId = publisherIdOverride || window.__rraPublisherId || '';

      if (!showAds) {
        hideAllContainers();
        return;
      }

      if (isCapacitor) {
        initAdMob();
      } else {
        initAdSense();
      }
    },

    // Show an AdMob interstitial ad (iOS only).
    // Safe to call on web — no-ops silently.
    // Only fires once per session to avoid user fatigue.
    showInterstitial: function () {
      if (!showAds || !isCapacitor || interstitialShownThisSession) return;
      if (!window.Capacitor || !window.Capacitor.Plugins.AdMob) return;

      var AdMob = window.Capacitor.Plugins.AdMob;
      if (interstitialReady) {
        AdMob.showInterstitial().then(function () {
          interstitialShownThisSession = true;
          interstitialReady = false;
          prepareNextInterstitial();
        }).catch(function () {});
      }
    },

    // Remove the AdMob banner (e.g. on logout or subscription upgrade).
    removeBanner: function () {
      if (!isCapacitor || !window.Capacitor || !window.Capacitor.Plugins.AdMob) return;
      window.Capacitor.Plugins.AdMob.removeBanner().catch(function () {});
    },
  };

  // ── Helpers ───────────────────────────────────────────────

  function hideAllContainers() {
    document.querySelectorAll('.rra-ad-container').forEach(function (el) {
      el.style.display = 'none';
    });
  }

  // ── Web: Google AdSense ───────────────────────────────────

  function initAdSense() {
    if (!publisherId) {
      // AdSense not configured yet — hide placeholders silently
      hideAllContainers();
      return;
    }

    // Inject the AdSense script once
    if (!document.querySelector('script[data-rra-adsense]')) {
      var script = document.createElement('script');
      script.async = true;
      script.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + publisherId;
      script.crossOrigin = 'anonymous';
      script.setAttribute('data-rra-adsense', '1');
      document.head.appendChild(script);
    }

    // Activate each ad container once the script has loaded
    script_ready(function () {
      document.querySelectorAll('.rra-ad-container').forEach(function (container) {
        activateAdContainer(container);
      });
    });
  }

  function activateAdContainer(container) {
    if (container.dataset.rraActivated) return;
    container.dataset.rraActivated = '1';
    container.style.display = '';

    var slot   = container.dataset.adSlot   || '';
    var format = container.dataset.adFormat || 'auto';

    var ins = document.createElement('ins');
    ins.className              = 'adsbygoogle';
    ins.style.display          = 'block';
    ins.dataset.adClient       = publisherId;
    ins.dataset.adSlot         = slot;
    ins.dataset.adFormat       = format;
    ins.dataset.fullWidthResponsive = 'true';
    container.appendChild(ins);

    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch (e) { /* AdSense not yet loaded, will push when ready */ }
  }

  // Run fn immediately if adsbygoogle already available, else defer
  function script_ready(fn) {
    if (window.adsbygoogle !== undefined) { fn(); return; }
    var attempts = 0;
    var t = setInterval(function () {
      attempts++;
      if (window.adsbygoogle !== undefined || attempts > 30) {
        clearInterval(t);
        fn();
      }
    }, 200);
  }

  // ── iOS: Google AdMob via Capacitor ──────────────────────

  function initAdMob() {
    if (!window.Capacitor || !window.Capacitor.Plugins.AdMob) return;
    var AdMob = window.Capacitor.Plugins.AdMob;

    AdMob.initialize({
      requestTrackingAuthorization: true,  // Shows iOS ATT prompt
      testingDevices: [],
      initializeForTesting: false,
    }).then(function () {
      showBanner();
      prepareNextInterstitial();
    }).catch(function (e) {
      console.warn('[RRAds] AdMob init failed:', e);
    });
  }

  function showBanner() {
    if (!window.Capacitor || !window.Capacitor.Plugins.AdMob) return;
    window.Capacitor.Plugins.AdMob.showBanner({
      adId:     ADMOB_BANNER_ID,
      adSize:   'BANNER',          // 320x50 standard banner
      position: 'BOTTOM_CENTER',
      margin:   0,
      isTesting: false,
    }).catch(function (e) {
      console.warn('[RRAds] Banner show failed:', e);
    });
  }

  function prepareNextInterstitial() {
    if (!window.Capacitor || !window.Capacitor.Plugins.AdMob) return;
    window.Capacitor.Plugins.AdMob.prepareInterstitial({
      adId:     ADMOB_INTERSTITIAL_ID,
      isTesting: false,
    }).then(function () {
      interstitialReady = true;
    }).catch(function () {
      interstitialReady = false;
    });
  }

})();

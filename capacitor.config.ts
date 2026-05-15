import type { CapacitorConfig } from '@capacitor/cli'

// Roof Manager — iOS / Android hybrid shell (Path B).
//
// Bundled webDir (`mobile-shell/`) contains a tiny vanilla-JS SPA:
//   splash → Sign in (email/Apple/Google) → module launcher (Customer/Admin/Super-Admin).
// Once authed, each module tile navigates the in-app WebView to the matching
// route on www.roofmanager.ca; cookies persist, so the shell + modules feel
// like one continuous app. Native bridges (camera, GPS, push) are exposed to
// every page via a shared `window.RoofNative` API.
//
// IMPORTANT: do NOT set `server.url` here — that turns the app into a pure
// WebView wrapper of the website and is the #1 cause of Apple Guideline 4.2
// rejections. The shell is bundled locally; external nav is allowlisted below.

const config: CapacitorConfig = {
  appId: 'ca.roofmanager.app',
  appName: 'Roof Manager',
  webDir: 'mobile-shell',
  server: {
    androidScheme: 'https',
    iosScheme: 'https',
    cleartext: false,
    // Allow the shell to navigate the WebView to the live site once the
    // user has authenticated. Each entry is a wildcard pattern, NOT a URL.
    allowNavigation: [
      'www.roofmanager.ca',
      '*.roofmanager.ca',
      'roofmanager.ca',
      'accounts.google.com',
      '*.googleusercontent.com',
      'appleid.apple.com',
    ],
  },
  ios: {
    contentInset: 'always',
    // We handle our own splash inside mobile-shell/index.html, so the
    // native splash just shows the brand background for ~600ms.
    backgroundColor: '#0A0A0A',
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#0A0A0A',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      backgroundColor: '#0A0A0A',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
      iosSpinnerStyle: 'small',
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0A0A0A',
      overlaysWebView: false,
    },
    // AdMob temporarily removed — @capacitor-community/admob v6.2 fails to
    // compile on Xcode 26 / Swift 6, and v7+ requires Capacitor 7 (the rest
    // of the plugin set is on Capacitor 6). To re-add after the user
    // registers a production AdMob app ID:
    //   1. npm install @capacitor-community/admob@6.2.0 (or upgrade the
    //      whole Capacitor stack to 7+).
    //   2. Restore this block with the real appId (NOT the test one).
    //   3. Add GADApplicationIdentifier with the real value to
    //      ios/App/App/Info.plist.
    //   4. npx cap sync ios && rebuild.
  },
}

export default config

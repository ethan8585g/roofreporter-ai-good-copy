import type { CapacitorConfig } from '@capacitor/cli'

// Storm Scout / Roof Manager — mobile wrapper.
// The app is a thin shell around the production web app; auth + routes
// live on the server. For offline-first work later, swap `server.url`
// for a bundled build and sync via a service worker.
const config: CapacitorConfig = {
  appId: 'ca.roofmanager.app',
  appName: 'Roof Manager',
  webDir: 'dist',
  server: {
    // Load the live site so all routes + auth come from production.
    url: 'https://www.roofmanager.ca',
    cleartext: false
  },
  ios: {
    contentInset: 'always'
  },
  android: {
    allowMixedContent: false
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert']
    },
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#0b0b0b',
      androidScaleType: 'CENTER_CROP'
    }
  }
}

export default config

// ============================================================
// Capacitor Native Push Notifications (iOS / Android)
// ============================================================
// Handles push notification registration for native apps built with Capacitor.
// Uses @capacitor/push-notifications plugin to register with APNs (iOS) / FCM (Android)
// and sends the device token to the Roof Manager API.
//
// This script auto-detects if running inside a Capacitor native app.
// If running in a browser, it does nothing (use push-subscribe.js instead).
// ============================================================

const RoofNativePush = {
  _registered: false,

  // Check if running inside Capacitor native app
  isNative() {
    return window.Capacitor && window.Capacitor.isNativePlatform();
  },

  // Get platform (ios or android)
  getPlatform() {
    return window.Capacitor?.getPlatform() || 'web';
  },

  // Get auth token
  _getAuthToken() {
    return localStorage.getItem('rc_token') ||
           localStorage.getItem('admin_token') ||
           localStorage.getItem('auth_token') ||
           localStorage.getItem('customer_token') || '';
  },

  // Initialize push notifications for native app
  async init() {
    if (!this.isNative()) return;
    if (this._registered) return;

    const { PushNotifications } = window.Capacitor.Plugins;
    if (!PushNotifications) {
      console.warn('[NativePush] PushNotifications plugin not available');
      return;
    }

    // Request permission
    const permResult = await PushNotifications.requestPermissions();
    if (permResult.receive !== 'granted') {
      console.warn('[NativePush] Permission not granted:', permResult.receive);
      return;
    }

    // Listen for registration success — receive device token
    PushNotifications.addListener('registration', async (token) => {
      console.log('[NativePush] Registered with token:', token.value);

      // Send token to server
      const authToken = this._getAuthToken();
      try {
        const resp = await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': authToken ? `Bearer ${authToken}` : ''
          },
          body: JSON.stringify({
            platform: this.getPlatform(),
            fcm_token: token.value,
            device_name: this.getPlatform() === 'ios' ? 'iPhone/iPad' : 'Android'
          })
        });

        if (resp.ok) {
          localStorage.setItem('push_native_registered', '1');
          console.log('[NativePush] Token registered with server');
        } else {
          const err = await resp.json();
          console.error('[NativePush] Server registration failed:', err);
        }
      } catch (err) {
        console.error('[NativePush] Failed to send token:', err);
      }
    });

    // Listen for registration errors
    PushNotifications.addListener('registrationError', (error) => {
      console.error('[NativePush] Registration failed:', error);
    });

    // Handle notification received while app is in foreground
    PushNotifications.addListener('pushNotificationReceived', (notification) => {
      console.log('[NativePush] Foreground notification:', notification);
      // Optionally update the in-app notification badge count
      if (typeof window.refreshNotifications === 'function') {
        window.refreshNotifications();
      }
    });

    // Handle notification tap (app was in background or closed)
    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      console.log('[NativePush] Notification tapped:', action);
      const link = action.notification?.data?.link;
      if (link) {
        // Navigate to the relevant page
        window.location.href = link;
      }
    });

    // Register with APNs/FCM
    await PushNotifications.register();
    this._registered = true;
    console.log('[NativePush] Registration initiated');
  },

  // Unregister from push notifications
  async unregister() {
    if (!this.isNative()) return;

    const { PushNotifications } = window.Capacitor.Plugins;
    if (!PushNotifications) return;

    try {
      await PushNotifications.removeAllListeners();
      localStorage.removeItem('push_native_registered');
      this._registered = false;
      console.log('[NativePush] Unregistered');
    } catch (err) {
      console.error('[NativePush] Unregister failed:', err);
    }
  }
};

// Auto-initialize when running in native app
if (typeof window !== 'undefined') {
  window.RoofNativePush = RoofNativePush;

  // Auto-init after DOM is ready and user is authenticated
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (RoofNativePush.isNative() && RoofNativePush._getAuthToken()) {
        RoofNativePush.init();
      }
    });
  } else {
    if (RoofNativePush.isNative() && RoofNativePush._getAuthToken()) {
      RoofNativePush.init();
    }
  }
}

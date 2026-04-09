// ============================================================
// Web Push Subscription Manager
// ============================================================
// Handles browser-side Web Push subscription flow:
// 1. Feature detection (serviceWorker + PushManager)
// 2. Request notification permission
// 3. Fetch VAPID public key from server
// 4. Subscribe via PushManager
// 5. Send subscription to server
//
// Include this script on authenticated pages (admin dashboard, customer portal).
// Requires: service worker registered, auth token available.
// ============================================================

const RoofPush = {
  // Check if browser supports push notifications
  isSupported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  },

  // Check current permission state
  getPermissionState() {
    if (!this.isSupported()) return 'unsupported';
    return Notification.permission; // 'granted', 'denied', 'default'
  },

  // Check if already subscribed
  async isSubscribed() {
    if (!this.isSupported()) return false;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      return !!sub;
    } catch {
      return false;
    }
  },

  // Get auth token from page (looks for common token storage patterns)
  _getAuthToken() {
    return localStorage.getItem('rc_token') ||
           localStorage.getItem('admin_token') ||
           localStorage.getItem('auth_token') ||
           localStorage.getItem('customer_token') || '';
  },

  // Convert base64url string to Uint8Array (for applicationServerKey)
  _urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  },

  // Subscribe to push notifications
  async subscribe() {
    if (!this.isSupported()) {
      console.warn('[Push] Browser does not support push notifications');
      return { success: false, error: 'unsupported' };
    }

    // Request permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.warn('[Push] Notification permission denied');
      return { success: false, error: 'permission_denied' };
    }

    try {
      // Fetch VAPID public key from server
      const keyResp = await fetch('/api/push/vapid-key');
      if (!keyResp.ok) {
        return { success: false, error: 'vapid_key_unavailable' };
      }
      const { publicKey } = await keyResp.json();
      if (!publicKey) {
        return { success: false, error: 'vapid_key_missing' };
      }

      // Get service worker registration
      const registration = await navigator.serviceWorker.ready;

      // Subscribe to push
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: this._urlBase64ToUint8Array(publicKey)
      });

      // Send subscription to server
      const token = this._getAuthToken();
      const resp = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({
          platform: 'web',
          subscription: subscription.toJSON(),
          device_name: navigator.userAgent.includes('Mac') ? 'MacBook' :
                       navigator.userAgent.includes('iPhone') ? 'iPhone' :
                       navigator.userAgent.includes('iPad') ? 'iPad' : 'Browser'
        })
      });

      if (!resp.ok) {
        const err = await resp.json();
        return { success: false, error: err.error || 'subscribe_failed' };
      }

      localStorage.setItem('push_subscribed', '1');
      console.log('[Push] Successfully subscribed to push notifications');
      return { success: true };

    } catch (err) {
      console.error('[Push] Subscription failed:', err);
      return { success: false, error: err.message };
    }
  },

  // Unsubscribe from push notifications
  async unsubscribe() {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        // Tell server
        const token = this._getAuthToken();
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': token ? `Bearer ${token}` : ''
          },
          body: JSON.stringify({ endpoint: subscription.endpoint })
        });

        // Unsubscribe locally
        await subscription.unsubscribe();
      }

      localStorage.removeItem('push_subscribed');
      console.log('[Push] Unsubscribed from push notifications');
      return { success: true };
    } catch (err) {
      console.error('[Push] Unsubscribe failed:', err);
      return { success: false, error: err.message };
    }
  },

  // Auto-prompt for push subscription (call after user logs in)
  // Only prompts once — respects user's previous decision
  async autoPrompt() {
    if (!this.isSupported()) return;
    if (Notification.permission === 'denied') return;
    if (localStorage.getItem('push_subscribed') === '1') return;
    if (localStorage.getItem('push_dismissed') === '1') return;

    // Check if already subscribed server-side but not tracked locally
    if (await this.isSubscribed()) {
      localStorage.setItem('push_subscribed', '1');
      return;
    }

    // Show a non-intrusive prompt
    this._showPromptBanner();
  },

  // Show a banner asking user to enable notifications
  _showPromptBanner() {
    // Don't show if one already exists
    if (document.getElementById('push-prompt-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'push-prompt-banner';
    banner.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:10000;background:#1a1a2e;border:1px solid rgba(0,255,136,0.3);border-radius:12px;padding:16px 20px;max-width:360px;box-shadow:0 8px 32px rgba(0,0,0,0.4);font-family:-apple-system,BlinkMacSystemFont,sans-serif;animation:slideUp 0.3s ease-out';
    banner.innerHTML = `
      <style>@keyframes slideUp{from{transform:translateY(100px);opacity:0}to{transform:translateY(0);opacity:1}}</style>
      <div style="display:flex;align-items:flex-start;gap:12px">
        <div style="font-size:24px;line-height:1">🔔</div>
        <div style="flex:1">
          <div style="color:#fff;font-weight:600;font-size:14px;margin-bottom:4px">Enable Push Notifications</div>
          <div style="color:#aaa;font-size:12px;line-height:1.4">Get instant alerts for new leads, payments, proposals, and more — even when the app is closed.</div>
          <div style="display:flex;gap:8px;margin-top:12px">
            <button id="push-prompt-enable" style="background:#00FF88;color:#000;border:none;border-radius:6px;padding:6px 16px;font-size:12px;font-weight:600;cursor:pointer">Enable</button>
            <button id="push-prompt-later" style="background:transparent;color:#888;border:1px solid #333;border-radius:6px;padding:6px 12px;font-size:12px;cursor:pointer">Later</button>
          </div>
        </div>
        <button id="push-prompt-close" style="background:none;border:none;color:#666;cursor:pointer;font-size:18px;line-height:1;padding:0">&times;</button>
      </div>
    `;
    document.body.appendChild(banner);

    document.getElementById('push-prompt-enable').addEventListener('click', async () => {
      banner.remove();
      const result = await RoofPush.subscribe();
      if (!result.success) console.warn('[Push] Enable failed:', result.error);
    });

    document.getElementById('push-prompt-later').addEventListener('click', () => {
      banner.remove();
      localStorage.setItem('push_dismissed', '1');
    });

    document.getElementById('push-prompt-close').addEventListener('click', () => {
      banner.remove();
      localStorage.setItem('push_dismissed', '1');
    });
  }
};

// Export for use in other scripts
if (typeof window !== 'undefined') window.RoofPush = RoofPush;

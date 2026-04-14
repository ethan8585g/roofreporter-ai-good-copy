# Capacitor Mobile Build — Roof Manager / Storm Scout

The web app code is ready; what's left is native tooling that can't run inside a Cloudflare Worker or a CLI agent.

## One-time setup

1. Install the Capacitor deps (added to `package.json`):
   ```bash
   npm install
   npx cap add ios
   npx cap add android
   ```
2. Each `cap add` creates an `ios/` or `android/` folder. Commit them if you want native changes version-controlled.

## Push notification keys

### Web Push (browsers + PWA)
Set these two Pages secrets in Cloudflare (Production + Preview):

- `VAPID_PUBLIC_KEY` — the base64url public key generated at `/tmp/vapid_keys.txt`
- `VAPID_PRIVATE_KEY` — matching private key
- `VAPID_SUBJECT` — `mailto:ops@roofmanager.ca` (or any contactable mailto)

After these are set, `POST /api/push/test` (auth'd) will fire a test push to every registered device. `POST /api/storm-scout/ingest` will send territory digests over push for any area with `notify_push=1`.

### APNs (iOS native)
1. Apple Developer → Identifiers → `ca.roofmanager.app` → enable "Push Notifications".
2. Keys → create an APNs Auth Key (.p8). Note Key ID + Team ID.
3. Firebase console → Project settings → Cloud Messaging → Apple app → upload the .p8 + Key ID + Team ID. (Capacitor PushNotifications uses FCM as the transport on iOS.)

### FCM (Android native)
1. Firebase console → Add Android app, package `ca.roofmanager.app`.
2. Download `google-services.json` → drop into `android/app/google-services.json`.
3. Add the Google Services gradle plugin per Firebase docs.

## Build + sign + ship

```bash
# Pull latest web build into native shells
npx cap sync

# iOS — opens Xcode
npx cap open ios
# Select Team for signing, build to device/simulator, archive, submit to App Store Connect.

# Android
npx cap open android
# Build → Generate Signed Bundle/APK → submit to Play Console.
```

## Making push work end-to-end in native

The web service-worker + VAPID path handles Chrome/Firefox/Edge/Safari. On iOS/Android wrappers, Capacitor's `PushNotifications` plugin gets a device token from FCM. Those tokens need a different send path (FCM HTTP v1 API) — not implemented yet. When you get to that:

1. Add a second table (or extra column) for `fcm_token`.
2. Add a send helper analogous to `sendWebPush` that POSTs to FCM's `/messages:send` endpoint with a service-account JWT.
3. Extend the ingester to fan out to both web-push subscriptions and FCM tokens.

Keep the web-push pipeline as the fallback — it works inside Capacitor on iOS 16.4+ PWAs without any of the native plumbing.

## Deep linking

The service worker opens `/customer/storm-scout` on notification click. To make native notifications open that route too, wire `@capacitor/app`'s `appUrlOpen` listener in a small `public/static/capacitor-boot.js` (not shipped yet — add when you start building natively).

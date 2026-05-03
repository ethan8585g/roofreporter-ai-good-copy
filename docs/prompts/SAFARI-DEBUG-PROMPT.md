# Safari Rendering / "Won't Load" — Deep Debug Prompt for Claude Code

**Paste everything below this line into your Claude Code terminal.**

---

## Context

`www.roofmanager.ca` loads fine in Chrome/Edge but fails in Safari (desktop macOS Safari and mobile iOS Safari). Symptoms reported: blank page, half‑rendered page, missing styles/icons, or dead click handlers on the landing page.

I did a static analysis of this repo and found a compact set of root causes that together produce exactly those Safari symptoms. The Cloudflare Pages + Hono (`src/index.tsx`) SSR layer emits HTML that Chrome's lenient parser "fixes up" but WebKit's stricter HTML5 parser does not. Fix these in order; each one is independently shippable.

---

## Root Cause #1 (most likely) — Invalid `<div>` inside `<head>` forces Safari to close the head early

**File:** `src/index.tsx`
**Function:** `getHeadTags()` (starts around line 3824)
**Offending lines:** ~3851 and ~3852

```html
<!-- Inside getHeadTags(), i.e. still inside <head> -->
<div id="gt-wrapper"><button id="gt-toggle" ...></button><div id="gt-panel">...</div></div>
<script>
  function googleTranslateElementInit(){ ... }
  document.getElementById('gt-toggle').onclick = function(){ ... };
  document.getElementById('gt-close').onclick = function(){ ... };
</script>
```

**Why this breaks Safari specifically.** Per the HTML5 spec, when the parser is in the "in head" insertion mode and encounters a `<div>` start tag, it must (a) act as if an `</head>` end tag was seen, (b) switch to "in body" mode, and (c) reprocess the `<div>`. Chromium and Firefox handle this quietly, but WebKit/Safari's parser more aggressively reparents every following `<style>`, `<link>`, and `<script>` into `<body>`, which changes the *execution order* of inline scripts. The subsequent inline script tries `document.getElementById('gt-toggle').onclick = ...`. In WebKit, if the element got reparented onto a partially-constructed body before the script ran, `getElementById` returns `null`, the script throws `TypeError: null is not an object`, and every inline script after it (theme init, service‑worker registration, rrTrack) never executes — producing a blank/broken landing page.

**Fix:**
1. Move `<div id="gt-wrapper">…</div>` out of `getHeadTags()` and render it inside `<body>` instead (either at the start of each page template, or add a `getBodyPreamble()` helper that each template inserts).
2. Guard the inline script so it can't throw:
   ```js
   var toggle = document.getElementById('gt-toggle');
   if (toggle) toggle.onclick = function(){ /* ... */ };
   var close = document.getElementById('gt-close');
   if (close) close.onclick = function(){ /* ... */ };
   ```
3. Better still, wrap the whole thing in `document.addEventListener('DOMContentLoaded', function(){ ... })` so it runs once the DOM is parsed, and move the widget markup to body.

## Root Cause #2 — `rrTrack(...)` is called in onclick handlers before `/static/tracker.js` loads

**File:** `src/index.tsx`
**Injection middleware:** lines ~106–288 (injects `<script src="/static/tracker.js" defer>` at the end of `<body>`)
**Handlers that call it:** every landing‑page anchor with `onclick="rrTrack('cta_click', {...})"`, e.g. lines 6102, 6143, 6145, 6151, 6154, 6180, 6181, 6219, 6246, 6247, 6248, 6367, 6456, 6496, 6523, 6551, 6589, and ~35 more.

**Why this breaks Safari.** `tracker.js` is loaded with `defer`, so it only defines `window.rrTrack` after the HTML parser is done. If a Safari user taps a CTA immediately on first paint, Safari evaluates `rrTrack('cta_click', …)`, which throws `ReferenceError: Can't find variable: rrTrack`. WebKit treats onclick handlers as `return` expressions; when the handler throws, the default action (navigation) is still supposed to proceed — but in practice iOS Safari has a long‑standing behavior where an exception inside an inline `onclick` prevents the subsequent anchor navigation for the first tap, so users report "the button does nothing, I have to tap twice."

**Fix (pick one):**
- **Cheapest:** define a global no‑op shim in the head before any CTAs render:
  ```html
  <script>window.rrTrack = window.rrTrack || function(){};</script>
  ```
  Put it inside `getHeadTags()` — right after the theme init and before closing `</head>`. The real `tracker.js` can overwrite `window.rrTrack` when it loads.
- **Cleaner:** remove the `defer` from tracker.js and load it *synchronously* in head (small cost to LCP, big win to reliability), or inline the tracker definition directly into the injection middleware at the top of `<body>`.

## Root Cause #3 — `backdrop-filter: blur(...)` missing `-webkit-` prefix

**File:** `src/index.tsx` lines 6009, 7061, 7108, 7174, 8671, 10449, 11013 and `src/routes/field.ts` line 250.

Every rule uses only `backdrop-filter`. Safari ≤ 17 (including many iPhones and iPads in the wild as of April 2026) still requires `-webkit-backdrop-filter`. Without the prefix the filter is silently ignored, which makes several overlays — exit‑intent modal, asset report modal, mobile sticky CTA, sticky nav — look washed‑out or invisible against the dark transparent background.

**Fix:** add the webkit prefix *before* the standard property everywhere:
```css
-webkit-backdrop-filter: blur(20px);
backdrop-filter: blur(20px);
```
A project‑wide find/replace on `backdrop-filter:` is safe here.

## Root Cause #4 — Service Worker pinning Safari on the broken build

**File:** `public/sw.js` and `src/index.tsx` line 3962: `<script>if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js')}</script>`

The SW name is `roofmanager-v2` and it precaches `/` plus static assets. Because the SW uses `skipWaiting()` + `clients.claim()`, users who loaded the broken HTML once have a stale (broken) `/` cached. On next visit Safari serves the cached broken page from the SW before the network version arrives (network‑first, but falls back to cache on any error, including iOS Safari's aggressive tab‑suspend behavior which sometimes aborts the fetch).

Separately, the inline registration has **no `.catch()`**, which in Safari Private Browsing produces an unhandled promise rejection that pollutes the console — not fatal, but noisy.

**Fix:**
1. Bump the cache name to `roofmanager-v3` so every user force‑purges the stale cache on next visit.
2. Exclude `/` and the landing page HTML from SW caching, or change the fetch handler to *never* serve cached HTML for the root path:
   ```js
   if (request.mode === 'navigate' || url.pathname === '/') {
     event.respondWith(fetch(request));
     return;
   }
   ```
3. Add error handling and an explicit scope to the registration:
   ```html
   <script>
   if ('serviceWorker' in navigator) {
     window.addEventListener('load', function(){
       navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function(){});
     });
   }
   </script>
   ```

## Root Cause #5 — Unguarded `localStorage` calls break iOS Safari Private Browsing

**File:** `src/index.tsx`
**Line 691** (magic‑link handler response HTML):
```js
localStorage.setItem('rc_customer_token', '${sessionToken}');
window.location.href = '${redirectUrl}';
```
In iOS Safari Private mode, `localStorage.setItem` throws `QuotaExceededError`. Because the call is not in a `try/catch`, the script halts and the redirect never fires — so the user sees a blank "Signing you in…" page forever.

Same pattern shows up in several other inline scripts — any client code that reads/writes `localStorage` or `sessionStorage` without a try/catch is a Safari Private Browsing crash site.

**Fix:** always wrap storage access:
```js
try { localStorage.setItem('rc_customer_token', '${sessionToken}'); } catch(e) {}
window.location.href = '${redirectUrl}';
```
Grep for `localStorage.` and `sessionStorage.` across `src/` and wrap every unguarded call.

## Root Cause #6 — Font Awesome lazy‑CSS pattern is flaky on older Safari

**File:** `src/index.tsx` line 3844
```html
<link rel="stylesheet" href="https://cdnjs.../font-awesome/6.4.0/css/all.min.css" media="print" onload="this.media='all'">
```
On some iOS Safari versions, the `onload` never fires for media="print" stylesheets, so Font Awesome never switches to `media="all"` — every `<i class="fas fa-...">` in the nav, mobile menu, and hero renders as invisible placeholder squares. Not a "won't load" issue but it is very likely part of the "looks broken on Safari" report.

**Fix:** use the correct pattern with a fallback:
```html
<link rel="preload" href="https://cdnjs.../all.min.css" as="style" onload="this.onload=null;this.rel='stylesheet'">
<noscript><link rel="stylesheet" href="https://cdnjs.../all.min.css"></noscript>
```

## Root Cause #7 (minor) — `<meta name="apple-mobile-web-app-capable">` is deprecated

**File:** `src/index.tsx` line 3839 — `apple-mobile-web-app-capable` is deprecated in iOS 17+. Replace with `<meta name="mobile-web-app-capable" content="yes">` (which you already have on line 3842, so you can just delete line 3839). Not a load blocker; just keeps the console clean.

---

## Task for Claude Code

Please do all of the following and commit as a single PR titled `fix(landing): Safari rendering & interaction bugs`:

1. **Move the Google Translate widget out of `<head>`.** In `src/index.tsx`, remove the `<div id="gt-wrapper">…</div>` element and its immediately following inline `<script>` from `getHeadTags()`. Create a new helper `getTranslateWidgetHTML()` that returns the same markup, and insert it at the top of `<body>` in every template that currently uses `getHeadTags()` (at minimum: `getLandingPageHTML`, `getSocialLandingHTML`, `getCustomerRegisterPageHTML`, `getMainPageHTML`, `getSettingsPageHTML`, `getLoginPageHTML`, `getSampleReportHTML`, `getDispatchBoardHTML`, `getCrewTodayHTML`, `getOnboardingPageHTML`, `getReferralLandingHTML`, `getOrderConfirmationHTML`, and any other landing/marketing templates). Wrap the click handlers in null checks.

2. **Add an `rrTrack` shim in `getHeadTags()`** so inline `onclick="rrTrack(...)"` never throws before `/static/tracker.js` loads:
   ```html
   <script>window.rrTrack = window.rrTrack || function(){};</script>
   ```
   Place it immediately after the theme‑init script (~line 3961) and before the service‑worker registration.

3. **Add `-webkit-backdrop-filter` everywhere.** Update every occurrence of `backdrop-filter: blur(...)` in `src/index.tsx` and `src/routes/field.ts` and `src/templates/certificate.ts` to also include `-webkit-backdrop-filter: blur(...)` directly above it. Run `grep -rn "backdrop-filter" src/` after the change to confirm every match has both properties.

4. **Harden `public/sw.js`:**
   - Bump `CACHE_NAME` from `roofmanager-v2` to `roofmanager-v3`.
   - In the `fetch` handler, short‑circuit root/navigation requests before the network‑first branch:
     ```js
     if (request.mode === 'navigate' || url.pathname === '/') {
       event.respondWith(fetch(request));
       return;
     }
     ```
   - Update the SW registration in `src/index.tsx` (line ~3962) to:
     ```html
     <script>
     if ('serviceWorker' in navigator) {
       window.addEventListener('load', function(){
         navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function(){});
       });
     }
     </script>
     ```

5. **Wrap every `localStorage.*` / `sessionStorage.*` call in try/catch.** Run `grep -n "localStorage\.\|sessionStorage\." src/index.tsx src/services/analytics-events.ts` and for every unguarded read/write, wrap it. Focus especially on the magic‑link handler HTML response at line ~691.

6. **Replace the Font Awesome lazy‑load** at line ~3844 with the preload pattern shown above.

7. **Delete the deprecated `<meta name="apple-mobile-web-app-capable">`** at line ~3839.

## Verification checklist

After the fixes, verify by:
- [ ] `npm run build` succeeds.
- [ ] `npm run dev:sandbox` — open `http://0.0.0.0:3000/` in Safari Technology Preview, confirm the landing page renders end‑to‑end, the nav dropdown works, and CTA buttons navigate on first tap.
- [ ] `curl -s http://0.0.0.0:3000/ | head -120` — confirm `<head>` contains no `<div>` elements (the only children should be `<meta>`, `<link>`, `<script>`, `<style>`, `<title>`, `<noscript>`).
- [ ] `curl -s http://0.0.0.0:3000/ | grep -n "rrTrack"` — confirm the shim line is present in the head.
- [ ] In iOS Safari (or a BrowserStack iPhone), load `/`, `/register`, `/pricing`, `/blog`, and `/customer/login` — no blank pages, no missing icons, no dead taps.
- [ ] In iOS Safari Private Browsing, click a magic‑link URL — should redirect to `/onboarding` or `/customer/dashboard` without hanging on "Signing you in…".
- [ ] Open Web Inspector → Console on Safari against `/` — zero red errors, zero unhandled promise rejections.
- [ ] After deploy: in Safari, DevTools → Storage → Service Workers, confirm the active worker name is `roofmanager-v3`.

## Nice‑to‑haves if time permits

- Replace the four separate `<script type="application/ld+json">` blocks with one `@graph` array — slightly smaller payload and cleaner for SEO.
- Move all inline `onclick="rrTrack(...)"` to delegated event listeners in `tracker.js`. Inline handlers are a long‑term Safari fragility.
- Add a Safari‑only smoke test to `vitest` using `happy-dom` or a browser runner to catch invalid‑HTML regressions in `getHeadTags()`.

---

**TL;DR for a human:** the landing page has a `<div>` inside `<head>` plus an inline script that assumes it can find that div. Chrome silently fixes it up; Safari's stricter parser aborts the whole inline‑script chain, leaving the page blank. A handful of other Safari‑only papercuts (missing `-webkit-backdrop-filter`, Font Awesome lazy‑load, bare `localStorage` in private mode, stale service worker cache) explain every remaining "it looks broken on my iPhone" report.

# Safari "Site Down" — Permanent Root-Cause Fix + CI Guardrails

**Paste everything below this line into Claude Code (claude.ai/code) in the repo root `/roofreporter-ai-good-copy`.**

---

## Why you are being called in again

`www.roofmanager.ca` is failing in Safari *again* with the same symptoms as yesterday (error page / blank page / "Safari can't open the page"). Yesterday's fix was shipped from `SAFARI-DEBUG-PROMPT.md` and is still in the tree (I verified: `getHeadTags()` no longer contains `<div id="gt-wrapper">`, the `rrTrack` shim is at line ~3936, `public/sw.js` is on `roofmanager-v3` and bypasses navigation). So this is a **regression**, not a missing fix — something merged between that fix and now has re-broken Safari.

Your job is not to re-apply yesterday's patch. Your job is to (1) diagnose which *new* change regressed Safari, (2) fix it, and (3) **make it impossible for any future commit to reintroduce this class of bug** — because the pattern has now recurred twice in 48 hours and every recurrence costs real customer trust.

This prompt therefore has three phases: **Diagnose → Fix → Lock it in**. Do all three; do not stop after phase 2.

---

## Phase 1 — Diagnose (do not skip; the answer is probably in here)

Run these checks in order and write findings to `DEBUG-SAFARI-RECURRENCE.md` as you go, one section per check. Do not start editing code until phase 1 is complete — you need the evidence trail.

### 1.1 Confirm the site is actually deploying
- `wrangler pages deployment list --project-name=roofmanager` (or whatever project name is in `wrangler.jsonc`). If the latest deploy is **failed** or **cancelled**, that's the whole bug — Cloudflare is serving the previous broken build. Check the deploy logs.
- `curl -sI https://www.roofmanager.ca/` — confirm HTTP status, `content-type`, `cf-ray`, and that `content-length` is non-trivial (> 50 KB for the landing page). A 200 with a 0-byte body is a classic Pages deploy-succeeded-but-asset-missing symptom.
- `curl -s https://www.roofmanager.ca/ | wc -c` and `curl -s https://www.roofmanager.ca/ | head -200` — does the HTML actually contain `<title>Roof Manager</title>` and the landing hero? If not, the Worker is throwing at render time and returning an error page.

### 1.2 Diff every commit since the last known-good Safari fix
```bash
git log --oneline be6c1e1..HEAD -- src/index.tsx src/middleware src/routes public/sw.js public/static
```
`be6c1e1` was the "remove Meta Pixel Advanced Matching code that may have caused Safari load issues" commit, which is the last commit explicitly about Safari. Walk each commit's diff and flag anything that:
- Adds HTML to `getHeadTags()` or the HTML-injection middleware (`src/index.tsx` ~lines 106-305).
- Adds `<script>`, `<style>`, `<link>`, or `<meta>` to the document before `</head>`.
- Touches `public/sw.js` or the service-worker registration snippet.
- Adds a CSP header, CSP meta tag, or flips `Content-Security-Policy-Report-Only` to `Content-Security-Policy` (see 1.3 — this is the strongest suspect).
- Adds `innerHTML = ...` or `document.write(...)` anywhere that runs on page load.
- Touches `html-escape`, `escapeHtml`, or a templating helper used inside `getHeadTags()` or `getLandingPageHTML()` — the P0-02 "escape SSR'd HTML" commit is a top-5 suspect for double-escaping something inside a `<script>` block, which WebKit will then fail to parse as JS.

### 1.3 Check the CSP situation explicitly (top suspect)
Commit `2be0e1c fix(security): P0-05 HttpOnly session cookies (dual-auth) + CSP Report-Only` added CSP. That's fine *in Report-Only mode*, but a later commit may have flipped it to enforcement.
- `grep -rn "Content-Security-Policy" src/` — list every place CSP is set, and for each one note whether it's `Report-Only` or enforced.
- If enforced, print the full policy string. Specifically look for missing `'unsafe-inline'` in `script-src` — the landing page is **full** of inline `onclick="rrTrack(...)"` and inline `<script>` blocks (theme init, SW register, `window.rrTrack` shim, Google Translate init, GA4, Meta Pixel, Clarity). A strict CSP with no `'unsafe-inline'` or no nonce will cause Safari to refuse every one of those scripts → blank page. Chrome may behave identically but if a different CSP header is sent to Safari via UA-sniffing middleware, only Safari would break.
- Also check `public/_headers` and any `c.header('Content-Security-Policy', ...)` calls.

### 1.4 Check the Worker is actually running
- `wrangler tail --format=pretty` (or Cloudflare dashboard → Workers → Logs) for 60 seconds while you `curl` the homepage. Any `Uncaught (in promise)`, `ReferenceError`, or `TypeError` inside the Worker at render time is your culprit.
- If the Worker is throwing, the ~300-line HTML-injection middleware in `src/index.tsx` (~lines 106-305) is the most likely location — it does `.text()` on the response body, runs multiple regex replaces, and rebuilds the Response. Any change to that middleware (GA4 injection, Meta Pixel injection, translate-widget injection) can throw on specific route responses and produce a 500 that Safari shows as "Safari can't open the page" while Chrome retries and succeeds.

### 1.5 Reproduce in actual Safari, not just curl
- `npm run dev:sandbox` and open `http://0.0.0.0:3000/` in Safari Technology Preview (or real Safari if you're on macOS). Open Web Inspector → Console **before** the page loads. Screenshot every red error and put it in `DEBUG-SAFARI-RECURRENCE.md`. A single `Refused to execute inline script because it violates the following Content Security Policy directive` line is the smoking gun for 1.3. A `SyntaxError: Unexpected token` is the smoking gun for 1.2's double-escape hypothesis.
- Also check Web Inspector → Network: is `/static/tracker.js` 200? `/static/toast.js`? `/static/tailwind.css`? `/sw.js`? A missing static asset (e.g. `public/static/tailwind.css` didn't get compiled on the last deploy) will cause Tailwind-dependent layouts to collapse into an unstyled wall of text that users describe as "error" or "broken."

### 1.6 Check the service worker trap even though we bumped to v3
The v2→v3 cache-name bump was supposed to force-purge stale caches. But:
- If a user's Safari loaded the broken v2 page once and *didn't close the tab* before the v3 deploy, the old SW is still controlling the tab. Check `public/sw.js` — you already skipWaiting + clients.claim, so this should be fine, but confirm.
- More insidiously: look at commit `bc2dfbf`'s change to `public/sw.js` (the "P3 silent-catch on SW" change). Silent-catching an error in the `fetch` handler can make the SW respond with `undefined`, which Safari renders as a blank page with a generic network error. Read that change and confirm the catch block returns `caches.match(request)` or falls through to `fetch(request)`, never just swallows.

### 1.7 Rule out DNS / certificate / Cloudflare edge
- `dig www.roofmanager.ca +short` — should return Cloudflare IPs.
- `openssl s_client -connect www.roofmanager.ca:443 -servername www.roofmanager.ca </dev/null 2>/dev/null | openssl x509 -noout -dates` — cert should be valid for > 30 days.
- Cloudflare dashboard → Overview — any active incidents on the zone? Under Attack Mode accidentally enabled? Bot Fight Mode escalated to JS Challenge? (JS Challenge breaks Safari more often than Chrome because of iOS Safari's ITP.)

At the end of phase 1 you should be able to finish this sentence: **"Safari is failing because `<exact file>:<line>` does `<specific thing>` which Safari rejects, introduced in commit `<sha>`."** If you cannot finish that sentence, phase 1 is not done — do more investigation before proceeding.

---

## Phase 2 — Fix the root cause you found in phase 1

Write the fix as a targeted commit with message `fix(safari): <one-line root cause>`. Do not pile unrelated changes in.

**If the culprit is CSP (most likely):** either (a) revert to `Content-Security-Policy-Report-Only` until we've added nonces to every inline script, or (b) add `'unsafe-inline'` to `script-src` and `style-src` as a stopgap, *and* open a follow-up ticket to move every inline script to `/static/*.js` files with SRI so we can drop `'unsafe-inline'` permanently.

**If the culprit is a bad HTML-injection middleware change:** revert just that hunk and re-implement the change with a regex that can't match inside a `<script>`/`<style>` body (use a proper HTML parser like `node-html-parser` for anything touching SSR output — regex replaces on HTML are how this bug keeps coming back).

**If the culprit is an over-aggressive `escapeHtml` from P0-02 that escaped something inside a `<script>`:** the fix is to never HTML-escape into a `<script>` body. Use `JSON.stringify` for values going into inline JS and HTML-escape only for text-node / attribute contexts. Add unit tests.

**If the culprit is the SW silent-catch:** make the catch return `fetch(request)` (bypass) or `caches.match(request)` (fallback), never nothing.

**If the culprit is a failed Cloudflare Pages build:** fix the build error, re-deploy, and in phase 3 add a deploy-gate (see 3.4).

---

## Phase 3 — Lock it in so this never recurs (this is the part that's been missing)

Yesterday's fix was a patch. Today's fix must be a **guardrail**. Add all of the following:

### 3.1 CI check: HTML validity of `<head>`
Add `scripts/validate-head.mjs` that:
1. Boots the app against an in-memory fetcher (or runs `npm run build && wrangler pages dev dist --port 8788` in the background) and GETs `/`, `/register`, `/pricing`, `/blog`, `/customer/login`, `/sample-report`, `/demo`, `/contact`.
2. For each response, parses the HTML with `node-html-parser` and asserts:
   - `<head>` contains *only* these child tag names: `meta`, `link`, `title`, `script`, `style`, `noscript`, `base`. **No `<div>`, no `<span>`, no `<p>`, no `<section>`, no `<button>`.** Fail CI with a clear message if violated.
   - Every inline `<script>` block parses as valid JS (use `acorn` with `ecmaVersion: 2022`). Catches the double-escape bug class.
   - The string `window.rrTrack` appears before the first `onclick="rrTrack(`.
   - The string `<div id="gt-wrapper"` appears *after* `<body` (not before).
3. Wire this into `package.json` as `"test:html": "node scripts/validate-head.mjs"` and run it in a new GitHub Action `.github/workflows/safari-guardrails.yml` on every PR.

### 3.2 CI check: CSP changes require explicit sign-off
Add a test that asserts: if `Content-Security-Policy` (enforced, not Report-Only) is present in any response, then **every** inline `<script>` and `<style>` in that response has a matching `nonce` attribute. If not, fail CI. This makes it literally impossible to merge a CSP tightening that breaks Safari — you'll have added nonces first, or the test will stop you.

### 3.3 CI check: `backdrop-filter` has the webkit prefix
Add a lint rule (one-line `grep`) that fails if any `.ts` / `.tsx` / `.css` file contains `backdrop-filter:` without a matching `-webkit-backdrop-filter:` on an adjacent line. This catches RC#3 regressions.

### 3.4 Deploy gate: smoke-test Safari before promoting
Add a GitHub Action step that runs after `wrangler pages deploy` to the preview environment:
- Uses Playwright with `webkit` (Safari's engine) to load the preview URL.
- Asserts the hero `<h1>` is visible within 5 s.
- Asserts the "Get 4 FREE Reports" CTA is clickable and navigates to `/register`.
- Asserts the Web Inspector console has zero errors and zero CSP violations.
- If any assertion fails, **do not** promote the preview to production. The current pipeline apparently promotes on build-success alone, which is why a Safari-breaking change slipped through twice.

Install: `npm i -D playwright @playwright/test && npx playwright install webkit`. File: `tests/safari-smoke.spec.ts`. CI: `.github/workflows/safari-guardrails.yml` adds a `safari-smoke` job.

### 3.5 Production monitoring: detect this within minutes, not hours
The reason we only find out from the user is that nothing watches the landing page from Safari's perspective. Add one of:
- A Cloudflare Worker cron (`wrangler-cron.jsonc` already exists, piggy-back on it) that every 5 minutes fetches `https://www.roofmanager.ca/` with a `Safari/605.1.15` UA, checks the response is 200, contains `<title>Roof Manager</title>`, and contains `window.rrTrack`. On failure, POST to a Slack webhook (env var `SAFARI_ALERT_WEBHOOK_URL`).
- Or a free Better Uptime / Checkly monitor hitting the same URL with a Safari UA and a keyword check.

Either way: the first Safari-outage alert should arrive before the first customer email.

### 3.6 Documentation: one file, canonical, linked from CLAUDE.md
Replace `SAFARI-DEBUG-PROMPT.md` and `SAFARI-PERMANENT-FIX-PROMPT.md` with a single `docs/SAFARI.md` that documents:
- The 7 root causes from yesterday's prompt (still the canonical catalog).
- The root cause you just fixed today.
- The CI guardrails from 3.1-3.4 and how to run them locally (`npm run test:html`, `npm run test:safari`).
- A "before you touch `getHeadTags()` or the injection middleware" checklist.
Add a line to `CLAUDE.md` under Architecture: `### Safari fragility — read docs/SAFARI.md before editing getHeadTags() or HTML-injection middleware`.

---

## Deliverables

Commit as three separate commits on a branch `fix/safari-permanent`:

1. `fix(safari): <specific root cause from phase 1>` — the actual fix.
2. `test(safari): HTML head validation + CSP-nonce + backdrop-filter guardrails` — scripts/validate-head.mjs, lint rule, CI workflow.
3. `test(safari): Playwright WebKit smoke test in deploy gate` — Playwright test, CI job that blocks promotion.
4. `docs: canonical Safari-fragility doc + CLAUDE.md link` — docs/SAFARI.md.

Then open a PR titled `fix(safari): permanent regression-proofing — root-cause fix + CI guardrails + deploy gate` with a description that lists, specifically, what the phase-1 diagnosis found.

## Verification before you say you're done

- [ ] Phase 1 produced `DEBUG-SAFARI-RECURRENCE.md` naming the exact commit SHA and line number that regressed.
- [ ] `npm run test:html` passes locally.
- [ ] `npx playwright test tests/safari-smoke.spec.ts` passes locally against `npm run dev:sandbox`.
- [ ] Safari Technology Preview loads `http://0.0.0.0:3000/` with zero console errors.
- [ ] Safari Technology Preview loads `http://0.0.0.0:3000/` in Private Browsing with zero console errors.
- [ ] `curl -s http://0.0.0.0:3000/ | grep -c "<div"` inside the `<head>` block returns 0.
- [ ] The new GitHub Action runs green on the PR.
- [ ] The production cron check (or external monitor) is live and has fired at least one healthy heartbeat.

## The meta-point (do not skip)

The reason this bug keeps coming back is that `src/index.tsx` is 17,301 lines long and every security-hardening commit touches HTML-injection or CSP without a Safari-aware test gate. **The permanent fix is the guardrail, not the patch.** If you only fix the immediate symptom and skip phase 3, I will be writing this prompt again tomorrow. Don't let that happen.

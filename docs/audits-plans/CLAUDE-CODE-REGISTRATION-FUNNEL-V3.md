# Roof Manager — Registration Funnel v3
## Precision implementation prompt for Claude Code

Paste this file into Claude Code. It supersedes all previous funnel prompts. The primary KPI is: **% of homepage visitors who complete registration** (email verified + at least one report ordered).

---

## Current state (verified 2026-04-16)

All v1 UX phases are shipped. The following is what is real right now — do NOT rebuild any of it.

**Already live:**
- GET `/contact` + POST `/api/contact/lead` (migration 0129)
- GET `/demo` with embedded Google Calendar iframe
- Tri-CTA nav with "Book Demo" button (phone is a TODO placeholder — see Phase 0)
- Mobile sticky CTA bar (IntersectionObserver, sessionStorage throttle)
- GET `/register` at `src/index.tsx:601` rendering `getCustomerRegisterPageHTML()` at line 7331
- Visible testimonials + trust strip on homepage
- A/B announcement bar (inline localStorage logic)

**Two live bugs to fix first:**

| Bug | File | Line(s) | Fix |
|-----|------|---------|-----|
| Signup CTAs link to `/customer/login` instead of `/register` | `src/index.tsx` | 1597, 1635, 1746, 1823, 10536, 10597, 10675, 10698, 10719, 10736, 10752, 10780, 11283, 11429, 11557, 15250, 15386, 15427 | Change `href="/customer/login"` and `href="/customer/login?mode=signup"` to `href="/register"` only on lines where the visible button/link text is a signup/free-trial CTA (e.g. "Get 3 Free Reports", "Start Free", "Sign Up Free", "Start Free Trial"). Do NOT change lines 11034, 11336, 11584, 13828, 13959 — those are "Login" navigation links that must stay. |
| Phone number is a hardcoded placeholder | `src/index.tsx` | ~5767 | `TODO(Ethan): confirm sales phone number` — Claude Code should leave a clear inline comment asking Ethan to fill this in before deploy; do not invent a number |

**Google OAuth backend — already live, not surfaced in UI:**
- `POST /api/customer-auth/google` at `src/routes/customer-auth.ts:454` — full Google Identity Services ID-token flow, auto-creates account, auto-verifies email, grants 4 free reports. The frontend has never had a button for this.

**What is confirmed missing (implement in order below):**
- Google "Continue with Google" button on register and login pages
- Multi-step registration form
- Magic-link passwordless auth + password reset
- Address-first hero with free preview
- Abandoned signup recovery
- `/onboarding` activation wizard
- `/r/:code` referral landing page
- `src/services/analytics-events.ts` unified event module
- Microsoft Clarity session recording
- Social proof toasts
- `src/lib/ab.ts` A/B helper
- Exit-intent v2

---

## Constraints that apply to every phase

- Do not refactor unrelated code. Only touch what each phase specifies.
- Do not change any URLs that already work. Add, don't replace.
- One commit per phase. No squashing. No `--no-verify`. No force pushes. No `git amend`.
- After every phase: `npm run build` must pass and `npx vitest run` must be green.
- Use `style="..."` for one-off color values, not arbitrary Tailwind classes like `bg-[#111]` — those won't be in the compiled CSS.
- Next migration file is `0131_*`.

---

## PHASE 0 — Fix the two live bugs (ship immediately, one commit)

### 0A — Repoint signup CTAs to /register

In `src/index.tsx`, change `href="/customer/login"` → `href="/register"` on these lines only (confirm by checking the visible link/button text is a signup/trial CTA, not a "Login" label):

**Lines to update:** 1597, 1635, 1746, 1823, 10536, 10597, 10675, 10698, 10719, 10736, 10752, 10780, 11283, 11429, 11557

**Also update** `href="/customer/login?mode=signup"` → `href="/register"` on lines: 15250, 15386, 15427

**Do NOT touch** lines 11034, 11336, 11584, 13828, 13959 (these are "Login" navigation links).

Add `onclick="rrTrack('cta_click',{location:'pricing_signup'})"` to the pricing page CTA links (lines 10597, 10675, 10698, 10719, 10736, 10752) so conversions are trackable.

### 0B — Phone number comment

At the line with `tel:+1XXXXXXXXXX` (around line 5767), replace the raw placeholder with:
```
<!-- TODO(Ethan): Replace +1XXXXXXXXXX with your real sales phone number before deploying to production -->
tel:+1XXXXXXXXXX
```

**Acceptance:** `npm run build` passes. Every "Get Free Reports" / "Start Free" / "Sign Up" CTA on the homepage, US landing pages, and pricing page goes to `/register`, not `/customer/login`. The "Login" navigation items still go to `/customer/login`.

---

## PHASE 1 — Surface Google OAuth on /register and /customer/login

This is the **single biggest remaining registration lever**. The backend at `POST /api/customer-auth/google` is production-ready; it just needs a button. Industry norm: a visible "Continue with Google" button on a B2B signup page lifts completion 20–40%.

### 1A — Add Google Identity Services to /register

In `getCustomerRegisterPageHTML()` (`src/index.tsx:7331`):

1. In the `<head>` section of this page, add:
   ```html
   <script src="https://accounts.google.com/gsi/client" async defer></script>
   ```

2. Above the existing form (before the `<form id="reg-form">`), insert a Google button block:
   ```html
   <div id="g_id_onload"
     data-client_id="__GOOGLE_OAUTH_CLIENT_ID__"
     data-callback="handleGoogleCredential"
     data-auto_prompt="false">
   </div>
   <div class="g_id_signin"
     data-type="standard"
     data-shape="rectangular"
     data-theme="outline"
     data-text="continue_with"
     data-size="large"
     data-width="100%"
     onclick="rrTrack('oauth_click',{provider:'google'})">
   </div>
   <div style="display:flex;align-items:center;gap:12px;margin:16px 0">
     <div style="flex:1;height:1px;background:#e5e7eb"></div>
     <span style="font-size:13px;color:#6b7280;white-space:nowrap">or continue with email</span>
     <div style="flex:1;height:1px;background:#e5e7eb"></div>
   </div>
   ```

3. In the inline `<script>` block at the bottom of this page, add:
   ```javascript
   async function handleGoogleCredential(response) {
     rrTrack('oauth_click', {provider: 'google'});
     const refCode = localStorage.getItem('rr_ref_code') || '';
     const previewId = new URLSearchParams(window.location.search).get('preview_id') || '';
     const res = await fetch('/api/customer-auth/google', {
       method: 'POST',
       headers: {'Content-Type': 'application/json'},
       body: JSON.stringify({credential: response.credential, referred_by_code: refCode, preview_id: previewId})
     });
     const data = await res.json();
     if (data.success) {
       rrTrack('oauth_success', {provider: 'google'});
       window.location.href = '/onboarding?welcome=1';
     } else {
       rrTrack('oauth_error', {provider: 'google', reason: data.error});
       document.getElementById('reg-error').textContent = data.error || 'Google sign-in failed. Please try email instead.';
       document.getElementById('reg-error').style.display = 'block';
     }
   }
   ```

4. Replace the literal `__GOOGLE_OAUTH_CLIENT_ID__` placeholder by reading it server-side from the Hono context env. The register route at `src/index.tsx:601` already receives `(c)` — pass the env value into the HTML function:
   ```typescript
   app.get('/register', (c) => {
     const email = c.req.query('email') || '';
     const googleClientId = (c.env as any).GOOGLE_OAUTH_CLIENT_ID || '';
     return c.html(getCustomerRegisterPageHTML(email, googleClientId));
   });
   ```
   Update `getCustomerRegisterPageHTML(prefillEmail = '', googleClientId = '')` signature accordingly and replace `__GOOGLE_OAUTH_CLIENT_ID__` in the template with `${googleClientId}`.

5. Also update `POST /api/customer-auth/google` to handle an optional `preview_id` in the body (currently it doesn't). If `preview_id` is present, after account creation run:
   ```sql
   UPDATE preview_requests SET converted_customer_id = ? WHERE preview_id = ?
   ```
   (This table is created in Phase 3. For now, wrap the UPDATE in a try/catch so it's a no-op if the table doesn't exist yet.)

### 1B — Add Google button to /customer/login page

Find the customer login page HTML function (search for `getCustomerLoginPageHTML` or the login form in `src/index.tsx`). Apply the same Google button block from 1A above the email/password form, with the same `handleGoogleCredential` handler. The handler for login is identical to signup — the backend upserts either way.

Update the login route to pass `googleClientId` from env the same way.

### 1C — Add "Sign in with Google" to the /customer/login page's "Sign up" link

On the login page, the "Don't have an account? Sign up" link should now go to `/register` (not `?mode=signup`).

**Acceptance:**
- `/register` shows a visible "Continue with Google" button above the email form.
- Clicking Google, completing the OAuth consent, lands the user at `/onboarding?welcome=1` (which will 404 until Phase 5 — that's fine; confirm the session cookie is set and redirect happens).
- `/customer/login` shows the same Google button.
- `oauth_click` and `oauth_success` events fire (check browser console).
- `npm run build` clean. `npx vitest run` green.

---

## PHASE 2 — Multi-step registration form

The current form at `getCustomerRegisterPageHTML()` asks for all fields at once. A two-step form (email-only first, then password+name) consistently outperforms single-step on mobile and surfaces abandonment data. The backend `POST /api/customer-auth/register` accepts all fields at once — only the UI splits them.

### Transformation

Replace the existing `<form id="reg-form">` and its submit handler with a two-step sequence. **Do not change the backend endpoint or its payload format.**

**Step 1 — Email only:**
```html
<div id="step1">
  <label for="reg-email" style="display:block;font-weight:600;margin-bottom:6px;font-size:14px">Work Email</label>
  <input id="reg-email" type="email" name="email" autocomplete="email" required
    placeholder="you@company.com"
    style="width:100%;padding:12px 16px;border:1.5px solid #d1d5db;border-radius:10px;font-size:15px;outline:none"
    onfocus="this.style.borderColor='#00CC70'"
    onblur="onEmailBlur(this.value)">
  <button type="button" onclick="goToStep2()" 
    style="width:100%;margin-top:12px;padding:14px;background:#00FF88;color:#0A0A0A;font-weight:800;border:none;border-radius:10px;font-size:16px;cursor:pointer">
    Continue <span style="margin-left:4px">→</span>
  </button>
  <p style="text-align:center;margin-top:10px;font-size:13px;color:#6b7280">
    🔒 No credit card &nbsp;·&nbsp; 🇨🇦 Canadian data &nbsp;·&nbsp; ⚡ 60-sec setup
  </p>
</div>
```

**Step 2 — Password + Name:**
```html
<div id="step2" style="display:none">
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;font-size:14px;color:#6b7280">
    <button type="button" onclick="goToStep1()" style="background:none;border:none;cursor:pointer;color:#00CC70;font-weight:600">← Back</button>
    <span>Step 2 of 2</span>
  </div>
  <!-- Full Name, Password (with strength meter), Company (optional), Phone (optional) -->
  <!-- Match current field names exactly so the existing submitRegForm() handler works -->
  <button type="button" onclick="submitRegForm()">Create Account</button>
</div>
```

**Step 3 — Email verification (in-place, same page):**
After `submitRegForm()` succeeds, hide step2, show a verification input matching the existing 6-digit flow (if you find existing verification UI on the page, reuse it). On successful verification redirect to `/onboarding?welcome=1`.

**Draft persistence:**
```javascript
function onEmailBlur(email) {
  if (!email || !email.includes('@')) return;
  const draft = JSON.parse(localStorage.getItem('rr_signup_draft') || '{}');
  draft.email = email;
  localStorage.setItem('rr_signup_draft', JSON.stringify(draft));
  // Capture email for abandoned-signup recovery (Phase 4)
  fetch('/api/customer-auth/signup-started', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      email,
      utm: Object.fromEntries(new URLSearchParams(sessionStorage.getItem('rr_utm') || '')),
      preview_id: new URLSearchParams(window.location.search).get('preview_id') || ''
    })
  }).catch(() => {}); // fire-and-forget
  rrTrack('signup_field_complete', {field: 'email'});
}
```

On page load, if `localStorage.rr_signup_draft` has an email, pre-fill and advance to step 2 (so returning users skip step 1):
```javascript
const draft = JSON.parse(localStorage.getItem('rr_signup_draft') || '{}');
if (draft.email) { document.getElementById('reg-email').value = draft.email; goToStep2(true); }
```

Clear draft on `signup_submit_success`.

**Progress indicator:**
Add above the form:
```html
<div style="display:flex;gap:8px;margin-bottom:20px">
  <div id="prog1" style="flex:1;height:4px;background:#00FF88;border-radius:2px"></div>
  <div id="prog2" style="flex:1;height:4px;background:#e5e7eb;border-radius:2px;transition:background 0.3s"></div>
</div>
```
`goToStep2()` sets `prog2` to `background:#00FF88`.

**Acceptance:**
- Visiting `/register` shows only the email input first.
- Filling email and clicking Continue shows step 2 with the progress bar fully green.
- Back button returns to step 1 with email preserved.
- Submitting a valid registration ends at the in-page verification step (or `/onboarding?welcome=1` if no verify step yet).
- Hard-refreshing the page with a draft in localStorage returns to step 2 pre-filled.
- `npm run build` clean.

---

## PHASE 3 — Address-first hero preview ("value before signup")

Measurement-tool funnels that let visitors see their own property before the registration wall convert 1.5–3× better. The widget infrastructure (`/api/widget/public/estimate`) exists but requires a contractor `public_key`. Create a public, key-free version for anonymous homepage visitors.

### 3A — New migration `migrations/0131_preview_requests.sql`

```sql
CREATE TABLE IF NOT EXISTS preview_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  preview_id TEXT NOT NULL UNIQUE,
  address TEXT NOT NULL,
  lat REAL,
  lng REAL,
  footprint_m2 REAL,
  pitch_deg REAL,
  segment_count INTEGER,
  ip TEXT,
  user_agent TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  converted_customer_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_preview_preview_id ON preview_requests(preview_id);
CREATE INDEX IF NOT EXISTS idx_preview_created_at ON preview_requests(created_at DESC);
```

### 3B — New file `src/routes/public-preview.ts`

```typescript
import { Hono } from 'hono';
// POST /api/public/preview
// Accepts: { address: string, utm?: object }
// Returns: { preview_id, lat, lng, footprint_m2, pitch_deg, segment_count, satellite_tile_url, estimated_area_sqft }
// Rate-limit: 10/hour per IP (use in-worker LRU Map with 1-hour TTL)
// Daily cap: read SOLAR_API_DAILY_CAP env var (default 500)
// On cap exceeded: return 429 with { error: 'preview_limit', message: 'Free previews are paused. Create an account for unlimited access.' }
```

Implementation notes:
- Generate `preview_id` as `crypto.randomUUID()`.
- Call the existing `fetchBuildingInsights(address, env)` from `src/services/solar-api.ts` — look at how it's used in `src/routes/widget.ts` and replicate.
- From the response, extract: `lat`, `lng`, `footprint_m2` (center building footprint area), `pitch_deg` (average pitch from `solarPotential.roofSegmentStats`), `segment_count`.
- For `satellite_tile_url`: construct the Maps Static API URL:
  ```
  https://maps.googleapis.com/maps/api/staticmap?center={lat},{lng}&zoom=20&size=600x400&maptype=satellite&key={GOOGLE_MAPS_API_KEY}
  ```
- `estimated_area_sqft` = `footprint_m2 * 10.764`.
- Write a row to `preview_requests`. Wrap in try/catch — if D1 write fails, still return the preview data.
- Do NOT return full segment geometry or roof edges — that's behind the registration wall.

Mount in `src/index.tsx`:
```typescript
import { publicPreviewRoutes } from './routes/public-preview';
app.route('/api/public', publicPreviewRoutes);
```

### 3C — Hero address input block

In `getLandingPageHTML()` (`src/index.tsx` around line 5826 where the hero primary CTA is), add an address input **above** the existing "Get 4 FREE Reports" button:

```html
<div id="hero-preview-form" style="margin-bottom:16px">
  <div style="display:flex;gap:8px;flex-wrap:wrap">
    <input id="hero-address" type="text" placeholder="Enter a property address…"
      autocomplete="off"
      style="flex:1;min-width:220px;padding:14px 16px;border:2px solid rgba(255,255,255,0.15);
             background:rgba(255,255,255,0.07);color:#fff;border-radius:12px;font-size:15px;outline:none"
      onfocus="this.style.borderColor='#00FF88'"
      onblur="this.style.borderColor='rgba(255,255,255,0.15)'">
    <button type="button" onclick="startPreview()"
      style="padding:14px 24px;background:#00FF88;color:#0A0A0A;font-weight:800;border:none;
             border-radius:12px;font-size:15px;cursor:pointer;white-space:nowrap">
      Measure this roof →
    </button>
  </div>
  <p style="font-size:12px;color:rgba(255,255,255,0.5);margin-top:6px">
    Free sample measurement · No account needed
  </p>
</div>

<!-- Preview result panel (hidden until preview loads) -->
<div id="hero-preview-result" style="display:none;margin-bottom:16px;
     background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);
     border-radius:14px;padding:16px;overflow:hidden">
  <div style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap">
    <img id="preview-sat-img" src="" alt="Satellite view" 
      style="width:140px;height:100px;object-fit:cover;border-radius:8px;flex-shrink:0">
    <div>
      <div id="preview-stats" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px"></div>
      <a id="preview-cta" href="/register"
        style="display:inline-block;background:#00FF88;color:#0A0A0A;font-weight:800;
               padding:10px 20px;border-radius:10px;font-size:14px;text-decoration:none">
        Create account to download full report →
      </a>
      <a href="/demo" style="display:inline-block;margin-left:8px;color:rgba(255,255,255,0.6);
         font-size:13px;text-decoration:none">Book a demo instead</a>
    </div>
  </div>
</div>
```

**JavaScript** (add to the hero section's inline script):
```javascript
function startPreview() {
  const addr = document.getElementById('hero-address').value.trim();
  if (!addr) { document.getElementById('hero-address').focus(); return; }
  rrTrack('hero_cta_click', {variant: 'address_start'});
  const btn = document.querySelector('[onclick="startPreview()"]');
  btn.disabled = true; btn.textContent = 'Measuring…';
  
  // Capture UTM for attribution
  const utm = Object.fromEntries(new URLSearchParams(sessionStorage.getItem('rr_utm') || ''));
  
  fetch('/api/public/preview', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({address: addr, utm})
  })
  .then(r => r.json())
  .then(data => {
    btn.disabled = false; btn.textContent = 'Measure this roof →';
    if (data.error === 'preview_limit') {
      document.getElementById('hero-address').placeholder = 'Free previews paused — create an account for unlimited access';
      return;
    }
    if (!data.preview_id) { alert('Could not find that address. Try a full street address.'); return; }
    rrTrack('preview_rendered', {area: data.estimated_area_sqft, pitch: data.pitch_deg});
    
    // Render satellite image + stats
    document.getElementById('preview-sat-img').src = data.satellite_tile_url;
    document.getElementById('preview-stats').innerHTML = `
      <div style="text-align:center"><div style="font-size:20px;font-weight:800;color:#00FF88">${Math.round(data.estimated_area_sqft).toLocaleString()}</div><div style="font-size:11px;color:rgba(255,255,255,0.5)">sq ft area</div></div>
      <div style="text-align:center"><div style="font-size:20px;font-weight:800;color:#00FF88">${data.pitch_deg ? data.pitch_deg.toFixed(1) + '°' : '—'}</div><div style="font-size:11px;color:rgba(255,255,255,0.5)">avg pitch</div></div>
      <div style="text-align:center"><div style="font-size:20px;font-weight:800;color:#00FF88">${data.segment_count || '—'}</div><div style="font-size:11px;color:rgba(255,255,255,0.5)">segments</div></div>
    `;
    const cta = document.getElementById('preview-cta');
    cta.href = '/register?preview_id=' + encodeURIComponent(data.preview_id);
    
    document.getElementById('hero-preview-result').style.display = 'block';
    document.getElementById('hero-preview-form').style.display = 'none';
  })
  .catch(() => { btn.disabled = false; btn.textContent = 'Measure this roof →'; });
}
```

**Preview banner on /register:** In `getCustomerRegisterPageHTML()`, check for `preview_id` query param (already passed via `prefillEmail` mechanism — extend the function to also accept `previewId`). If present, add above the Google button:
```html
<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px 16px;margin-bottom:16px;font-size:14px;color:#15803d">
  ✅ Your roof preview is saved — complete signup to download the full report.
</div>
```

**Acceptance:**
- Entering a valid Calgary or Toronto address in the hero returns a satellite thumbnail + 3 stats within ~4s.
- Two CTAs appear; clicking the primary goes to `/register?preview_id=...` with the banner visible.
- 11th request from same IP in one hour returns a friendly message (not a JS error).
- `preview_requests` row exists in D1 after a successful preview.
- `npm run build` + `npx vitest run` clean.

---

## PHASE 4 — Magic-link passwordless auth + password reset

Passwords are the #1 drop-off point on Step 2 of the form. Offering magic-link as an alternative removes permanent friction. Password reset closes a security gap.

### 4A — Migration `migrations/0132_magic_link_tokens.sql`

```sql
CREATE TABLE IF NOT EXISTS magic_link_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  token_type TEXT NOT NULL DEFAULT 'signin', -- 'signin' | 'signup' | 'reset'
  used INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_magic_token ON magic_link_tokens(token);
CREATE INDEX IF NOT EXISTS idx_magic_email ON magic_link_tokens(email);
```

### 4B — New endpoints in `src/routes/customer-auth.ts`

**POST `/api/customer-auth/magic-link`**
- Input: `{ email: string, referred_by_code?: string }`
- Generate a 32-byte hex token (`crypto.getRandomValues`), insert into `magic_link_tokens` with `expires_at = now + 15 minutes`, `token_type = email_exists ? 'signin' : 'signup'`.
- Send email via `sendViaResend` (or `sendGmailOAuth2` fallback):
  - Subject: `Your Roof Manager sign-in link`
  - Body: big button `Sign in to Roof Manager` → `https://www.roofmanager.ca/auth/magic?token={token}`
  - Footer: `This link expires in 15 minutes. If you didn't request this, ignore this email.`
- Return `{ success: true }` (never reveal whether the email exists).
- Fire `magic_link_requested` log entry (server-side, don't include PII in the log).

**GET `/auth/magic?token=...`** (add in `src/index.tsx`)
- Look up token in `magic_link_tokens`. If not found or used=1: render a minimal error page "This link has expired or already been used. [Request a new one →]" linking to `/customer/login`.
- If expired (`expires_at < now`): same error.
- Mark `used=1`. 
- If `token_type='signup'` and no customer row exists for the email: create the customer (same account creation logic as the email/password register handler — name defaults to email prefix, no password set, `email_verified=1`, 4 free reports). Set session cookie. Redirect to `/onboarding?welcome=1`.
- If `token_type='signin'`: look up customer by email, set session cookie, redirect to `/customer/dashboard`.
- If `token_type='reset'`: render the password-reset form inline (see below).

**POST `/api/customer-auth/forgot-password`**
- Input: `{ email: string }`
- Generate token, insert with `token_type='reset'`, send email with subject `Reset your Roof Manager password` and link `https://www.roofmanager.ca/auth/magic?token={token}`.
- Always return `{ success: true }` (no email-exists reveal).

**POST `/api/customer-auth/reset-password`**
- Input: `{ token: string, password: string }`
- Validate token (`token_type='reset'`, not used, not expired). 
- Hash password with PBKDF2 (match the existing `hashPassword()` helper in `customer-auth.ts`).
- Update `customers` row. Mark token `used=1`. Create session. Return `{ success: true, redirect: '/customer/dashboard' }`.

### 4C — UI integration

**On `/register` (Step 1 email blur):**
After the "Continue" button in Step 1, add a secondary link:
```html
<p style="text-align:center;margin-top:8px;font-size:13px">
  Prefer passwordless? 
  <a id="magic-link-btn" href="#" onclick="requestMagicLink(event)"
    style="color:#00CC70;font-weight:600;text-decoration:none">
    Email me a sign-in link
  </a>
</p>
```

`requestMagicLink(e)` — reads email from `#reg-email`, POSTs to `/api/customer-auth/magic-link`, shows inline: "Check your inbox — we sent a sign-in link to {email}."

**On `/customer/login`:**
- Under the password field, add `<a href="/forgot-password" style="font-size:13px;color:#6b7280">Forgot your password?</a>`.
- Add a "Send me a sign-in link instead" link that triggers the same magic-link flow.

**GET `/forgot-password`** — a chrome-stripped page with just an email input and "Send reset link" button that calls `POST /api/customer-auth/forgot-password`. On submit show "If that email exists, a reset link is on its way."

**Password reset page** — when `GET /auth/magic?token=...` resolves a `reset` token, render in-place:
```html
<form onsubmit="resetPassword(event)">
  <input type="password" id="new-pw" placeholder="New password (min 8 chars)" required minlength="8" data-clarity-mask="true">
  <input type="password" id="confirm-pw" placeholder="Confirm new password" required>
  <button type="submit">Set new password</button>
</form>
```
The submit handler POSTs to `/api/customer-auth/reset-password` with the token from the URL query param, then redirects to dashboard on success.

**Acceptance:**
- Requesting a magic-link from `/register` results in an email arriving and a successful passwordless sign-in (ends at `/onboarding?welcome=1`).
- `/forgot-password` sends a reset email; clicking the link renders the reset form; resetting ends at dashboard.
- Tokens are single-use: replaying a used/expired token shows the friendly error page.
- Password reset uses `PBKDF2` — confirm by checking the existing `hashPassword` call in `customer-auth.ts` is reused.
- `npm run build` + tests green.

---

## PHASE 5 — Abandoned signup recovery

Roughly 70% of users who start signup abandon at Step 2 (password). The `onEmailBlur` in Phase 2 already fires `POST /api/customer-auth/signup-started` on email blur. Wire up the backend and the recovery email.

### 5A — Migration `migrations/0133_signup_attempts.sql`

```sql
CREATE TABLE IF NOT EXISTS signup_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  preview_id TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  recovered INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  unsubscribed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_signup_attempts_email ON signup_attempts(email);
CREATE INDEX IF NOT EXISTS idx_signup_attempts_created_at ON signup_attempts(created_at DESC);

CREATE TABLE IF NOT EXISTS signup_recovery_optouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 5B — POST `/api/customer-auth/signup-started`

In `src/routes/customer-auth.ts`:
- Input: `{ email: string, utm?: object, preview_id?: string }`
- Validate email format. If invalid, return 400.
- Check `signup_recovery_optouts` — if this email has opted out, still return 200 (no-op).
- `INSERT OR IGNORE INTO signup_attempts` (one row per email per day — use `WHERE NOT EXISTS (SELECT 1 FROM signup_attempts WHERE email=? AND date(created_at)=date('now'))` or just `INSERT OR IGNORE` with a unique constraint if you prefer).
- Return `{ success: true }`.
- This endpoint must be unauthenticated (no auth middleware).

### 5C — Recovery email cron

Find the existing cron worker (check `src/cron-worker.ts`, `wrangler.jsonc` cron triggers, or `ecosystem.config.cjs`). Add a new cron task `runAbandonedSignupRecovery(env)` that runs every 15 minutes.

Logic:
```sql
SELECT sa.email, sa.preview_id
FROM signup_attempts sa
WHERE sa.created_at BETWEEN datetime('now', '-75 minutes') AND datetime('now', '-60 minutes')
  AND sa.completed = 0
  AND sa.recovered = 0
  AND sa.unsubscribed = 0
  AND NOT EXISTS (SELECT 1 FROM customers c WHERE c.email = sa.email)
  AND NOT EXISTS (SELECT 1 FROM signup_recovery_optouts o WHERE o.email = sa.email)
LIMIT 50
```

For each row, send a recovery email via `sendViaResend`:
- Subject: `You left 4 free reports on the table`
- Body:
  ```
  Hi there —

  You started creating a Roof Manager account but didn't finish.
  Your 4 free reports are still reserved for you.

  [Complete your signup →]  (link: https://www.roofmanager.ca/register?email={urlencoded}&resume=1)

  — The Roof Manager Team

  ─────────────
  Don't want these emails? [Unsubscribe] (link: https://www.roofmanager.ca/api/customer-auth/signup-optout?email={urlencoded}&token={hmac})
  ```
- Include `List-Unsubscribe: <https://www.roofmanager.ca/api/customer-auth/signup-optout?email=...>` header.
- Mark `recovered=1` for each sent row to avoid duplicates.

### 5D — Unsubscribe endpoint

**GET `/api/customer-auth/signup-optout?email=...&token=...`**
- Verify HMAC (use `HMAC_SECRET` env var + email as message; if no HMAC_SECRET, fall back to accepting all). 
- Insert into `signup_recovery_optouts`. 
- Render: "You've been unsubscribed from signup reminder emails."

### 5E — On registration success

In the existing `POST /api/customer-auth/register` handler, after account creation add:
```sql
UPDATE signup_attempts SET completed = 1 WHERE email = ? AND completed = 0
```

On `/register?resume=1`: in the page JS, on load if `resume=1` is in the query, read email from query param, pre-fill `#reg-email`, and call `goToStep2(true)` to skip to step 2. Fire `signup_resumed` event.

**Acceptance:**
- Entering email in step 1, waiting (simulate with a DB insert with a past timestamp), receiving recovery email within the next cron run.
- Clicking the link shows `/register` with email pre-filled at step 2.
- Completing from that link marks the attempt `completed=1`.
- Unsubscribe link works and prevents future recovery emails for that email.
- `npm run build` + tests green.

---

## PHASE 6 — /onboarding activation wizard

Every new registration (Google OAuth, email/password, or magic-link) redirects to `/onboarding?welcome=1`. Currently this is a 404. Build the wizard.

**The goal:** get users to place their first report order in under 5 minutes, while the account still feels fresh.

### 6A — Route

```typescript
app.get('/onboarding', authMiddleware, async (c) => {
  const customer = c.get('customer');
  if (customer.onboarding_completed) return c.redirect('/customer/dashboard');
  return c.html(getOnboardingPageHTML(customer));
});
```

Use the same `authMiddleware` already used on `/customer/dashboard` etc. If unauthenticated, redirect to `/register`.

### 6B — Page: `getOnboardingPageHTML(customer)`

Three steps rendered as a single chrome-stripped page (no top nav, no footer). Progress bar at top: 3 circles.

**Step 1 — "Measure your first roof"**
- Header: `Welcome, {customer.name || 'there'}! Let's measure your first roof.`
- Sub: `You have 4 free reports ready to use. This takes about 60 seconds.`
- Address input with Google Places Autocomplete (reuse the same pattern from Phase 3 / `/order/new`).
- If the URL has `?welcome=1` and a `preview_id` from a prior session (read via a cookie or query param chain), pre-fill the address with the address stored in `preview_requests` for that preview_id, and show a banner: "We found your earlier preview."
- "Measure this roof →" button: POSTs to `/api/public/preview` (Phase 3). On success, shows a mini satellite thumbnail + stats and transitions to Step 2.
- Secondary: "Skip for now →" link that calls `POST /api/customer-auth/onboarding/complete` (exists at line 1003 in `customer-auth.ts`) with `{ step: 'skipped' }` and redirects to `/customer/dashboard`.

**Step 2 — "Confirm the roof" (address confirmed)**
- Shows the satellite thumbnail and area stats from Step 1.
- "This looks right — generate report →" primary button.
- "That's the wrong building" link that goes back to Step 1.
- On primary click, POST to `/api/orders` (or whatever the existing order creation endpoint is — look at how `/order/new` submits its form) to create a draft order using the address from step 1.
- On success, transition to Step 3 with the order_id.

**Step 3 — "Generating your report"**
- Animated progress bar (`setInterval` + width increment up to 95%, then wait for the real completion webhook or a poll).
- Poll `GET /api/orders/{order_id}/status` every 3 seconds. When status is `complete` or `delivered`:
  - Complete the progress bar to 100%.
  - Show: "Your report is ready! 🎉" with a "Download PDF" button and a secondary "Back to Dashboard →".
  - POST to `/api/customer-auth/onboarding/complete` with `{ step: 3 }`.
  - Fire `first_report_completed` event.
- Below the progress bar, show a referral nudge: "While you wait — share Roof Manager with a colleague and get 2 bonus reports." + a copy-to-clipboard referral link (read `customer.referral_code` which is generated at signup).

**Acceptance:**
- A new registration goes to `/onboarding`, enters an address, confirms, sees a progress bar, and ends on dashboard with `onboarding_completed=1`.
- Skipping the wizard redirects to dashboard and does not show the wizard again.
- A persistent yellow banner appears on dashboard for users with `onboarding_completed=0` (if this banner doesn't exist yet, add it to the dashboard HTML: `You have 4 free reports — generate your first one now →` linking to `/onboarding`. Add a dismiss button that stores `dismissed_until = now+24h` in `localStorage`).
- `npm run build` + tests green.

---

## PHASE 7 — Referral landing page `/r/:code`

The referral backend (referral_code generated at signup, referral_earnings table, referred_by_code accepted on register) already exists. Wire the missing public-facing endpoint.

### 7A — Route in `src/index.tsx`

```typescript
app.get('/r/:code', (c) => {
  const code = c.req.param('code');
  // Set a 30-day cookie: rr_ref={code}
  const headers = new Headers();
  headers.append('Set-Cookie', `rr_ref=${encodeURIComponent(code)}; Path=/; Max-Age=2592000; SameSite=Lax; Secure`);
  headers.append('Location', `/register?ref=${encodeURIComponent(code)}`);
  return new Response(null, { status: 302, headers });
});
```

### 7B — /register reads the referral code

In `getCustomerRegisterPageHTML()`, on page load JS:
```javascript
// Read ref from query param OR from rr_ref cookie
function getRefCode() {
  const qs = new URLSearchParams(window.location.search).get('ref');
  if (qs) return qs;
  const cookie = document.cookie.split(';').find(c => c.trim().startsWith('rr_ref='));
  return cookie ? decodeURIComponent(cookie.split('=')[1]) : '';
}
const refCode = getRefCode();
if (refCode) localStorage.setItem('rr_ref_code', refCode);
```

The `onEmailBlur` (Phase 2) and the Google OAuth handler (Phase 1) already read from `localStorage.rr_ref_code`. The email/password submit already reads `referred_by_code` from localStorage. So this wiring is already in place.

### 7C — Referral share widget on /onboarding and dashboard

On the Step 3 screen of `/onboarding` (while report is generating) and on the customer dashboard referrals section (`/customer/referrals`), render:

```html
<div style="background:rgba(0,255,136,0.07);border:1px solid rgba(0,255,136,0.2);border-radius:12px;padding:16px;margin-top:16px">
  <p style="font-weight:700;margin-bottom:8px">Share with a colleague — earn 2 bonus reports each</p>
  <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
    <input id="ref-link" readonly value="https://www.roofmanager.ca/r/{REFERRAL_CODE}"
      style="flex:1;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;background:#f9fafb">
    <button onclick="copyRefLink()" 
      style="padding:10px 16px;background:#00FF88;color:#0A0A0A;font-weight:700;border:none;border-radius:8px;cursor:pointer">
      Copy link
    </button>
  </div>
  <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
    <a href="mailto:?subject=Free%20roof%20measurement%20tool&body=I've%20been%20using%20Roof%20Manager%20for%20measurements%20%E2%80%94%20you%20get%204%20free%20reports%3A%20https%3A%2F%2Fwww.roofmanager.ca%2Fr%2F{REFERRAL_CODE}" 
       style="font-size:13px;padding:6px 12px;border:1px solid #d1d5db;border-radius:6px;text-decoration:none;color:#374151">
      ✉ Email
    </a>
    <a href="sms:?body=Try%20Roof%20Manager%20for%20free%20roof%20reports%3A%20https%3A%2F%2Fwww.roofmanager.ca%2Fr%2F{REFERRAL_CODE}"
       style="font-size:13px;padding:6px 12px;border:1px solid #d1d5db;border-radius:6px;text-decoration:none;color:#374151">
      💬 SMS
    </a>
    <a href="https://www.linkedin.com/sharing/share-offsite/?url=https%3A%2F%2Fwww.roofmanager.ca%2Fr%2F{REFERRAL_CODE}"
       target="_blank" rel="noopener"
       style="font-size:13px;padding:6px 12px;border:1px solid #d1d5db;border-radius:6px;text-decoration:none;color:#374151">
      in LinkedIn
    </a>
  </div>
</div>
```

Replace `{REFERRAL_CODE}` server-side from the customer's `referral_code`.

For the `/onboarding` page, pass `customer.referral_code` into `getOnboardingPageHTML()`.
For `/customer/referrals`, it's loaded dynamically — inject the referral code into a `window.rrCustomer = { referral_code: '...' }` variable in the page shell.

**Reward on referral sign-up:** In `POST /api/customer-auth/register` and `POST /api/customer-auth/google`, after account creation, if `referred_by_code` resolves to a valid customer:
1. Insert into `referral_earnings` (the table already exists): `{ referrer_id, referred_customer_id, commission_earned: 0, bonus_reports_granted: 2 }`.
2. Update referrer's `free_reports_remaining` (or however bonus reports are tracked in your schema — check the `customers` table columns) by +2.
3. Send the referrer a notification email: Subject `🎉 Someone joined via your Roof Manager link — 2 bonus reports added`.

**Acceptance:**
- Visiting `/r/TESTCODE` sets the `rr_ref` cookie and redirects to `/register?ref=TESTCODE`.
- Completing signup from that link stores `referred_by_code` and inserts a `referral_earnings` row.
- The referrer gets +2 reports and a notification email.
- The referral widget is visible on the onboarding wizard step 3 and on `/customer/referrals`.
- `npm run build` + tests green.

---

## PHASE 8 — Analytics instrumentation (Clarity + unified events)

Without instrumentation you can't optimize. This phase is small but foundational.

### 8A — `src/services/analytics-events.ts` (new file)

```typescript
// Unified analytics event helper
// Client-side: exported as a string to be injected inline in HTML pages
// Server-side: sends GA4 Measurement Protocol hits

export const CLIENT_ANALYTICS_SCRIPT = `
<script>
window.rrTrack = window.rrTrack || function(name, params) {
  try {
    if (typeof gtag !== 'undefined') gtag('event', name, params || {});
    if (window._rrAnalyticsQueue) window._rrAnalyticsQueue.push([name, params]);
  } catch(e) {}
};
// UTM capture — store in sessionStorage on first page load
(function() {
  const p = new URLSearchParams(location.search);
  const utm = {};
  ['source','medium','campaign','content','term'].forEach(k => {
    const v = p.get('utm_' + k); if (v) utm[k] = v;
  });
  if (Object.keys(utm).length) sessionStorage.setItem('rr_utm', new URLSearchParams(utm).toString());
  // page_view_engaged: fire after 10s + any scroll
  let scrolled = false, timerFired = false;
  function maybeEngaged() {
    if (scrolled && timerFired && !sessionStorage.getItem('rr_pve')) {
      sessionStorage.setItem('rr_pve', '1');
      rrTrack('page_view_engaged', {page: location.pathname});
    }
  }
  setTimeout(() => { timerFired = true; maybeEngaged(); }, 10000);
  window.addEventListener('scroll', function() { if (!scrolled) { scrolled = true; maybeEngaged(); } }, {once: true});
})();
</script>
`;

// Server-side: GA4 Measurement Protocol
export async function trackServerEvent(env: any, eventName: string, params: Record<string, any>) {
  const measurementId = env.GA4_MEASUREMENT_ID;
  const apiSecret = env.GA4_API_SECRET;
  if (!measurementId || !apiSecret) return;
  try {
    await fetch(`https://www.google-analytics.com/mp/collect?measurement_id=${measurementId}&api_secret=${apiSecret}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: params.user_id || 'server',
        events: [{ name: eventName, params: { ...params, engagement_time_msec: 1 } }]
      })
    });
  } catch {}
}
```

**Inject `CLIENT_ANALYTICS_SCRIPT`** in the GA4/analytics middleware block in `src/index.tsx` (around lines 95–240 where GA4 is injected). Import the constant and append it to the injected analytics HTML. Replace all bare `rrTrack(...)` calls in the codebase that aren't already going through this with the `window.rrTrack` pattern (they should already work since `rrTrack` is a global — just verify the function exists before the first call).

**Server-side sign_up hit:** In `POST /api/customer-auth/register` and `POST /api/customer-auth/google`, after successful account creation, call:
```typescript
await trackServerEvent(c.env, 'sign_up', { method: source === 'google' ? 'google' : 'email', user_id: newCustomerId.toString() });
```

### 8B — Microsoft Clarity

In the same analytics middleware block in `src/index.tsx`, add Clarity **after** the GA4 snippet, gated on `CLARITY_PROJECT_ID` env var:

```javascript
if (clarityId) {
  analyticsHtml += `<script type="text/javascript">
    (function(c,l,a,r,i,t,y){
      c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
      t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
      y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
    })(window,document,"clarity","script","${clarityId}");
  </script>`;
}
```

Add `data-clarity-mask="true"` to every password input and every financial input across all page functions in `src/index.tsx`. Search for `type="password"` and add the attribute. Search for inputs named `amount`, `price`, `card_number`, `cvv` and add it.

**Acceptance:**
- GA4 Realtime shows a `sign_up` event when a test registration completes (even with uBlock Origin enabled, because it's server-side MP).
- `page_view_engaged` fires after 10s + scroll in GA4 DebugView.
- Clarity records sessions on `/` and `/register` (verify via Clarity dashboard after setting `CLARITY_PROJECT_ID` in Cloudflare env).
- Password fields have `data-clarity-mask="true"`.
- `npm run build` + tests green.

---

## PHASE 9 — Social proof toasts + A/B module

### 9A — Social proof toasts

In `getLandingPageHTML()`, gated on a `SOCIAL_PROOF_ENABLED` env var (default off):

Add to the bottom of the page (before `</body>`) a small toast container and JS:

```html
<div id="sp-toast-container" 
  style="position:fixed;bottom:80px;left:16px;z-index:999;display:flex;flex-direction:column;gap:8px;pointer-events:none"
  aria-live="polite"></div>
```

JS (shown max 3 toasts per session, 12s apart, dismiss on click):
```javascript
(function() {
  if (sessionStorage.getItem('rr_sp_shown')) return;
  const msgs = [
    'Mike in Calgary just started a roof report',
    'Sarah in Austin registered for free',
    'James in Toronto generated a report today',
    'A contractor in Vancouver measured a 3,200 sq ft roof',
    'New signup from Edmonton — 4 free reports claimed'
  ];
  let count = 0;
  function showToast() {
    if (count >= 3) return;
    const msg = msgs[count % msgs.length];
    const el = document.createElement('div');
    el.style.cssText = 'background:#1a1a1a;color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;pointer-events:all;cursor:pointer;opacity:0;transition:opacity 0.3s;border:1px solid rgba(255,255,255,0.1);max-width:260px';
    el.innerHTML = '<span style="color:#00FF88;margin-right:6px">●</span>' + msg;
    el.onclick = () => el.remove();
    document.getElementById('sp-toast-container').appendChild(el);
    requestAnimationFrame(() => el.style.opacity = '1');
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 4000);
    count++;
    if (count < 3) setTimeout(showToast, 12000);
    else sessionStorage.setItem('rr_sp_shown', '1');
  }
  setTimeout(showToast, 8000); // first toast 8s after load
})();
```

Do not show on `/register`, `/customer/*`, `/admin*`, `/demo`, `/contact`. Check `window.location.pathname` before calling `showToast()`.

### 9B — `src/lib/ab.ts` A/B helper

```typescript
export function getVariant(testId: string, variants: string[]): string {
  if (typeof document === 'undefined') return variants[0];
  const cookieKey = 'rr_ab';
  const raw = document.cookie.split(';').find(c => c.trim().startsWith(cookieKey + '='));
  const stored: Record<string, string> = raw ? JSON.parse(decodeURIComponent(raw.split('=')[1].trim()) || '{}') : {};
  if (stored[testId] && variants.includes(stored[testId])) return stored[testId];
  // Assign deterministically: hash visitor_id + testId
  const visitorId = localStorage.getItem('rr_vid') || (() => { const id = Math.random().toString(36).slice(2); localStorage.setItem('rr_vid', id); return id; })();
  let hash = 0;
  for (const c of visitorId + testId) hash = ((hash << 5) - hash + c.charCodeAt(0)) | 0;
  const variant = variants[Math.abs(hash) % variants.length];
  stored[testId] = variant;
  document.cookie = cookieKey + '=' + encodeURIComponent(JSON.stringify(stored)) + ';path=/;max-age=2592000;samesite=lax';
  rrTrack('ab_exposure', {test: testId, variant});
  return variant;
}
```

This is a client-side-only helper. It's imported as a raw string and injected inline in the `getLandingPageHTML()` page. (Since the monolith is SSR, you can't import TS modules into inline scripts — export the function body as a `const AB_SCRIPT: string` and inject it, same as `CLIENT_ANALYTICS_SCRIPT` in Phase 8.)

**Wire up the announcement bar A/B test** using this helper (replacing the current inline localStorage logic at lines ~6736–6874 in `src/index.tsx`):
```javascript
const annVariant = getVariant('announcement_bar_2026', ['signup', 'demo']);
const abLink = document.getElementById('ab-link');
const abText = document.getElementById('ab-text');
if (annVariant === 'demo') {
  abLink.href = '/demo';
  if (abText) abText.textContent = 'Book a free 20-min demo →';
}
```

**Acceptance:**
- Clearing cookies and reloading 10 times assigns variants roughly 50/50 for a 2-variant test.
- Same variant is returned for 30 days after first assignment.
- `ab_exposure` fires once per session per test.
- Social proof toasts appear on the homepage (when `SOCIAL_PROOF_ENABLED=true`), throttle correctly, and never show on `/register` or `/customer/*`.
- `npm run build` + tests green.

---

## PHASE 10 — Exit-intent v2

Find the existing exit-intent modal in `src/index.tsx` (around line 6800). Replace its content (do not replace its trigger logic — just the HTML inside the modal and the submit handler).

**New modal content:**
```html
<h2 style="font-size:22px;font-weight:800;margin-bottom:8px">Wait — 4 free reports in 60 seconds</h2>
<p style="color:#6b7280;margin-bottom:20px;font-size:15px">No credit card. No commitment. See a real roof measurement before you decide.</p>

<!-- Google button (same handler as Phase 1) -->
<div class="g_id_signin" data-type="standard" data-shape="rectangular" data-theme="filled_blue"
  data-text="continue_with" data-size="large" data-width="100%"
  onclick="rrTrack('exit_intent_google_click')"></div>

<div style="display:flex;align-items:center;gap:12px;margin:14px 0">
  <div style="flex:1;height:1px;background:#e5e7eb"></div>
  <span style="font-size:12px;color:#9ca3af">or</span>
  <div style="flex:1;height:1px;background:#e5e7eb"></div>
</div>

<form onsubmit="exitIntentSubmit(event)">
  <input type="email" id="exit-email" placeholder="your@email.com" required
    style="width:100%;padding:12px 16px;border:1.5px solid #d1d5db;border-radius:10px;font-size:15px;margin-bottom:8px">
  <button type="submit"
    style="width:100%;padding:13px;background:#00FF88;color:#0A0A0A;font-weight:800;border:none;border-radius:10px;font-size:15px;cursor:pointer">
    Get 4 Free Reports →
  </button>
</form>
<p style="text-align:center;font-size:12px;color:#9ca3af;margin-top:8px">🔒 No spam · Unsubscribe any time</p>
```

**Update the trigger conditions** (find the existing `mouseleave` handler):
- Only show after 20s on page AND ≥30% scroll AND no prior CTA click this session AND not already shown this session.
- Suppress entirely on: `/register`, any `/customer/*`, any `/admin*`, `/onboarding`.
- Mobile trigger: keep the existing 45s + 50% scroll condition; suppress if any input on the page has been focused (check via a global `window._rrAnyInput` flag set on `focus` events with a `document.addEventListener('focusin', ...)` listener).

**`exitIntentSubmit(e)`:**
```javascript
function exitIntentSubmit(e) {
  e.preventDefault();
  const email = document.getElementById('exit-email').value;
  rrTrack('exit_intent_email_submit', {email_len: email.length});
  window.location.href = '/register?email=' + encodeURIComponent(email) + '&resume=1';
}
```

**Acceptance:**
- Exit intent never fires on `/register`, `/customer/*`, or `/admin*`.
- The modal shows the Google button + email form.
- Submitting the email goes to `/register?email=...&resume=1` with email pre-filled at step 1.
- `exit_intent_shown`, `exit_intent_google_click`, `exit_intent_email_submit` events fire correctly.
- `npm run build` + tests green.

---

## PHASE 11 — Final verification + env var checklist

After all phases, run:
```bash
npm run build
npx vitest run
git diff --stat main...HEAD
```

Then print to console (do not commit a file for this):

**New env vars required in Cloudflare (set via `wrangler secret put` or dashboard):**

| Var | Phase | If missing |
|-----|-------|-----------|
| `GOOGLE_OAUTH_CLIENT_ID` | 1 | Google button renders but OAuth fails |
| `GA4_API_SECRET` | 8 | Server-side sign_up event won't fire |
| `GA4_MEASUREMENT_ID` | 8 | (likely already set — verify) |
| `CLARITY_PROJECT_ID` | 8 | Clarity silently disabled |
| `SOLAR_API_DAILY_CAP` | 3 | Defaults to 500 free previews/day |
| `SOCIAL_PROOF_ENABLED` | 9 | Toasts silently disabled (safe default) |
| `HMAC_SECRET` | 5 | Unsubscribe tokens unverified (still works, less secure) |

**D1 migrations to run before deploy (in order):**
```bash
wrangler d1 execute roofing-production --file=migrations/0131_preview_requests.sql --env production
wrangler d1 execute roofing-production --file=migrations/0132_magic_link_tokens.sql --env production
wrangler d1 execute roofing-production --file=migrations/0133_signup_attempts.sql --env production
```

**Deploy:**
```bash
npm run deploy:prod
```

**GA4 funnel exploration sequence** (paste into GA4 Explorations → Funnel Exploration):
1. `page_view` on `/`
2. `page_view_engaged`
3. `hero_cta_click` (any variant) OR `address_entered`
4. `signup_started`
5. `signup_submit_success` OR `oauth_success`
6. `verify_email_verified` (email flow only)
7. `first_report_started`
8. `first_report_completed`

---

## Global non-goals

- No new frontend framework.
- No chat widget (needs vendor + privacy review).
- No paid A/B tools.
- No changes to pricing copy, measurement engine, or `/admin*` surfaces.
- No `--no-verify` on commits. No `--force` pushes. No amending.
- Do not invent a phone number for the TODO placeholder — leave the comment, let Ethan fill it in.

---

## What a user experiences end-to-end after all phases (print this in the final message)

A roofer in Calgary clicks a Google Ad for "xactimate roof measurement report". They land on the homepage and see the headline **"Xactimate-ready roof measurements in 60 seconds"** (the dynamic headline override from the campaign keyword). The primary affordance is an address input: "Enter a property address." They type their client's address, click "Measure this roof →", and in ~3 seconds see a satellite thumbnail of that roof with **2,840 sq ft · 5.2° pitch · 4 segments** below it. A green button reads "Create account to download the full report →". They click it and arrive at `/register` with a banner: "Your roof preview is saved." They see a large "Continue with Google" button and click it — OAuth takes 4 seconds — and they land at `/onboarding?welcome=1`. The wizard pre-fills their address, they confirm the building, and a progress bar runs while the real report generates. In 90 seconds they have a PDF in hand and 3 free reports remaining. In GA4 Realtime, Ethan sees: `page_view` → `page_view_engaged` → `hero_cta_click{address_start}` → `address_entered` → `preview_rendered` → `oauth_click{google}` → `oauth_success` → `first_report_started` → `first_report_completed`. The `sign_up` hit fires server-side via Measurement Protocol, so it shows even if the user had an ad blocker.

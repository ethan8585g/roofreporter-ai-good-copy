import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Bindings, AppEnv } from '../types'
import { validateAdminSession } from './auth'
import { getCustomerSessionToken } from '../lib/session-tokens'

export const fieldLogRoutes = new Hono<AppEnv>()

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function timesValid(start?: string | null, end?: string | null): boolean {
  if (!start || !end) return true
  return start < end
}

function randomToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function resolveAuth(c: Context<AppEnv>): Promise<
  | { kind: 'admin'; adminId: number; ownerId: number; name: string }
  | { kind: 'crew'; crewId: number; ownerId: number; name: string }
  | null
> {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (admin) return { kind: 'admin', adminId: admin.id, ownerId: 1000000 + admin.id, name: admin.name || admin.email }

  const token = getCustomerSessionToken(c)
  if (token) {
    const session = await c.env.DB.prepare(
      "SELECT customer_id FROM customer_sessions WHERE session_token = ? AND expires_at > datetime('now')"
    ).bind(token).first<any>()
    if (session) {
      const cust = await c.env.DB.prepare('SELECT id, name, email FROM customers WHERE id = ?')
        .bind(session.customer_id).first<any>()
      if (cust) return { kind: 'crew', crewId: cust.id, ownerId: cust.id, name: cust.name || cust.email }
    }
  }
  return null
}

// ────────────────────────────────────────────────────────────
// API — SUBMIT FIELD LOG (admin or crew via magic link)
// ────────────────────────────────────────────────────────────
fieldLogRoutes.post('/api/field-log', async (c) => {
  const auth = await resolveAuth(c)
  let submitterType: 'admin' | 'crew' | null = null
  let submitterId: number | null = null
  let submitterName: string | null = null
  let ownerIdForJob: number | null = null

  if (auth) {
    submitterType = auth.kind
    submitterId = auth.kind === 'admin' ? auth.adminId : auth.crewId
    submitterName = auth.name
    ownerIdForJob = auth.ownerId
  } else {
    const tokenHeader = c.req.header('X-Crew-Token') || ''
    const url = new URL(c.req.url)
    const tokenQ = url.searchParams.get('crew_token') || ''
    const crewToken = tokenHeader || tokenQ
    if (crewToken) {
      const row = await c.env.DB.prepare(
        'SELECT t.crew_member_id, t.owner_id, c.name, c.email FROM job_field_log_crew_tokens t ' +
        'JOIN customers c ON c.id = t.crew_member_id WHERE t.token = ? AND t.revoked_at IS NULL'
      ).bind(crewToken).first<any>()
      if (row) {
        submitterType = 'crew'
        submitterId = row.crew_member_id
        submitterName = row.name || row.email
        ownerIdForJob = row.owner_id
      }
    }
  }

  if (!submitterType || !submitterId) return c.json({ error: 'Unauthorized' }, 401)

  const body = await c.req.json().catch(() => ({} as any))
  const jobId = Number(body.job_id)
  const reportDate = String(body.report_date || '').trim()
  const crewStart = body.crew_start_time || null
  const crewEnd = body.crew_end_time || null
  const workCompleted = String(body.work_completed || '').trim()
  const issuesNotes = String(body.issues_notes || '').trim()
  const attendees: Array<{ crew_member_id: number; name?: string; start_time?: string; end_time?: string }> = Array.isArray(body.attendees) ? body.attendees : []
  const photos: Array<{ photo_data: string; caption?: string }> = Array.isArray(body.photos) ? body.photos : []

  if (!jobId || !reportDate) return c.json({ error: 'job_id and report_date are required' }, 400)
  if (!timesValid(crewStart, crewEnd)) return c.json({ error: 'crew_end_time must be after crew_start_time' }, 400)
  for (const a of attendees) {
    if (!timesValid(a.start_time, a.end_time)) return c.json({ error: 'Attendee end_time must be after start_time' }, 400)
  }

  // Scope: the job must belong to this owner.
  const job = await c.env.DB.prepare('SELECT id, owner_id, status FROM crm_jobs WHERE id = ?').bind(jobId).first<any>()
  if (!job) return c.json({ error: 'Job not found' }, 404)
  if (ownerIdForJob !== null && job.owner_id !== ownerIdForJob) {
    return c.json({ error: 'Job does not belong to this account' }, 403)
  }

  const ins = await c.env.DB.prepare(
    'INSERT INTO job_field_logs (job_id, report_date, submitter_type, submitter_id, submitter_name, crew_start_time, crew_end_time, work_completed, issues_notes) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(jobId, reportDate, submitterType, submitterId, submitterName, crewStart, crewEnd, workCompleted, issuesNotes).run()
  const logId = Number((ins as any).meta?.last_row_id)

  for (const a of attendees) {
    if (!a.crew_member_id) continue
    await c.env.DB.prepare(
      'INSERT INTO job_field_log_attendees (log_id, crew_member_id, crew_member_name, start_time, end_time) VALUES (?, ?, ?, ?, ?)'
    ).bind(logId, Number(a.crew_member_id), a.name || null, a.start_time || null, a.end_time || null).run()
  }

  for (const p of photos) {
    if (!p.photo_data) continue
    await c.env.DB.prepare(
      'INSERT INTO job_field_log_photos (log_id, photo_data, caption) VALUES (?, ?, ?)'
    ).bind(logId, p.photo_data, p.caption || null).run()
  }

  // Flip scheduled → in_progress on first submission.
  if (job.status === 'scheduled') {
    await c.env.DB.prepare("UPDATE crm_jobs SET status = 'in_progress', updated_at = datetime('now') WHERE id = ?").bind(jobId).run()
  }

  return c.json({ ok: true, log_id: logId })
})

// ────────────────────────────────────────────────────────────
// API — LIST LOGS FOR A JOB (admin only)
// ────────────────────────────────────────────────────────────
fieldLogRoutes.get('/api/field-log/job/:jobId', async (c) => {
  const auth = await resolveAuth(c)
  if (!auth || auth.kind !== 'admin') return c.json({ error: 'Unauthorized' }, 401)
  const jobId = Number(c.req.param('jobId'))
  const logs = await c.env.DB.prepare(
    'SELECT * FROM job_field_logs WHERE job_id = ? ORDER BY report_date DESC, id DESC'
  ).bind(jobId).all<any>()
  return c.json({ logs: logs.results || [] })
})

// ────────────────────────────────────────────────────────────
// API — GET SINGLE LOG WITH ATTENDEES + PHOTOS
// ────────────────────────────────────────────────────────────
fieldLogRoutes.get('/api/field-log/:id', async (c) => {
  const auth = await resolveAuth(c)
  if (!auth || auth.kind !== 'admin') return c.json({ error: 'Unauthorized' }, 401)
  const id = Number(c.req.param('id'))
  const log = await c.env.DB.prepare('SELECT * FROM job_field_logs WHERE id = ?').bind(id).first<any>()
  if (!log) return c.json({ error: 'Not found' }, 404)
  const attendees = await c.env.DB.prepare('SELECT * FROM job_field_log_attendees WHERE log_id = ?').bind(id).all<any>()
  const photos = await c.env.DB.prepare('SELECT id, caption, created_at FROM job_field_log_photos WHERE log_id = ? ORDER BY id').bind(id).all<any>()
  return c.json({ log, attendees: attendees.results || [], photos: photos.results || [] })
})

fieldLogRoutes.get('/api/field-log/photo/:photoId', async (c) => {
  const auth = await resolveAuth(c)
  if (!auth) return c.json({ error: 'Unauthorized' }, 401)
  const pid = Number(c.req.param('photoId'))
  const row = await c.env.DB.prepare('SELECT photo_data FROM job_field_log_photos WHERE id = ?').bind(pid).first<any>()
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({ photo_data: row.photo_data })
})

// ────────────────────────────────────────────────────────────
// API — ISSUE / REVOKE crew magic-link token (admin only)
// ────────────────────────────────────────────────────────────
fieldLogRoutes.post('/api/field-log/crew-tokens', async (c) => {
  const auth = await resolveAuth(c)
  if (!auth || auth.kind !== 'admin') return c.json({ error: 'Unauthorized' }, 401)
  const body = await c.req.json().catch(() => ({} as any))
  const crewId = Number(body.crew_member_id)
  if (!crewId) return c.json({ error: 'crew_member_id required' }, 400)
  const token = randomToken()
  await c.env.DB.prepare(
    'INSERT INTO job_field_log_crew_tokens (crew_member_id, owner_id, token) VALUES (?, ?, ?)'
  ).bind(crewId, auth.ownerId, token).run()
  const url = new URL(c.req.url)
  const link = `${url.origin}/field-log/submit?crew_token=${token}`
  return c.json({ ok: true, token, link })
})

fieldLogRoutes.get('/api/field-log/crew-tokens', async (c) => {
  const auth = await resolveAuth(c)
  if (!auth || auth.kind !== 'admin') return c.json({ error: 'Unauthorized' }, 401)
  const rows = await c.env.DB.prepare(
    'SELECT t.id, t.crew_member_id, t.token, t.created_at, t.revoked_at, c.name, c.email ' +
    'FROM job_field_log_crew_tokens t JOIN customers c ON c.id = t.crew_member_id ' +
    'WHERE t.owner_id = ? ORDER BY t.id DESC'
  ).bind(auth.ownerId).all<any>()
  return c.json({ tokens: rows.results || [] })
})

fieldLogRoutes.delete('/api/field-log/crew-tokens/:id', async (c) => {
  const auth = await resolveAuth(c)
  if (!auth || auth.kind !== 'admin') return c.json({ error: 'Unauthorized' }, 401)
  const id = Number(c.req.param('id'))
  await c.env.DB.prepare("UPDATE job_field_log_crew_tokens SET revoked_at = datetime('now') WHERE id = ? AND owner_id = ?")
    .bind(id, auth.ownerId).run()
  return c.json({ ok: true })
})

// ────────────────────────────────────────────────────────────
// API — helper: list this owner's jobs + crew (for UI pickers)
// ────────────────────────────────────────────────────────────
fieldLogRoutes.get('/api/field-log/context', async (c) => {
  const auth = await resolveAuth(c)
  if (!auth) {
    // crew magic-link context
    const url = new URL(c.req.url)
    const crewToken = url.searchParams.get('crew_token') || c.req.header('X-Crew-Token') || ''
    if (!crewToken) return c.json({ error: 'Unauthorized' }, 401)
    const row = await c.env.DB.prepare(
      'SELECT t.crew_member_id, t.owner_id, c.name FROM job_field_log_crew_tokens t ' +
      'JOIN customers c ON c.id = t.crew_member_id WHERE t.token = ? AND t.revoked_at IS NULL'
    ).bind(crewToken).first<any>()
    if (!row) return c.json({ error: 'Invalid token' }, 401)
    const jobs = await c.env.DB.prepare(
      'SELECT j.id, j.job_number, j.title, j.property_address, j.scheduled_date, j.status ' +
      'FROM crm_jobs j JOIN job_crew_assignments a ON a.job_id = j.id ' +
      "WHERE a.crew_member_id = ? AND j.status IN ('scheduled','in_progress') ORDER BY j.scheduled_date DESC"
    ).bind(row.crew_member_id).all<any>()
    const crew = await c.env.DB.prepare(
      'SELECT id, name, email FROM customers WHERE id IN (SELECT DISTINCT crew_member_id FROM job_crew_assignments WHERE job_id IN (SELECT id FROM crm_jobs WHERE owner_id = ?)) ORDER BY name'
    ).bind(row.owner_id).all<any>()
    return c.json({ submitter: { type: 'crew', id: row.crew_member_id, name: row.name }, jobs: jobs.results || [], crew: crew.results || [] })
  }

  const jobs = await c.env.DB.prepare(
    "SELECT id, job_number, title, property_address, scheduled_date, status FROM crm_jobs WHERE owner_id = ? AND status IN ('scheduled','in_progress') ORDER BY scheduled_date DESC"
  ).bind(auth.ownerId).all<any>()
  const crew = await c.env.DB.prepare(
    'SELECT id, name, email FROM customers WHERE id IN (SELECT DISTINCT crew_member_id FROM job_crew_assignments WHERE job_id IN (SELECT id FROM crm_jobs WHERE owner_id = ?)) ORDER BY name'
  ).bind(auth.ownerId).all<any>()
  return c.json({ submitter: { type: auth.kind, id: auth.kind === 'admin' ? auth.adminId : auth.crewId, name: auth.name }, jobs: jobs.results || [], crew: crew.results || [] })
})

// ────────────────────────────────────────────────────────────
// UI — CREW/ADMIN SUBMISSION FORM (mobile-first)
// ────────────────────────────────────────────────────────────
fieldLogRoutes.get('/field-log/submit', (c) => {
  const url = new URL(c.req.url)
  const crewToken = url.searchParams.get('crew_token') || ''
  const jobIdPreselect = url.searchParams.get('job_id') || ''
  return c.html(renderSubmitPage(crewToken, jobIdPreselect))
})

// ────────────────────────────────────────────────────────────
// UI — ADMIN DASHBOARD: job list + per-job log history + crew token manager
// ────────────────────────────────────────────────────────────
fieldLogRoutes.get('/field-log', (c) => {
  return c.html(renderAdminPage())
})

fieldLogRoutes.get('/field-log/job/:jobId', (c) => {
  const jobId = c.req.param('jobId')
  return c.html(renderJobDetailPage(jobId))
})

function renderSubmitPage(crewToken: string, jobIdPreselect: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
<title>Submit Daily Field Log — RoofManager</title>
<link rel="stylesheet" href="/static/tailwind.css" />
<style>
  body { font-family: -apple-system, system-ui, sans-serif; background:#0b1220; color:#e5e7eb; }
  .card { background:#111827; border:1px solid #1f2937; border-radius:14px; padding:16px; }
  .field { margin-bottom:14px; }
  .label { font-size:13px; font-weight:600; color:#9ca3af; margin-bottom:6px; display:block; }
  input, textarea, select { width:100%; background:#0b1220; border:1px solid #1f2937; color:#e5e7eb; border-radius:10px; padding:12px 14px; font-size:16px; }
  input:focus, textarea:focus, select:focus { outline:none; border-color:#3b82f6; }
  .btn { background:linear-gradient(135deg,#3b82f6,#2563eb); color:#fff; border:none; border-radius:10px; padding:14px; font-weight:700; font-size:16px; width:100%; }
  .btn:disabled { opacity:.5; }
  .chip { display:inline-flex; align-items:center; gap:6px; background:#1f2937; color:#e5e7eb; border-radius:999px; padding:6px 10px; font-size:13px; margin:4px 4px 0 0; }
  .photo-thumb { position:relative; display:inline-block; margin:4px; }
  .photo-thumb img { width:80px; height:80px; object-fit:cover; border-radius:8px; border:1px solid #1f2937; }
  .photo-thumb button { position:absolute; top:-6px; right:-6px; background:#ef4444; color:#fff; border:none; border-radius:999px; width:22px; height:22px; font-size:12px; }
</style>
</head>
<body class="min-h-screen p-4">
  <div class="max-w-xl mx-auto">
    <h1 class="text-2xl font-bold mb-1">Daily Field Log</h1>
    <p id="submitter-line" class="text-sm text-gray-400 mb-4">Loading…</p>

    <form id="form" class="card">
      <div class="field">
        <label class="label">Job Site</label>
        <select id="job_id" required></select>
      </div>
      <div class="field">
        <label class="label">Report Date</label>
        <input type="date" id="report_date" required />
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div class="field"><label class="label">Crew Start</label><input type="time" id="crew_start_time" /></div>
        <div class="field"><label class="label">Crew End</label><input type="time" id="crew_end_time" /></div>
      </div>
      <div class="field">
        <label class="label">Crew Present</label>
        <select id="attendee-picker"></select>
        <div id="attendees" class="mt-2"></div>
      </div>
      <div class="field">
        <label class="label">Work Completed Today</label>
        <textarea id="work_completed" rows="4" placeholder="e.g. tore off south slope, installed underlayment…"></textarea>
      </div>
      <div class="field">
        <label class="label">Issues / Notes</label>
        <textarea id="issues_notes" rows="3" placeholder="e.g. hidden rot under valley — needs decking swap"></textarea>
      </div>
      <div class="field">
        <label class="label">Progress Photos (unlimited)</label>
        <input type="file" id="photos" accept="image/*" multiple capture="environment" />
        <div id="photo-previews" class="mt-2"></div>
      </div>
      <button class="btn" id="submit-btn" type="submit">Submit Field Log</button>
      <p id="status" class="text-sm text-center mt-3"></p>
    </form>
  </div>

<script>
const CREW_TOKEN = ${JSON.stringify(crewToken)};
const PRESELECT_JOB = ${JSON.stringify(jobIdPreselect)};
const photos = [];
const attendees = [];
let crewList = [];

function authHeaders(extra = {}) {
  const h = Object.assign({ 'Content-Type': 'application/json' }, extra);
  if (CREW_TOKEN) h['X-Crew-Token'] = CREW_TOKEN;
  return h;
}
function contextUrl() {
  return CREW_TOKEN ? '/api/field-log/context?crew_token=' + encodeURIComponent(CREW_TOKEN) : '/api/field-log/context';
}
function submitUrl() {
  return CREW_TOKEN ? '/api/field-log?crew_token=' + encodeURIComponent(CREW_TOKEN) : '/api/field-log';
}

async function resizeImage(file, maxDim = 1600) {
  return new Promise((resolve) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => { img.src = e.target.result; };
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const r = maxDim / Math.max(width, height);
        width = Math.round(width * r); height = Math.round(height * r);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    reader.readAsDataURL(file);
  });
}

document.getElementById('photos').addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  for (const f of files) {
    const dataUrl = await resizeImage(f);
    photos.push({ photo_data: dataUrl, caption: '' });
  }
  renderPhotos();
  e.target.value = '';
});

function renderPhotos() {
  const wrap = document.getElementById('photo-previews');
  wrap.innerHTML = '';
  photos.forEach((p, i) => {
    const d = document.createElement('div');
    d.className = 'photo-thumb';
    d.innerHTML = '<img src="' + p.photo_data + '"><button type="button" data-i="' + i + '">X</button>';
    wrap.appendChild(d);
  });
  wrap.querySelectorAll('button').forEach(b => b.addEventListener('click', (e) => {
    photos.splice(Number(e.target.dataset.i), 1); renderPhotos();
  }));
}

function renderAttendees() {
  const wrap = document.getElementById('attendees');
  wrap.innerHTML = '';
  attendees.forEach((a, i) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = (a.name || 'Crew #' + a.crew_member_id) + ' <button type="button" data-i="' + i + '" style="background:none;border:none;color:#9ca3af;">x</button>';
    wrap.appendChild(chip);
  });
  wrap.querySelectorAll('button').forEach(b => b.addEventListener('click', (e) => {
    attendees.splice(Number(e.target.dataset.i), 1); renderAttendees();
  }));
}

document.getElementById('attendee-picker').addEventListener('change', (e) => {
  const id = Number(e.target.value);
  if (!id) return;
  if (!attendees.some(a => a.crew_member_id === id)) {
    const m = crewList.find(c => c.id === id);
    attendees.push({ crew_member_id: id, name: m ? (m.name || m.email) : null });
    renderAttendees();
  }
  e.target.value = '';
});

async function loadContext() {
  const r = await fetch(contextUrl(), { headers: authHeaders() });
  if (!r.ok) { document.getElementById('submitter-line').textContent = 'Not authorized — ask the office for a fresh link.'; return; }
  const data = await r.json();
  document.getElementById('submitter-line').textContent = 'Submitting as: ' + (data.submitter.name || 'Unknown');
  const jobSel = document.getElementById('job_id');
  jobSel.innerHTML = '<option value="">Select a job…</option>' +
    (data.jobs || []).map(j => '<option value="' + j.id + '">#' + (j.job_number || j.id) + ' — ' + (j.title || '') + ' (' + (j.property_address || '') + ')</option>').join('');
  if (PRESELECT_JOB) jobSel.value = PRESELECT_JOB;
  crewList = data.crew || [];
  const ap = document.getElementById('attendee-picker');
  ap.innerHTML = '<option value="">Add a crew member…</option>' +
    crewList.map(c => '<option value="' + c.id + '">' + (c.name || c.email) + '</option>').join('');
  document.getElementById('report_date').value = new Date().toISOString().slice(0, 10);
}

document.getElementById('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('submit-btn');
  const status = document.getElementById('status');
  btn.disabled = true; status.textContent = 'Uploading ' + photos.length + ' photo' + (photos.length === 1 ? '' : 's') + '…'; status.style.color = '#9ca3af';
  const payload = {
    job_id: Number(document.getElementById('job_id').value),
    report_date: document.getElementById('report_date').value,
    crew_start_time: document.getElementById('crew_start_time').value || null,
    crew_end_time: document.getElementById('crew_end_time').value || null,
    work_completed: document.getElementById('work_completed').value,
    issues_notes: document.getElementById('issues_notes').value,
    attendees, photos
  };
  if (payload.crew_start_time && payload.crew_end_time && payload.crew_start_time >= payload.crew_end_time) {
    status.textContent = 'End time must be after start time.'; status.style.color = '#ef4444'; btn.disabled = false; return;
  }
  try {
    const r = await fetch(submitUrl(), { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Submit failed');
    status.textContent = 'Submitted. Thanks!'; status.style.color = '#10b981';
    photos.length = 0; attendees.length = 0; renderPhotos(); renderAttendees();
    document.getElementById('form').reset();
    document.getElementById('report_date').value = new Date().toISOString().slice(0, 10);
  } catch (err) {
    status.textContent = err.message; status.style.color = '#ef4444';
  } finally { btn.disabled = false; }
});

loadContext();
</script>
</body>
</html>`
}

function renderAdminPage(): string {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Field Log — Jobs & Crew</title>
<link rel="stylesheet" href="/static/tailwind.css" />
<style>
  body { font-family:-apple-system,system-ui,sans-serif; background:#0b1220; color:#e5e7eb; }
  .card { background:#111827; border:1px solid #1f2937; border-radius:14px; padding:18px; }
  .btn { background:linear-gradient(135deg,#3b82f6,#2563eb); color:#fff; border:none; border-radius:10px; padding:10px 14px; font-weight:600; }
  .btn-sm { padding:6px 10px; font-size:13px; }
  .btn-red { background:#ef4444; }
  table { width:100%; border-collapse:collapse; }
  th, td { text-align:left; padding:10px 8px; border-bottom:1px solid #1f2937; font-size:14px; }
  th { color:#9ca3af; font-weight:600; font-size:12px; text-transform:uppercase; }
  a.link { color:#60a5fa; }
  input { background:#0b1220; border:1px solid #1f2937; color:#e5e7eb; border-radius:8px; padding:8px 10px; }
</style></head>
<body class="min-h-screen p-6">
  <div class="max-w-5xl mx-auto">
    <h1 class="text-3xl font-bold mb-6">Field Log — Jobs & Crew</h1>

    <div class="card mb-6">
      <h2 class="text-lg font-semibold mb-3">Active Jobs</h2>
      <table><thead><tr><th>Job #</th><th>Title</th><th>Address</th><th>Date</th><th>Status</th><th></th></tr></thead>
      <tbody id="jobs-body"><tr><td colspan="6" class="text-gray-500">Loading…</td></tr></tbody></table>
    </div>

    <div class="card">
      <h2 class="text-lg font-semibold mb-3">Crew Magic Links</h2>
      <p class="text-sm text-gray-400 mb-3">Share these links with crew members so they can submit logs from the field (no login required).</p>
      <div class="mb-3">
        <select id="crew-select" class="mr-2"></select>
        <button class="btn btn-sm" id="issue-btn">Issue Link</button>
      </div>
      <table><thead><tr><th>Crew</th><th>Link</th><th>Created</th><th>Status</th><th></th></tr></thead>
      <tbody id="tokens-body"><tr><td colspan="5" class="text-gray-500">Loading…</td></tr></tbody></table>
    </div>
  </div>

<script>
async function api(url, opts = {}) {
  const r = await fetch(url, Object.assign({ credentials: 'include' }, opts));
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Request failed');
  return r.json();
}

async function loadJobs() {
  const data = await api('/api/field-log/context');
  const body = document.getElementById('jobs-body');
  body.innerHTML = '';
  for (const j of data.jobs) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>#' + (j.job_number || j.id) + '</td>' +
      '<td>' + (j.title || '') + '</td>' +
      '<td>' + (j.property_address || '') + '</td>' +
      '<td>' + (j.scheduled_date || '') + '</td>' +
      '<td>' + (j.status || '') + '</td>' +
      '<td><a class="link" href="/field-log/job/' + j.id + '">View logs</a> · <a class="link" href="/field-log/submit?job_id=' + j.id + '">New log</a></td>';
    body.appendChild(tr);
  }
  if (!data.jobs.length) body.innerHTML = '<tr><td colspan="6" class="text-gray-500">No active jobs.</td></tr>';
  const sel = document.getElementById('crew-select');
  sel.innerHTML = '<option value="">Select a crew member…</option>' +
    (data.crew || []).map(c => '<option value="' + c.id + '">' + (c.name || c.email) + '</option>').join('');
}

async function loadTokens() {
  const data = await api('/api/field-log/crew-tokens');
  const body = document.getElementById('tokens-body');
  body.innerHTML = '';
  for (const t of data.tokens) {
    const link = location.origin + '/field-log/submit?crew_token=' + t.token;
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + (t.name || t.email) + '</td>' +
      '<td><input value="' + link + '" readonly onclick="this.select()" style="width:100%" /></td>' +
      '<td>' + (t.created_at || '').slice(0, 10) + '</td>' +
      '<td>' + (t.revoked_at ? '<span style="color:#ef4444">revoked</span>' : '<span style="color:#10b981">active</span>') + '</td>' +
      '<td>' + (t.revoked_at ? '' : '<button class="btn btn-sm btn-red" data-id="' + t.id + '">Revoke</button>') + '</td>';
    body.appendChild(tr);
  }
  if (!data.tokens.length) body.innerHTML = '<tr><td colspan="5" class="text-gray-500">No tokens issued yet.</td></tr>';
  body.querySelectorAll('button[data-id]').forEach(b => b.addEventListener('click', async () => {
    await api('/api/field-log/crew-tokens/' + b.dataset.id, { method: 'DELETE' });
    loadTokens();
  }));
}

document.getElementById('issue-btn').addEventListener('click', async () => {
  const id = Number(document.getElementById('crew-select').value);
  if (!id) return;
  await api('/api/field-log/crew-tokens', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ crew_member_id: id }) });
  loadTokens();
});

loadJobs().catch(e => { document.getElementById('jobs-body').innerHTML = '<tr><td colspan="6" style="color:#ef4444">' + e.message + '</td></tr>'; });
loadTokens().catch(e => { document.getElementById('tokens-body').innerHTML = '<tr><td colspan="5" style="color:#ef4444">' + e.message + '</td></tr>'; });
</script>
</body></html>`
}

function renderJobDetailPage(jobId: string): string {
  const safe = esc(jobId)
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Job ${safe} — Field Logs</title>
<link rel="stylesheet" href="/static/tailwind.css" />
<style>
  body { font-family:-apple-system,system-ui,sans-serif; background:#0b1220; color:#e5e7eb; }
  .card { background:#111827; border:1px solid #1f2937; border-radius:14px; padding:16px; margin-bottom:14px; }
  .label { font-size:12px; color:#9ca3af; text-transform:uppercase; letter-spacing:.04em; }
  .photo-grid img { width:140px; height:140px; object-fit:cover; border-radius:10px; border:1px solid #1f2937; margin:4px; cursor:pointer; }
  a.link { color:#60a5fa; }
</style></head>
<body class="min-h-screen p-6">
  <div class="max-w-4xl mx-auto">
    <a class="link text-sm" href="/field-log">&larr; All jobs</a>
    <h1 class="text-2xl font-bold my-4">Field Logs for Job ${safe}</h1>
    <div id="logs">Loading…</div>
  </div>
<script>
const JOB_ID = ${JSON.stringify(jobId)};
async function load() {
  const r = await fetch('/api/field-log/job/' + JOB_ID, { credentials: 'include' });
  const data = await r.json();
  const root = document.getElementById('logs');
  root.innerHTML = '';
  if (!(data.logs || []).length) { root.innerHTML = '<p class="text-gray-500">No logs yet.</p>'; return; }
  for (const l of data.logs) {
    const d = await fetch('/api/field-log/' + l.id, { credentials: 'include' }).then(r => r.json());
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML =
      '<div class="flex justify-between mb-2"><div><div class="label">Date</div><div class="font-semibold">' + l.report_date + '</div></div>' +
      '<div><div class="label">Submitted by</div><div class="font-semibold">' + (l.submitter_name || '—') + ' <span class="text-xs text-gray-500">(' + l.submitter_type + ')</span></div></div>' +
      '<div><div class="label">Crew Times</div><div>' + (l.crew_start_time || '—') + ' to ' + (l.crew_end_time || '—') + '</div></div></div>' +
      (l.work_completed ? '<div class="label mt-3">Work Completed</div><p>' + escapeHtml(l.work_completed) + '</p>' : '') +
      (l.issues_notes ? '<div class="label mt-3">Issues / Notes</div><p>' + escapeHtml(l.issues_notes) + '</p>' : '') +
      ((d.attendees || []).length ? '<div class="label mt-3">Crew Present</div><p>' + d.attendees.map(a => escapeHtml(a.crew_member_name || 'Crew #' + a.crew_member_id) + (a.start_time ? ' (' + a.start_time + '-' + (a.end_time || '?') + ')' : '')).join(', ') + '</p>' : '') +
      ((d.photos || []).length ? '<div class="label mt-3">Photos (' + d.photos.length + ')</div><div class="photo-grid" id="pg-' + l.id + '"></div>' : '');
    root.appendChild(card);
    const pg = document.getElementById('pg-' + l.id);
    if (pg) for (const p of d.photos) {
      const pr = await fetch('/api/field-log/photo/' + p.id, { credentials: 'include' }).then(r => r.json());
      const img = document.createElement('img');
      img.src = pr.photo_data;
      img.onclick = () => window.open(pr.photo_data, '_blank');
      pg.appendChild(img);
    }
  }
}
function escapeHtml(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
load();
</script>
</body></html>`
}

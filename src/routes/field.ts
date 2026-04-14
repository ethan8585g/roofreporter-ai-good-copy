// ============================================================
// Field App — crew-facing mobile PWA
// ============================================================
// PIN-based login, offline-first job list, GPS check-ins, photo uploads.
// UI served at /field; API at /api/field/*.
// ============================================================

import { Hono } from 'hono'
import type { Bindings } from '../types'

export const fieldRoutes = new Hono<{ Bindings: Bindings }>()
export const fieldUiRoutes = new Hono<{ Bindings: Bindings }>()

// ---------------- helpers ----------------

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function randomToken(): string {
  const a = new Uint8Array(24)
  crypto.getRandomValues(a)
  return Array.from(a).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function requireCrew(c: any): Promise<{ crewId: number; ownerId: number } | null> {
  const auth = c.req.header('Authorization') || ''
  const token = auth.replace('Bearer ', '').trim()
  if (!token) return null
  const row = await c.env.DB.prepare(
    `SELECT crew_member_id, owner_id FROM field_sessions WHERE token = ? AND expires_at > datetime('now')`
  ).bind(token).first<any>()
  if (!row) return null
  return { crewId: row.crew_member_id, ownerId: row.owner_id }
}

// ---------------- auth ----------------

// Owner/admin provisions a PIN for a crew member (team_member whose crew_member_id is the customer.id)
fieldRoutes.post('/set-pin', async (c) => {
  const { crew_member_id, owner_id, pin } = await c.req.json<any>()
  if (!crew_member_id || !owner_id || !pin || String(pin).length < 4) {
    return c.json({ error: 'crew_member_id, owner_id, pin (4+ digits) required' }, 400)
  }
  const hash = await sha256(`${crew_member_id}:${pin}`)
  await c.env.DB.prepare(
    `INSERT INTO field_crew_pins (crew_member_id, owner_id, pin_hash)
     VALUES (?, ?, ?)
     ON CONFLICT(crew_member_id) DO UPDATE SET pin_hash = excluded.pin_hash`
  ).bind(crew_member_id, owner_id, hash).run()
  return c.json({ ok: true })
})

fieldRoutes.post('/login', async (c) => {
  const { crew_member_id, pin } = await c.req.json<any>()
  if (!crew_member_id || !pin) return c.json({ error: 'crew_member_id and pin required' }, 400)
  const hash = await sha256(`${crew_member_id}:${pin}`)
  const row = await c.env.DB.prepare(
    `SELECT crew_member_id, owner_id FROM field_crew_pins WHERE crew_member_id = ? AND pin_hash = ?`
  ).bind(crew_member_id, hash).first<any>()
  if (!row) return c.json({ error: 'invalid credentials' }, 401)

  const token = randomToken()
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  await c.env.DB.prepare(
    `INSERT INTO field_sessions (token, crew_member_id, owner_id, expires_at) VALUES (?, ?, ?, ?)`
  ).bind(token, row.crew_member_id, row.owner_id, expires).run()
  await c.env.DB.prepare(
    `UPDATE field_crew_pins SET last_login_at = datetime('now') WHERE crew_member_id = ?`
  ).bind(row.crew_member_id).run()

  const name = await c.env.DB.prepare(`SELECT name, email FROM customers WHERE id = ?`).bind(row.crew_member_id).first<any>()
  return c.json({ token, crew_member_id: row.crew_member_id, owner_id: row.owner_id, name: name?.name || '', email: name?.email || '' })
})

fieldRoutes.post('/logout', async (c) => {
  const auth = c.req.header('Authorization') || ''
  const token = auth.replace('Bearer ', '').trim()
  if (token) await c.env.DB.prepare(`DELETE FROM field_sessions WHERE token = ?`).bind(token).run()
  return c.json({ ok: true })
})

// ---------------- jobs ----------------

// Today/upcoming jobs assigned to this crew
fieldRoutes.get('/jobs', async (c) => {
  const crew = await requireCrew(c)
  if (!crew) return c.json({ error: 'unauthorized' }, 401)
  const rows = await c.env.DB.prepare(
    `SELECT j.id, j.job_number, j.title, j.property_address, j.job_type, j.scheduled_date,
            j.scheduled_time, j.status, j.notes,
            (SELECT event_type FROM field_check_ins fc
               WHERE fc.job_id = j.id AND fc.crew_member_id = ?
               ORDER BY fc.created_at DESC LIMIT 1) AS last_event
       FROM crm_jobs j
       JOIN job_crew_assignments a ON a.job_id = j.id
      WHERE a.crew_member_id = ?
        AND j.status IN ('scheduled','in_progress')
      ORDER BY j.scheduled_date ASC, j.scheduled_time ASC
      LIMIT 50`
  ).bind(crew.crewId, crew.crewId).all<any>()
  return c.json({ jobs: rows.results || [] })
})

fieldRoutes.get('/jobs/:id', async (c) => {
  const crew = await requireCrew(c)
  if (!crew) return c.json({ error: 'unauthorized' }, 401)
  const id = Number(c.req.param('id'))
  const job = await c.env.DB.prepare(
    `SELECT j.* FROM crm_jobs j
       JOIN job_crew_assignments a ON a.job_id = j.id
      WHERE j.id = ? AND a.crew_member_id = ?`
  ).bind(id, crew.crewId).first<any>()
  if (!job) return c.json({ error: 'not found' }, 404)
  const checklist = await c.env.DB.prepare(
    `SELECT id, label, item_type, is_completed FROM crm_job_checklist WHERE job_id = ? ORDER BY sort_order, id`
  ).bind(id).all<any>()
  const photos = await c.env.DB.prepare(
    `SELECT id, phase, caption, taken_at FROM job_photos WHERE job_id = ? ORDER BY taken_at DESC LIMIT 30`
  ).bind(id).all<any>()
  return c.json({ job, checklist: checklist.results || [], photos: photos.results || [] })
})

// ---------------- check-ins ----------------

fieldRoutes.post('/check-in', async (c) => {
  const crew = await requireCrew(c)
  if (!crew) return c.json({ error: 'unauthorized' }, 401)
  const { job_id, event_type, lat, lng, accuracy_m, client_event_id } = await c.req.json<any>()
  if (!job_id || !event_type) return c.json({ error: 'job_id and event_type required' }, 400)
  if (!['check_in', 'check_out', 'break_start', 'break_end'].includes(event_type)) {
    return c.json({ error: 'bad event_type' }, 400)
  }

  // Idempotency for offline replay
  if (client_event_id) {
    const existing = await c.env.DB.prepare(
      `SELECT id FROM field_check_ins WHERE client_event_id = ?`
    ).bind(client_event_id).first<any>()
    if (existing) return c.json({ ok: true, id: existing.id, deduped: true })
  }

  const res = await c.env.DB.prepare(
    `INSERT INTO field_check_ins (job_id, crew_member_id, event_type, lat, lng, accuracy_m, client_event_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(job_id, crew.crewId, event_type, lat ?? null, lng ?? null, accuracy_m ?? null, client_event_id ?? null).run()

  // Flip job to in_progress on first check-in
  if (event_type === 'check_in') {
    await c.env.DB.prepare(
      `UPDATE crm_jobs SET status = 'in_progress', updated_at = datetime('now')
        WHERE id = ? AND status = 'scheduled'`
    ).bind(job_id).run()
  }

  return c.json({ ok: true, id: res.meta.last_row_id })
})

fieldRoutes.get('/check-ins/:jobId', async (c) => {
  const crew = await requireCrew(c)
  if (!crew) return c.json({ error: 'unauthorized' }, 401)
  const jobId = Number(c.req.param('jobId'))
  const rows = await c.env.DB.prepare(
    `SELECT id, event_type, lat, lng, accuracy_m, created_at
       FROM field_check_ins WHERE job_id = ? AND crew_member_id = ?
      ORDER BY created_at DESC LIMIT 100`
  ).bind(jobId, crew.crewId).all<any>()
  return c.json({ events: rows.results || [] })
})

// ---------------- photos ----------------

fieldRoutes.post('/photos', async (c) => {
  const crew = await requireCrew(c)
  if (!crew) return c.json({ error: 'unauthorized' }, 401)
  const { job_id, data_url, caption, phase, lat, lng } = await c.req.json<any>()
  if (!job_id || !data_url) return c.json({ error: 'job_id and data_url required' }, 400)
  if (!data_url.startsWith('data:image/')) return c.json({ error: 'data_url must be image' }, 400)
  if (data_url.length > 8 * 1024 * 1024) return c.json({ error: 'image too large (8MB max)' }, 400)

  const author = await c.env.DB.prepare(`SELECT name FROM customers WHERE id = ?`).bind(crew.crewId).first<any>()
  const res = await c.env.DB.prepare(
    `INSERT INTO job_photos (job_id, crew_member_id, author_name, data_url, caption, phase, lat, lng)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    job_id, crew.crewId, author?.name || '', data_url,
    caption || '', phase || 'during', lat ?? null, lng ?? null
  ).run()
  return c.json({ ok: true, id: res.meta.last_row_id })
})

// ---------------- checklist toggle ----------------

fieldRoutes.post('/checklist/:itemId/toggle', async (c) => {
  const crew = await requireCrew(c)
  if (!crew) return c.json({ error: 'unauthorized' }, 401)
  const itemId = Number(c.req.param('itemId'))
  const { is_completed } = await c.req.json<any>()
  await c.env.DB.prepare(
    `UPDATE crm_job_checklist
        SET is_completed = ?, completed_at = CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END
      WHERE id = ?`
  ).bind(is_completed ? 1 : 0, is_completed ? 1 : 0, itemId).run()
  return c.json({ ok: true })
})

// ============================================================
// UI — served at /field (PWA shell, offline-capable)
// ============================================================

const FIELD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
<meta name="theme-color" content="#0b1220" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<title>Roof Manager — Field</title>
<link rel="manifest" href="/field/manifest.webmanifest" />
<style>
  :root { --bg:#0b1220; --card:#111a2e; --line:#1f2a44; --text:#e7ecf5; --muted:#93a4c3; --accent:#3b82f6; --ok:#10b981; --warn:#f59e0b; --err:#ef4444; }
  * { box-sizing:border-box; }
  html,body { margin:0; padding:0; background:var(--bg); color:var(--text); font:15px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  header { position:sticky; top:0; z-index:5; background:rgba(11,18,32,.95); backdrop-filter:blur(8px); border-bottom:1px solid var(--line); padding:env(safe-area-inset-top) 16px 12px; }
  .h { display:flex; align-items:center; justify-content:space-between; padding-top:12px; }
  .h h1 { font-size:17px; margin:0; }
  .sync { font-size:12px; color:var(--muted); }
  .sync.bad { color:var(--warn); }
  main { padding:14px 14px 100px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:14px; margin:10px 0; }
  input, button, select, textarea { font:inherit; }
  input, textarea { width:100%; padding:12px 14px; border-radius:10px; border:1px solid var(--line); background:#0d1628; color:var(--text); }
  button { padding:12px 16px; border-radius:10px; border:0; background:var(--accent); color:#fff; font-weight:600; width:100%; margin-top:10px; }
  button.ghost { background:transparent; border:1px solid var(--line); color:var(--text); }
  button.ok { background:var(--ok); }
  button.warn { background:var(--warn); }
  button.err { background:var(--err); }
  .row { display:flex; gap:8px; }
  .row > * { flex:1; }
  .muted { color:var(--muted); font-size:13px; }
  .title { font-weight:600; font-size:16px; }
  .badge { display:inline-block; padding:3px 9px; border-radius:999px; font-size:11px; background:#1f2a44; color:var(--muted); margin-left:6px; }
  .badge.live { background:#064e3b; color:#6ee7b7; }
  .hidden { display:none !important; }
  .jobitem { cursor:pointer; }
  .back { background:none; border:0; color:var(--accent); padding:0; width:auto; margin:0 0 8px; font-weight:500; }
  .tabs { display:flex; gap:8px; margin:10px 0; }
  .tabs button { flex:1; margin:0; background:#0d1628; border:1px solid var(--line); color:var(--muted); padding:10px; }
  .tabs button.active { background:var(--accent); color:#fff; border-color:var(--accent); }
  .grid { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; }
  .thumb { aspect-ratio:1; background:#0d1628; border:1px solid var(--line); border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:11px; color:var(--muted); overflow:hidden; }
  .thumb img { width:100%; height:100%; object-fit:cover; }
  .queue { font-size:12px; color:var(--warn); }
  .pill { display:inline-block; padding:4px 10px; border-radius:999px; background:#0d1628; font-size:12px; color:var(--muted); margin-right:6px; }
</style>
</head>
<body>
<header>
  <div class="h">
    <h1>Roof Manager · Field</h1>
    <span id="sync" class="sync">·</span>
  </div>
</header>
<main>

<section id="loginView" class="hidden">
  <div class="card">
    <div class="title">Crew sign-in</div>
    <p class="muted">Use your crew ID and 4-digit PIN. Ask your manager if you don't have one yet.</p>
    <input id="crewId" inputmode="numeric" placeholder="Crew ID" />
    <input id="pin" inputmode="numeric" type="password" placeholder="PIN" style="margin-top:8px" />
    <button id="loginBtn">Sign in</button>
    <p id="loginErr" class="muted" style="color:var(--err)"></p>
  </div>
</section>

<section id="listView" class="hidden">
  <div class="card">
    <div class="title">Hello, <span id="meName">crew</span></div>
    <p class="muted" id="listHint">Today's jobs</p>
    <div class="row">
      <button class="ghost" onclick="app.refresh()">Refresh</button>
      <button class="ghost" onclick="app.logout()">Sign out</button>
    </div>
    <div class="queue hidden" id="queueLine"></div>
  </div>
  <div id="jobs"></div>
</section>

<section id="jobView" class="hidden">
  <button class="back" onclick="app.back()">← Back to jobs</button>
  <div class="card">
    <div id="jobHead"></div>
    <div class="row">
      <button class="ok" id="btnCheckIn">Check in</button>
      <button class="warn hidden" id="btnCheckOut">Check out</button>
    </div>
    <p class="muted" id="gpsStatus"></p>
  </div>

  <div class="card">
    <div class="title">Photos</div>
    <div class="tabs" id="phaseTabs">
      <button data-phase="before" class="active">Before</button>
      <button data-phase="during">During</button>
      <button data-phase="after">After</button>
    </div>
    <input type="file" id="photoInput" accept="image/*" capture="environment" style="display:none" />
    <button onclick="document.getElementById('photoInput').click()">Take / upload photo</button>
    <div id="photoGrid" class="grid" style="margin-top:10px"></div>
  </div>

  <div class="card">
    <div class="title">Checklist</div>
    <div id="checklist"></div>
  </div>

  <div class="card">
    <div class="title">Recent check-ins</div>
    <div id="events" class="muted"></div>
  </div>
</section>

</main>

<script>
// ---------------- IndexedDB queue ----------------
const DB_NAME = 'field-queue-v1';
function idbOpen() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache', { keyPath: 'k' });
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
async function qAdd(item) { const db = await idbOpen(); return new Promise((r,j)=>{ const tx=db.transaction('queue','readwrite'); tx.objectStore('queue').add({ ...item, ts: Date.now() }); tx.oncomplete=()=>r(); tx.onerror=()=>j(tx.error); }); }
async function qAll()   { const db = await idbOpen(); return new Promise((r,j)=>{ const tx=db.transaction('queue','readonly'); const rq=tx.objectStore('queue').getAll(); rq.onsuccess=()=>r(rq.result||[]); rq.onerror=()=>j(rq.error); }); }
async function qDel(id) { const db = await idbOpen(); return new Promise((r,j)=>{ const tx=db.transaction('queue','readwrite'); tx.objectStore('queue').delete(id); tx.oncomplete=()=>r(); tx.onerror=()=>j(tx.error); }); }
async function cacheSet(k,v){ const db=await idbOpen(); return new Promise((r)=>{ const tx=db.transaction('cache','readwrite'); tx.objectStore('cache').put({k,v}); tx.oncomplete=()=>r(); }); }
async function cacheGet(k){ const db=await idbOpen(); return new Promise((r)=>{ const tx=db.transaction('cache','readonly'); const rq=tx.objectStore('cache').get(k); rq.onsuccess=()=>r(rq.result?.v); rq.onerror=()=>r(undefined); }); }

// ---------------- API ----------------
const API = '/api/field';
const state = { token: localStorage.getItem('field_token')||'', me: JSON.parse(localStorage.getItem('field_me')||'null'), jobs: [], job: null, phase: 'before' };
function authHeaders(){ return state.token ? { 'Authorization': 'Bearer '+state.token, 'Content-Type':'application/json' } : { 'Content-Type':'application/json' }; }
async function api(path, opts={}) {
  const res = await fetch(API+path, { headers: authHeaders(), ...opts });
  if (res.status === 401) { logout(); throw new Error('unauthorized'); }
  return res.json();
}

// ---------------- Sync loop ----------------
let online = navigator.onLine;
window.addEventListener('online',  () => { online = true;  updateSync(); flush(); });
window.addEventListener('offline', () => { online = false; updateSync(); });
function updateSync(){
  const el = document.getElementById('sync');
  qAll().then(q => {
    const n = q.length;
    if (!online) { el.textContent = 'Offline' + (n?' · '+n+' queued':''); el.className='sync bad'; }
    else if (n)   { el.textContent = 'Syncing ' + n; el.className='sync bad'; }
    else          { el.textContent = 'Online'; el.className='sync'; }
    const ql = document.getElementById('queueLine');
    if (ql) { if (n){ ql.classList.remove('hidden'); ql.textContent = n+' update'+(n>1?'s':'')+' waiting to upload.'; } else ql.classList.add('hidden'); }
  });
}
async function flush(){
  if (!online || !state.token) return;
  const items = await qAll();
  for (const it of items) {
    try {
      const res = await fetch(API+it.path, { method:'POST', headers: authHeaders(), body: JSON.stringify(it.body) });
      if (res.ok) await qDel(it.id);
      else if (res.status === 401) { logout(); return; }
      else break; // stop, try later
    } catch { break; }
  }
  updateSync();
}
setInterval(flush, 15000);

// ---------------- Views ----------------
function show(id){ for (const v of ['loginView','listView','jobView']) document.getElementById(v).classList.toggle('hidden', v!==id); }

function logout(){
  state.token=''; state.me=null; localStorage.removeItem('field_token'); localStorage.removeItem('field_me');
  show('loginView');
}

async function login(){
  const crew_member_id = Number(document.getElementById('crewId').value.trim());
  const pin = document.getElementById('pin').value.trim();
  document.getElementById('loginErr').textContent='';
  try {
    const res = await fetch(API+'/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ crew_member_id, pin }) });
    const j = await res.json();
    if (!res.ok) { document.getElementById('loginErr').textContent = j.error||'login failed'; return; }
    state.token = j.token; state.me = { id:j.crew_member_id, owner_id:j.owner_id, name:j.name, email:j.email };
    localStorage.setItem('field_token', state.token);
    localStorage.setItem('field_me', JSON.stringify(state.me));
    afterLogin();
  } catch(e){ document.getElementById('loginErr').textContent='network error'; }
}

async function afterLogin(){
  document.getElementById('meName').textContent = state.me?.name || 'crew';
  show('listView');
  await loadJobs();
}

async function loadJobs(){
  try {
    if (online) {
      const j = await api('/jobs');
      state.jobs = j.jobs||[];
      await cacheSet('jobs', state.jobs);
    } else {
      state.jobs = (await cacheGet('jobs')) || [];
    }
  } catch { state.jobs = (await cacheGet('jobs')) || []; }
  renderJobs();
}
function renderJobs(){
  const root = document.getElementById('jobs');
  if (!state.jobs.length) { root.innerHTML = '<div class="card muted">No jobs scheduled. Pull to refresh when near a signal.</div>'; return; }
  root.innerHTML = state.jobs.map(j => \`
    <div class="card jobitem" onclick="app.openJob(\${j.id})">
      <div class="title">\${esc(j.title||'Job '+j.job_number)} <span class="badge \${j.last_event==='check_in'?'live':''}">\${j.status}\${j.last_event==='check_in'?' · on-site':''}</span></div>
      <div class="muted">\${esc(j.property_address||'')}</div>
      <div style="margin-top:6px">
        <span class="pill">\${j.scheduled_date||''}\${j.scheduled_time?' · '+j.scheduled_time:''}</span>
        <span class="pill">\${j.job_type||''}</span>
      </div>
    </div>\`).join('');
}
function esc(s){ return String(s??'').replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

async function openJob(id){
  let data = null;
  try {
    if (online) { data = await api('/jobs/'+id); await cacheSet('job:'+id, data); }
    else data = await cacheGet('job:'+id);
  } catch { data = await cacheGet('job:'+id); }
  if (!data) { alert('Job not cached for offline use'); return; }
  state.job = data;
  renderJob();
  show('jobView');
}
function renderJob(){
  const j = state.job.job;
  document.getElementById('jobHead').innerHTML = \`
    <div class="title">\${esc(j.title)}</div>
    <div class="muted">\${esc(j.property_address||'')}</div>
    <div style="margin-top:6px"><span class="pill">\${j.scheduled_date}\${j.scheduled_time?' · '+j.scheduled_time:''}</span><span class="pill">\${j.status}</span></div>
  \`;
  document.getElementById('checklist').innerHTML = (state.job.checklist||[]).map(c => \`
    <label style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--line)">
      <input type="checkbox" \${c.is_completed?'checked':''} onchange="app.toggleChecklist(\${c.id}, this.checked)" style="width:20px;height:20px"/>
      <span>\${esc(c.label)}</span>
    </label>
  \`).join('') || '<div class="muted">No checklist items.</div>';
  document.getElementById('events').innerHTML = '—';
  loadEvents();
  renderPhotos();
}
async function loadEvents(){
  if (!online) return;
  try {
    const ev = await api('/check-ins/'+state.job.job.id);
    document.getElementById('events').innerHTML = (ev.events||[]).slice(0,5).map(e => \`• \${e.event_type} · \${new Date(e.created_at+'Z').toLocaleString()}\`).join('<br>') || 'No events yet.';
  } catch {}
}
function renderPhotos(){
  const grid = document.getElementById('photoGrid');
  const photos = state.job.photos || [];
  const filtered = photos.filter(p => p.phase === state.phase);
  grid.innerHTML = filtered.slice(0,12).map(p => \`<div class="thumb">\${esc(p.caption||'photo')}</div>\`).join('') || '<div class="muted">No \${state.phase} photos yet.</div>'.replace('\${state.phase}', state.phase);
}

async function toggleChecklist(itemId, checked){
  const body = { is_completed: checked };
  if (online) { try { await fetch(API+'/checklist/'+itemId+'/toggle', { method:'POST', headers: authHeaders(), body: JSON.stringify(body)}); } catch { await qAdd({path:'/checklist/'+itemId+'/toggle', body}); } }
  else await qAdd({ path:'/checklist/'+itemId+'/toggle', body });
  updateSync();
}

async function getGps(){
  return new Promise(res => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(
      p => res({ lat:p.coords.latitude, lng:p.coords.longitude, accuracy_m:p.coords.accuracy }),
      () => res(null),
      { enableHighAccuracy:true, timeout:10000, maximumAge:30000 }
    );
  });
}

async function doCheck(event_type){
  const status = document.getElementById('gpsStatus');
  status.textContent = 'Getting GPS...';
  const g = await getGps();
  status.textContent = g ? 'GPS ±'+Math.round(g.accuracy_m)+'m' : 'No GPS fix (saved without location)';
  const body = { job_id: state.job.job.id, event_type, client_event_id: crypto.randomUUID(), ...(g||{}) };
  if (online) {
    try {
      const res = await fetch(API+'/check-in', { method:'POST', headers: authHeaders(), body: JSON.stringify(body) });
      if (!res.ok) throw new Error('bad');
    } catch { await qAdd({ path:'/check-in', body }); }
  } else {
    await qAdd({ path:'/check-in', body });
  }
  updateSync();
  // reflect in UI
  if (event_type === 'check_in') {
    document.getElementById('btnCheckIn').classList.add('hidden');
    document.getElementById('btnCheckOut').classList.remove('hidden');
  } else {
    document.getElementById('btnCheckIn').classList.remove('hidden');
    document.getElementById('btnCheckOut').classList.add('hidden');
  }
  loadEvents();
}

function fileToDataUrl(file){
  return new Promise((res, rej) => {
    const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(file);
  });
}
async function compressImage(file, maxDim=1600, quality=0.75){
  const dataUrl = await fileToDataUrl(file);
  const img = await new Promise((res, rej) => { const i=new Image(); i.onload=()=>res(i); i.onerror=rej; i.src=dataUrl; });
  const ratio = Math.min(1, maxDim/Math.max(img.width, img.height));
  const w = Math.round(img.width*ratio), h = Math.round(img.height*ratio);
  const canvas = document.createElement('canvas'); canvas.width=w; canvas.height=h;
  canvas.getContext('2d').drawImage(img, 0,0,w,h);
  return canvas.toDataURL('image/jpeg', quality);
}
async function onPhoto(e){
  const file = e.target.files?.[0]; if (!file) return;
  const dataUrl = await compressImage(file);
  const g = await getGps();
  const body = { job_id: state.job.job.id, data_url: dataUrl, phase: state.phase, caption: '', ...(g? { lat:g.lat, lng:g.lng }: {}) };
  if (online) {
    try { const res = await fetch(API+'/photos', { method:'POST', headers: authHeaders(), body: JSON.stringify(body) }); if (!res.ok) throw new Error('bad'); }
    catch { await qAdd({ path:'/photos', body }); }
  } else {
    await qAdd({ path:'/photos', body });
  }
  state.job.photos = [{ phase: state.phase, caption: 'just now' }, ...(state.job.photos||[])];
  renderPhotos(); updateSync();
  e.target.value = '';
}

// ---------------- bindings ----------------
document.getElementById('loginBtn').onclick = login;
document.getElementById('btnCheckIn').onclick = () => doCheck('check_in');
document.getElementById('btnCheckOut').onclick = () => doCheck('check_out');
document.getElementById('photoInput').onchange = onPhoto;
document.querySelectorAll('#phaseTabs button').forEach(btn => btn.onclick = () => {
  document.querySelectorAll('#phaseTabs button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  state.phase = btn.dataset.phase;
  renderPhotos();
});

window.app = {
  refresh: loadJobs, logout, openJob, back: () => { state.job=null; show('listView'); loadJobs(); }, toggleChecklist
};

// ---------------- boot ----------------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/field/sw.js').catch(()=>{});
updateSync();
if (state.token && state.me) afterLogin(); else show('loginView');
flush();
</script>
</body>
</html>`

const SW_JS = `
const CACHE = 'field-shell-v1';
const SHELL = ['/field', '/field/manifest.webmanifest'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.pathname === '/field' || url.pathname === '/field/' || url.pathname === '/field/manifest.webmanifest') {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => {
      const clone = res.clone(); caches.open(CACHE).then(c => c.put(e.request, clone)); return res;
    }).catch(() => caches.match('/field'))));
  }
});
`

const MANIFEST = {
  name: 'Roof Manager — Field',
  short_name: 'RM Field',
  start_url: '/field',
  display: 'standalone',
  background_color: '#0b1220',
  theme_color: '#0b1220',
  icons: [
    { src: '/favicon.ico', sizes: '64x64', type: 'image/x-icon' }
  ]
}

fieldUiRoutes.get('/', (c) => c.html(FIELD_HTML))
fieldUiRoutes.get('/sw.js', (c) => new Response(SW_JS, { headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Service-Worker-Allowed': '/field' } }))
fieldUiRoutes.get('/manifest.webmanifest', (c) => c.json(MANIFEST))

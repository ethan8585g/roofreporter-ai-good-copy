// ============================================================
// Super Admin — Manual Cold-Call Tracker
// HTML pages at /super-admin/cold-call*
// JSON at /api/super-admin/cold-call/*
// Independent of customer-cold-call.ts and call-center.ts.
// ============================================================

import { Hono } from 'hono'
import { validateAdminSession, requireSuperadmin } from './auth'
import {
  listLeads, getLead, createLead, updateLead, deleteLead,
  logCall, listLogsForLead, listAllLogs,
  getCallQueue, getStats,
  VALID_STATUSES, VALID_OUTCOMES,
} from '../repositories/cold-call'

import type { Bindings, AppEnv } from '../types'

export const superAdminColdCall = new Hono<AppEnv>()

superAdminColdCall.use('*', async (c, next) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) {
    if (c.req.path.includes('/api/')) return c.json({ error: 'superadmin required' }, 403)
    return c.redirect('/login?next=' + encodeURIComponent(c.req.path), 302)
  }
  ;(c as any).set('admin', admin)
  await next()
})

function periodToDays(p: string | undefined): number {
  if (p === '24h') return 1
  if (p === '30d') return 30
  if (p === '90d') return 90
  if (p === '365d') return 365
  return 7
}
function sinceIso(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().replace('T', ' ').slice(0, 19)
}

// ── JSON: leads ──────────────────────────────────────────────
superAdminColdCall.get('/api/leads', async (c) => {
  const status = c.req.query('status') || null
  const priority = c.req.query('priority') ? parseInt(c.req.query('priority') as string) : null
  const search = c.req.query('search') || null
  const limit = c.req.query('limit') ? parseInt(c.req.query('limit') as string) : 200
  const offset = c.req.query('offset') ? parseInt(c.req.query('offset') as string) : 0
  const rows = await listLeads(c.env.DB, { status, priority, search, limit, offset })
  return c.json({ rows })
})

superAdminColdCall.post('/api/leads', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  if (!body || (typeof body.name !== 'string' && typeof body.company_name !== 'string' && typeof body.phone !== 'string')) {
    return c.json({ error: 'need at least one of: name, company_name, phone' }, 400)
  }
  const id = await createLead(c.env.DB, body)
  return c.json({ ok: true, id })
})

superAdminColdCall.patch('/api/leads/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  if (!id) return c.json({ error: 'bad id' }, 400)
  const body = await c.req.json().catch(() => ({}))
  if (body.status && !VALID_STATUSES.includes(body.status)) return c.json({ error: 'bad status' }, 400)
  await updateLead(c.env.DB, id, body)
  return c.json({ ok: true })
})

superAdminColdCall.delete('/api/leads/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  if (!id) return c.json({ error: 'bad id' }, 400)
  await deleteLead(c.env.DB, id)
  return c.json({ ok: true })
})

superAdminColdCall.get('/api/leads/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  const lead = await getLead(c.env.DB, id)
  if (!lead) return c.json({ error: 'not found' }, 404)
  const logs = await listLogsForLead(c.env.DB, id)
  return c.json({ lead, logs })
})

superAdminColdCall.post('/api/leads/:id/log', async (c) => {
  const lead_id = parseInt(c.req.param('id'))
  if (!lead_id) return c.json({ error: 'bad id' }, 400)
  const body = await c.req.json().catch(() => ({}))
  if (!body.outcome || !VALID_OUTCOMES.includes(body.outcome)) {
    return c.json({ error: 'invalid outcome', allowed: VALID_OUTCOMES }, 400)
  }
  const admin = (c as any).get('admin')
  const id = await logCall(c.env.DB, {
    lead_id,
    admin_user_id: admin?.id ?? null,
    outcome: body.outcome,
    duration_seconds: body.duration_seconds ?? null,
    sentiment: body.sentiment ?? null,
    notes: body.notes ?? null,
    next_step: body.next_step ?? null,
    next_action_at: body.next_action_at ?? null,
    set_status: body.set_status ?? null,
  })
  return c.json({ ok: true, log_id: id })
})

// ── Bulk import (paste TSV/CSV: name,company,phone,email,city,source,notes) ──
superAdminColdCall.post('/api/leads/bulk-import', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const text: string = body.text || ''
  const delimiter: string = body.delimiter === 'tab' ? '\t' : ','
  if (!text.trim()) return c.json({ error: 'no text' }, 400)
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  // optional header row
  let start = 0
  const first = lines[0]?.toLowerCase() || ''
  if (/name|company|phone|email/.test(first) && /,|\t/.test(first)) start = 1
  let created = 0
  for (let i = start; i < lines.length; i++) {
    const cols = lines[i].split(delimiter).map(s => s.trim().replace(/^"|"$/g, ''))
    if (cols.length === 0 || (!cols[0] && !cols[1] && !cols[2])) continue
    await createLead(c.env.DB, {
      name: cols[0] || null,
      company_name: cols[1] || null,
      phone: cols[2] || null,
      email: cols[3] || null,
      city: cols[4] || null,
      source: cols[5] || 'Google Maps',
      notes: cols[6] || null,
    })
    created += 1
  }
  return c.json({ ok: true, created })
})

// ── Queue + stats ────────────────────────────────────────────
superAdminColdCall.get('/api/queue', async (c) => {
  const limit = parseInt(c.req.query('limit') || '50')
  const rows = await getCallQueue(c.env.DB, limit)
  return c.json({ rows })
})

superAdminColdCall.get('/api/stats', async (c) => {
  const days = periodToDays(c.req.query('period') || '30d')
  const s = await getStats(c.env.DB, sinceIso(days))
  return c.json({ period_days: days, ...s })
})

superAdminColdCall.get('/api/logs', async (c) => {
  const days = periodToDays(c.req.query('period') || '30d')
  const outcome = c.req.query('outcome') || null
  const rows = await listAllLogs(c.env.DB, { sinceIso: sinceIso(days), outcome, limit: 1000 })
  return c.json({ rows })
})

superAdminColdCall.get('/api/leads.csv', async (c) => {
  const rows = await listLeads(c.env.DB, { limit: 5000 })
  const header = ['id','name','company_name','phone','email','city','province','country',
                  'source','status','priority','attempts_count','last_outcome','last_attempt_at',
                  'next_action_at','linked_customer_id','notes','created_at']
  const lines = [header.join(',')]
  for (const r of rows as any[]) {
    lines.push(header.map(h => {
      const v = r[h]; if (v == null) return ''
      const s = String(v).replace(/"/g, '""')
      return /[",\n]/.test(s) ? `"${s}"` : s
    }).join(','))
  }
  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="cold-call-leads.csv"',
    }
  })
})

// ── HTML shell ───────────────────────────────────────────────
function shell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — Roof Manager Super Admin</title>
<script src="https://cdn.tailwindcss.com"></script>
<style>
  body { background:#0A0A0A; color:#E5E7EB; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; margin:0; }
  .card { background:#111827; border:1px solid #1F2937; border-radius:12px; }
  .pill { display:inline-block; padding:2px 10px; border-radius:9999px; font-size:11px; font-weight:600; }
  .pill-new { background:#1E3A8A; color:#BFDBFE; }
  .pill-attempting { background:#7C2D12; color:#FED7AA; }
  .pill-contacted { background:#064E3B; color:#A7F3D0; }
  .pill-qualified { background:#065F46; color:#6EE7B7; }
  .pill-proposal_sent { background:#581C87; color:#E9D5FF; }
  .pill-won { background:#10B981; color:#0A0A0A; }
  .pill-lost { background:#374151; color:#9CA3AF; }
  .pill-do_not_call { background:#7F1D1D; color:#FECACA; }
  th { font-size:11px; text-transform:uppercase; letter-spacing:0.05em; color:#9CA3AF; padding:10px 12px; text-align:left; border-bottom:1px solid #1F2937; cursor:pointer; }
  td { padding:10px 12px; border-bottom:1px solid #1F2937; font-size:14px; vertical-align:top; }
  tr:hover td { background:#1F2937; }
  a.tab { padding:8px 16px; border-radius:8px; color:#9CA3AF; text-decoration:none; font-weight:500; }
  a.tab.active { background:#1F2937; color:#FFF; }
  a.tab:hover { color:#FFF; }
  select, input, textarea { background:#0F172A; color:#E5E7EB; border:1px solid #1F2937; border-radius:8px; padding:8px 10px; font-size:14px; width:100%; }
  textarea { resize:vertical; min-height:80px; }
  button { cursor:pointer; }
  .btn { background:#10B981; color:#0A0A0A; padding:10px 16px; border-radius:8px; font-weight:700; border:none; }
  .btn:hover { background:#34D399; }
  .btn-secondary { background:#1F2937; color:#E5E7EB; padding:10px 16px; border-radius:8px; border:none; }
  .btn-secondary:hover { background:#374151; }
  .outcome-btn { padding:14px 12px; border-radius:10px; font-weight:700; font-size:14px; border:none; color:#0A0A0A; transition:transform .06s; }
  .outcome-btn:active { transform:scale(0.97); }
  .outcome-btn.no_answer       { background:#6B7280; color:#FFF; }
  .outcome-btn.voicemail       { background:#A78BFA; }
  .outcome-btn.wrong_number    { background:#1F2937; color:#9CA3AF; }
  .outcome-btn.not_interested  { background:#7F1D1D; color:#FECACA; }
  .outcome-btn.interested      { background:#34D399; }
  .outcome-btn.callback_requested { background:#FBBF24; }
  .outcome-btn.meeting_booked  { background:#10B981; }
  .outcome-btn.do_not_call     { background:#7F1D1D; color:#FECACA; }
  .outcome-btn.won             { background:#FBBF24; color:#0A0A0A; }
  .outcome-btn.lost            { background:#374151; color:#9CA3AF; }
  .num { font-variant-numeric:tabular-nums; }
  .kbd { display:inline-block; background:#1F2937; border:1px solid #374151; border-radius:4px; padding:1px 6px; font-size:11px; font-family:ui-monospace,monospace; color:#9CA3AF; }
  details > summary { cursor:pointer; }
</style>
</head>
<body>
  <header style="padding:16px 24px; border-bottom:1px solid #1F2937; display:flex; align-items:center; gap:24px;">
    <a href="/super-admin" style="color:#FBBF24; font-weight:700; text-decoration:none;">👑 Super Admin</a>
    <span style="color:#6B7280;">/</span>
    <span style="color:#FFF; font-weight:600;">Cold Call</span>
    <nav style="margin-left:auto; display:flex; gap:4px;">
      <a class="tab" href="/super-admin/cold-call">Dial Queue</a>
      <a class="tab" href="/super-admin/cold-call/leads">Leads</a>
      <a class="tab" href="/super-admin/cold-call/history">History</a>
      <a class="tab" href="/super-admin/cold-call/stats">Stats</a>
    </nav>
  </header>
  <main style="max-width:1400px; margin:0 auto; padding:24px;">${body}</main>
  <script>
    document.querySelectorAll('a.tab').forEach(function(a){
      if (a.getAttribute('href') === location.pathname) a.classList.add('active');
    });
    window.api = async function(url, opts){
      var r = await fetch(url, Object.assign({ credentials:'include' }, opts || {}));
      if (r.status === 401 || r.status === 403) { location.href='/login?next='+encodeURIComponent(location.pathname); return null; }
      try { return await r.json(); } catch(e) { return null; }
    };
    window.fmtNum = function(n){ return Number(n||0).toLocaleString(); };
    window.fmtDur = function(s){ if(!s) return ''; var m=Math.floor(s/60),sec=s%60; return m+':'+(sec<10?'0':'')+sec; };
    window.pillFor = function(s){ return '<span class="pill pill-' + (s||'new') + '">' + (s||'new').replace(/_/g,' ') + '</span>'; };
  </script>
</body>
</html>`
}

// ── Dial Queue (the page you'll live in) ─────────────────────
superAdminColdCall.get('/', async (c) => {
  const html = shell('Dial Queue', `
    <div style="display:grid; grid-template-columns:1fr 380px; gap:20px;">
      <div>
        <div style="display:flex; align-items:center; gap:12px; margin-bottom:16px;">
          <h1 style="font-size:22px; font-weight:700;">Up next</h1>
          <span id="queueCount" style="color:#6B7280; font-size:13px;"></span>
          <button id="skipBtn" class="btn-secondary" style="margin-left:auto;">Skip <span class="kbd">S</span></button>
        </div>
        <div id="leadCard" class="card" style="padding:24px; min-height:280px;">
          <div style="color:#6B7280;">Loading…</div>
        </div>

        <div style="margin-top:20px;">
          <h3 style="font-size:13px; color:#9CA3AF; margin-bottom:10px;">Notes for THIS call</h3>
          <textarea id="callNotes" placeholder="What did they say? Objections? Decision-makers?"></textarea>
        </div>

        <div style="margin-top:20px;">
          <h3 style="font-size:13px; color:#9CA3AF; margin-bottom:10px;">Outcome (one click logs the call → next lead)</h3>
          <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:10px;">
            <button class="outcome-btn no_answer" data-o="no_answer">No answer <span class="kbd">1</span></button>
            <button class="outcome-btn voicemail" data-o="voicemail">Voicemail <span class="kbd">2</span></button>
            <button class="outcome-btn not_interested" data-o="not_interested">Not interested <span class="kbd">3</span></button>
            <button class="outcome-btn interested" data-o="interested">Interested <span class="kbd">4</span></button>
            <button class="outcome-btn callback_requested" data-o="callback_requested">Callback <span class="kbd">5</span></button>
            <button class="outcome-btn meeting_booked" data-o="meeting_booked">Meeting booked <span class="kbd">6</span></button>
          </div>
          <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-top:10px;">
            <button class="outcome-btn wrong_number" data-o="wrong_number">Wrong #</button>
            <button class="outcome-btn do_not_call" data-o="do_not_call">Do not call</button>
            <button class="outcome-btn won" data-o="won">Won</button>
            <button class="outcome-btn lost" data-o="lost">Lost</button>
          </div>
          <div style="margin-top:14px; display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
            <label style="font-size:12px; color:#9CA3AF;">Callback in</label>
            <select id="callbackIn" style="width:auto;">
              <option value="">(none)</option>
              <option value="1">1 day</option>
              <option value="3">3 days</option>
              <option value="7">1 week</option>
              <option value="14">2 weeks</option>
              <option value="30">1 month</option>
            </select>
            <label style="font-size:12px; color:#9CA3AF; margin-left:auto;">Call duration (sec)</label>
            <input id="callDur" type="number" min="0" placeholder="e.g. 90" style="width:120px;">
          </div>
          <p style="font-size:11px; color:#6B7280; margin-top:12px;">
            Press <span class="kbd">N</span> to skip to next, <span class="kbd">1–6</span> for fast outcomes.
          </p>
        </div>
      </div>

      <aside>
        <div class="card" style="padding:18px; margin-bottom:16px;">
          <div style="font-size:12px; color:#9CA3AF; margin-bottom:8px;">TODAY</div>
          <div id="todayStats" style="display:grid; grid-template-columns:1fr 1fr; gap:10px;"></div>
        </div>
        <div class="card" style="padding:18px;">
          <h3 style="font-size:13px; color:#9CA3AF; margin-bottom:10px;">Add a lead fast</h3>
          <input id="qName" placeholder="Name (optional)" style="margin-bottom:6px;">
          <input id="qCompany" placeholder="Company (optional)" style="margin-bottom:6px;">
          <input id="qPhone" placeholder="Phone *" style="margin-bottom:6px;">
          <input id="qSource" placeholder="Source (default: Google Maps)" style="margin-bottom:6px;">
          <button id="qAddBtn" class="btn" style="width:100%;">Add to queue</button>
        </div>
      </aside>
    </div>

    <script>
      var queue = []; var idx = 0; var current = null;
      async function loadQueue() {
        var d = await window.api('/api/super-admin/cold-call/api/queue?limit=200');
        if (!d) return;
        queue = d.rows || []; idx = 0;
        render();
        renderToday();
      }
      async function renderToday() {
        var d = await window.api('/api/super-admin/cold-call/api/stats?period=24h');
        if (!d) return;
        var o = d.overall || {};
        document.getElementById('todayStats').innerHTML =
          stat('Calls', o.calls||0, '#60A5FA') +
          stat('Contacts', o.contacts||0, '#34D399') +
          stat('Meetings', o.meetings||0, '#FBBF24') +
          stat('Open leads', d.open_leads||0, '#A78BFA');
        document.getElementById('queueCount').textContent = (d.due_leads||0) + ' due · ' + (d.open_leads||0) + ' open';
      }
      function stat(label, val, color) {
        return '<div><div style="font-size:11px; color:#9CA3AF;">' + label + '</div>' +
               '<div class="num" style="font-size:22px; font-weight:700; color:' + color + ';">' + fmtNum(val) + '</div></div>';
      }
      function render() {
        if (!queue.length || idx >= queue.length) {
          current = null;
          document.getElementById('leadCard').innerHTML = '<div style="text-align:center; padding:40px 0; color:#6B7280;">' +
            '<div style="font-size:44px; margin-bottom:10px;">🎉</div>' +
            '<div style="font-size:18px; font-weight:600; color:#E5E7EB;">No leads in the queue.</div>' +
            '<div style="margin-top:8px;">Add one in the panel on the right, or import a CSV from <a href="/super-admin/cold-call/leads" style="color:#60A5FA;">Leads</a>.</div></div>';
          return;
        }
        current = queue[idx];
        var phoneLink = current.phone ? '<a href="tel:' + current.phone + '" style="color:#10B981; font-size:24px; font-weight:700; text-decoration:none;">' + current.phone + ' →</a>' : '<span style="color:#6B7280;">no phone</span>';
        var addr = [current.address, current.city, current.province].filter(Boolean).join(', ');
        document.getElementById('leadCard').innerHTML =
          '<div style="display:flex; justify-content:space-between; align-items:flex-start;">' +
            '<div>' +
              '<div style="font-size:24px; font-weight:700;">' + (current.company_name || current.name || 'Lead #' + current.id) + '</div>' +
              (current.name && current.company_name ? '<div style="color:#9CA3AF; margin-top:2px;">' + current.name + '</div>' : '') +
              (addr ? '<div style="color:#9CA3AF; margin-top:6px; font-size:13px;">' + addr + '</div>' : '') +
              (current.source ? '<div style="color:#6B7280; margin-top:4px; font-size:12px;">via ' + current.source + '</div>' : '') +
              (current.notes ? '<div style="margin-top:14px; padding:10px; background:#0F172A; border-radius:8px; font-size:13px; white-space:pre-wrap;">' + escapeHtml(current.notes) + '</div>' : '') +
            '</div>' +
            '<div style="text-align:right;">' +
              pillFor(current.status) +
              '<div style="margin-top:14px;">' + phoneLink + '</div>' +
              '<div style="margin-top:8px; font-size:12px; color:#6B7280;">' +
                'attempts: ' + (current.attempts_count || 0) +
                (current.last_outcome ? ' · last: ' + current.last_outcome.replace(/_/g,' ') : '') +
              '</div>' +
            '</div>' +
          '</div>';
        // reset call fields
        document.getElementById('callNotes').value = '';
        document.getElementById('callbackIn').value = '';
        document.getElementById('callDur').value = '';
      }
      function escapeHtml(s){ return String(s).replace(/[&<>"]/g, function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
      async function logOutcome(outcome) {
        if (!current) return;
        var notes = document.getElementById('callNotes').value || null;
        var dur = parseInt(document.getElementById('callDur').value) || null;
        var inDays = parseInt(document.getElementById('callbackIn').value) || null;
        var nextAt = inDays ? new Date(Date.now() + inDays*86400000).toISOString().replace('T',' ').slice(0,19) : null;
        var body = { outcome: outcome, notes: notes, duration_seconds: dur, next_action_at: nextAt };
        await window.api('/api/super-admin/cold-call/api/leads/' + current.id + '/log', {
          method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)
        });
        idx += 1;
        render();
        renderToday();
      }
      document.querySelectorAll('.outcome-btn').forEach(function(b){
        b.addEventListener('click', function(){ logOutcome(b.getAttribute('data-o')); });
      });
      document.getElementById('skipBtn').addEventListener('click', function(){ idx += 1; render(); });
      document.addEventListener('keydown', function(e){
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        var map = { '1':'no_answer','2':'voicemail','3':'not_interested','4':'interested','5':'callback_requested','6':'meeting_booked' };
        if (map[e.key]) { logOutcome(map[e.key]); return; }
        if (e.key === 'n' || e.key === 'N' || e.key === 's' || e.key === 'S') { idx += 1; render(); }
      });
      document.getElementById('qAddBtn').addEventListener('click', async function(){
        var name = document.getElementById('qName').value.trim();
        var company = document.getElementById('qCompany').value.trim();
        var phone = document.getElementById('qPhone').value.trim();
        var source = document.getElementById('qSource').value.trim() || 'Google Maps';
        if (!phone && !name && !company) { alert('Phone, name, or company is required'); return; }
        await window.api('/api/super-admin/cold-call/api/leads', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ name:name||null, company_name:company||null, phone:phone||null, source: source })
        });
        document.getElementById('qName').value=''; document.getElementById('qCompany').value=''; document.getElementById('qPhone').value=''; document.getElementById('qSource').value='';
        loadQueue();
      });
      loadQueue();
    </script>
  `)
  return c.html(html)
})

// ── Leads list + bulk import ─────────────────────────────────
superAdminColdCall.get('/leads', async (c) => {
  const html = shell('Leads', `
    <div style="display:flex; align-items:center; gap:12px; margin-bottom:18px;">
      <h1 style="font-size:22px; font-weight:700;">Leads</h1>
      <input id="search" placeholder="Search name / company / phone / notes" style="max-width:380px;">
      <select id="status" style="width:auto;">
        <option value="">All statuses</option>
        ${VALID_STATUSES.map(s => `<option value="${s}">${s.replace(/_/g, ' ')}</option>`).join('')}
      </select>
      <button id="addBtn" class="btn" style="margin-left:auto;">+ Add lead</button>
      <button id="importBtn" class="btn-secondary">Import CSV</button>
      <a class="btn-secondary" style="text-decoration:none;" href="/api/super-admin/cold-call/api/leads.csv">Export CSV</a>
    </div>
    <div class="card" style="padding:0; overflow:auto;">
      <table style="width:100%;">
        <thead><tr>
          <th>Lead</th><th>Phone / email</th><th>Source</th><th>Status</th>
          <th class="num">Tries</th><th>Last outcome</th><th>Next callback</th><th></th>
        </tr></thead>
        <tbody id="rows"><tr><td colspan="8" style="text-align:center; color:#6B7280; padding:32px;">Loading…</td></tr></tbody>
      </table>
    </div>

    <!-- Add modal -->
    <div id="addModal" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.7); align-items:center; justify-content:center; z-index:50;">
      <div class="card" style="padding:24px; width:520px; max-width:92vw;">
        <h2 style="font-weight:700; margin-bottom:14px;">Add lead</h2>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
          <input id="aName" placeholder="Name">
          <input id="aCompany" placeholder="Company">
          <input id="aPhone" placeholder="Phone *">
          <input id="aEmail" placeholder="Email">
          <input id="aCity" placeholder="City">
          <input id="aProvince" placeholder="Province / state">
          <input id="aSource" placeholder="Source (e.g. Google Maps)" style="grid-column:1/3;">
          <textarea id="aNotes" placeholder="Notes / research" style="grid-column:1/3;"></textarea>
        </div>
        <div style="display:flex; gap:10px; margin-top:14px; justify-content:flex-end;">
          <button class="btn-secondary" onclick="document.getElementById('addModal').style.display='none'">Cancel</button>
          <button class="btn" id="aSave">Save</button>
        </div>
      </div>
    </div>

    <!-- Import modal -->
    <div id="importModal" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.7); align-items:center; justify-content:center; z-index:50;">
      <div class="card" style="padding:24px; width:640px; max-width:92vw;">
        <h2 style="font-weight:700; margin-bottom:8px;">Bulk import</h2>
        <p style="color:#9CA3AF; font-size:13px; margin-bottom:10px;">
          Paste rows in this order: <code style="background:#0F172A; padding:2px 6px; border-radius:4px;">name, company, phone, email, city, source, notes</code>.
          Headers OK. Tab- or comma-separated.
        </p>
        <textarea id="importText" placeholder='John Smith,Smith Roofing,(555) 123-4567,j@smithroofing.com,Calgary,Google Maps,"Family-run, ask about commercial work"' style="height:200px; font-family:ui-monospace,monospace; font-size:12px;"></textarea>
        <div style="display:flex; gap:10px; margin-top:14px; justify-content:flex-end; align-items:center;">
          <label style="font-size:12px; color:#9CA3AF;">
            <input type="checkbox" id="importTab" style="width:auto;"> tab-separated
          </label>
          <button class="btn-secondary" onclick="document.getElementById('importModal').style.display='none'">Cancel</button>
          <button class="btn" id="importSave">Import</button>
        </div>
      </div>
    </div>

    <script>
      async function load() {
        var s = document.getElementById('status').value;
        var q = document.getElementById('search').value;
        var url = '/api/super-admin/cold-call/api/leads?' + (s?'status='+s+'&':'') + (q?'search='+encodeURIComponent(q):'');
        var d = await window.api(url);
        if (!d) return;
        var rows = d.rows || [];
        document.getElementById('rows').innerHTML = rows.length ? rows.map(function(r){
          return '<tr>' +
            '<td><div style="font-weight:600;">' + esc(r.company_name || r.name || ('Lead #' + r.id)) + '</div>' +
              (r.name && r.company_name ? '<div style="font-size:12px; color:#9CA3AF;">' + esc(r.name) + '</div>' : '') +
              (r.city ? '<div style="font-size:11px; color:#6B7280;">' + esc(r.city) + (r.province?', '+esc(r.province):'') + '</div>' : '') +
            '</td>' +
            '<td><div>' + (r.phone ? '<a href="tel:'+esc(r.phone)+'" style="color:#34D399;">'+esc(r.phone)+'</a>' : '<span style="color:#6B7280;">—</span>') + '</div>' +
              (r.email ? '<div style="font-size:12px; color:#9CA3AF;">' + esc(r.email) + '</div>' : '') + '</td>' +
            '<td>' + (r.source ? esc(r.source) : '<span style="color:#6B7280;">—</span>') + '</td>' +
            '<td>' + pillFor(r.status) + '</td>' +
            '<td class="num" style="text-align:right;">' + (r.attempts_count || 0) + '</td>' +
            '<td>' + (r.last_outcome ? esc(r.last_outcome.replace(/_/g, ' ')) : '<span style="color:#6B7280;">—</span>') + '</td>' +
            '<td style="font-size:12px;">' + (r.next_action_at ? esc(r.next_action_at) : '<span style="color:#6B7280;">—</span>') + '</td>' +
            '<td><button class="btn-secondary" style="padding:4px 10px; font-size:12px;" onclick="del(' + r.id + ')">Delete</button></td>' +
            '</tr>';
        }).join('') : '<tr><td colspan="8" style="text-align:center; color:#6B7280; padding:32px;">No leads. Add one or import a CSV.</td></tr>';
      }
      function esc(s){ return String(s||'').replace(/[&<>"]/g, function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
      window.del = async function(id){
        if (!confirm('Delete this lead and all its call logs?')) return;
        await window.api('/api/super-admin/cold-call/api/leads/' + id, { method:'DELETE' });
        load();
      };
      document.getElementById('search').addEventListener('input', debounce(load, 250));
      document.getElementById('status').addEventListener('change', load);
      document.getElementById('addBtn').addEventListener('click', function(){ document.getElementById('addModal').style.display='flex'; });
      document.getElementById('importBtn').addEventListener('click', function(){ document.getElementById('importModal').style.display='flex'; });
      document.getElementById('aSave').addEventListener('click', async function(){
        var body = {
          name: document.getElementById('aName').value.trim() || null,
          company_name: document.getElementById('aCompany').value.trim() || null,
          phone: document.getElementById('aPhone').value.trim() || null,
          email: document.getElementById('aEmail').value.trim() || null,
          city: document.getElementById('aCity').value.trim() || null,
          province: document.getElementById('aProvince').value.trim() || null,
          source: document.getElementById('aSource').value.trim() || 'Google Maps',
          notes: document.getElementById('aNotes').value.trim() || null,
        };
        if (!body.phone && !body.name && !body.company_name) { alert('Need phone, name, or company'); return; }
        await window.api('/api/super-admin/cold-call/api/leads', {
          method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)
        });
        document.getElementById('addModal').style.display='none';
        ['aName','aCompany','aPhone','aEmail','aCity','aProvince','aSource','aNotes'].forEach(function(i){ document.getElementById(i).value=''; });
        load();
      });
      document.getElementById('importSave').addEventListener('click', async function(){
        var text = document.getElementById('importText').value;
        var tab = document.getElementById('importTab').checked;
        if (!text.trim()) return;
        var d = await window.api('/api/super-admin/cold-call/api/leads/bulk-import', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ text: text, delimiter: tab ? 'tab' : 'csv' })
        });
        alert('Imported ' + (d ? d.created : 0) + ' leads.');
        document.getElementById('importModal').style.display='none';
        document.getElementById('importText').value='';
        load();
      });
      function debounce(fn, ms){ var t; return function(){ clearTimeout(t); var a=arguments; t=setTimeout(function(){ fn.apply(null,a); }, ms); }; }
      load();
    </script>
  `)
  return c.html(html)
})

// ── History ──────────────────────────────────────────────────
superAdminColdCall.get('/history', async (c) => {
  const html = shell('Call History', `
    <div style="display:flex; align-items:center; gap:12px; margin-bottom:18px;">
      <h1 style="font-size:22px; font-weight:700;">Call history</h1>
      <select id="period" style="width:auto;">
        <option value="24h">Last 24h</option>
        <option value="7d" selected>Last 7 days</option>
        <option value="30d">Last 30 days</option>
        <option value="90d">Last 90 days</option>
        <option value="365d">Last year</option>
      </select>
      <select id="outcome" style="width:auto;">
        <option value="">All outcomes</option>
        ${VALID_OUTCOMES.map(o => `<option value="${o}">${o.replace(/_/g, ' ')}</option>`).join('')}
      </select>
    </div>
    <div class="card" style="padding:0; overflow:auto;">
      <table style="width:100%;">
        <thead><tr>
          <th>When</th><th>Lead</th><th>Outcome</th><th class="num">Duration</th><th>Notes</th>
        </tr></thead>
        <tbody id="rows"><tr><td colspan="5" style="text-align:center; color:#6B7280; padding:32px;">Loading…</td></tr></tbody>
      </table>
    </div>
    <script>
      async function load() {
        var period = document.getElementById('period').value;
        var o = document.getElementById('outcome').value;
        var d = await window.api('/api/super-admin/cold-call/api/logs?period=' + period + (o?'&outcome='+o:''));
        if (!d) return;
        var rows = d.rows || [];
        document.getElementById('rows').innerHTML = rows.length ? rows.map(function(r){
          return '<tr>' +
            '<td style="font-size:12px;">' + esc(r.called_at) + '</td>' +
            '<td>' + esc(r.company_name || r.lead_name || ('#' + r.lead_id)) + (r.phone ? '<div style="font-size:11px; color:#9CA3AF;">' + esc(r.phone) + '</div>' : '') + '</td>' +
            '<td>' + pillForOutcome(r.outcome) + '</td>' +
            '<td class="num" style="text-align:right;">' + (r.duration_seconds ? fmtDur(r.duration_seconds) : '—') + '</td>' +
            '<td style="font-size:13px; color:#9CA3AF; white-space:pre-wrap;">' + esc(r.notes || '') + '</td>' +
            '</tr>';
        }).join('') : '<tr><td colspan="5" style="text-align:center; color:#6B7280; padding:32px;">No calls in this window.</td></tr>';
      }
      function esc(s){ return String(s||'').replace(/[&<>"]/g, function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
      function pillForOutcome(o){
        var color = ({no_answer:'#6B7280', voicemail:'#A78BFA', wrong_number:'#374151',
          not_interested:'#7F1D1D', interested:'#34D399', callback_requested:'#FBBF24',
          meeting_booked:'#10B981', do_not_call:'#7F1D1D', won:'#FBBF24', lost:'#374151'})[o] || '#374151';
        return '<span class="pill" style="background:' + color + '; color:#0A0A0A;">' + (o||'').replace(/_/g,' ') + '</span>';
      }
      document.getElementById('period').addEventListener('change', load);
      document.getElementById('outcome').addEventListener('change', load);
      load();
    </script>
  `)
  return c.html(html)
})

// ── Stats ────────────────────────────────────────────────────
superAdminColdCall.get('/stats', async (c) => {
  const html = shell('Stats', `
    <div style="display:flex; align-items:center; gap:12px; margin-bottom:18px;">
      <h1 style="font-size:22px; font-weight:700;">Cold-call performance</h1>
      <select id="period" style="margin-left:auto; width:auto;">
        <option value="24h">Last 24h</option>
        <option value="7d">Last 7 days</option>
        <option value="30d" selected>Last 30 days</option>
        <option value="90d">Last 90 days</option>
        <option value="365d">Last year</option>
      </select>
    </div>
    <div id="kpis" style="display:grid; grid-template-columns:repeat(5,1fr); gap:14px; margin-bottom:18px;"></div>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-bottom:18px;">
      <div class="card" style="padding:18px;"><h3 style="font-size:13px; color:#9CA3AF; margin-bottom:10px;">Outcomes</h3><div id="outcomes"></div></div>
      <div class="card" style="padding:18px;"><h3 style="font-size:13px; color:#9CA3AF; margin-bottom:10px;">By hour of day (when do they answer?)</h3><div id="byHour"></div></div>
    </div>
    <div class="card" style="padding:18px; margin-bottom:18px;">
      <h3 style="font-size:13px; color:#9CA3AF; margin-bottom:10px;">By day</h3>
      <div id="byDay"></div>
    </div>
    <div class="card" style="padding:18px;">
      <h3 style="font-size:13px; color:#9CA3AF; margin-bottom:10px;">By source</h3>
      <div id="bySource"></div>
    </div>
    <script>
      async function load() {
        var period = document.getElementById('period').value;
        var d = await window.api('/api/super-admin/cold-call/api/stats?period=' + period);
        if (!d) return;
        var o = d.overall || {};
        var contactRate = (o.calls && o.contacts) ? (o.contacts / o.calls * 100).toFixed(1) + '%' : '—';
        var meetingRate = (o.calls && o.meetings) ? (o.meetings / o.calls * 100).toFixed(1) + '%' : '—';
        document.getElementById('kpis').innerHTML = [
          kpi('Calls', fmtNum(o.calls||0), '#60A5FA'),
          kpi('Contact rate', contactRate, '#34D399'),
          kpi('Meeting rate', meetingRate, '#FBBF24'),
          kpi('Wins', fmtNum(o.wins||0), '#10B981'),
          kpi('Time on phone', fmtTimeMins(o.total_seconds||0), '#A78BFA')
        ].join('');
        document.getElementById('outcomes').innerHTML = barRows(d.by_outcome || [], 'outcome', 'n');
        document.getElementById('byHour').innerHTML = byHourBars(d.by_hour || []);
        document.getElementById('byDay').innerHTML = byDayBars(d.by_day || []);
        document.getElementById('bySource').innerHTML = sourceTable(d.by_source || []);
      }
      function kpi(label,val,color){
        return '<div class="card" style="padding:14px;"><div style="font-size:11px; color:#9CA3AF;">' + label + '</div>' +
          '<div class="num" style="font-size:24px; font-weight:700; color:' + color + ';">' + val + '</div></div>';
      }
      function fmtTimeMins(s){ var m = Math.round(s/60); return m + 'm'; }
      function barRows(rows, labelKey, valKey){
        if (!rows.length) return '<div style="color:#6B7280;">No calls.</div>';
        var max = Math.max.apply(null, rows.map(function(r){ return r[valKey]; }));
        return rows.map(function(r){
          var w = max > 0 ? (r[valKey]/max)*100 : 0;
          return '<div style="margin-bottom:8px;">' +
            '<div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:3px;">' +
              '<span>' + r[labelKey].replace(/_/g,' ') + '</span><span class="num" style="color:#9CA3AF;">' + fmtNum(r[valKey]) + '</span></div>' +
            '<div style="background:#1F2937; height:14px; border-radius:4px;"><div style="width:' + w + '%; background:#60A5FA; height:100%; border-radius:4px;"></div></div>' +
            '</div>';
        }).join('');
      }
      function byHourBars(rows){
        if (!rows.length) return '<div style="color:#6B7280;">No calls.</div>';
        var byHr = {}; rows.forEach(function(r){ byHr[r.hour] = r; });
        var max = Math.max.apply(null, rows.map(function(r){ return r.calls; }));
        var html = '<div style="display:flex; align-items:flex-end; gap:2px; height:120px;">';
        for (var h = 0; h < 24; h++) {
          var r = byHr[h] || { calls:0, contacts:0 };
          var hpct = max > 0 ? (r.calls/max)*100 : 0;
          var color = (h>=9 && h<=17) ? '#34D399' : '#374151';
          html += '<div style="flex:1; display:flex; flex-direction:column; align-items:center; gap:2px;">' +
            '<div title="' + r.calls + ' calls / ' + r.contacts + ' contacts at ' + h + ':00" style="width:100%; background:' + color + '; height:' + hpct + '%; border-radius:2px 2px 0 0; min-height:1px;"></div>' +
            '<div style="font-size:9px; color:#6B7280;">' + h + '</div></div>';
        }
        html += '</div>';
        return html;
      }
      function byDayBars(rows){
        if (!rows.length) return '<div style="color:#6B7280;">No calls.</div>';
        var max = Math.max.apply(null, rows.map(function(r){ return r.calls; }));
        return '<div style="display:flex; align-items:flex-end; gap:4px; height:120px;">' + rows.map(function(r){
          var hpct = max > 0 ? (r.calls/max)*100 : 0;
          return '<div style="flex:1; display:flex; flex-direction:column; align-items:center; gap:4px;">' +
            '<div title="' + r.date + ': ' + r.calls + ' calls" style="width:100%; background:#60A5FA; height:' + hpct + '%; border-radius:3px 3px 0 0; min-height:1px;"></div>' +
            '<div style="font-size:10px; color:#6B7280;">' + r.date.slice(5) + '</div></div>';
        }).join('') + '</div>';
      }
      function sourceTable(rows){
        if (!rows.length) return '<div style="color:#6B7280;">No data.</div>';
        return '<table style="width:100%;"><thead><tr><th>Source</th><th class="num">Leads called</th><th class="num">Meetings</th><th class="num">Wins</th></tr></thead><tbody>' +
          rows.map(function(r){
            return '<tr><td>' + r.source + '</td>' +
              '<td class="num" style="text-align:right;">' + fmtNum(r.leads_touched) + '</td>' +
              '<td class="num" style="text-align:right;">' + fmtNum(r.meetings) + '</td>' +
              '<td class="num" style="text-align:right;">' + fmtNum(r.wins) + '</td></tr>';
          }).join('') + '</tbody></table>';
      }
      document.getElementById('period').addEventListener('change', load);
      load();
    </script>
  `)
  return c.html(html)
})

// ============================================================
// Roof Manager — Google Calendar Integration
// ============================================================
//
// Syncs CRM jobs, proposals, and events with Google Calendar.
// Requires Gmail OAuth connection (which already requests calendar scopes).
//
// ENDPOINTS:
//   GET  /api/calendar/status           → Check calendar connection
//   GET  /api/calendar/events           → List upcoming events
//   POST /api/calendar/events           → Create event
//   PUT  /api/calendar/events/:id       → Update event
//   DELETE /api/calendar/events/:id     → Delete event
//   POST /api/calendar/sync-job/:jobId  → Sync CRM job to calendar
//   POST /api/calendar/sync-all-jobs    → Sync all upcoming CRM jobs
//   GET  /api/calendar/availability     → Get free/busy times
// ============================================================

import { Hono } from 'hono'
import type { Bindings } from '../types'
import { resolveTeamOwner } from './team'

export const calendarRoutes = new Hono<{ Bindings: Bindings }>()

// ── AUTH HELPER ──
async function getCalendarAuth(c: any): Promise<{ ownerId: number; accessToken: string; calendarEmail: string } | null> {
  const auth = c.req.header('Authorization')
  if (!auth || !auth.startsWith('Bearer ')) return null
  const token = auth.slice(7)

  const session = await c.env.DB.prepare(
    "SELECT customer_id FROM customer_sessions WHERE session_token = ? AND expires_at > datetime('now')"
  ).bind(token).first<any>()
  if (!session) return null

  const { ownerId } = await resolveTeamOwner(c.env.DB, session.customer_id)

  // Get Gmail/Calendar tokens
  const customer = await c.env.DB.prepare(
    'SELECT gmail_refresh_token, gmail_connected_email FROM customers WHERE id = ?'
  ).bind(ownerId).first<any>()

  if (!customer?.gmail_refresh_token) return null

  // Refresh access token
  const clientId = (c.env as any).GMAIL_CLIENT_ID2 || (c.env as any).GMAIL_CLIENT_ID
  let clientSecret = (c.env as any).GMAIL_CLIENT_SECRET2 || (c.env as any).GMAIL_CLIENT_SECRET || ''
  if (!clientSecret) {
    try {
      const csRow = await c.env.DB.prepare(
        "SELECT setting_value FROM settings WHERE setting_key = 'gmail_client_secret' AND master_company_id = 1"
      ).first<any>()
      if (csRow?.setting_value) clientSecret = csRow.setting_value
    } catch {}
  }

  if (!clientId || !clientSecret) return null

  try {
    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: customer.gmail_refresh_token,
        client_id: clientId,
        client_secret: clientSecret
      }).toString()
    })

    const tokenData: any = await tokenResp.json()
    if (!tokenData.access_token) return null

    return {
      ownerId,
      accessToken: tokenData.access_token,
      calendarEmail: customer.gmail_connected_email || ''
    }
  } catch {
    return null
  }
}

// Simple owner auth (no calendar token needed)
async function getOwnerId(c: any): Promise<number | null> {
  const auth = c.req.header('Authorization')
  if (!auth || !auth.startsWith('Bearer ')) return null
  const token = auth.slice(7)
  const session = await c.env.DB.prepare(
    "SELECT customer_id FROM customer_sessions WHERE session_token = ? AND expires_at > datetime('now')"
  ).bind(token).first<any>()
  if (!session) return null
  const { ownerId } = await resolveTeamOwner(c.env.DB, session.customer_id)
  return ownerId
}

// ============================================================
// DB SETUP
// ============================================================
async function ensureCalendarTables(db: D1Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS calendar_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id INTEGER NOT NULL,
    google_event_id TEXT,
    title TEXT NOT NULL,
    description TEXT,
    location TEXT,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    all_day INTEGER DEFAULT 0,
    event_type TEXT DEFAULT 'general',
    linked_entity_type TEXT,
    linked_entity_id INTEGER,
    attendees TEXT,
    color TEXT DEFAULT '#0ea5e9',
    synced_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`).run()

  try {
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_cal_events_owner ON calendar_events(owner_id)').run()
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_cal_events_google ON calendar_events(google_event_id)').run()
  } catch {}
}

// ============================================================
// Google Calendar API helpers
// ============================================================
const GCAL_API = 'https://www.googleapis.com/calendar/v3'

async function gcalRequest(accessToken: string, path: string, method = 'GET', body?: any) {
  const opts: any = {
    method,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  }
  if (body) opts.body = JSON.stringify(body)
  const resp = await fetch(`${GCAL_API}${path}`, opts)
  if (!resp.ok) {
    const err: any = await resp.json().catch(() => ({}))
    throw new Error(err?.error?.message || `Calendar API error (${resp.status})`)
  }
  return resp.json()
}

// ============================================================
// GET /status — Check Google Calendar connection status
// ============================================================
calendarRoutes.get('/status', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)

  const customer = await c.env.DB.prepare(
    'SELECT gmail_connected_email, gmail_connected_at, gmail_refresh_token FROM customers WHERE id = ?'
  ).bind(ownerId).first<any>()

  const connected = !!customer?.gmail_refresh_token
  const hasCalendarScope = connected // OAuth flow already requests calendar scope

  return c.json({
    connected,
    has_calendar_scope: hasCalendarScope,
    email: customer?.gmail_connected_email || null,
    connected_at: customer?.gmail_connected_at || null,
    instructions: connected ? null : 'Connect Gmail first via Settings → Gmail Integration. Calendar access is included automatically.'
  })
})

// ============================================================
// GET /events — List upcoming calendar events
// ============================================================
calendarRoutes.get('/events', async (c) => {
  const calAuth = await getCalendarAuth(c)
  if (!calAuth) return c.json({ error: 'Calendar not connected. Connect Gmail first.' }, 401)

  const { ownerId, accessToken } = calAuth
  await ensureCalendarTables(c.env.DB)

  const days = parseInt(c.req.query('days') || '30')
  const now = new Date()
  const timeMin = now.toISOString()
  const timeMax = new Date(now.getTime() + days * 86400000).toISOString()

  try {
    // Fetch from Google Calendar
    const gcalEvents: any = await gcalRequest(
      accessToken,
      `/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&maxResults=100&singleEvents=true&orderBy=startTime`
    )

    const events = (gcalEvents.items || []).map((e: any) => ({
      google_event_id: e.id,
      title: e.summary || 'Untitled',
      description: e.description || '',
      location: e.location || '',
      start_time: e.start?.dateTime || e.start?.date || '',
      end_time: e.end?.dateTime || e.end?.date || '',
      all_day: !!e.start?.date,
      status: e.status,
      attendees: (e.attendees || []).map((a: any) => ({ email: a.email, name: a.displayName, status: a.responseStatus })),
      html_link: e.htmlLink,
      color_id: e.colorId
    }))

    // Also get local events (not synced to Google)
    const localEvents = await c.env.DB.prepare(
      'SELECT * FROM calendar_events WHERE owner_id = ? AND start_time >= ? AND start_time <= ? ORDER BY start_time'
    ).bind(ownerId, timeMin, timeMax).all<any>()

    return c.json({
      success: true,
      google_events: events,
      local_events: localEvents.results || [],
      total: events.length + ((localEvents.results || []).length),
      calendar_email: calAuth.calendarEmail
    })
  } catch (err: any) {
    return c.json({ error: 'Calendar fetch failed: ' + err.message }, 502)
  }
})

// ============================================================
// POST /events — Create a new calendar event
// ============================================================
calendarRoutes.post('/events', async (c) => {
  const calAuth = await getCalendarAuth(c)
  if (!calAuth) return c.json({ error: 'Calendar not connected' }, 401)

  const { ownerId, accessToken } = calAuth
  await ensureCalendarTables(c.env.DB)

  const body = await c.req.json()
  const { title, description, location, start_time, end_time, all_day, attendees, event_type, linked_entity_type, linked_entity_id, color } = body

  if (!title || !start_time) {
    return c.json({ error: 'Title and start_time are required' }, 400)
  }

  const eventEnd = end_time || new Date(new Date(start_time).getTime() + 3600000).toISOString()

  // Create on Google Calendar
  const gcalEvent: any = {
    summary: title,
    description: description || '',
    location: location || '',
    start: all_day
      ? { date: start_time.split('T')[0] }
      : { dateTime: start_time, timeZone: 'America/Edmonton' },
    end: all_day
      ? { date: eventEnd.split('T')[0] }
      : { dateTime: eventEnd, timeZone: 'America/Edmonton' },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 30 },
        { method: 'email', minutes: 60 }
      ]
    }
  }

  if (attendees && Array.isArray(attendees)) {
    gcalEvent.attendees = attendees.map((email: string) => ({ email }))
  }

  try {
    const created: any = await gcalRequest(accessToken, '/calendars/primary/events', 'POST', gcalEvent)

    // Store locally
    await c.env.DB.prepare(`
      INSERT INTO calendar_events (owner_id, google_event_id, title, description, location, start_time, end_time, all_day, event_type, linked_entity_type, linked_entity_id, attendees, color, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      ownerId, created.id, title, description || null, location || null,
      start_time, eventEnd, all_day ? 1 : 0, event_type || 'general',
      linked_entity_type || null, linked_entity_id || null,
      attendees ? JSON.stringify(attendees) : null, color || '#0ea5e9'
    ).run()

    return c.json({
      success: true,
      event_id: created.id,
      html_link: created.htmlLink,
      message: 'Event created and synced to Google Calendar'
    })
  } catch (err: any) {
    return c.json({ error: 'Failed to create event: ' + err.message }, 502)
  }
})

// ============================================================
// PUT /events/:id — Update a calendar event
// ============================================================
calendarRoutes.put('/events/:id', async (c) => {
  const calAuth = await getCalendarAuth(c)
  if (!calAuth) return c.json({ error: 'Calendar not connected' }, 401)

  const { accessToken } = calAuth
  const googleEventId = c.req.param('id')
  const body = await c.req.json()

  const updates: any = {}
  if (body.title) updates.summary = body.title
  if (body.description !== undefined) updates.description = body.description
  if (body.location !== undefined) updates.location = body.location
  if (body.start_time) {
    updates.start = body.all_day
      ? { date: body.start_time.split('T')[0] }
      : { dateTime: body.start_time, timeZone: 'America/Edmonton' }
  }
  if (body.end_time) {
    updates.end = body.all_day
      ? { date: body.end_time.split('T')[0] }
      : { dateTime: body.end_time, timeZone: 'America/Edmonton' }
  }

  try {
    const updated: any = await gcalRequest(
      accessToken,
      `/calendars/primary/events/${encodeURIComponent(googleEventId)}`,
      'PATCH',
      updates
    )

    // Update local record
    if (body.title || body.start_time) {
      await c.env.DB.prepare(
        "UPDATE calendar_events SET title = COALESCE(?, title), start_time = COALESCE(?, start_time), end_time = COALESCE(?, end_time), synced_at = datetime('now'), updated_at = datetime('now') WHERE google_event_id = ?"
      ).bind(body.title || null, body.start_time || null, body.end_time || null, googleEventId).run()
    }

    return c.json({ success: true, event: updated, message: 'Event updated' })
  } catch (err: any) {
    return c.json({ error: 'Failed to update event: ' + err.message }, 502)
  }
})

// ============================================================
// DELETE /events/:id — Delete a calendar event
// ============================================================
calendarRoutes.delete('/events/:id', async (c) => {
  const calAuth = await getCalendarAuth(c)
  if (!calAuth) return c.json({ error: 'Calendar not connected' }, 401)

  const { ownerId, accessToken } = calAuth
  const googleEventId = c.req.param('id')

  try {
    await fetch(`${GCAL_API}/calendars/primary/events/${encodeURIComponent(googleEventId)}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${accessToken}` }
    })

    // Remove local record
    await c.env.DB.prepare(
      'DELETE FROM calendar_events WHERE google_event_id = ? AND owner_id = ?'
    ).bind(googleEventId, ownerId).run()

    return c.json({ success: true, message: 'Event deleted from Google Calendar' })
  } catch (err: any) {
    return c.json({ error: 'Failed to delete event: ' + err.message }, 502)
  }
})

// ============================================================
// POST /sync-job/:jobId — Sync a CRM job to Google Calendar
// ============================================================
calendarRoutes.post('/sync-job/:jobId', async (c) => {
  const calAuth = await getCalendarAuth(c)
  if (!calAuth) return c.json({ error: 'Calendar not connected' }, 401)

  const { ownerId, accessToken } = calAuth
  await ensureCalendarTables(c.env.DB)

  const jobId = c.req.param('jobId')

  // Get job details
  const job = await c.env.DB.prepare(`
    SELECT cj.*, cc.name as customer_name, cc.phone as customer_phone, cc.email as customer_email
    FROM crm_jobs cj 
    LEFT JOIN crm_customers cc ON cc.id = cj.crm_customer_id
    WHERE cj.id = ? AND cj.owner_id = ?
  `).bind(jobId, ownerId).first<any>()

  if (!job) return c.json({ error: 'Job not found' }, 404)

  // Check if already synced
  const existing = await c.env.DB.prepare(
    "SELECT google_event_id FROM calendar_events WHERE linked_entity_type = 'job' AND linked_entity_id = ? AND owner_id = ?"
  ).bind(parseInt(jobId), ownerId).first<any>()

  // Build event details
  const startDate = job.scheduled_date || new Date().toISOString().split('T')[0]
  const startTime = job.scheduled_time || '09:00'
  const durationHrs = parseFloat(job.estimated_duration || '2')
  const startDateTime = `${startDate}T${startTime}:00`
  const endDateTime = new Date(new Date(startDateTime).getTime() + durationHrs * 3600000).toISOString()

  const description = [
    `Job: ${job.job_number}`,
    `Type: ${job.job_type || 'Roof Install'}`,
    job.customer_name ? `Customer: ${job.customer_name}` : '',
    job.customer_phone ? `Phone: ${job.customer_phone}` : '',
    job.crew_size ? `Crew Size: ${job.crew_size}` : '',
    job.notes ? `\nNotes: ${job.notes}` : '',
    `\nStatus: ${job.status}`,
    `\nManaged by Roof Manager`
  ].filter(Boolean).join('\n')

  const gcalEvent: any = {
    summary: `🏠 ${job.title} — ${job.customer_name || 'Job ' + job.job_number}`,
    description,
    location: job.property_address || '',
    start: { dateTime: startDateTime, timeZone: 'America/Edmonton' },
    end: { dateTime: endDateTime, timeZone: 'America/Edmonton' },
    colorId: job.status === 'completed' ? '2' : '9', // Green for completed, Blue for scheduled
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 60 },
        { method: 'email', minutes: 1440 } // 24 hours before
      ]
    }
  }

  // Add customer as attendee if they have email
  if (job.customer_email) {
    gcalEvent.attendees = [{ email: job.customer_email }]
  }

  try {
    let result: any

    if (existing?.google_event_id) {
      // Update existing event
      result = await gcalRequest(
        accessToken,
        `/calendars/primary/events/${encodeURIComponent(existing.google_event_id)}`,
        'PUT',
        gcalEvent
      )
      await c.env.DB.prepare(
        "UPDATE calendar_events SET title = ?, start_time = ?, end_time = ?, description = ?, location = ?, synced_at = datetime('now'), updated_at = datetime('now') WHERE google_event_id = ?"
      ).bind(gcalEvent.summary, startDateTime, endDateTime, description, job.property_address || '', existing.google_event_id).run()
    } else {
      // Create new event
      result = await gcalRequest(accessToken, '/calendars/primary/events', 'POST', gcalEvent)
      await c.env.DB.prepare(`
        INSERT INTO calendar_events (owner_id, google_event_id, title, description, location, start_time, end_time, event_type, linked_entity_type, linked_entity_id, color, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'job', 'job', ?, '#0ea5e9', datetime('now'))
      `).bind(ownerId, result.id, gcalEvent.summary, description, job.property_address || '', startDateTime, endDateTime, parseInt(jobId)).run()
    }

    return c.json({
      success: true,
      google_event_id: result.id,
      html_link: result.htmlLink,
      action: existing ? 'updated' : 'created',
      message: `Job "${job.title}" synced to Google Calendar`
    })
  } catch (err: any) {
    return c.json({ error: 'Calendar sync failed: ' + err.message }, 502)
  }
})

// ============================================================
// POST /sync-all-jobs — Sync all upcoming CRM jobs
// ============================================================
calendarRoutes.post('/sync-all-jobs', async (c) => {
  const calAuth = await getCalendarAuth(c)
  if (!calAuth) return c.json({ error: 'Calendar not connected' }, 401)

  const { ownerId } = calAuth
  await ensureCalendarTables(c.env.DB)

  // Get all scheduled/in_progress jobs
  const { results: jobs } = await c.env.DB.prepare(`
    SELECT id FROM crm_jobs 
    WHERE owner_id = ? AND status IN ('scheduled', 'in_progress')
    ORDER BY scheduled_date
  `).bind(ownerId).all<any>()

  const synced: any[] = []
  const failed: any[] = []

  for (const job of (jobs || [])) {
    try {
      // Reuse sync-job endpoint logic internally
      const url = new URL(c.req.url)
      const syncResp = await fetch(`${url.protocol}//${url.host}/api/calendar/sync-job/${job.id}`, {
        method: 'POST',
        headers: {
          'Authorization': c.req.header('Authorization') || '',
          'Content-Type': 'application/json'
        }
      })
      const result: any = await syncResp.json()
      if (result.success) {
        synced.push({ job_id: job.id, event_id: result.google_event_id })
      } else {
        failed.push({ job_id: job.id, error: result.error })
      }
    } catch (err: any) {
      failed.push({ job_id: job.id, error: err.message })
    }
  }

  return c.json({
    success: true,
    total_jobs: (jobs || []).length,
    synced: synced.length,
    failed: failed.length,
    details: { synced, failed }
  })
})

// ============================================================
// GET /availability — Get free/busy times for scheduling
// ============================================================
calendarRoutes.get('/availability', async (c) => {
  const calAuth = await getCalendarAuth(c)
  if (!calAuth) return c.json({ error: 'Calendar not connected' }, 401)

  const { accessToken, calendarEmail } = calAuth
  const days = parseInt(c.req.query('days') || '7')
  const now = new Date()
  const timeMin = now.toISOString()
  const timeMax = new Date(now.getTime() + days * 86400000).toISOString()

  try {
    const freeBusy: any = await gcalRequest(
      accessToken,
      '/freeBusy',
      'POST',
      {
        timeMin,
        timeMax,
        timeZone: 'America/Edmonton',
        items: [{ id: 'primary' }]
      }
    )

    const busyTimes = freeBusy?.calendars?.primary?.busy || []

    // Generate suggested appointment slots (avoid busy times)
    const slots: any[] = []
    const workStart = 8 // 8 AM
    const workEnd = 17 // 5 PM
    const slotDuration = 2 // 2-hour slots

    for (let d = 0; d < days; d++) {
      const date = new Date(now.getTime() + d * 86400000)
      const dayOfWeek = date.getDay()
      if (dayOfWeek === 0 || dayOfWeek === 6) continue // Skip weekends

      for (let hour = workStart; hour < workEnd; hour += slotDuration) {
        const slotStart = new Date(date)
        slotStart.setHours(hour, 0, 0, 0)
        const slotEnd = new Date(slotStart.getTime() + slotDuration * 3600000)

        // Check if slot overlaps with any busy time
        const isBusy = busyTimes.some((busy: any) => {
          const busyStart = new Date(busy.start)
          const busyEnd = new Date(busy.end)
          return slotStart < busyEnd && slotEnd > busyStart
        })

        if (!isBusy) {
          slots.push({
            start: slotStart.toISOString(),
            end: slotEnd.toISOString(),
            date: slotStart.toISOString().split('T')[0],
            time: `${hour}:00 - ${hour + slotDuration}:00`,
            available: true
          })
        }
      }
    }

    return c.json({
      success: true,
      busy_times: busyTimes,
      available_slots: slots,
      calendar_email: calendarEmail,
      period: { from: timeMin, to: timeMax }
    })
  } catch (err: any) {
    return c.json({ error: 'Availability check failed: ' + err.message }, 502)
  }
})

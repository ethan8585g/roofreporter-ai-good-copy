// ============================================================
// Instagram Webhooks — Meta + Twilio inbound events
// Mounted at /webhooks/instagram (no admin auth — HMAC validated)
// ============================================================

import { Hono } from 'hono'
import type { Bindings } from '../types'
import { validateWebhookSignatureAsync } from '../services/instagram/graph-client'
import { handleIncomingDM } from '../services/instagram/dm-automation'
import { handleInboundCall } from '../services/instagram/phone-tracking'

export const instagramWebhookRoutes = new Hono<{ Bindings: Bindings }>()

// ── Meta Webhook Verification Handshake ──
instagramWebhookRoutes.get('/instagram', async (c) => {
  const mode = c.req.query('hub.mode')
  const token = c.req.query('hub.verify_token')
  const challenge = c.req.query('hub.challenge')

  const verifyToken = (c.env as any).INSTAGRAM_WEBHOOK_VERIFY_TOKEN

  if (mode === 'subscribe' && token === verifyToken) {
    return c.text(challenge || '', 200)
  }
  return c.text('Verification failed', 403)
})

// ── Meta Webhook Events (DMs, comments) ──
instagramWebhookRoutes.post('/instagram', async (c) => {
  const appSecret = (c.env as any).INSTAGRAM_APP_SECRET || (c.env as any).META_KEY
  if (!appSecret) return c.json({ error: 'Not configured' }, 500)

  // Validate HMAC signature
  const signature = c.req.header('X-Hub-Signature-256') || ''
  const body = await c.req.text()

  const valid = await validateWebhookSignatureAsync(body, signature, appSecret)
  if (!valid) return c.json({ error: 'Invalid signature' }, 401)

  try {
    const payload = JSON.parse(body)
    const entries = payload.entry || []

    for (const entry of entries) {
      // Handle messaging (DMs)
      const messaging = entry.messaging || []
      for (const msg of messaging) {
        if (msg.message?.text && msg.sender?.id) {
          await handleIncomingDM(
            c.env,
            msg.sender.id,
            msg.message.text,
            msg.sender.id // thread_id = sender_id for IG DMs
          )
        }
      }

      // Handle comments (optional — log but don't auto-reply)
      const changes = entry.changes || []
      for (const change of changes) {
        if (change.field === 'comments' && change.value) {
          console.log('[IG Webhook] Comment:', change.value.text?.slice(0, 100))
        }
      }
    }

    return c.json({ success: true })
  } catch (err: any) {
    console.error('[IG Webhook] Parse error:', err.message)
    return c.json({ error: 'Parse error' }, 400)
  }
})

// ── Twilio Voice Webhook — Inbound call attribution ──
instagramWebhookRoutes.post('/twilio/voice', async (c) => {
  // Twilio sends form-encoded data
  const formData = await c.req.parseBody()
  const callerPhone = String(formData.From || '')
  const calledNumber = String(formData.To || '')

  if (!callerPhone || !calledNumber) {
    // Return TwiML even on error to avoid Twilio errors
    return c.text('<?xml version="1.0" encoding="UTF-8"?><Response><Say>Thank you for calling Roof Manager. Please leave your information after the tone.</Say><Record maxLength="120" /></Response>', 200, {
      'Content-Type': 'text/xml',
    })
  }

  // Attribute the call
  await handleInboundCall(c.env, callerPhone, calledNumber)

  // Return TwiML — forward to main business line or record
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Thank you for calling Roof Manager. Connecting you now.</Say>
  <Dial timeout="30">
    <Number>+14165551234</Number>
  </Dial>
  <Say>Sorry, no one is available right now. Please leave a message after the tone.</Say>
  <Record maxLength="120" />
</Response>`

  return c.text(twiml, 200, { 'Content-Type': 'text/xml' })
})

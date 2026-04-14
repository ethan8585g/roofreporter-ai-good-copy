import { describe, it, expect } from 'vitest'
import { verifySquareSignature } from './square'

// Square webhook signature verification is the ONLY auth boundary between
// Square's servers and our money-moving code paths (marking payments as
// succeeded, issuing report credits, activating subscriptions). A false
// accept here lets an attacker forge a payment.completed event and top up
// anyone's account — so we pin every way it can fail.
//
// Algorithm (per Square docs):
//   signature = base64( HMAC-SHA256( signatureKey, notificationUrl + rawBody ) )

const KEY = 'test-signature-key-abc123'
const URL = 'https://www.roofmanager.ca/api/square/webhook'

async function sign(body: string, url: string = URL, key: string = KEY): Promise<string> {
  const payload = url + body
  const k = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(payload))
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
}

describe('verifySquareSignature — accepts valid signatures', () => {
  it('verifies a correctly signed empty body', async () => {
    const body = ''
    const good = await sign(body)
    expect(await verifySquareSignature(body, good, KEY, URL)).toBe(true)
  })

  it('verifies a correctly signed payment.completed event', async () => {
    const body = JSON.stringify({
      type: 'payment.completed',
      event_id: 'evt_123',
      data: { object: { payment: { id: 'pmt_1', order_id: 'ord_1' } } }
    })
    const good = await sign(body)
    expect(await verifySquareSignature(body, good, KEY, URL)).toBe(true)
  })
})

describe('verifySquareSignature — rejects invalid signatures', () => {
  it('rejects a tampered body (single-byte change)', async () => {
    const original = JSON.stringify({ type: 'payment.completed', amount: 100 })
    const good = await sign(original)
    const tampered = JSON.stringify({ type: 'payment.completed', amount: 10000 })
    expect(await verifySquareSignature(tampered, good, KEY, URL)).toBe(false)
  })

  it('rejects a signature made with a different key', async () => {
    const body = JSON.stringify({ type: 'payment.completed' })
    const attackerSig = await sign(body, URL, 'wrong-key')
    expect(await verifySquareSignature(body, attackerSig, KEY, URL)).toBe(false)
  })

  it('rejects a signature made against a different notification URL', async () => {
    // Attacker intercepts a signed webhook meant for another tenant.
    const body = JSON.stringify({ type: 'payment.completed' })
    const victimSig = await sign(body, 'https://other-tenant.example.com/webhook')
    expect(await verifySquareSignature(body, victimSig, KEY, URL)).toBe(false)
  })

  it('rejects a missing signature', async () => {
    expect(await verifySquareSignature('{}', '', KEY, URL)).toBe(false)
  })

  it('rejects when signature key is not configured', async () => {
    // If the server forgets to set SQUARE_WEBHOOK_SIGNATURE_KEY, we must fail
    // closed rather than accepting every request.
    const body = '{}'
    const anySig = await sign(body)
    expect(await verifySquareSignature(body, anySig, '', URL)).toBe(false)
  })

  it('rejects a garbage signature string', async () => {
    expect(await verifySquareSignature('{}', 'not-base64!!!', KEY, URL)).toBe(false)
  })
})

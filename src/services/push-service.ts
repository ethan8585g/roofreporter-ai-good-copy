// ============================================================
// Push Notification Delivery Service
// ============================================================
// Sends push notifications via two channels:
// 1. FCM HTTP v1 API — for iOS native (via APNs passthrough) and Android
// 2. Web Push (VAPID) — for browser subscriptions (Chrome, Firefox, Safari)
//
// All crypto uses Web Crypto API (Cloudflare Workers compatible).
// FCM auth reuses the JWT → OAuth2 pattern from gcp-auth.ts.
// ============================================================

import type { Bindings } from '../types'

// ============================================================
// Types
// ============================================================

export interface PushPayload {
  title: string
  body: string
  icon?: string
  badge?: string
  link?: string
  type?: string
  tag?: string
}

interface WebPushSubscription {
  endpoint: string
  p256dh_key: string
  auth_key: string
}

interface VAPIDKeys {
  publicKey: string   // base64url
  privateKey: string  // base64url
  subject: string     // mailto: or https: URL
}

// ============================================================
// Base64URL helpers
// ============================================================

function base64urlEncode(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlToUint8Array(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  const pad = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4))
  const binary = atob(base64 + pad)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function uint8ArrayToBase64url(arr: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function arrayBufferToBase64url(buffer: ArrayBuffer): string {
  return uint8ArrayToBase64url(new Uint8Array(buffer))
}

function concatUint8Arrays(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const arr of arrays) {
    result.set(arr, offset)
    offset += arr.length
  }
  return result
}

// ============================================================
// FCM Authentication (JWT → OAuth2 token)
// ============================================================
// Same pattern as gcp-auth.ts but with firebase.messaging scope

interface ServiceAccountKey {
  type: string
  project_id: string
  private_key: string
  client_email: string
}

let fcmTokenCache: { accessToken: string; expiresAt: number } | null = null

async function importRSAPrivateKey(pem: string): Promise<CryptoKey> {
  const pemContents = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '')
  const binaryString = atob(pemContents)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i)
  return crypto.subtle.importKey('pkcs8', bytes.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
}

async function createFCMJWT(sa: ServiceAccountKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = {
    iss: sa.client_email,
    sub: sa.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/firebase.messaging'
  }
  const encodedHeader = base64urlEncode(JSON.stringify(header))
  const encodedPayload = base64urlEncode(JSON.stringify(payload))
  const signingInput = `${encodedHeader}.${encodedPayload}`
  const key = await importRSAPrivateKey(sa.private_key)
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput))
  return `${signingInput}.${arrayBufferToBase64url(signature)}`
}

export async function getFCMAccessToken(serviceAccountJson: string): Promise<string> {
  if (fcmTokenCache && Date.now() < fcmTokenCache.expiresAt) {
    return fcmTokenCache.accessToken
  }

  const sa: ServiceAccountKey = JSON.parse(serviceAccountJson)
  const jwt = await createFCMJWT(sa)

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  })

  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`FCM OAuth2 failed (${resp.status}): ${err}`)
  }

  const data = await resp.json() as { access_token: string; expires_in: number }
  fcmTokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 600) * 1000
  }
  return data.access_token
}

// ============================================================
// FCM HTTP v1 API — Send push to a single device token
// ============================================================

export async function sendFCMPush(
  accessToken: string,
  projectId: string,
  fcmToken: string,
  payload: PushPayload
): Promise<{ success: boolean; error?: string }> {
  try {
    const resp = await fetch(
      `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: {
            token: fcmToken,
            notification: {
              title: payload.title,
              body: payload.body
            },
            data: {
              link: payload.link || '/',
              type: payload.type || '',
              tag: payload.tag || ''
            },
            apns: {
              payload: {
                aps: {
                  sound: 'default',
                  badge: 1,
                  'mutable-content': 1
                }
              }
            },
            webpush: {
              notification: {
                icon: payload.icon || '/static/icons/icon-192x192.png',
                badge: payload.badge || '/static/icons/icon-192x192.png',
                tag: payload.tag || 'default',
                requireInteraction: true
              }
            }
          }
        })
      }
    )

    if (!resp.ok) {
      const err = await resp.text()
      // Token no longer valid
      if (resp.status === 404 || err.includes('UNREGISTERED') || err.includes('NOT_FOUND')) {
        return { success: false, error: 'token_expired' }
      }
      return { success: false, error: `FCM error (${resp.status}): ${err}` }
    }

    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// ============================================================
// Web Push (VAPID) — RFC 8291 encrypted push to browser
// ============================================================

// HKDF extract + expand (RFC 5869) using Web Crypto
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const prk = new Uint8Array(await crypto.subtle.sign('HMAC', key, salt.length > 0 ? salt : new Uint8Array(32)))

  // Expand
  const prkKey = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const infoWithCounter = concatUint8Arrays(info, new Uint8Array([1]))
  const output = new Uint8Array(await crypto.subtle.sign('HMAC', prkKey, infoWithCounter))
  return output.slice(0, length)
}

// Create info parameter for HKDF per RFC 8291
function createInfo(type: string, clientPublicKey: Uint8Array, serverPublicKey: Uint8Array): Uint8Array {
  const encoder = new TextEncoder()
  const typeBytes = encoder.encode(type)
  const header = encoder.encode('Content-Encoding: ')
  const nul = new Uint8Array([0])

  return concatUint8Arrays(
    header, typeBytes, nul,
    new Uint8Array([0, 0, 0, 65]), clientPublicKey,
    new Uint8Array([0, 0, 0, 65]), serverPublicKey
  )
}

async function createVAPIDAuthHeader(endpoint: string, vapidKeys: VAPIDKeys): Promise<{ authorization: string; cryptoKey: string }> {
  const url = new URL(endpoint)
  const audience = `${url.protocol}//${url.host}`

  // Import VAPID private key as ECDSA P-256
  const privateKeyBytes = base64urlToUint8Array(vapidKeys.privateKey)
  // VAPID private key is raw 32 bytes — wrap in PKCS8 for import
  const pkcs8Prefix = new Uint8Array([
    0x30, 0x81, 0x87, 0x02, 0x01, 0x00, 0x30, 0x13,
    0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02,
    0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d,
    0x03, 0x01, 0x07, 0x04, 0x6d, 0x30, 0x6b, 0x02,
    0x01, 0x01, 0x04, 0x20
  ])
  const pkcs8Suffix = new Uint8Array([
    0xa1, 0x44, 0x03, 0x42, 0x00
  ])
  const publicKeyBytes = base64urlToUint8Array(vapidKeys.publicKey)
  const pkcs8Key = concatUint8Arrays(pkcs8Prefix, privateKeyBytes, pkcs8Suffix, publicKeyBytes)

  const signingKey = await crypto.subtle.importKey(
    'pkcs8', pkcs8Key.buffer as ArrayBuffer,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, ['sign']
  )

  // Create VAPID JWT
  const now = Math.floor(Date.now() / 1000)
  const header = base64urlEncode(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))
  const payload = base64urlEncode(JSON.stringify({
    aud: audience,
    exp: now + 86400,
    sub: `mailto:push@roofmanager.ca`
  }))
  const signingInput = `${header}.${payload}`
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    signingKey,
    new TextEncoder().encode(signingInput)
  )

  // Convert DER signature to raw r||s format for JWT
  const sigBytes = new Uint8Array(signature)
  let token: string
  if (sigBytes.length === 64) {
    // Already raw format
    token = `${signingInput}.${uint8ArrayToBase64url(sigBytes)}`
  } else {
    // DER format — extract r and s
    const r = extractDERInteger(sigBytes, 3)
    const s = extractDERInteger(sigBytes, 3 + 1 + sigBytes[3] + 1)
    const rawSig = concatUint8Arrays(padTo32(r), padTo32(s))
    token = `${signingInput}.${uint8ArrayToBase64url(rawSig)}`
  }

  return {
    authorization: `vapid t=${token},k=${vapidKeys.publicKey}`,
    cryptoKey: `p256ecdsa=${vapidKeys.publicKey}`
  }
}

function extractDERInteger(buf: Uint8Array, offset: number): Uint8Array {
  const len = buf[offset + 1]
  return buf.slice(offset + 2, offset + 2 + len)
}

function padTo32(buf: Uint8Array): Uint8Array {
  if (buf.length === 32) return buf
  if (buf.length > 32) return buf.slice(buf.length - 32)
  const padded = new Uint8Array(32)
  padded.set(buf, 32 - buf.length)
  return padded
}

export async function sendWebPush(
  subscription: WebPushSubscription,
  vapidKeys: VAPIDKeys,
  payload: PushPayload
): Promise<{ success: boolean; error?: string }> {
  try {
    const payloadBytes = new TextEncoder().encode(JSON.stringify(payload))

    // Client keys from subscription
    const clientPublicKey = base64urlToUint8Array(subscription.p256dh_key)
    const clientAuth = base64urlToUint8Array(subscription.auth_key)

    // Generate ephemeral ECDH key pair
    const ephemeralKey = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits']
    )

    // Export ephemeral public key (uncompressed, 65 bytes)
    const ephemeralPair = ephemeralKey as CryptoKeyPair
    const ephemeralPublicKeyRaw = new Uint8Array(
      (await crypto.subtle.exportKey('raw' as any, ephemeralPair.publicKey)) as ArrayBuffer
    )

    // Import client public key
    const clientKey = await crypto.subtle.importKey(
      'raw', clientPublicKey,
      { name: 'ECDH', namedCurve: 'P-256' },
      false, []
    )

    // ECDH shared secret
    const sharedSecret = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: 'ECDH', public: clientKey } as any,
        ephemeralPair.privateKey,
        256
      )
    )

    // RFC 8291: Derive encryption key and nonce using HKDF
    // IKM = HKDF(auth, sharedSecret, "Content-Encoding: auth\0", 32)
    const encoder = new TextEncoder()
    const authInfo = encoder.encode('Content-Encoding: auth\0')
    const ikm = await hkdf(clientAuth, sharedSecret, authInfo, 32)

    // Content encryption key: HKDF(salt, ikm, cek_info, 16)
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const cekInfo = createInfo('aesgcm', clientPublicKey, ephemeralPublicKeyRaw)
    const contentEncryptionKey = await hkdf(salt, ikm, cekInfo, 16)

    // Nonce: HKDF(salt, ikm, nonce_info, 12)
    const nonceInfo = createInfo('nonce', clientPublicKey, ephemeralPublicKeyRaw)
    const nonce = await hkdf(salt, ikm, nonceInfo, 12)

    // Pad payload (2-byte padding length prefix + padding)
    const paddingLength = 0
    const paddedPayload = concatUint8Arrays(
      new Uint8Array([paddingLength >> 8, paddingLength & 0xff]),
      payloadBytes
    )

    // AES-128-GCM encrypt
    const aesKey = await crypto.subtle.importKey(
      'raw', contentEncryptionKey,
      { name: 'AES-GCM' },
      false, ['encrypt']
    )
    const encrypted = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: nonce },
        aesKey,
        paddedPayload
      )
    )

    // VAPID auth headers
    const vapidHeaders = await createVAPIDAuthHeader(subscription.endpoint, vapidKeys)

    // Send to push service
    const resp = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        'Authorization': vapidHeaders.authorization,
        'Crypto-Key': `dh=${uint8ArrayToBase64url(ephemeralPublicKeyRaw)};${vapidHeaders.cryptoKey}`,
        'Content-Encoding': 'aesgcm',
        'Encryption': `salt=${uint8ArrayToBase64url(salt)}`,
        'Content-Type': 'application/octet-stream',
        'TTL': '86400'
      },
      body: encrypted
    })

    if (resp.status === 201 || resp.status === 200) {
      return { success: true }
    }

    if (resp.status === 410 || resp.status === 404) {
      return { success: false, error: 'subscription_expired' }
    }

    const errText = await resp.text()
    return { success: false, error: `Web Push error (${resp.status}): ${errText}` }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// ============================================================
// Unified: Send push to all of a user's registered devices
// ============================================================

export async function sendPushToUser(
  db: D1Database,
  env: Bindings,
  userType: 'admin' | 'customer',
  userId: number,
  payload: PushPayload
): Promise<{ sent: number; failed: number }> {
  let sent = 0
  let failed = 0

  try {
    const subs = await db.prepare(
      'SELECT * FROM push_subscriptions WHERE user_type = ? AND user_id = ? AND is_active = 1'
    ).bind(userType, userId).all()

    if (!subs.results || subs.results.length === 0) return { sent: 0, failed: 0 }

    // Default icon/badge
    const fullPayload: PushPayload = {
      ...payload,
      icon: payload.icon || '/static/icons/icon-192x192.png',
      badge: payload.badge || '/static/icons/icon-192x192.png'
    }

    const results = await Promise.allSettled(
      subs.results.map(async (sub: any) => {
        if (sub.fcm_token && env.FCM_SERVICE_ACCOUNT_JSON && env.FCM_PROJECT_ID) {
          // FCM push (iOS native / Android)
          const accessToken = await getFCMAccessToken(env.FCM_SERVICE_ACCOUNT_JSON)
          const result = await sendFCMPush(accessToken, env.FCM_PROJECT_ID, sub.fcm_token, fullPayload)
          if (!result.success && result.error === 'token_expired') {
            await db.prepare('UPDATE push_subscriptions SET is_active = 0 WHERE id = ?').bind(sub.id).run()
          }
          return result
        } else if (sub.endpoint && sub.p256dh_key && sub.auth_key && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
          // Web Push (browser)
          const result = await sendWebPush(
            { endpoint: sub.endpoint, p256dh_key: sub.p256dh_key, auth_key: sub.auth_key },
            { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: 'mailto:push@roofmanager.ca' },
            fullPayload
          )
          if (!result.success && result.error === 'subscription_expired') {
            await db.prepare('UPDATE push_subscriptions SET is_active = 0 WHERE id = ?').bind(sub.id).run()
          }
          return result
        }
        return { success: false, error: 'no_delivery_channel' }
      })
    )

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.success) sent++
      else failed++
    }
  } catch (err) {
    console.error('[Push Service] Error sending push:', err)
  }

  return { sent, failed }
}

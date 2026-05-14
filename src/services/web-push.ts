import type { Bindings } from '../types'
// ============================================================
// Web Push — VAPID (RFC 8292) + payload encryption (RFC 8291, aes128gcm).
// Self-contained, Workers-compatible. No Node-only APIs.
//
// Expected secrets:
//   VAPID_PUBLIC_KEY   - base64url of uncompressed EC P-256 public key (65 bytes)
//   VAPID_PRIVATE_KEY  - base64url of 32-byte private scalar
//   VAPID_SUBJECT      - mailto:ops@roofmanager.ca  (anything contactable)
// ============================================================

export interface PushSubscriptionRecord {
  endpoint: string
  keys_p256dh: string  // base64url of receiver's P-256 public key (65 bytes)
  keys_auth: string    // base64url of 16-byte auth secret
}

export interface VapidKeys {
  publicKey: string
  privateKey: string
  subject: string
}

// ---------- base64url helpers ----------
function b64UrlEncode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function b64UrlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 2 ? '==' : s.length % 4 === 3 ? '=' : ''
  const str = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
  const bytes = new Uint8Array(str.length)
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i)
  return bytes
}
function concat(...arrs: Uint8Array[]): Uint8Array {
  const len = arrs.reduce((n, a) => n + a.length, 0)
  const out = new Uint8Array(len)
  let o = 0
  for (const a of arrs) { out.set(a, o); o += a.length }
  return out
}

// ---------- VAPID ----------
async function importVapidPrivate(privateKeyB64Url: string): Promise<CryptoKey> {
  const d = b64UrlDecode(privateKeyB64Url)
  // WebCrypto needs JWK for P-256 import. We have raw d (32 bytes) and derive x/y from public.
  // Simpler path: import via PKCS8. But we don't have PKCS8 on hand — so we build a JWK.
  // For JWK, we need x and y too. Those come from the public key (65 bytes uncompressed: 04||x||y).
  throw new Error('importVapidPrivate: call importVapidKeyPair with both public and private')
}

async function importVapidKeyPair(publicB64Url: string, privateB64Url: string): Promise<CryptoKey> {
  const pub = b64UrlDecode(publicB64Url)
  const priv = b64UrlDecode(privateB64Url)
  if (pub.length !== 65 || pub[0] !== 0x04) throw new Error('VAPID_PUBLIC_KEY must be 65-byte uncompressed P-256 (base64url)')
  if (priv.length !== 32) throw new Error('VAPID_PRIVATE_KEY must be 32-byte scalar (base64url)')
  const x = pub.slice(1, 33), y = pub.slice(33, 65)
  const jwk = {
    kty: 'EC', crv: 'P-256', d: b64UrlEncode(priv), x: b64UrlEncode(x), y: b64UrlEncode(y),
    ext: true, key_ops: ['sign']
  }
  return crypto.subtle.importKey('jwk', jwk as any, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
}

async function signVapidJWT(audience: string, vapid: VapidKeys, expSeconds: number): Promise<string> {
  const header = { typ: 'JWT', alg: 'ES256' }
  const now = Math.floor(Date.now() / 1000)
  const payload = { aud: audience, exp: now + expSeconds, sub: vapid.subject }
  const signingInput = b64UrlEncode(new TextEncoder().encode(JSON.stringify(header))) + '.' +
                       b64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)))
  const key = await importVapidKeyPair(vapid.publicKey, vapid.privateKey)
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(signingInput))
  // WebCrypto returns raw r||s (64 bytes) for ES256 — which is what JWT expects.
  return signingInput + '.' + b64UrlEncode(sig)
}

// ---------- aes128gcm payload encryption (RFC 8188/8291) ----------
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', salt, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const prk = new Uint8Array(await crypto.subtle.sign('HMAC', key, ikm))
  const prkKey = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  // Single-block expand (len <= 32).
  const t = new Uint8Array(await crypto.subtle.sign('HMAC', prkKey, concat(info, new Uint8Array([1]))))
  return t.slice(0, len)
}

async function encryptPayload(
  payload: Uint8Array,
  receiverPubB64Url: string,
  receiverAuthB64Url: string
): Promise<{ body: Uint8Array; senderPublicRaw: Uint8Array; salt: Uint8Array }> {
  const receiverPub = b64UrlDecode(receiverPubB64Url) // 65 bytes
  const receiverAuth = b64UrlDecode(receiverAuthB64Url)
  if (receiverPub.length !== 65 || receiverPub[0] !== 0x04) throw new Error('Bad receiver public key')

  // Ephemeral sender keypair (P-256)
  const senderKP = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const senderPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', (senderKP as any).publicKey))

  // Import receiver public for ECDH
  const receiverJwk = {
    kty: 'EC', crv: 'P-256',
    x: b64UrlEncode(receiverPub.slice(1, 33)),
    y: b64UrlEncode(receiverPub.slice(33, 65)),
    ext: true
  }
  const receiverPubKey = await crypto.subtle.importKey('jwk', receiverJwk as any, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: receiverPubKey }, (senderKP as any).privateKey, 256))

  // key_info = "WebPush: info\0" || ua_public || as_public
  const keyInfo = concat(new TextEncoder().encode('WebPush: info\0'), receiverPub, senderPubRaw)
  const ikm = await hkdf(receiverAuth, ecdhSecret, keyInfo, 32)

  const salt = crypto.getRandomValues(new Uint8Array(16))
  const cek = await hkdf(salt, ikm, new TextEncoder().encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, new TextEncoder().encode('Content-Encoding: nonce\0'), 12)

  // Plaintext || 0x02 (last record) — no further padding (recordSize=4096 handles whole payload)
  const plain = concat(payload, new Uint8Array([0x02]))
  const cekKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt'])
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cekKey, plain))

  // Header: salt(16) || rs(uint32 BE) || idlen(1) || keyid(idlen)
  // Per RFC 8291, keyid = sender public key (65 bytes) for aes128gcm + WebPush.
  const rs = 4096
  const header = new Uint8Array(16 + 4 + 1 + senderPubRaw.length)
  header.set(salt, 0)
  header[16] = (rs >>> 24) & 0xff; header[17] = (rs >>> 16) & 0xff; header[18] = (rs >>> 8) & 0xff; header[19] = rs & 0xff
  header[20] = senderPubRaw.length
  header.set(senderPubRaw, 21)

  return { body: concat(header, cipher), senderPublicRaw: senderPubRaw, salt }
}

// ---------- public entry point ----------
export async function sendWebPush(
  sub: PushSubscriptionRecord,
  payload: object | string,
  vapid: VapidKeys,
  ttlSeconds = 3600
): Promise<{ ok: boolean; status: number; body?: string }> {
  const url = new URL(sub.endpoint)
  const audience = `${url.protocol}//${url.host}`
  const jwt = await signVapidJWT(audience, vapid, 12 * 3600)

  const plain = typeof payload === 'string' ? new TextEncoder().encode(payload)
    : new TextEncoder().encode(JSON.stringify(payload))
  const { body } = await encryptPayload(plain, sub.keys_p256dh, sub.keys_auth)

  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `vapid t=${jwt}, k=${vapid.publicKey}`,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'TTL': String(ttlSeconds),
      'Urgency': 'normal'
    },
    body
  })
  if (res.ok) return { ok: true, status: res.status }
  const text = await res.text().catch(() => '')
  return { ok: false, status: res.status, body: text.slice(0, 300) }
}

export function getVapidFromEnv(env: Bindings): VapidKeys | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null
  return {
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject: env.VAPID_SUBJECT || 'mailto:ops@roofmanager.ca'
  }
}
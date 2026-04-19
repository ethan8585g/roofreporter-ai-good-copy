import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getAccount, getMediaList, getBusinessDiscovery, validateWebhookSignatureAsync, encryptToken, decryptToken } from './graph-client'

const mockConfig = {
  accessToken: 'test-token-123',
  apiVersion: 'v21.0',
  igUserId: '12345678',
}

describe('graph-client', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  describe('URL formation', () => {
    it('builds correct URL for getAccount', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ id: '12345678', username: 'roofmanager' }))
      )

      await getAccount(mockConfig)

      expect(fetchSpy).toHaveBeenCalledOnce()
      const url = fetchSpy.mock.calls[0][0] as string
      expect(url).toContain('https://graph.facebook.com/v21.0/12345678')
      expect(url).toContain('access_token=test-token-123')
      expect(decodeURIComponent(url)).toContain('fields=id,username,name,profile_picture_url')
    })

    it('builds correct URL for getMediaList with pagination', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ data: [] }))
      )

      await getMediaList(mockConfig, 25, 'cursor_abc')

      const url = fetchSpy.mock.calls[0][0] as string
      expect(url).toContain('/12345678/media')
      expect(url).toContain('limit=25')
      expect(url).toContain('after=cursor_abc')
    })

    it('builds correct URL for Business Discovery', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ business_discovery: {} }))
      )

      await getBusinessDiscovery(mockConfig, 'competitor_acct', 10)

      const url = fetchSpy.mock.calls[0][0] as string
      const decoded = decodeURIComponent(url)
      expect(decoded).toContain('business_discovery')
      expect(decoded).toContain('username(competitor_acct)')
      expect(decoded).toContain('media.limit(10)')
    })

    it('pins API version from config', async () => {
      const customConfig = { ...mockConfig, apiVersion: 'v19.0' }
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({}))
      )

      await getAccount(customConfig)

      const url = fetchSpy.mock.calls[0][0] as string
      expect(url).toContain('/v19.0/')
      expect(url).not.toContain('/v21.0/')
    })
  })

  describe('retry on 429', () => {
    it('retries on 429 and succeeds', async () => {
      let callCount = 0
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        callCount++
        if (callCount <= 2) {
          return new Response('Rate limited', { status: 429 })
        }
        return new Response(JSON.stringify({ id: '123', username: 'test' }))
      })

      const result = await getAccount(mockConfig)
      expect(result.username).toBe('test')
      expect(callCount).toBe(3)
    })
  })

  describe('webhook signature validation', () => {
    it('validates correct HMAC-SHA256 signature', async () => {
      const payload = '{"test":"data"}'
      const secret = 'my-app-secret'

      // Generate expected signature
      const encoder = new TextEncoder()
      const key = await crypto.subtle.importKey(
        'raw', encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
      )
      const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
      const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')

      const valid = await validateWebhookSignatureAsync(payload, `sha256=${hex}`, secret)
      expect(valid).toBe(true)
    })

    it('rejects invalid signature', async () => {
      const valid = await validateWebhookSignatureAsync('payload', 'sha256=invalid', 'secret')
      expect(valid).toBe(false)
    })

    it('rejects missing sha256 prefix', async () => {
      const valid = await validateWebhookSignatureAsync('payload', 'nope', 'secret')
      expect(valid).toBe(false)
    })
  })

  describe('token encryption/decryption', () => {
    it('round-trips encrypt and decrypt', async () => {
      const token = 'EAABwzLixnjYBO...'
      const key = 'my-jwt-secret-key'

      const encrypted = await encryptToken(token, key)
      expect(encrypted).not.toBe(token)

      const decrypted = await decryptToken(encrypted, key)
      expect(decrypted).toBe(token)
    })
  })
})

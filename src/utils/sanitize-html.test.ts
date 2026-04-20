import { describe, it, expect } from 'vitest'
import { sanitizeHtml } from './sanitize-html'

describe('sanitizeHtml', () => {
  it('strips script tags', () => {
    expect(sanitizeHtml('<p>ok</p><script>alert(1)</script>')).toBe('<p>ok</p>')
  })
  it('strips iframe + object + embed', () => {
    expect(sanitizeHtml('<iframe src="x"></iframe><object></object><embed>')).toBe('')
  })
  it('strips inline event handlers', () => {
    // Exact whitespace depends on regex; the guarantee is "no on*=" remains.
    const a = sanitizeHtml('<a href="/x" onclick="bad()">hi</a>')
    expect(a).toContain('<a')
    expect(a).toContain('href="/x"')
    expect(a).not.toContain('onclick')
    const img = sanitizeHtml("<img src='x' onerror='y'>")
    expect(img).toContain("src='x'")
    expect(img).not.toContain('onerror')
  })
  it('strips javascript: URLs', () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>')
  })
  it('strips data:text/html URLs', () => {
    expect(sanitizeHtml('<a href="data:text/html,<script>x</script>">x</a>')).toBe('<a>x</a>')
  })
  it('strips HTML comments', () => {
    expect(sanitizeHtml('<!-- bad --><p>ok</p>')).toBe('<p>ok</p>')
  })
  it('passes safe HTML unchanged', () => {
    const safe = '<h2>Title</h2><p>Hello <strong>world</strong> and <a href="/about">about</a>.</p>'
    expect(sanitizeHtml(safe)).toBe(safe)
  })
  it('handles nested scripts', () => {
    expect(sanitizeHtml('<p>a<script>b<script>c</script></script></p>')).toContain('<p>a')
    expect(sanitizeHtml('<p>a<script>b<script>c</script></script></p>')).not.toContain('<script')
  })
})

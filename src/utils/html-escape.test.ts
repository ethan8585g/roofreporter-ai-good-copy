import { describe, it, expect } from 'vitest'
import { escHtml, escAttr } from './html-escape'

describe('escHtml', () => {
  it('escapes all HTML-special characters', () => {
    expect(escHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;&#x2F;script&gt;')
    expect(escHtml('a & b')).toBe('a &amp; b')
    expect(escHtml('"quoted"')).toBe('&quot;quoted&quot;')
    expect(escHtml("it's")).toBe('it&#39;s')
    expect(escHtml('`bt`')).toBe('&#x60;bt&#x60;')
    expect(escHtml('x=1')).toBe('x&#x3D;1')
  })
  it('handles null/undefined', () => {
    expect(escHtml(null)).toBe('')
    expect(escHtml(undefined)).toBe('')
  })
  it('coerces non-strings', () => {
    expect(escHtml(42)).toBe('42')
    expect(escHtml(true)).toBe('true')
  })
  it('preserves CRLF and unicode', () => {
    expect(escHtml('line1\r\nline2')).toBe('line1\r\nline2')
    expect(escHtml('café ☕')).toBe('café ☕')
  })
})

describe('escAttr', () => {
  it('matches escHtml', () => {
    expect(escAttr('" onmouseover="x()')).toBe(escHtml('" onmouseover="x()'))
  })
})

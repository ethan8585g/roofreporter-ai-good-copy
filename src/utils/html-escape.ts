const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '/': '&#x2F;',
  '`': '&#x60;',
  '=': '&#x3D;',
}

export function escHtml(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v).replace(/[&<>"'`=\/]/g, (ch) => HTML_ESCAPES[ch] || ch)
}

export function escAttr(v: unknown): string {
  return escHtml(v)
}

// Server-side HTML sanitizer for content that's authored by admins and
// rendered unsafely to public visitors (blog posts, report prose, etc.).
// Cloudflare Workers has no DOM so we can't use DOMPurify directly; this is
// a minimal regex-based allowlist that strips the highest-risk constructs:
//
//   - <script>...</script>
//   - <iframe>, <object>, <embed>, <applet>, <link>, <meta>, <style>
//   - inline event handlers (on*="...")
//   - javascript: / data:text/html / vbscript: URLs in href/src
//   - HTML comments (can hide conditional IE script blocks)
//
// Everything else passes through. Not a substitute for a full DOMPurify port;
// intended as defense-in-depth on top of admin-only authoring gates.

const DANGEROUS_TAGS = ['script', 'iframe', 'object', 'embed', 'applet', 'link', 'meta', 'style', 'base', 'form']

const URL_ATTR_PATTERN = /\s(href|src|xlink:href|action|formaction|poster|background)\s*=\s*(["'])?\s*(javascript:|data:text\/html|vbscript:)[^"'\s>]*["']?/gi

export function sanitizeHtml(input: string): string {
  if (typeof input !== 'string' || !input) return ''
  let out = input

  // 1. Strip HTML comments (can hide IE conditional scripts).
  out = out.replace(/<!--[\s\S]*?-->/g, '')

  // 2. Strip dangerous tags and their contents.
  for (const tag of DANGEROUS_TAGS) {
    const openClose = new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}\\s*>`, 'gi')
    const selfClose = new RegExp(`<${tag}\\b[^>]*\\/?>`, 'gi')
    out = out.replace(openClose, '')
    out = out.replace(selfClose, '')
  }

  // 3. Strip inline event handlers (on*="...", on*='...', on*=unquoted).
  out = out.replace(/\s(on[a-z]+)\s*=\s*"[^"]*"/gi, '')
  out = out.replace(/\s(on[a-z]+)\s*=\s*'[^']*'/gi, '')
  out = out.replace(/\s(on[a-z]+)\s*=\s*[^"'\s>]+/gi, '')

  // 4. Strip dangerous URL schemes in href/src/etc.
  out = out.replace(URL_ATTR_PATTERN, '')

  return out
}

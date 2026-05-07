#!/usr/bin/env node
// Build-time internal link auditor for roofmanager.ca.
// Cross-references every internal href / window.location / c.redirect()
// in src/ + public/static/ against the Hono route registry. Exits non-zero
// on any unmatched internal link so a broken redirect can never ship.
//
// Allowlist a known false-positive by adding `// link-audit-allow` on the
// same line as the href (or the line above).

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, basename } from 'node:path'

const ROOT = process.cwd()
const SRC_DIRS = ['src']
const STATIC_DIRS = ['public/static']
const PUBLIC_DIR = join(ROOT, 'public')

// ────────────────────────────────────────────────────────────────────────────
// File walking
// ────────────────────────────────────────────────────────────────────────────
function walk(dir, exts) {
  const out = []
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      out.push(...walk(p, exts))
    } else if (exts.some((e) => entry.name.endsWith(e))) {
      out.push(p)
    }
  }
  return out
}

// Test files contain href fixtures and prose strings that aren't real
// links — skipping prevents false-positive flood.
const isTestFile = (p) => /\.test\.(ts|tsx|js)$/.test(p)
const tsFiles = walk(join(ROOT, 'src'), ['.ts', '.tsx']).filter((p) => !isTestFile(p))
const jsFiles = walk(join(ROOT, 'public/static'), ['.js']).filter((p) => !isTestFile(p))

// ────────────────────────────────────────────────────────────────────────────
// Route registry — discover everything mounted in src/index.tsx and
// every sub-router file under src/routes/.
// ────────────────────────────────────────────────────────────────────────────
const indexPath = join(ROOT, 'src/index.tsx')
const indexSrc = readFileSync(indexPath, 'utf8')

// Discover every import binding that comes from `./routes/<file>`. We need
// to handle three forms:
//   import { fooRoutes } from './routes/foo'                  (named)
//   import { ukApp as ukRoutes } from './routes/intl-regions' (named-aliased)
//   import barRoutes from './routes/bar'                       (default)
// All resolve to bindings that can later be passed to `app.route(...)`.
const importMap = {}
// Named imports (with optional `as alias`)
for (const m of indexSrc.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]\.\/routes\/([\w-]+)['"]/g)) {
  const fileBase = m[2]
  for (const part of m[1].split(',')) {
    const piece = part.trim()
    if (!piece) continue
    const aliasMatch = piece.match(/(?:[\w$]+)\s+as\s+([\w$]+)/)
    const localName = aliasMatch ? aliasMatch[1] : piece
    importMap[localName] = fileBase
  }
}
// Default imports
for (const m of indexSrc.matchAll(/import\s+([\w$]+)\s+from\s*['"]\.\/routes\/([\w-]+)['"]/g)) {
  importMap[m[1]] = m[2]
}

// app.route('/prefix', xxxRoutes)  →  varName → [prefix, prefix, ...]
const mountMap = {}
for (const m of indexSrc.matchAll(/app\.route\(\s*['"]([^'"]*)['"]\s*,\s*(\w+)\s*\)/g)) {
  const prefix = m[1]
  const varName = m[2]
  if (!mountMap[varName]) mountMap[varName] = []
  mountMap[varName].push(prefix)
}

// app.get('/path', ...) / app.post / app.all etc — page + API routes
// declared directly in index.tsx.
const directRoutes = new Set()
const verbRe = /\bapp\.(get|post|put|patch|delete|all|use)\(\s*['"]([^'"`]+)['"]/g
for (const m of indexSrc.matchAll(verbRe)) {
  const path = m[2]
  if (path.startsWith('/')) directRoutes.add(path)
}

// For each routes file, aggregate every `<word>.(verb)('/path', ...)` call —
// this catches routes registered against ANY local binding (handles default
// imports, aliased named imports, and files that export multiple Hono apps
// like intl-regions.ts with ukApp + auApp). Then mount the aggregated path
// list at every prefix used to mount any binding from that file.
const fileToRelPaths = {}
const fileToPrefixes = {}
for (const [varName, fileBase] of Object.entries(importMap)) {
  if (!fileToRelPaths[fileBase]) {
    const filePath = join(ROOT, 'src/routes', fileBase + '.ts')
    if (!existsSync(filePath)) {
      fileToRelPaths[fileBase] = []
    } else {
      const src = readFileSync(filePath, 'utf8')
      const reAny = /\b[\w$]+\.(get|post|put|patch|delete|all|use)\(\s*['"]([^'"`]+)['"]/g
      const paths = []
      for (const m of src.matchAll(reAny)) {
        const p = m[2]
        // skip sub-router mount calls inside the file (rare but possible)
        if (p === '*' || p === '/*') paths.push('/*')
        else paths.push(p)
      }
      fileToRelPaths[fileBase] = paths
    }
  }
  if (!fileToPrefixes[fileBase]) fileToPrefixes[fileBase] = new Set()
  for (const pfx of (mountMap[varName] || [])) fileToPrefixes[fileBase].add(pfx)
}

const subRouterRoutes = new Set()
function registerRoute(set, p) {
  if (!p) return
  set.add(p)
  // Hono treats `/foo` and `/foo/` as the same — the matcher already does
  // this, but we register both spellings so prefix-match passes too.
  if (p !== '/' && p.endsWith('/')) set.add(p.slice(0, -1))
  if (p !== '/' && !p.endsWith('/')) set.add(p + '/')
}
for (const [fileBase, relPaths] of Object.entries(fileToRelPaths)) {
  const prefixes = fileToPrefixes[fileBase] || new Set()
  for (const prefix of prefixes) {
    for (const rel of relPaths) {
      const full = (prefix + (rel.startsWith('/') ? rel : '/' + rel)).replace(/\/+/g, '/')
      registerRoute(subRouterRoutes, full || '/')
    }
  }
}

const allRoutes = new Set([...directRoutes, ...subRouterRoutes])

// Convert each registered route into a regex so dynamic segments (`:id`,
// `:slug`) and wildcards (`*`) match real hrefs.
function routeToRegex(route) {
  let pattern = route
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex metas (preserve / and :)
    .replace(/:[a-zA-Z_][a-zA-Z0-9_]*/g, '[^/]+')
    .replace(/\*/g, '.*')
  return new RegExp('^' + pattern + '/?$')
}
const routeRegexes = [...allRoutes].map((r) => ({ route: r, re: routeToRegex(r) }))

// ────────────────────────────────────────────────────────────────────────────
// Static asset registry — anything physically in public/ is served by Pages.
// ────────────────────────────────────────────────────────────────────────────
function listStaticPaths(dir, prefix = '') {
  const out = []
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = prefix + '/' + entry.name
    if (entry.isDirectory()) out.push(...listStaticPaths(join(dir, entry.name), p))
    else out.push(p)
  }
  return out
}
const staticAssets = new Set(listStaticPaths(PUBLIC_DIR))

// Special-case Cloudflare-served paths that aren't files in public/.
const ALWAYS_VALID = new Set([
  '/',
  '/favicon.ico',
  '/robots.txt',
  '/sitemap.xml',
  '/manifest.json',
])

// ────────────────────────────────────────────────────────────────────────────
// Href extraction — pull every internal path reference from source.
// ────────────────────────────────────────────────────────────────────────────
const HREF_PATTERNS = [
  // href="..."   /   href='...'
  /\bhref\s*=\s*["']([^"']+)["']/g,
  // href={`...`} — JSX template literal
  /\bhref\s*=\s*\{\s*`([^`]+)`\s*\}/g,
  // window.location.href = "..."
  /window\.location(?:\.href)?\s*=\s*["'`]([^"'`]+)["'`]/g,
  // window.location.replace("...") / .assign("...")
  /window\.location\.(?:replace|assign)\s*\(\s*["'`]([^"'`]+)["'`]/g,
  // c.redirect("...")
  /\bc\.redirect\s*\(\s*["'`]([^"'`]+)["'`]/g,
]

function isExternal(href) {
  // Protocol-relative URLs (`//host/...`) resolve to the same scheme but a
  // different host — treat them as external to avoid false positives on
  // dns-prefetch and CDN preload tags.
  if (href.startsWith('//')) return true
  return /^(https?:|mailto:|tel:|sms:|data:|javascript:|blob:|ftp:)/i.test(href)
}

function staticPrefixOfTemplate(href) {
  // For "/customer/order?address=${...}" → "/customer/order"
  // For "/report/${id}/share"            → "/report/"
  const dollar = href.indexOf('${')
  if (dollar === -1) return href
  return href.slice(0, dollar)
}

function stripQueryAndHash(p) {
  return p.split('#')[0].split('?')[0]
}

function isAllowed(content, lineIdx) {
  const line = content[lineIdx] || ''
  const prev = content[lineIdx - 1] || ''
  return /link-audit-allow/.test(line) || /link-audit-allow/.test(prev)
}

function matchesAnyRoute(path) {
  if (ALWAYS_VALID.has(path)) return true
  if (staticAssets.has(path)) return true
  // /static/* paths are always served by Pages, even if file missing
  if (path.startsWith('/static/')) return true
  for (const { re } of routeRegexes) if (re.test(path)) return true
  // Prefix match for template-literal hrefs that ended at "${"
  if (path.endsWith('/')) {
    for (const route of allRoutes) {
      if (route.startsWith(path)) return true
    }
  }
  return false
}

const findings = []

for (const file of [...tsFiles, ...jsFiles]) {
  const src = readFileSync(file, 'utf8')
  const lines = src.split('\n')
  for (const re of HREF_PATTERNS) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(src)) !== null) {
      let raw = m[1]
      if (!raw) continue
      if (isExternal(raw)) continue
      if (raw.startsWith('#')) continue
      if (raw.startsWith('?')) continue
      if (raw.startsWith('${')) continue // entire URL is computed at runtime
      // LLM prompt strings often contain demonstrative `/…` placeholders.
      // A real route never contains an ellipsis or three consecutive dots.
      if (raw.includes('...')) continue
      // Reduce template literal to its static prefix for matching purposes.
      raw = staticPrefixOfTemplate(raw)
      const path = stripQueryAndHash(raw)
      if (!path.startsWith('/')) continue
      // Pure root with query/hash already stripped
      if (path === '/') continue
      // Find the line number for nicer reporting + allowlist support.
      const upTo = src.slice(0, m.index)
      const lineIdx = upTo.split('\n').length - 1
      if (isAllowed(lines, lineIdx)) continue
      if (matchesAnyRoute(path)) continue
      findings.push({
        file: relative(ROOT, file),
        line: lineIdx + 1,
        path,
        snippet: lines[lineIdx].trim().slice(0, 160),
      })
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Report
// ────────────────────────────────────────────────────────────────────────────
const total = findings.length
console.log(`[link-audit] scanned ${tsFiles.length + jsFiles.length} files, ${allRoutes.size} routes registered, ${staticAssets.size} static assets`)
if (total === 0) {
  console.log('[link-audit] ✓ no broken internal links found')
  process.exit(0)
}

// Group by path for readability when the same broken link appears in many places.
const byPath = new Map()
for (const f of findings) {
  if (!byPath.has(f.path)) byPath.set(f.path, [])
  byPath.get(f.path).push(f)
}
console.log(`[link-audit] ✗ ${total} broken internal link reference(s) across ${byPath.size} unique path(s):\n`)
for (const [path, hits] of [...byPath.entries()].sort()) {
  console.log(`  ${path}  (${hits.length} reference${hits.length === 1 ? '' : 's'})`)
  for (const h of hits.slice(0, 5)) {
    console.log(`    ${h.file}:${h.line}  →  ${h.snippet}`)
  }
  if (hits.length > 5) console.log(`    … +${hits.length - 5} more`)
  console.log()
}
console.log('Add a registered route, fix the link, or annotate the line with')
console.log('`// link-audit-allow` if the path is intentionally external/dynamic.\n')
process.exit(1)

#!/usr/bin/env node
// Walks src/ and public/static/ extracting every internal URL referenced in
// `href="..."`, `window.location.href = ...`, and `c.redirect(...)` calls,
// then diffs against routes registered via `app.get/post/put/delete/all`.
// Any reference with no matching route is reported and the script exits 1.
//
// Scope: catches the class of bug that took out customers #48 and #49 on
// 2026-05-06 — a CTA pointing at a path with no route handler.
//
// Run: node tools/audit-internal-links.mjs

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const SRC_DIRS = ['src', 'public/static']
const FILE_EXTS = new Set(['.ts', '.tsx', '.js', '.mjs', '.html'])

// Paths we shouldn't flag even if not registered (handled by Cloudflare
// Pages static asset serving, by external services, or by intent).
const IGNORE_PREFIXES = [
  '/static/',
  '/favicon',
  '/robots.txt',
  '/sitemap',
  '/manifest',
  '/.well-known/',
  '/api/',     // API routes live in src/routes/* and are registered via mounted sub-routers; skip API path verification here (separate concern)
  '/sw.js',
]

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.') || entry === 'node_modules' || entry === 'dist') continue
    const p = join(dir, entry)
    const s = statSync(p)
    if (s.isDirectory()) walk(p, out)
    else if (FILE_EXTS.has(extname(p))) out.push(p)
  }
  return out
}

const files = SRC_DIRS.flatMap(d => walk(join(ROOT, d)))

// --- collect referenced internal paths -----------------------------------
const referenced = new Map() // path -> [{ file, line }]

const REF_PATTERNS = [
  // href="/..."  href='/...'  href={`/...`}
  /href\s*=\s*["'`](\/[^"'`?#\s${}]*)/g,
  // window.location.href = '/...'  window.location = '/...'  location.href='/...'
  /(?:window\.)?location(?:\.href)?\s*=\s*["'`](\/[^"'`?#\s${}]*)/g,
  // c.redirect('/...', ...)  return c.redirect("/...")
  /\.redirect\s*\(\s*["'`](\/[^"'`?#\s${}]*)/g,
  // Response.redirect('/...')
  /Response\.redirect\s*\(\s*["'`](\/[^"'`?#\s${}]*)/g,
]

for (const file of files) {
  const src = readFileSync(file, 'utf8')
  const lines = src.split('\n')
  for (const pattern of REF_PATTERNS) {
    pattern.lastIndex = 0
    let m
    while ((m = pattern.exec(src)) !== null) {
      const path = m[1]
      if (!path || path === '/' || path.startsWith('//')) continue
      // strip query/fragment if any made it through
      const clean = path.split(/[?#]/)[0]
      if (IGNORE_PREFIXES.some(p => clean.startsWith(p))) continue
      // figure out line number for the match
      const upTo = src.slice(0, m.index)
      const line = upTo.split('\n').length
      const rel = file.replace(ROOT, '')
      if (!referenced.has(clean)) referenced.set(clean, [])
      referenced.get(clean).push({ file: rel, line })
    }
  }
}

// --- collect registered routes -------------------------------------------
const routes = new Set() // exact paths
const paramRoutes = []   // patterns with :param

const ROUTE_PATTERN = /\b(?:app|route|router|api|customer|admin|reports|orders|crm|square|stripe|telephony|jobs|customers|invoices|widget|webhooks|pipeline|leads|payments|email|nearmap|calendar|secretary|google|wb|onboarding|register)\.(?:get|post|put|patch|delete|all)\s*\(\s*["'`]([^"'`)]+)/g

for (const file of files) {
  if (!file.endsWith('.ts') && !file.endsWith('.tsx')) continue
  const src = readFileSync(file, 'utf8')
  ROUTE_PATTERN.lastIndex = 0
  let m
  while ((m = ROUTE_PATTERN.exec(src)) !== null) {
    const path = m[1]
    if (!path.startsWith('/')) continue
    if (path.includes(':')) {
      // build a regex that matches the parameterized pattern
      const re = new RegExp('^' + path.replace(/:[^/]+/g, '[^/]+') + '$')
      paramRoutes.push({ pattern: path, re })
    } else {
      routes.add(path)
    }
  }
}

// --- also accept paths that are merely redirected through Hono `redirect()` --
// (because `c.redirect('/x')` makes /x a valid landing target if /x is itself
// a registered route). We've already added all redirect targets to `routes`
// indirectly via the route scan above. Redirect *sources* are likewise routes.

// --- diff -----------------------------------------------------------------
const broken = []
for (const [path, refs] of referenced) {
  if (routes.has(path)) continue
  if (paramRoutes.some(r => r.re.test(path))) continue
  broken.push({ path, refs })
}

broken.sort((a, b) => a.path.localeCompare(b.path))

// --- report ---------------------------------------------------------------
if (broken.length === 0) {
  console.log('✅ No broken internal links. Scanned ' + files.length + ' files, ' + referenced.size + ' referenced paths, ' + (routes.size + paramRoutes.length) + ' registered routes.')
  process.exit(0)
}

console.log('❌ ' + broken.length + ' internal link(s) reference a path with no matching route handler:\n')
for (const b of broken) {
  console.log('  ' + b.path)
  for (const r of b.refs.slice(0, 5)) {
    console.log('    → ' + r.file + ':' + r.line)
  }
  if (b.refs.length > 5) console.log('    → … and ' + (b.refs.length - 5) + ' more')
  console.log('')
}
console.log('Scanned ' + files.length + ' files, ' + referenced.size + ' referenced paths, ' + (routes.size + paramRoutes.length) + ' registered routes.')
process.exit(1)

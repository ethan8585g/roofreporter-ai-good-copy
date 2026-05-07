#!/usr/bin/env node
// Live smoke test: hits every customer-facing URL referenced as a link
// target in the codebase against production and asserts a 2xx/3xx response.
//
// Catches the class of bug that took out 2 signups on 2026-05-06: a CTA
// pointing at a path with no route handler. The link auditor catches this
// at build time; this script catches it at run time, so transient deploy
// drift (config error, route registration broken, etc.) is also flagged.
//
// Run: node tools/customer-flow-smoke.mjs
// CI: invoked by .github/workflows/customer-flow-smoke.yml

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

const BASE = process.env.SMOKE_BASE_URL || 'https://www.roofmanager.ca'
const ROOT = new URL('..', import.meta.url).pathname
const SRC_DIRS = ['src', 'public/static']
const FILE_EXTS = new Set(['.ts', '.tsx', '.js', '.mjs', '.html'])

// Customer-facing URL prefixes to verify. Other paths (admin, api, etc.)
// are excluded — admin pages are gated, api endpoints expect POST/auth.
const VERIFY_PREFIXES = ['/customer/', '/onboarding', '/register', '/pricing', '/help', '/blog', '/about', '/contact']
const SKIP_PREFIXES = ['/static/', '/api/', '/.well-known/', '/og/', '/widget/', '/customer/login', '/customer/forgot-password']

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

const referenced = new Map()
const REF_PATTERNS = [
  /href\s*=\s*["'`](\/[a-z][^"'`?#\s${}]*)/gi,
  /(?:window\.)?location(?:\.href)?\s*=\s*["'`](\/[a-z][^"'`?#\s${}]*)/gi,
]

for (const file of files) {
  const src = readFileSync(file, 'utf8')
  for (const pattern of REF_PATTERNS) {
    pattern.lastIndex = 0
    let m
    while ((m = pattern.exec(src)) !== null) {
      const path = m[1].split(/[?#]/)[0]
      if (!VERIFY_PREFIXES.some(p => path.startsWith(p))) continue
      if (SKIP_PREFIXES.some(p => path.startsWith(p))) continue
      // Skip paths ending with '/' that look like template-literal truncations
      // (href="/blog/${slug}" → /blog/) — the empty trailing segment can't be
      // verified live without knowing the param value.
      if (path.endsWith('/') && path !== '/') continue
      const upTo = src.slice(0, m.index)
      const line = upTo.split('\n').length
      const rel = file.replace(ROOT, '')
      if (!referenced.has(path)) referenced.set(path, [])
      referenced.get(path).push({ file: rel, line })
    }
  }
}

console.log(`Smoke testing ${referenced.size} unique paths against ${BASE}\n`)

const failures = []
const paths = [...referenced.keys()].sort()

// concurrency-limited fetch loop
const CONCURRENCY = 8
let i = 0
async function worker() {
  while (i < paths.length) {
    const idx = i++
    const path = paths[idx]
    const url = BASE + path
    try {
      const res = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': 'roofmanager-smoke/1.0' } })
      const ok = res.status >= 200 && res.status < 400
      const tag = ok ? '✓' : '✗'
      process.stdout.write(`${tag} ${res.status}  ${path}\n`)
      if (!ok) failures.push({ path, status: res.status, refs: referenced.get(path) })
    } catch (err) {
      process.stdout.write(`✗ ERR  ${path}  (${err.message})\n`)
      failures.push({ path, status: 'error', error: err.message, refs: referenced.get(path) })
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker))

console.log('')
if (failures.length === 0) {
  console.log(`✅ All ${paths.length} customer-facing paths return 2xx/3xx.`)
  process.exit(0)
}

console.log(`❌ ${failures.length} path(s) failed:\n`)
for (const f of failures) {
  console.log(`  ${f.status}  ${f.path}`)
  for (const r of (f.refs || []).slice(0, 3)) {
    console.log(`    ↳ referenced from ${r.file}:${r.line}`)
  }
}
process.exit(1)

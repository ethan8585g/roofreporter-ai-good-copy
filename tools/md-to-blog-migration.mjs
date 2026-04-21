#!/usr/bin/env node
// One-shot: convert blog-posts/*.md into D1 INSERT migrations.
// Reads frontmatter (YAML-ish), converts body markdown -> HTML, emits migration SQL.

import fs from 'node:fs'
import path from 'node:path'
import { marked } from 'marked'

const INPUTS = process.argv.slice(2)
if (!INPUTS.length) {
  console.error('usage: md-to-blog-migration.mjs <file.md> [more...]')
  process.exit(1)
}

function parseFrontmatter(src) {
  const m = src.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!m) throw new Error('No frontmatter')
  const fmRaw = m[1]
  const body = m[2]
  const fm = {}
  let lastKey = null
  for (const line of fmRaw.split('\n')) {
    const kv = line.match(/^([a-z_]+):\s*(.*)$/)
    if (kv) {
      lastKey = kv[1]
      let v = kv[2].trim()
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
      fm[lastKey] = v
    }
  }
  return { fm, body }
}

function stripLeadingH1(md) {
  // Body often opens with "# Title" duplicating frontmatter title; remove it.
  return md.replace(/^\s*#\s+.+\n+/, '')
}

function mdToHtml(md) {
  marked.setOptions({ gfm: true, breaks: false, mangle: false, headerIds: false })
  return marked.parse(md)
}

function sqlEscape(s) {
  return String(s).replace(/'/g, "''")
}

function buildQuickAnswerBlock(firstParagraphHtml) {
  // Wrap the first paragraph (which is typically "Quick Answer: ...") in the
  // styled callout used by the existing GEO-series posts (0158/0159).
  const m = firstParagraphHtml.match(/^<p><strong>Quick Answer:<\/strong>\s*([\s\S]*?)<\/p>/i)
  if (!m) return null
  const inner = m[1].trim()
  return `<div class="rm-quick-answer not-prose my-8 rounded-2xl p-6" style="background:rgba(245,158,11,0.07);border:1px solid rgba(245,158,11,0.25)">
  <p style="font-size:12px;font-weight:700;color:#f59e0b;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:10px"><i class="fas fa-bolt" style="margin-right:6px"></i>Quick Answer</p>
  <p style="margin:0;font-size:15px;line-height:1.7;color:#e5e7eb">${inner}</p>
</div>`
}

for (const file of INPUTS) {
  const raw = fs.readFileSync(file, 'utf8')
  const { fm, body } = parseFrontmatter(raw)
  const stripped = stripLeadingH1(body)
  let html = mdToHtml(stripped).trim()

  // Replace leading "Quick Answer" paragraph with styled callout block.
  const quick = buildQuickAnswerBlock(html)
  if (quick) {
    html = html.replace(/^<p><strong>Quick Answer:<\/strong>[\s\S]*?<\/p>/i, quick)
  }

  const slug = fm.slug
  const title = fm.title
  const excerpt = fm.excerpt || ''
  const cover = fm.cover_image_url || ''
  const category = fm.category || 'roofing'
  const tags = fm.tags || ''
  const author = fm.author_name || 'Roof Manager Team'
  const status = 'published'
  const featured = fm.is_featured === '1' ? 1 : 0
  const metaTitle = fm.meta_title || title
  const metaDescription = fm.meta_description || excerpt
  const readTime = parseInt(fm.read_time_minutes || '10', 10)

  const sql = `-- Auto-generated from ${path.basename(file)} via tools/md-to-blog-migration.mjs
-- slug: ${slug}

INSERT OR IGNORE INTO blog_posts (
  slug, title, excerpt, content, cover_image_url,
  category, tags, author_name, status, is_featured,
  meta_title, meta_description, read_time_minutes, published_at
) VALUES (
  '${sqlEscape(slug)}',
  '${sqlEscape(title)}',
  '${sqlEscape(excerpt)}',
  '${sqlEscape(html)}',
  '${sqlEscape(cover)}',
  '${sqlEscape(category)}',
  '${sqlEscape(tags)}',
  '${sqlEscape(author)}',
  '${status}',
  ${featured},
  '${sqlEscape(metaTitle)}',
  '${sqlEscape(metaDescription)}',
  ${readTime},
  datetime('now')
);
`
  process.stdout.write(sql + '\n')
}

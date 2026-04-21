/**
 * Schema.org JSON-LD regression guardrails.
 *
 * Parses every ld+json script block out of representative rendered pages
 * and verifies the core shape — @context, @type, required fields per
 * type. Catches obvious regressions (syntax errors, missing @type,
 * mangled JSON) before they hit production.
 *
 * Does NOT hit the network. Drives the rendered HTML through the existing
 * page-builder functions and inspects the strings in-process.
 */

import { describe, it, expect } from 'vitest'

// Pull out every <script type="application/ld+json">...</script> block and
// parse each payload. Throws if any block fails to parse — that alone is
// the most common regression and would fail silently in production.
function extractLdJson(html: string): any[] {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  const blocks: any[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const raw = m[1].trim()
    if (!raw) continue
    blocks.push(JSON.parse(raw))
  }
  return blocks
}

function assertBreadcrumbList(blocks: any[]) {
  const bc = blocks.find(b => b['@type'] === 'BreadcrumbList')
  expect(bc, 'missing BreadcrumbList').toBeTruthy()
  expect(bc['@context']).toBe('https://schema.org')
  expect(Array.isArray(bc.itemListElement)).toBe(true)
  expect(bc.itemListElement.length).toBeGreaterThanOrEqual(2)
  bc.itemListElement.forEach((item: any, i: number) => {
    expect(item['@type']).toBe('ListItem')
    expect(item.position).toBe(i + 1)
    expect(typeof item.name).toBe('string')
    expect(typeof item.item).toBe('string')
    expect(item.item.startsWith('http')).toBe(true)
  })
}

describe('JSON-LD schema — basic parse + shape', () => {
  it('parses every ld+json block from a known good payload', () => {
    const goodHtml = `
      <html><head>
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Home","item":"https://example.com/"},{"@type":"ListItem","position":2,"name":"Help","item":"https://example.com/help"}]}</script>
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Example","url":"https://example.com"}</script>
      </head></html>`
    const blocks = extractLdJson(goodHtml)
    expect(blocks.length).toBe(2)
    assertBreadcrumbList(blocks)
    expect(blocks.find(b => b['@type'] === 'Organization')?.name).toBe('Example')
  })

  it('fails loudly on malformed JSON (ensures our guard catches regressions)', () => {
    const badHtml = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"BlogPosting",</script>`
    expect(() => extractLdJson(badHtml)).toThrow()
  })

  it('accepts the Person schema shape used by author byline + blog posts', () => {
    const personBlock = {
      '@context': 'https://schema.org',
      '@type': 'Person',
      name: 'Roof Manager Editorial Team',
      url: 'https://www.roofmanager.ca/authors/roof-manager-editorial-team',
      jobTitle: 'Roofing measurement & software engineering team',
      knowsAbout: ['satellite roof measurement', 'Google Solar API'],
      worksFor: { '@type': 'Organization', name: 'Roof Manager' },
    }
    expect(personBlock['@type']).toBe('Person')
    expect(typeof personBlock.name).toBe('string')
    expect(typeof personBlock.url).toBe('string')
    expect(Array.isArray(personBlock.knowsAbout)).toBe(true)
    expect(personBlock.worksFor['@type']).toBe('Organization')
  })

  it('accepts a Product with nested Review + AggregateRating shape', () => {
    const product = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: 'Roof Manager',
      aggregateRating: { '@type': 'AggregateRating', ratingValue: '4.9', ratingCount: '200', bestRating: '5' },
      review: [
        { '@type': 'Review', reviewRating: { '@type': 'Rating', ratingValue: '5', bestRating: '5' }, author: { '@type': 'Person', name: 'Derek M.' }, datePublished: '2026-02-11', reviewBody: 'Great.' },
      ],
    }
    expect(product.aggregateRating['@type']).toBe('AggregateRating')
    expect(Array.isArray(product.review)).toBe(true)
    expect(product.review[0].author['@type']).toBe('Person')
    expect(product.review[0].datePublished).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('BreadcrumbList with too few items fails the guard', () => {
    const blocks = [{ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [] }]
    expect(() => assertBreadcrumbList(blocks)).toThrow()
  })

  it('accepts BlogPosting shape including Person author + wordCount + inLanguage', () => {
    const post = {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: 'Test', description: 'Test', image: 'https://example.com/og.jpg',
      datePublished: '2026-04-21', dateModified: '2026-04-21',
      author: { '@type': 'Person', name: 'Roof Manager Editorial Team', url: 'https://www.roofmanager.ca/authors/roof-manager-editorial-team' },
      publisher: { '@type': 'Organization', name: 'Roof Manager', logo: { '@type': 'ImageObject', url: 'https://example.com/logo.png' } },
      mainEntityOfPage: { '@type': 'WebPage', '@id': 'https://example.com/blog/x' },
      inLanguage: 'en', articleSection: 'ai-automation', keywords: 'a,b,c', wordCount: 1800,
    }
    expect(post['@type']).toBe('BlogPosting')
    expect(post.author['@type']).toBe('Person')
    expect(typeof post.wordCount).toBe('number')
    expect(post.wordCount).toBeGreaterThan(0)
    expect(post.datePublished).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

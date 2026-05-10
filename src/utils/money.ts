// Integer-cents money helpers — never use floats in invoice/commission math.

export function toCents(dollars: number | string): number {
  const n = typeof dollars === 'string' ? Number(dollars) : dollars
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 100)
}

export function fromCents(cents: number): number {
  return Math.round(cents) / 100
}

export function addCents(...parts: number[]): number {
  let sum = 0
  for (const p of parts) sum += Math.round(p)
  return sum
}

export function subCents(a: number, b: number): number {
  return Math.round(a) - Math.round(b)
}

// Percent-of-cents rounded to the nearest cent.
// `pct` is in percent (e.g. 13 for 13% GST).
export function pctOfCents(cents: number, pct: number): number {
  return Math.round((Math.round(cents) * pct) / 100)
}

export function formatCents(cents: number, currency = 'CAD'): string {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(fromCents(cents))
}

// ============================================================
// Report Search — Semantic Vector Search via Gemini Embeddings + D1
//
// Architecture:
//   1. On report generation/save → extract key text → embed with Gemini text-embedding-004
//   2. Store 768-dim float vector as JSON in D1 report_embeddings table
//   3. On search → embed query → cosine similarity against all stored vectors
//   4. Return top-K ranked results with metadata
//
// Gemini text-embedding-004: 768 dimensions, free tier 1500 RPM
// D1 storage: ~6KB per report (768 × 8 bytes) — handles thousands of reports easily
// ============================================================

const EMBEDDING_MODEL = 'text-embedding-004'
const EMBEDDING_DIMENSIONS = 768

// ── Build searchable text from a RoofReport ─────────────────

export function buildReportSearchText(report: any, order?: any): string {
  const parts: string[] = []

  // Property info
  if (report.property?.address) parts.push(`Address: ${report.property.address}`)
  if (report.property?.city) parts.push(`City: ${report.property.city}`)
  if (report.property?.province) parts.push(`Province: ${report.property.province}`)
  if (report.property?.homeowner_name) parts.push(`Homeowner: ${report.property.homeowner_name}`)
  if (report.property?.requester_name) parts.push(`Requester: ${report.property.requester_name}`)
  if (report.property?.requester_company) parts.push(`Company: ${report.property.requester_company}`)

  // Key measurements
  if (report.total_footprint_sqft) parts.push(`Roof footprint: ${report.total_footprint_sqft} sq ft`)
  if (report.total_true_area_sqft) parts.push(`Sloped area: ${report.total_true_area_sqft} sq ft`)
  if (report.roof_pitch_ratio) parts.push(`Pitch: ${report.roof_pitch_ratio}`)
  if (report.roof_pitch_degrees) parts.push(`Pitch degrees: ${report.roof_pitch_degrees}`)

  // Segment details
  if (report.segments?.length) {
    parts.push(`${report.segments.length} roof segments`)
    for (const seg of report.segments) {
      if (seg.name) parts.push(`Segment: ${seg.name}`)
      if (seg.pitch_ratio) parts.push(`Segment pitch: ${seg.pitch_ratio}`)
      if (seg.true_area_sqft) parts.push(`Segment area: ${seg.true_area_sqft} sq ft`)
    }
  }

  // Edge types present
  if (report.edge_summary) {
    const es = report.edge_summary
    if (es.total_hip_ft > 0) parts.push(`Hip roof: ${es.total_hip_ft} ft hip edges`)
    if (es.total_valley_ft > 0) parts.push(`Valley present: ${es.total_valley_ft} ft valley`)
    if (es.total_ridge_ft > 0) parts.push(`Ridge: ${es.total_ridge_ft} ft`)
    if (es.total_eave_ft > 0) parts.push(`Eaves: ${es.total_eave_ft} ft`)
    if (es.total_rake_ft > 0) parts.push(`Rakes: ${es.total_rake_ft} ft`)
  }

  // Materials
  if (report.materials) {
    const m = report.materials
    if (m.total_squares) parts.push(`${m.total_squares} roofing squares`)
    if (m.bundles_3tab) parts.push(`${m.bundles_3tab} shingle bundles`)
    if (m.ice_water_shield_lf > 0) parts.push(`Ice and water shield: ${m.ice_water_shield_lf} lf`)
    if (m.valley_flashing_lf > 0) parts.push(`Valley flashing: ${m.valley_flashing_lf} lf`)
  }

  // Quality notes (rich context)
  if (report.quality?.notes?.length) {
    for (const note of report.quality.notes) {
      parts.push(note)
    }
  }

  // Provider / source
  if (report.metadata?.provider) parts.push(`Source: ${report.metadata.provider}`)

  // Order-level context
  if (order?.service_tier) parts.push(`Tier: ${order.service_tier}`)
  if (order?.order_number) parts.push(`Order: ${order.order_number}`)

  return parts.join('. ').substring(0, 4000) // Gemini embedding has a token limit
}

// ── Call Gemini Embedding API ───────────────────────────────

export async function generateEmbedding(
  text: string,
  apiKey: string
): Promise<number[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${apiKey}`

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: `models/${EMBEDDING_MODEL}`,
      content: { parts: [{ text }] },
      taskType: 'RETRIEVAL_DOCUMENT',
      // outputDimensionality: EMBEDDING_DIMENSIONS, // optional, defaults to 768
    }),
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`Gemini embedding failed (${response.status}): ${errText.substring(0, 300)}`)
  }

  const data: any = await response.json()
  const values = data?.embedding?.values
  if (!values || !Array.isArray(values)) {
    throw new Error('Gemini embedding returned no values')
  }
  return values
}

export async function generateQueryEmbedding(
  text: string,
  apiKey: string
): Promise<number[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${apiKey}`

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: `models/${EMBEDDING_MODEL}`,
      content: { parts: [{ text }] },
      taskType: 'RETRIEVAL_QUERY',
    }),
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`Gemini query embedding failed (${response.status}): ${errText.substring(0, 300)}`)
  }

  const data: any = await response.json()
  return data?.embedding?.values || []
}

// ── Cosine Similarity ───────────────────────────────────────

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0, magA = 0, magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB)
  return denom === 0 ? 0 : dot / denom
}

// ── D1 Storage Operations ───────────────────────────────────

export async function storeReportEmbedding(
  db: D1Database,
  orderId: number,
  report: any,
  embedding: number[],
  embeddedText: string
): Promise<void> {
  await db.prepare(`
    INSERT INTO report_embeddings (
      order_id, embedded_text, embedding,
      property_address, homeowner_name,
      total_footprint_sqft, total_true_area_sqft,
      roof_pitch, num_segments, report_status,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(order_id) DO UPDATE SET
      embedded_text = excluded.embedded_text,
      embedding = excluded.embedding,
      property_address = excluded.property_address,
      homeowner_name = excluded.homeowner_name,
      total_footprint_sqft = excluded.total_footprint_sqft,
      total_true_area_sqft = excluded.total_true_area_sqft,
      roof_pitch = excluded.roof_pitch,
      num_segments = excluded.num_segments,
      report_status = excluded.report_status,
      updated_at = datetime('now')
  `).bind(
    orderId,
    embeddedText,
    JSON.stringify(embedding),
    report.property?.address || null,
    report.property?.homeowner_name || null,
    report.total_footprint_sqft || null,
    report.total_true_area_sqft || null,
    report.roof_pitch_ratio || null,
    report.segments?.length || 0,
    'completed'
  ).run()
}

export async function searchReports(
  db: D1Database,
  queryEmbedding: number[],
  limit: number = 10,
  minScore: number = 0.3
): Promise<{ order_id: number; score: number; property_address: string; homeowner_name: string; total_footprint_sqft: number; total_true_area_sqft: number; roof_pitch: string; num_segments: number }[]> {
  // Fetch all embeddings — for hundreds of reports this is fast (<50ms)
  const rows = await db.prepare(`
    SELECT order_id, embedding, property_address, homeowner_name,
           total_footprint_sqft, total_true_area_sqft, roof_pitch, num_segments
    FROM report_embeddings
    WHERE report_status = 'completed'
  `).all()

  if (!rows.results?.length) return []

  // Score each report
  const scored = rows.results.map((row: any) => {
    let embedding: number[]
    try { embedding = JSON.parse(row.embedding) } catch { return null }
    const score = cosineSimilarity(queryEmbedding, embedding)
    return {
      order_id: row.order_id,
      score: Math.round(score * 10000) / 10000,
      property_address: row.property_address,
      homeowner_name: row.homeowner_name,
      total_footprint_sqft: row.total_footprint_sqft,
      total_true_area_sqft: row.total_true_area_sqft,
      roof_pitch: row.roof_pitch,
      num_segments: row.num_segments,
    }
  }).filter(r => r !== null && r.score >= minScore)

  // Sort by score descending, take top K
  scored.sort((a, b) => b!.score - a!.score)
  return scored.slice(0, limit) as any[]
}

// ── Embed + Store a Report (called after report generation) ──

export async function embedAndStoreReport(
  db: D1Database,
  orderId: number,
  report: any,
  apiKey: string,
  order?: any
): Promise<{ success: boolean; error?: string }> {
  try {
    const text = buildReportSearchText(report, order)
    if (text.length < 20) {
      return { success: false, error: 'Report text too short to embed' }
    }

    const embedding = await generateEmbedding(text, apiKey)
    if (embedding.length !== EMBEDDING_DIMENSIONS) {
      return { success: false, error: `Unexpected embedding dimensions: ${embedding.length}` }
    }

    await storeReportEmbedding(db, orderId, report, embedding, text)
    console.log(`[Search] Embedded report for order ${orderId} (${text.length} chars → ${embedding.length} dims)`)
    return { success: true }
  } catch (err: any) {
    console.error(`[Search] Failed to embed report for order ${orderId}:`, err.message)
    return { success: false, error: err.message }
  }
}

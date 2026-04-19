// ============================================================
// Lead Attribution — Cross-channel lead join + CPL computation
// Joins instagram_leads across UTM, DM, and phone channels.
// Computes blended CPL per post; writes back to instagram_posts.
// ============================================================

import type { Bindings } from '../../types'

export interface AttributionResult {
  ok: boolean
  posts_updated: number
  total_leads: number
  blended_cpl_cents: number
  kill_switch_triggered: boolean
  error?: string
}

export async function runLeadAttribution(env: Bindings): Promise<AttributionResult> {
  const db = env.DB

  try {
    // 1. Compute lead counts per post
    const { results: leadsByPost } = await db.prepare(`
      SELECT post_id,
        SUM(CASE WHEN source_channel = 'utm' THEN 1 ELSE 0 END) as utm_leads,
        SUM(CASE WHEN source_channel = 'dm' THEN 1 ELSE 0 END) as dm_leads,
        SUM(CASE WHEN source_channel = 'phone' THEN 1 ELSE 0 END) as phone_leads,
        COUNT(*) as total_leads
      FROM instagram_leads
      WHERE post_id IS NOT NULL
      GROUP BY post_id
    `).all<any>()

    let posts_updated = 0
    let total_leads = 0

    for (const row of (leadsByPost || [])) {
      if (!row.post_id) continue
      total_leads += row.total_leads

      // Separate organic vs paid leads
      const boost = await db.prepare(
        'SELECT COALESCE(SUM(spent_cents), 0) as total_spent FROM instagram_boosts WHERE post_id = ?'
      ).bind(row.post_id).first<any>()

      const boostSpent = boost?.total_spent || 0
      const organicLeads = boostSpent === 0 ? row.total_leads : 0
      const paidLeads = boostSpent > 0 ? row.total_leads : 0

      // Compute CPL for this post
      const postCost = await db.prepare(`
        SELECT COALESCE(SUM(b.spent_cents), 0) + COALESCE(p.production_cost_cents, 0) as total_cost
        FROM instagram_posts p
        LEFT JOIN instagram_boosts b ON b.post_id = p.id
        WHERE p.id = ?
      `).bind(row.post_id).first<any>()

      const totalCost = postCost?.total_cost || 0
      const cpl = row.total_leads > 0 ? Math.round(totalCost / row.total_leads) : 0

      // Update post with lead counts + CPL
      await db.prepare(`
        UPDATE instagram_posts SET organic_leads=?, paid_leads=?, cpl_blended_cents=?, updated_at=datetime('now') WHERE id=?
      `).bind(organicLeads, paidLeads, cpl, row.post_id).run()
      posts_updated++

      // Distribute cost to individual leads proportionally
      if (row.total_leads > 0 && totalCost > 0) {
        const costPerLead = Math.round(totalCost / row.total_leads)
        await db.prepare(
          'UPDATE instagram_leads SET cost_cents = ? WHERE post_id = ?'
        ).bind(costPerLead, row.post_id).run()
      }
    }

    // 2. Calculate blended CPL across all posts in last 30 days
    const blendedResult = await db.prepare(`
      SELECT
        COALESCE(SUM(b.spent_cents), 0) as boost_spend,
        COALESCE(SUM(p.production_cost_cents), 0) as production_cost,
        (SELECT COUNT(*) FROM instagram_leads WHERE qualified = 1 AND created_at > datetime('now', '-30 days')) as qualified_leads
      FROM instagram_posts p
      LEFT JOIN instagram_boosts b ON b.post_id = p.id
      WHERE p.posted_at > datetime('now', '-30 days')
    `).first<any>()

    const totalSpend = (blendedResult?.boost_spend || 0) + (blendedResult?.production_cost || 0)
    const qualifiedLeads = blendedResult?.qualified_leads || 0
    const blended_cpl_cents = qualifiedLeads > 0 ? Math.round(totalSpend / qualifiedLeads) : 0

    // 3. Check kill switch
    const ceilingSetting = await db.prepare(
      "SELECT setting_value FROM settings WHERE master_company_id = 1 AND setting_key = 'instagram_cpl_ceiling_cents'"
    ).first<any>()
    const ceiling = parseInt(ceilingSetting?.setting_value || '6000')
    const kill_switch_triggered = blended_cpl_cents > ceiling && qualifiedLeads > 0

    return { ok: true, posts_updated, total_leads, blended_cpl_cents, kill_switch_triggered }
  } catch (err: any) {
    return { ok: false, posts_updated: 0, total_leads: 0, blended_cpl_cents: 0, kill_switch_triggered: false, error: err.message }
  }
}

// Deduplicate leads: if same contact_phone appears within 24h, keep earliest
export async function deduplicateLeads(env: Bindings): Promise<{ removed: number }> {
  const db = env.DB
  try {
    const result = await db.prepare(`
      DELETE FROM instagram_leads WHERE id IN (
        SELECT l2.id FROM instagram_leads l1
        JOIN instagram_leads l2 ON l1.contact_phone = l2.contact_phone
        AND l1.id < l2.id
        AND l1.contact_phone IS NOT NULL
        AND l1.contact_phone != ''
        AND ABS(julianday(l1.created_at) - julianday(l2.created_at)) < 1
      )
    `).run()
    return { removed: result.meta.changes || 0 }
  } catch {
    return { removed: 0 }
  }
}

// Get CPL summary by post, channel, pillar
export async function getLeadSummary(env: Bindings): Promise<any> {
  const db = env.DB

  const [byChannel, byPost, byPillar, totals] = await Promise.all([
    db.prepare(`
      SELECT source_channel, COUNT(*) as leads, SUM(cost_cents) as total_cost,
        CASE WHEN COUNT(*) > 0 THEN SUM(cost_cents) / COUNT(*) ELSE 0 END as cpl
      FROM instagram_leads WHERE created_at > datetime('now', '-30 days')
      GROUP BY source_channel
    `).all<any>(),

    db.prepare(`
      SELECT p.id, p.ig_media_id, p.caption, p.organic_leads, p.paid_leads, p.cpl_blended_cents, p.boost_spend_cents
      FROM instagram_posts p
      WHERE p.posted_at > datetime('now', '-30 days') AND (p.organic_leads > 0 OR p.paid_leads > 0)
      ORDER BY p.cpl_blended_cents ASC
      LIMIT 20
    `).all<any>(),

    db.prepare(`
      SELECT i.pillar, COUNT(l.id) as leads,
        SUM(l.cost_cents) as total_cost,
        CASE WHEN COUNT(l.id) > 0 THEN SUM(l.cost_cents) / COUNT(l.id) ELSE 0 END as cpl
      FROM instagram_leads l
      JOIN instagram_posts p ON p.id = l.post_id
      JOIN instagram_content_ideas i ON i.id = p.content_idea_id
      WHERE l.created_at > datetime('now', '-30 days')
      GROUP BY i.pillar
    `).all<any>(),

    db.prepare(`
      SELECT COUNT(*) as total_leads,
        SUM(CASE WHEN qualified = 1 THEN 1 ELSE 0 END) as qualified,
        SUM(CASE WHEN qualified = -1 THEN 1 ELSE 0 END) as spam,
        SUM(cost_cents) as total_cost
      FROM instagram_leads WHERE created_at > datetime('now', '-30 days')
    `).first<any>(),
  ])

  return {
    by_channel: byChannel.results || [],
    by_post: byPost.results || [],
    by_pillar: byPillar.results || [],
    totals: totals || { total_leads: 0, qualified: 0, spam: 0, total_cost: 0 },
  }
}

// Exported for testing
export function computeBlendedCpl(boostSpend: number, productionCost: number, qualifiedLeads: number): number {
  if (qualifiedLeads <= 0) return 0
  return Math.round((boostSpend + productionCost) / qualifiedLeads)
}

export function shouldTriggerKillSwitch(blendedCpl: number, ceiling: number, qualifiedLeads: number): boolean {
  return blendedCpl > ceiling && qualifiedLeads > 0
}

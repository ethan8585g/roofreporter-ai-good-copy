// ============================================================
// Boost Engine — Skill 4: Boost Content
// Creates Meta Ads boosted-post campaigns, daily reallocation.
// Pauses campaigns where CPL > 2x median; redirects to lowest CPL.
// ============================================================

import type { Bindings } from '../../types'
import { createBoostedPost, getAdInsights, updateAdCampaignStatus } from './graph-client'

export interface BoostResult {
  ok: boolean
  boost_id?: number
  error?: string
}

export interface ReallocationResult {
  ok: boolean
  paused: number
  boosted: number
  kill_switch_triggered: boolean
  error?: string
}

// Default ICP targeting for roofing
const ROOFING_ICP_TARGETING = {
  geo_locations: { countries: ['CA'], regions: [{ key: 'ontario' }] },
  age_min: 25,
  age_max: 65,
  interests: [
    { id: '6003107902433', name: 'Home improvement' },
    { id: '6003012327985', name: 'Homeowner' },
  ],
}

export async function createBoost(
  env: Bindings,
  postId: number,
  dailyBudgetCents: number,
  durationDays: number
): Promise<BoostResult> {
  const db = env.DB
  const accessToken = (env as any).INSTAGRAM_PAGE_ACCESS_TOKEN || ''
  const apiVersion = (env as any).INSTAGRAM_GRAPH_API_VERSION || 'v21.0'
  const adAccountId = (env as any).META_AD_ACCOUNT_ID || ''

  if (!adAccountId) return { ok: false, error: 'META_AD_ACCOUNT_ID not configured' }

  try {
    const post = await db.prepare('SELECT * FROM instagram_posts WHERE id = ?').bind(postId).first<any>()
    if (!post) return { ok: false, error: 'Post not found' }

    // Create boost via Meta Ads API
    const adResult = await createBoostedPost(accessToken, apiVersion, adAccountId, {
      postId: post.ig_media_id,
      dailyBudgetCents,
      durationDays,
      targeting: ROOFING_ICP_TARGETING,
    })

    if (adResult.error) return { ok: false, error: adResult.error.message }

    const res = await db.prepare(`
      INSERT INTO instagram_boosts (post_id, platform, daily_budget_cents, lifetime_budget_cents, status, started_at)
      VALUES (?, 'meta_ads', ?, ?, 'active', datetime('now'))
    `).bind(postId, dailyBudgetCents, dailyBudgetCents * durationDays).run()

    return { ok: true, boost_id: res.meta.last_row_id as number }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
}

export async function reallocateBoostBudgets(env: Bindings): Promise<ReallocationResult> {
  const db = env.DB

  try {
    // Check kill switch — blended CPL ceiling from settings
    const ceilingSetting = await db.prepare(
      "SELECT setting_value FROM settings WHERE master_company_id = 1 AND setting_key = 'instagram_cpl_ceiling_cents'"
    ).first<any>()
    const cplCeiling = parseInt(ceilingSetting?.setting_value || '6000') // Default CA$60

    // Calculate current blended CPL
    const blendedResult = await db.prepare(`
      SELECT
        COALESCE(SUM(b.spent_cents), 0) + COALESCE(SUM(p.production_cost_cents), 0) as total_cost,
        (SELECT COUNT(*) FROM instagram_leads WHERE qualified = 1 AND created_at > datetime('now', '-30 days')) as qualified_leads
      FROM instagram_boosts b
      LEFT JOIN instagram_posts p ON p.id = b.post_id
      WHERE b.created_at > datetime('now', '-30 days')
    `).first<any>()

    const totalCost = blendedResult?.total_cost || 0
    const qualifiedLeads = blendedResult?.qualified_leads || 0
    const blendedCpl = qualifiedLeads > 0 ? Math.round(totalCost / qualifiedLeads) : 0

    // Kill switch
    if (blendedCpl > cplCeiling && qualifiedLeads > 0) {
      // Pause ALL active boosts
      await db.prepare("UPDATE instagram_boosts SET status='paused' WHERE status='active'").run()
      return { ok: true, paused: 0, boosted: 0, kill_switch_triggered: true }
    }

    // Get all active boosts with their CPL
    const { results: activeBoosts } = await db.prepare(`
      SELECT b.*, b.spent_cents, b.leads_attributed,
             CASE WHEN b.leads_attributed > 0 THEN b.spent_cents / b.leads_attributed ELSE 999999 END as cpl
      FROM instagram_boosts b
      WHERE b.status = 'active'
    `).all<any>()

    if (!activeBoosts || activeBoosts.length < 2) {
      return { ok: true, paused: 0, boosted: 0, kill_switch_triggered: false }
    }

    // Calculate median CPL
    const cpls = activeBoosts
      .filter((b: any) => b.leads_attributed > 0)
      .map((b: any) => b.cpl)
      .sort((a: number, b: number) => a - b)

    if (cpls.length === 0) return { ok: true, paused: 0, boosted: 0, kill_switch_triggered: false }

    const medianCpl = cpls[Math.floor(cpls.length / 2)]
    const threshold = medianCpl * 2

    let paused = 0
    let boosted = 0
    let savedBudget = 0

    // Pause underperformers (CPL > 2x median)
    for (const boost of activeBoosts) {
      if (boost.leads_attributed > 0 && boost.cpl > threshold) {
        await db.prepare("UPDATE instagram_boosts SET status='paused', ended_at=datetime('now') WHERE id=?").bind(boost.id).run()
        savedBudget += boost.daily_budget_cents
        paused++
      }
    }

    // Redistribute saved budget to best performer
    if (savedBudget > 0) {
      const bestBoost = activeBoosts
        .filter((b: any) => b.leads_attributed > 0 && b.cpl <= medianCpl)
        .sort((a: any, b: any) => a.cpl - b.cpl)[0]

      if (bestBoost) {
        const newBudget = bestBoost.daily_budget_cents + savedBudget
        await db.prepare("UPDATE instagram_boosts SET daily_budget_cents=? WHERE id=?").bind(newBudget, bestBoost.id).run()
        boosted++
      }
    }

    return { ok: true, paused, boosted, kill_switch_triggered: false }
  } catch (err: any) {
    return { ok: false, paused: 0, boosted: 0, kill_switch_triggered: false, error: err.message }
  }
}

export async function updateBoostStatus(env: Bindings, boostId: number, status: 'active' | 'paused' | 'ended'): Promise<{ ok: boolean; error?: string }> {
  const db = env.DB
  try {
    const endedAt = status === 'ended' ? "datetime('now')" : 'NULL'
    await db.prepare(`UPDATE instagram_boosts SET status=?, ended_at=${status === 'ended' ? "datetime('now')" : 'NULL'} WHERE id=?`).bind(status, boostId).run()
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
}

// Exported for testing
export function calculateMedianCpl(cpls: number[]): number {
  if (cpls.length === 0) return 0
  const sorted = [...cpls].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

export function shouldPauseBoost(boostCpl: number, medianCpl: number): boolean {
  return boostCpl > medianCpl * 2
}

// ============================================================
// Anthropic Claude Client — Shared factory for all agents
// Model: claude-sonnet-4-6 (latest, works in Cloudflare Workers)
// ============================================================

import Anthropic from '@anthropic-ai/sdk'

export const CLAUDE_MODEL = 'claude-sonnet-4-6'

export function getAnthropicClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey })
}

/** Parse JSON from a Claude text response, stripping markdown fences if present */
export function extractJson<T>(text: string): T {
  const stripped = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim()
  return JSON.parse(stripped) as T
}

// ── Agent Memory helpers ──────────────────────────────────────
// Agents call these to persist and retrieve learnings across runs.
// Each (agent_type, memory_key) pair stores up to ~4000 chars of text.

export async function readAgentMemory(
  db: D1Database,
  agentType: string,
  memoryKey: string
): Promise<string> {
  try {
    const row = await db
      .prepare(`SELECT memory_value FROM agent_memory WHERE agent_type = ? AND memory_key = ?`)
      .bind(agentType, memoryKey)
      .first<{ memory_value: string }>()
    return row?.memory_value || ''
  } catch {
    return ''
  }
}

export async function writeAgentMemory(
  db: D1Database,
  agentType: string,
  memoryKey: string,
  value: string
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO agent_memory (agent_type, memory_key, memory_value, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(agent_type, memory_key) DO UPDATE SET
           memory_value = excluded.memory_value,
           updated_at   = datetime('now')`
      )
      .bind(agentType, memoryKey, value.slice(0, 4000))
      .run()
  } catch {}
}

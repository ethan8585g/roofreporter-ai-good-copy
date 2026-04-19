// ============================================================
// Phone Tracking — Twilio pool management + inbound call attribution
// Assigns/releases tracking numbers; attributes calls to posts.
// ============================================================

import type { Bindings } from '../../types'

export async function initializePool(env: Bindings): Promise<{ ok: boolean; provisioned: number }> {
  const db = env.DB
  const pool = ((env as any).TWILIO_TRACKING_NUMBER_POOL || '').split(',').map((n: string) => n.trim()).filter(Boolean)

  let provisioned = 0
  for (const number of pool) {
    const existing = await db.prepare('SELECT id FROM instagram_tracking_numbers WHERE phone_number = ?').bind(number).first<any>()
    if (!existing) {
      await db.prepare(
        "INSERT INTO instagram_tracking_numbers (phone_number, provider) VALUES (?, 'twilio')"
      ).bind(number).run()
      provisioned++
    }
  }

  return { ok: true, provisioned }
}

export async function assignTrackingNumber(env: Bindings, postId: number): Promise<string | null> {
  const db = env.DB

  // Find an unassigned number
  const available = await db.prepare(
    "SELECT id, phone_number FROM instagram_tracking_numbers WHERE assigned_post_id IS NULL ORDER BY released_at ASC LIMIT 1"
  ).first<any>()

  if (!available) return null

  await db.prepare(
    "UPDATE instagram_tracking_numbers SET assigned_post_id=?, assigned_at=datetime('now'), released_at=NULL WHERE id=?"
  ).bind(postId, available.id).run()

  return available.phone_number
}

export async function releaseTrackingNumber(env: Bindings, phoneNumber: string): Promise<boolean> {
  const db = env.DB
  await db.prepare(
    "UPDATE instagram_tracking_numbers SET assigned_post_id=NULL, released_at=datetime('now') WHERE phone_number=?"
  ).bind(phoneNumber).run()
  return true
}

export async function handleInboundCall(
  env: Bindings,
  callerPhone: string,
  calledNumber: string
): Promise<{ ok: boolean; lead_created: boolean; error?: string }> {
  const db = env.DB

  try {
    // Find which post this number is assigned to
    const tracking = await db.prepare(
      'SELECT assigned_post_id FROM instagram_tracking_numbers WHERE phone_number = ?'
    ).bind(calledNumber).first<any>()

    const postId = tracking?.assigned_post_id || null

    // Increment call count
    await db.prepare(
      'UPDATE instagram_tracking_numbers SET total_calls = total_calls + 1 WHERE phone_number = ?'
    ).bind(calledNumber).run()

    // Create lead
    await db.prepare(`
      INSERT INTO instagram_leads (source_channel, post_id, tracking_phone_number, contact_phone, message_or_query)
      VALUES ('phone', ?, ?, ?, 'Inbound call')
    `).bind(postId, calledNumber, callerPhone).run()

    return { ok: true, lead_created: true }
  } catch (err: any) {
    return { ok: false, lead_created: false, error: err.message }
  }
}

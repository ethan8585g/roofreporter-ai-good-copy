// ============================================================
// SIGNUP-JOURNEY EMAIL — Composes + sends the digest of every
// dead end the journey trace found, after each /signup-journey
// tick. Recipient hardcoded to christinegourley04@gmail.com.
// ============================================================

import type { Bindings } from '../types'
import { loadGmailCreds, sendGmailOAuth2 } from './email'
import type { JourneyResult, DeadEnd } from './signup-journey'

const RECIPIENT = 'christinegourley04@gmail.com'
const SENDER_DEFAULT = 'sales@roofmanager.ca'

export async function sendJourneyEmail(
  env: Bindings,
  result: JourneyResult,
  opts: { onlyOnIssues?: boolean } = {},
): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  // Skip the email when nothing failed. Hourly cadence + daily-summary
  // cadence are different audiences; we want the hourly one to be quiet.
  if (opts.onlyOnIssues && result.dead_ends.length === 0) {
    return { ok: true, skipped: true }
  }

  const creds = await loadGmailCreds(env)
  if (!creds.clientId || !creds.clientSecret || !creds.refreshToken) {
    return { ok: false, error: 'Gmail OAuth2 creds not loaded — cannot send journey email' }
  }
  const sender = creds.senderEmail || SENDER_DEFAULT

  const dateStr = new Date(result.checked_at).toISOString().slice(0, 16).replace('T', ' ')
  const verdictTag = result.verdict === 'pass' ? '✓ all green'
    : result.verdict === 'warn' ? `⚠ ${result.dead_ends.length} warning${result.dead_ends.length === 1 ? '' : 's'}`
    : `🔴 ${result.dead_ends.length} dead end${result.dead_ends.length === 1 ? '' : 's'}`
  const subject = `[RoofManager Journey] ${dateStr} UTC · ${verdictTag}`

  const html = renderHtml(result, dateStr, verdictTag)

  try {
    await sendGmailOAuth2(
      creds.clientId,
      creds.clientSecret,
      creds.refreshToken,
      RECIPIENT,
      subject,
      html,
      sender,
    )
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e).slice(0, 400) }
  }
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ))
}

function severityColor(s: 'error' | 'warn'): string {
  return s === 'error' ? '#dc2626' : '#d97706'
}

function renderHtml(result: JourneyResult, dateStr: string, verdictTag: string): string {
  const headerBg = result.verdict === 'pass' ? '#16a34a' : result.verdict === 'warn' ? '#d97706' : '#dc2626'

  // Group dead ends by category for the email body.
  const byCategory: Record<string, DeadEnd[]> = { page: [], api: [], toggle: [] }
  for (const d of result.dead_ends) byCategory[d.category].push(d)

  const renderGroup = (label: string, items: DeadEnd[]) => {
    if (items.length === 0) return ''
    return `
      <div style="margin:14px 0 8px">
        <div style="font-weight:700;color:#111827;font-size:13px;margin-bottom:6px">${escapeHtml(label)} (${items.length})</div>
        <table style="width:100%;border-collapse:collapse;font-size:12px;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden">
          <thead><tr style="background:#f9fafb;text-align:left">
            <th style="padding:6px 10px;color:#6b7280;border-bottom:1px solid #e5e7eb;width:60px">Sev</th>
            <th style="padding:6px 10px;color:#6b7280;border-bottom:1px solid #e5e7eb">Path</th>
            <th style="padding:6px 10px;color:#6b7280;border-bottom:1px solid #e5e7eb;width:60px">Status</th>
            <th style="padding:6px 10px;color:#6b7280;border-bottom:1px solid #e5e7eb">Detail</th>
          </tr></thead>
          <tbody>
            ${items.map(d => `<tr>
              <td style="padding:6px 10px;border-top:1px solid #f3f4f6;color:${severityColor(d.severity)};font-weight:700;text-transform:uppercase">${d.severity}</td>
              <td style="padding:6px 10px;border-top:1px solid #f3f4f6;font-family:ui-monospace,Consolas,monospace;color:#111827">${escapeHtml(d.path)}</td>
              <td style="padding:6px 10px;border-top:1px solid #f3f4f6;color:#374151">${d.status === null ? '—' : d.status}</td>
              <td style="padding:6px 10px;border-top:1px solid #f3f4f6;color:#374151">${escapeHtml(d.message)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    `
  }

  const summaryRow = (label: string, total: number, failed: number) => {
    const ok = total - failed
    const color = failed === 0 ? '#16a34a' : '#dc2626'
    return `
      <div style="flex:1;padding:14px 16px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;margin:0 4px">
        <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:1px">${escapeHtml(label)}</div>
        <div style="font-size:22px;font-weight:700;color:${color};margin-top:4px">${ok} / ${total}</div>
        <div style="font-size:11px;color:#6b7280;margin-top:2px">${failed} failed</div>
      </div>
    `
  }

  const allClearHtml = result.dead_ends.length === 0
    ? `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin:16px 0;color:#15803d;font-size:14px">
        ✓ A synthetic logged-in user successfully walked the entire customer surface with no dead ends, broken pages, or failed toggle round-trips.
      </div>`
    : ''

  return `<!doctype html>
<html><body style="margin:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:720px;margin:0 auto;background:#fff">
  <div style="background:${headerBg};color:#fff;padding:24px 24px 18px">
    <div style="font-size:13px;opacity:.85;letter-spacing:1px;text-transform:uppercase">Roof Manager · Signup-Journey Trace</div>
    <div style="font-size:24px;font-weight:700;margin-top:6px">${escapeHtml(dateStr)} · ${escapeHtml(verdictTag)}</div>
    <div style="font-size:13px;opacity:.85;margin-top:6px">
      Synthetic logged-in walk · ${result.duration_ms}ms · ${result.pages_checked} pages, ${result.apis_checked} APIs, ${result.toggles_checked} toggles
    </div>
  </div>
  <div style="padding:20px 24px">
    <div style="display:flex;margin:0 -4px 12px">
      ${summaryRow('Pages', result.pages_checked, result.pages_failed)}
      ${summaryRow('API GETs', result.apis_checked, result.apis_failed)}
      ${summaryRow('Toggles', result.toggles_checked, result.toggles_failed)}
    </div>
    ${allClearHtml}
    ${renderGroup('Page dead ends', byCategory.page)}
    ${renderGroup('API failures', byCategory.api)}
    ${renderGroup('Broken toggles', byCategory.toggle)}
    <p style="color:#888;font-size:11px;margin-top:24px;line-height:1.5">
      Sent by /signup-journey loop · ${escapeHtml(result.checked_at)} UTC.<br>
      Probe customer ${result.probe_created ? '(created on this run)' : '(persistent)'}: signup-journey-probe@roofmanager.ca<br>
      Loop tracker: <a href="https://www.roofmanager.ca/super-admin/loop-tracker" style="color:#0ea5e9">/super-admin/loop-tracker</a>
    </p>
  </div>
</div>
</body></html>`
}

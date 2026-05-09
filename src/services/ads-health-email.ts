// ============================================================
// ADS-HEALTH EMAIL — Composes + sends the 4-hourly summary email
// triggered by the /ads-health loop. Recipient is hardcoded to
// christinegourley04@gmail.com per product decision; change
// RECIPIENT below if the audit list grows.
//
// Only sends on warn/fail by default — pass ticks are silent so
// the inbox doesn't fill up with "all green" 6× per day.
// ============================================================

import { loadGmailCreds, sendGmailOAuth2 } from './email'
import type { AdsHealthResult, SectionResult } from './ads-health'

const RECIPIENT = 'christinegourley04@gmail.com'
const SENDER_DEFAULT = 'sales@roofmanager.ca'

export async function sendAdsHealthEmail(
  env: any,
  result: AdsHealthResult,
): Promise<{ ok: boolean; error?: string; skipped?: boolean }> {
  // Quiet on healthy ticks — avoid 6× emails/day saying nothing's wrong.
  if (result.verdict === 'pass') {
    return { ok: true, skipped: true }
  }

  const creds = await loadGmailCreds(env)
  if (!creds.clientId || !creds.clientSecret || !creds.refreshToken) {
    return { ok: false, error: 'Gmail OAuth2 creds not loaded — cannot send ads-health email' }
  }
  const sender = creds.senderEmail || SENDER_DEFAULT

  const ts = new Date(result.checked_at).toISOString().replace('T', ' ').slice(0, 16)
  const verdictIcon = result.verdict === 'warn'
    ? `⚠ ${result.issues.length} warning${result.issues.length === 1 ? '' : 's'}`
    : `🔴 ${result.issues.length} issue${result.issues.length === 1 ? '' : 's'}`
  const subject = `[RoofManager Ads Health] ${ts} UTC · ${verdictIcon}`

  const html = renderHtml(result, ts, verdictIcon)

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

function statusColor(s: SectionResult['status']): string {
  if (s === 'pass') return '#16a34a'
  if (s === 'warn') return '#d97706'
  return '#dc2626'
}
function statusBg(s: SectionResult['status']): string {
  if (s === 'pass') return '#dcfce7'
  if (s === 'warn') return '#fef3c7'
  return '#fee2e2'
}
function statusIcon(s: SectionResult['status']): string {
  if (s === 'pass') return '✓'
  if (s === 'warn') return '⚠'
  return '✗'
}
function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ))
}

function renderHtml(result: AdsHealthResult, ts: string, verdictIcon: string): string {
  const headerBg = result.verdict === 'pass' ? '#16a34a' : result.verdict === 'warn' ? '#d97706' : '#dc2626'
  const sectionsHtml = result.sections.map(renderSection).join('')
  const issueCount = result.issues.length

  const issueListHtml = issueCount > 0
    ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin:16px 0">
        <div style="font-weight:700;color:#991b1b;margin-bottom:8px">Action items (${issueCount})</div>
        <ol style="margin:0;padding-left:20px;color:#991b1b;font-size:14px;line-height:1.6">
          ${result.issues.map(i => `<li><strong>${escapeHtml(i.section)}</strong> — ${escapeHtml(i.message)}</li>`).join('')}
        </ol>
      </div>`
    : ''

  return `<!doctype html>
<html><body style="margin:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:640px;margin:0 auto;background:#fff">
  <div style="background:${headerBg};color:#fff;padding:24px 24px 18px">
    <div style="font-size:13px;opacity:.85;letter-spacing:1px;text-transform:uppercase">Roof Manager · Ads Health · 4h sweep</div>
    <div style="font-size:24px;font-weight:700;margin-top:6px">${escapeHtml(ts)} UTC · ${escapeHtml(verdictIcon)}</div>
    <div style="font-size:13px;opacity:.85;margin-top:6px">
      Checked in ${result.duration_ms}ms · ${result.sections.length} sections
    </div>
  </div>
  <div style="padding:20px 24px">
    ${issueListHtml}
    ${sectionsHtml}
    <p style="color:#888;font-size:11px;margin-top:24px;line-height:1.5">
      Sent by /ads-health loop · run at ${escapeHtml(result.checked_at)}.<br>
      Open the unified loop dashboard:
      <a href="https://www.roofmanager.ca/super-admin/loop-tracker" style="color:#0ea5e9">/super-admin/loop-tracker</a>
    </p>
  </div>
</div>
</body></html>`
}

function renderSection(s: SectionResult): string {
  const color = statusColor(s.status)
  const bg = statusBg(s.status)
  const icon = statusIcon(s.status)
  return `
    <div style="border:1px solid #e5e7eb;border-radius:8px;margin:10px 0;overflow:hidden">
      <div style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:${bg};border-bottom:1px solid #e5e7eb">
        <div style="width:24px;height:24px;border-radius:50%;background:${color};color:#fff;font-weight:700;text-align:center;line-height:24px;flex-shrink:0">${icon}</div>
        <div style="flex:1">
          <div style="font-weight:700;color:#111827;font-size:14px">${escapeHtml(s.label)}</div>
          <div style="color:${color};font-size:13px;margin-top:2px">${escapeHtml(s.summary)}</div>
        </div>
      </div>
    </div>
  `
}

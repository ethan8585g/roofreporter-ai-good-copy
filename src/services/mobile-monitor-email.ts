// ============================================================
// MOBILE-MONITOR EMAIL — Composes + sends the warn/fail digest
// after each /mobile-monitor tick. Silent on pass. Recipient
// hardcoded to christinegourley04@gmail.com (same as the other
// monitor emails).
// ============================================================

import { loadGmailCreds, sendGmailOAuth2 } from './email'
import type { MobileResult, MobileFinding } from './mobile-monitor'

const RECIPIENT = 'christinegourley04@gmail.com'
const SENDER_DEFAULT = 'sales@roofmanager.ca'

export async function sendMobileMonitorEmail(
  env: any,
  result: MobileResult,
  opts: { onlyOnIssues?: boolean } = {},
): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const onlyOnIssues = opts.onlyOnIssues !== false
  if (onlyOnIssues && result.verdict === 'pass') {
    return { ok: true, skipped: true }
  }

  const creds = await loadGmailCreds(env)
  if (!creds.clientId || !creds.clientSecret || !creds.refreshToken) {
    return { ok: false, error: 'Gmail OAuth2 creds not loaded — cannot send mobile-monitor email' }
  }
  const sender = creds.senderEmail || SENDER_DEFAULT

  const dateStr = new Date(result.checked_at).toISOString().slice(0, 16).replace('T', ' ')
  const verdictTag = result.verdict === 'pass' ? '✓ all green'
    : result.verdict === 'warn' ? `⚠ ${result.findings.length} warning${result.findings.length === 1 ? '' : 's'}`
    : `🔴 ${result.findings.filter(f => f.severity === 'error').length} dead end${result.findings.filter(f => f.severity === 'error').length === 1 ? '' : 's'}`
  const subject = `[RoofManager Mobile] ${dateStr} UTC · ${verdictTag}`

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

function renderHtml(result: MobileResult, dateStr: string, verdictTag: string): string {
  const headerBg = result.verdict === 'pass' ? '#16a34a' : result.verdict === 'warn' ? '#d97706' : '#dc2626'

  const bySection: Record<'public' | 'customer', MobileFinding[]> = { public: [], customer: [] }
  for (const f of result.findings) bySection[f.section].push(f)

  const renderGroup = (label: string, items: MobileFinding[]) => {
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

  const summaryRow = (label: string, total: number, failed: number, consoleErrors: number) => {
    const ok = total - failed
    const color = failed === 0 ? '#16a34a' : '#dc2626'
    return `
      <div style="flex:1;padding:14px 16px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;margin:0 4px">
        <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:1px">${escapeHtml(label)}</div>
        <div style="font-size:22px;font-weight:700;color:${color};margin-top:4px">${ok} / ${total}</div>
        <div style="font-size:11px;color:#6b7280;margin-top:2px">${failed} failed · ${consoleErrors} console err</div>
      </div>
    `
  }

  return `<!doctype html>
<html><body style="margin:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:720px;margin:0 auto;background:#fff">
  <div style="background:${headerBg};color:#fff;padding:24px 24px 18px">
    <div style="font-size:13px;opacity:.85;letter-spacing:1px;text-transform:uppercase">Roof Manager · Mobile + Customer Health</div>
    <div style="font-size:24px;font-weight:700;margin-top:6px">${escapeHtml(dateStr)} · ${escapeHtml(verdictTag)}</div>
    <div style="font-size:13px;opacity:.85;margin-top:6px">
      iPhone viewport (375×667 @ 2x) · ${result.duration_ms}ms · ${result.public.checked} public + ${result.customer.checked} customer pages
    </div>
  </div>
  <div style="padding:20px 24px">
    <div style="display:flex;margin:0 -4px 12px">
      ${summaryRow('Public webfront', result.public.checked, result.public.failed, result.public.console_errors)}
      ${summaryRow('Customer module', result.customer.checked, result.customer.failed, result.customer.console_errors)}
    </div>
    ${renderGroup('Public webfront issues', bySection.public)}
    ${renderGroup('Customer module issues', bySection.customer)}
    <p style="color:#888;font-size:11px;margin-top:24px;line-height:1.5">
      Sent by /mobile-monitor loop · ${escapeHtml(result.checked_at)} UTC.<br>
      iPhone UA: iOS Safari 17. Synthetic customer: signup-journey-probe@roofmanager.ca.<br>
      Loop tracker: <a href="https://www.roofmanager.ca/super-admin/loop-tracker" style="color:#0ea5e9">/super-admin/loop-tracker</a>
    </p>
  </div>
</div>
</body></html>`
}

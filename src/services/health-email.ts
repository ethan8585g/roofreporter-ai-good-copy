// ============================================================
// SIGNUP-HEALTH EMAIL — Composes + sends the daily summary email
// triggered by the /signup-health loop. Recipient is hardcoded
// to christinegourley04@gmail.com per product decision; change
// RECIPIENT below if the audit list grows.
//
// Transport: Gmail OAuth2 (Resend fallback unconfigured in prod
// per memory). Failure to send is reported back to the caller —
// the result still gets logged to the loop tracker either way.
// ============================================================

import { loadGmailCreds, sendGmailOAuth2 } from './email'
import type { SignupHealthResult, SectionResult } from './signup-health'

const RECIPIENT = 'christinegourley04@gmail.com'
const SENDER_DEFAULT = 'sales@roofmanager.ca'

export async function sendSignupHealthEmail(
  env: any,
  result: SignupHealthResult,
): Promise<{ ok: boolean; error?: string }> {
  const creds = await loadGmailCreds(env)
  if (!creds.clientId || !creds.clientSecret || !creds.refreshToken) {
    return { ok: false, error: 'Gmail OAuth2 creds not loaded — cannot send health email' }
  }
  const sender = creds.senderEmail || SENDER_DEFAULT

  const dateStr = formatDateUTC(new Date(result.checked_at))
  const verdictIcon = result.verdict === 'pass' ? '✓ all green'
    : result.verdict === 'warn' ? `⚠ ${result.issues.length} warning${result.issues.length === 1 ? '' : 's'}`
    : `🔴 ${result.issues.length} issue${result.issues.length === 1 ? '' : 's'}`
  const subject = `[RoofManager Health] ${dateStr} · ${verdictIcon}`

  const html = renderHtml(result, dateStr, verdictIcon)

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

function formatDateUTC(d: Date): string {
  return d.toISOString().slice(0, 10)
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

function renderHtml(result: SignupHealthResult, dateStr: string, verdictIcon: string): string {
  const headerBg = result.verdict === 'pass' ? '#16a34a' : result.verdict === 'warn' ? '#d97706' : '#dc2626'
  const sectionsHtml = result.sections.map(s => renderSection(s)).join('')
  const issueCount = result.issues.length

  const issueListHtml = issueCount > 0
    ? `
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin:16px 0">
        <div style="font-weight:700;color:#991b1b;margin-bottom:8px">Action items (${issueCount})</div>
        <ol style="margin:0;padding-left:20px;color:#991b1b;font-size:14px;line-height:1.6">
          ${result.issues.map(i => `<li><strong>${escapeHtml(i.section)}</strong> — ${escapeHtml(i.message)}</li>`).join('')}
        </ol>
      </div>`
    : `
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin:16px 0;color:#15803d;font-size:14px">
        ✓ All sections healthy. No action required.
      </div>`

  return `<!doctype html>
<html><body style="margin:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:640px;margin:0 auto;background:#fff">
  <div style="background:${headerBg};color:#fff;padding:24px 24px 18px">
    <div style="font-size:13px;opacity:.85;letter-spacing:1px;text-transform:uppercase">Roof Manager · Daily Health</div>
    <div style="font-size:24px;font-weight:700;margin-top:6px">${escapeHtml(dateStr)} · ${escapeHtml(verdictIcon)}</div>
    <div style="font-size:13px;opacity:.85;margin-top:6px">
      Checked in ${result.duration_ms}ms · ${result.sections.length} sections
    </div>
  </div>
  <div style="padding:20px 24px">
    ${issueListHtml}
    ${sectionsHtml}
    <p style="color:#888;font-size:11px;margin-top:24px;line-height:1.5">
      Sent by /signup-health loop · run at ${escapeHtml(result.checked_at)} UTC.<br>
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
  const detailsHtml = renderSectionDetails(s)
  return `
    <div style="border:1px solid #e5e7eb;border-radius:8px;margin:10px 0;overflow:hidden">
      <div style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:${bg};border-bottom:1px solid #e5e7eb">
        <div style="width:24px;height:24px;border-radius:50%;background:${color};color:#fff;font-weight:700;text-align:center;line-height:24px;flex-shrink:0">${icon}</div>
        <div style="flex:1">
          <div style="font-weight:700;color:#111827;font-size:14px">${escapeHtml(s.label)}</div>
          <div style="color:${color};font-size:13px;margin-top:2px">${escapeHtml(s.summary)}</div>
        </div>
      </div>
      ${detailsHtml ? `<div style="padding:12px 14px;font-size:12px;color:#374151;line-height:1.6">${detailsHtml}</div>` : ''}
    </div>
  `
}

function renderSectionDetails(s: SectionResult): string {
  // Tailored renderers per section key — keeps the email scannable.
  switch (s.key) {
    case 'signup_smoke': {
      const probes: any[] = s.details.probes || []
      if (!probes.length) return ''
      return `<table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="text-align:left;color:#6b7280">
          <th style="padding:4px 8px 4px 0">Probe</th>
          <th style="padding:4px 0">Status</th>
          <th style="padding:4px 0">Note</th>
        </tr></thead>
        <tbody>
          ${probes.map(p => `<tr>
            <td style="padding:3px 8px 3px 0;color:#111827">${escapeHtml(p.name)}</td>
            <td style="padding:3px 0;color:${p.ok ? '#16a34a' : '#dc2626'};font-weight:600">${p.ok ? 'OK' : 'FAIL'} ${p.status === null ? '' : `(${p.status})`}</td>
            <td style="padding:3px 0;color:#6b7280">${escapeHtml(p.note || '')}</td>
          </tr>`).join('')}
        </tbody>
      </table>`
    }
    case 'funnel_regression': {
      const cur = s.details.current || {}
      const base = s.details.baseline_avg || {}
      const delta = s.details.delta_pct || {}
      const fmt = (v: any) => v === null || v === undefined ? '—' : (typeof v === 'number' ? v.toFixed(v < 10 ? 1 : 0) : String(v))
      const fmtPct = (v: any) => v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(0)}%`
      return `<table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="text-align:left;color:#6b7280">
          <th style="padding:4px 8px 4px 0">Metric</th>
          <th style="padding:4px 8px 4px 0">Last 24h</th>
          <th style="padding:4px 8px 4px 0">7-day avg</th>
          <th style="padding:4px 0">Δ</th>
        </tr></thead>
        <tbody>
          <tr><td style="padding:3px 8px 3px 0">Signups</td><td style="padding:3px 8px 3px 0;font-weight:600">${fmt(cur.signups)}</td><td style="padding:3px 8px 3px 0;color:#6b7280">${fmt(base.signups)}</td><td style="padding:3px 0;color:${(delta.signups ?? 0) < -25 ? '#dc2626' : '#374151'}">${fmtPct(delta.signups)}</td></tr>
          <tr><td style="padding:3px 8px 3px 0">Orders</td><td style="padding:3px 8px 3px 0;font-weight:600">${fmt(cur.orders)}</td><td style="padding:3px 8px 3px 0;color:#6b7280">${fmt(base.orders)}</td><td style="padding:3px 0;color:${(delta.orders ?? 0) < -25 ? '#dc2626' : '#374151'}">${fmtPct(delta.orders)}</td></tr>
          <tr><td style="padding:3px 8px 3px 0">Paid orders</td><td style="padding:3px 8px 3px 0;font-weight:600">${fmt(cur.paid)}</td><td style="padding:3px 8px 3px 0;color:#6b7280">${fmt(base.paid)}</td><td style="padding:3px 0;color:${(delta.paid ?? 0) < -25 ? '#dc2626' : '#374151'}">${fmtPct(delta.paid)}</td></tr>
        </tbody>
      </table>`
    }
    case 'surface_scans': {
      const types = ['public', 'customer', 'admin']
      return `<table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="text-align:left;color:#6b7280">
          <th style="padding:4px 8px 4px 0">Surface</th>
          <th style="padding:4px 8px 4px 0">Last status</th>
          <th style="padding:4px 8px 4px 0">OK / Fail</th>
          <th style="padding:4px 0">Unresolved errors</th>
        </tr></thead>
        <tbody>
          ${types.map(t => {
            const r = s.details[t] || {}
            return `<tr>
              <td style="padding:3px 8px 3px 0;color:#111827;font-weight:600">scan_${escapeHtml(t)}</td>
              <td style="padding:3px 8px 3px 0">${escapeHtml(r.status || 'never run')}</td>
              <td style="padding:3px 8px 3px 0">${r.ok_count ?? 0} / ${r.fail_count ?? 0}</td>
              <td style="padding:3px 0;color:${(r.unresolved_findings ?? 0) > 0 ? '#dc2626' : '#374151'};font-weight:${(r.unresolved_findings ?? 0) > 0 ? 700 : 400}">${r.unresolved_findings ?? 0}</td>
            </tr>`
          }).join('')}
        </tbody>
      </table>`
    }
    case 'backend_core': {
      const missing: string[] = s.details.missing_secrets || []
      const lat = s.details.d1_latency_ms
      const lines: string[] = []
      lines.push(`D1 latency: <strong>${lat ?? '—'}ms</strong>`)
      if (missing.length) {
        lines.push(`<span style="color:#dc2626">Missing secrets: ${missing.map(escapeHtml).join(', ')}</span>`)
      } else {
        lines.push(`All checked secrets present`)
      }
      return lines.join(' · ')
    }
    case 'gmail_transport': {
      if (s.status === 'pass') {
        return `Mint OK · access token expires in ${escapeHtml(String(s.details.expires_in_s ?? '—'))}s`
      }
      return `Token mint failed: ${escapeHtml(JSON.stringify(s.details).slice(0, 240))}`
    }
    case 'reports_health': {
      return `Stuck >1h enhancing: <strong>${s.details.stuck_enhancing}</strong> · Failed last 24h: <strong>${s.details.failed_24h}</strong> · Orphan: <strong>${s.details.orphan}</strong>`
    }
    case 'payments_health': {
      return `Unmatched square_payments: <strong>${s.details.unmatched}</strong> · Failed payments 24h: <strong>${s.details.recent_failed_payments}</strong> · Orders w/ payment_status=failed: <strong>${s.details.orders_failed_payment}</strong>`
    }
    default:
      return ''
  }
}

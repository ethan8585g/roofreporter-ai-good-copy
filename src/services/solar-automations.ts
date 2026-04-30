// ============================================================
// Solar deal-stage email automations.
//
// Two entry points:
//   - onDealStageChange(env, deal, oldStage, newStage) — called from the
//     PATCH handler in src/routes/solar-pipeline.ts whenever the stage
//     changes (and only then).
//   - onProposalSigned(env, proposalId) — called from the public sign route
//     (c.executionCtx.waitUntil so the homeowner's HTTP response isn't blocked).
//
// All emails are fire-and-forget. Any failure is logged and swallowed so
// the underlying CRUD action never fails because the mailer hiccuped.
// ============================================================

import { sendViaResend, sendGmailOAuth2, loadGmailCreds } from './email'

type Env = {
  DB: D1Database
  RESEND_API_KEY?: string
  GMAIL_SENDER_EMAIL?: string
  GMAIL_CLIENT_ID?: string
  GMAIL_CLIENT_SECRET?: string
  GMAIL_REFRESH_TOKEN?: string
}

interface Deal {
  id: number
  customer_id: number
  homeowner_name?: string | null
  homeowner_email?: string | null
  property_address?: string | null
  install_scheduled_at?: string | null
}

function esc(s: unknown): string {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] || ch))
}

async function loadCustomer(env: Env, customerId: number) {
  return await env.DB.prepare(
    `SELECT id, name, email,
            COALESCE(brand_business_name, company_name, name) AS company,
            COALESCE(brand_email, email) AS contact_email,
            COALESCE(brand_phone, phone) AS contact_phone,
            brand_logo_url, brand_primary_color
       FROM customers WHERE id = ?`
  ).bind(customerId).first<any>()
}

async function send(env: Env, to: string, subject: string, html: string, fromEmail?: string | null) {
  // Prefer Resend if configured; otherwise fall back to Gmail OAuth2
  // (env first, then D1 settings — works after /api/auth/gmail flow).
  if (env.RESEND_API_KEY) {
    try {
      await sendViaResend(env.RESEND_API_KEY, to, subject, html, fromEmail || null)
      return
    } catch (e: any) {
      console.error('[solar-automations] resend failed, trying gmail:', e?.message || e)
    }
  }
  try {
    const creds = await loadGmailCreds(env as any)
    if (creds.clientId && creds.clientSecret && creds.refreshToken) {
      await sendGmailOAuth2(
        creds.clientId, creds.clientSecret, creds.refreshToken,
        to, subject, html,
        fromEmail || creds.senderEmail || env.GMAIL_SENDER_EMAIL || null
      )
      return
    }
    console.log('[solar-automations] no email provider configured; skipping email to', to)
  } catch (e: any) {
    console.error('[solar-automations] gmail send failed:', e?.message || e)
  }
}

function button(label: string, href: string, color = '#f59e0b'): string {
  return `<a href="${esc(href)}" style="display:inline-block;background:${color};color:#0b0f19;font-weight:800;padding:12px 20px;border-radius:10px;text-decoration:none;margin:12px 0">${esc(label)}</a>`
}

function shell(bodyHtml: string, company: any): string {
  return `<div style="font-family:-apple-system,system-ui,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111">
    ${company?.brand_logo_url ? `<img src="${esc(company.brand_logo_url)}" alt="${esc(company.company)}" style="max-height:40px;margin-bottom:16px">` : `<div style="font-weight:800;font-size:18px;margin-bottom:16px">${esc(company?.company || '')}</div>`}
    ${bodyHtml}
    <hr style="margin:28px 0;border:0;border-top:1px solid #e5e7eb">
    <div style="color:#6b7280;font-size:12px">${esc(company?.company || '')}${company?.contact_phone ? ' · ' + esc(company.contact_phone) : ''}${company?.contact_email ? ' · ' + esc(company.contact_email) : ''}</div>
  </div>`
}

export function buildSolarProposalEmail(proposal: any, company: any, origin: string): { subject: string; html: string } {
  const first = (proposal.homeowner_name || '').split(' ')[0] || 'there'
  const url = `${origin}/p/solar/${proposal.share_token}`
  const body = `
    <h1 style="font-size:22px;margin:0 0 12px">Your solar plan is ready, ${esc(first)}.</h1>
    <p>Here's your interactive proposal. Review your system size, production, 25-year savings, and sign from your phone when you're ready.</p>
    ${button('View My Solar Proposal', url)}
    <p style="color:#6b7280;font-size:13px">Link: <a href="${esc(url)}">${esc(url)}</a></p>
  `
  return {
    subject: `Your solar proposal${company?.company ? ' from ' + company.company : ''}`,
    html: shell(body, company),
  }
}

export function buildSolarSignedEmailToRep(proposal: any, company: any): { subject: string; html: string } {
  const body = `
    <h1 style="font-size:20px;margin:0 0 10px">${esc(proposal.signer_name || proposal.homeowner_name || 'Homeowner')} just signed their solar proposal.</h1>
    <p>Address: <strong>${esc(proposal.property_address || '')}</strong></p>
    <p>System: <strong>${Number(proposal.system_kw || 0).toFixed(2)} kW · ${proposal.panel_count} panels</strong></p>
    <p>Time to kick off site planning and permits.</p>
  `
  return { subject: 'Solar proposal signed — kick off install planning', html: shell(body, company) }
}

export function buildSolarInstallScheduledEmail(deal: Deal, company: any): { subject: string; html: string } {
  const first = (deal.homeowner_name || '').split(' ')[0] || 'there'
  const body = `
    <h1 style="font-size:22px;margin:0 0 12px">${esc(first)}, your install is scheduled!</h1>
    <p>We've locked in your solar install for <strong>${esc((deal.install_scheduled_at || '').slice(0, 10) || 'the scheduled date')}</strong> at ${esc(deal.property_address || 'your home')}.</p>
    <p>Our crew will arrive between 7–9am. Expect a full day on-site and a utility inspection within a couple weeks after.</p>
    <p>Questions? Reply to this email anytime.</p>
  `
  return { subject: 'Your solar install is scheduled', html: shell(body, company) }
}

export function buildSolarInstalledEmail(deal: Deal, company: any): { subject: string; html: string } {
  const first = (deal.homeowner_name || '').split(' ')[0] || 'there'
  const body = `
    <h1 style="font-size:22px;margin:0 0 12px">Welcome to solar, ${esc(first)}.</h1>
    <p>Your panels are installed and producing. You'll get a permission-to-operate notice from the utility in the next 1–4 weeks; after that, every sunny hour starts paying you back.</p>
    <p>If you have a minute, we'd love a quick review — it means everything to small installers like us.</p>
  `
  return { subject: 'Your solar system is live', html: shell(body, company) }
}

// ─── Entry points ───────────────────────────────────────────

export async function onDealStageChange(env: Env, deal: Deal, oldStage: string, newStage: string): Promise<void> {
  if (oldStage === newStage) return
  const company = await loadCustomer(env, deal.customer_id)
  const from = env.GMAIL_SENDER_EMAIL || null

  if (newStage === 'install_scheduled' && deal.homeowner_email) {
    const { subject, html } = buildSolarInstallScheduledEmail(deal, company)
    await send(env, deal.homeowner_email, subject, html, from)
  }

  if (newStage === 'installed' && deal.homeowner_email) {
    const { subject, html } = buildSolarInstalledEmail(deal, company)
    await send(env, deal.homeowner_email, subject, html, from)
  }
}

export async function sendProposalEmail(env: Env, proposalId: number, origin: string): Promise<void> {
  const row = await env.DB.prepare(
    `SELECT sp.*, cu.name as cu_name, cu.email as cu_email
       FROM solar_proposals sp
       LEFT JOIN customers cu ON cu.id = sp.customer_id
       WHERE sp.id = ?`
  ).bind(proposalId).first<any>()
  if (!row) return
  if (!row.homeowner_email) {
    console.log('[solar-automations] no homeowner_email on proposal', proposalId)
    return
  }
  const company = await loadCustomer(env, row.customer_id)
  const { subject, html } = buildSolarProposalEmail(row, company, origin)
  await send(env, row.homeowner_email, subject, html, env.GMAIL_SENDER_EMAIL || null)
}

export async function onProposalSigned(env: Env, proposalId: number): Promise<void> {
  const row = await env.DB.prepare(
    `SELECT sp.*, cu.email AS cu_email
       FROM solar_proposals sp
       LEFT JOIN customers cu ON cu.id = sp.customer_id
       WHERE sp.id = ?`
  ).bind(proposalId).first<any>()
  if (!row) return
  const company = await loadCustomer(env, row.customer_id)
  const { subject, html } = buildSolarSignedEmailToRep(row, company)
  const repTo = row.cu_email
  if (repTo) await send(env, repTo, subject, html, env.GMAIL_SENDER_EMAIL || null)
}

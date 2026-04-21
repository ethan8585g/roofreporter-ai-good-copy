import { describe, it, expect } from 'vitest'
import {
  buildSolarProposalEmail,
  buildSolarSignedEmailToRep,
  buildSolarInstallScheduledEmail,
  buildSolarInstalledEmail,
} from './solar-automations'

const company = { company: 'Bright Solar', contact_email: 'ops@bright.example', contact_phone: '555' }

describe('solar-automations templates', () => {
  it('proposal email links to the public share URL and greets by first name', () => {
    const { subject, html } = buildSolarProposalEmail(
      { homeowner_name: 'Alex Smith', share_token: 'abc123' },
      company,
      'https://example.com'
    )
    expect(subject).toContain('Bright Solar')
    expect(html).toContain('Alex')
    expect(html).toContain('https://example.com/p/solar/abc123')
  })

  it('signed-to-rep email names the signer + system + address', () => {
    const { html } = buildSolarSignedEmailToRep(
      { signer_name: 'Alex Smith', property_address: '1 Elm', system_kw: 8.4, panel_count: 21 },
      company
    )
    expect(html).toContain('Alex Smith')
    expect(html).toContain('1 Elm')
    expect(html).toContain('8.40 kW')
    expect(html).toContain('21 panels')
  })

  it('install-scheduled email includes the scheduled date and address', () => {
    const { html } = buildSolarInstallScheduledEmail(
      { id: 1, customer_id: 1, homeowner_name: 'Alex', property_address: '1 Elm', install_scheduled_at: '2026-06-15T09:00:00Z' },
      company
    )
    expect(html).toContain('2026-06-15')
    expect(html).toContain('1 Elm')
  })

  it('installed email welcomes by first name and asks for a review', () => {
    const { html } = buildSolarInstalledEmail(
      { id: 1, customer_id: 1, homeowner_name: 'Alex Smith' },
      company
    )
    expect(html).toContain('Welcome to solar, Alex')
    expect(html.toLowerCase()).toContain('review')
  })

  it('escapes HTML in homeowner names (no XSS through rep input)', () => {
    const { html } = buildSolarProposalEmail(
      { homeowner_name: '<script>alert(1)</script>', share_token: 'tok' },
      company,
      'https://ex.com'
    )
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })
})

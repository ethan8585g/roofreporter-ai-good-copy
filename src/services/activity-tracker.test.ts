import { describe, it, expect } from 'vitest'
import { classifyModule } from './activity-tracker'

describe('classifyModule', () => {
  it('skips static/health/heartbeat paths', () => {
    expect(classifyModule('/static/foo.js')).toBeNull()
    expect(classifyModule('/health')).toBeNull()
    expect(classifyModule('/healthz')).toBeNull()
    expect(classifyModule('/favicon.ico')).toBeNull()
    expect(classifyModule('/sitemap.xml')).toBeNull()
    expect(classifyModule('/robots.txt')).toBeNull()
    expect(classifyModule('/api/activity/heartbeat')).toBeNull()
  })

  it('classifies measurement paths', () => {
    expect(classifyModule('/api/measure/snapshot')).toBe('measurement')
    expect(classifyModule('/api/property-imagery/lookup')).toBe('measurement')
    expect(classifyModule('/api/sam3/segment')).toBe('measurement')
    expect(classifyModule('/api/report-images/upload')).toBe('measurement')
    expect(classifyModule('/measure?addr=foo')).toBe('measurement')
  })

  it('classifies CRM/pipeline paths', () => {
    expect(classifyModule('/api/crm/customers')).toBe('crm')
    expect(classifyModule('/api/pipeline/jobs')).toBe('crm')
    expect(classifyModule('/api/d2d/territories')).toBe('crm')
    expect(classifyModule('/api/customer-leads/inbox')).toBe('crm')
  })

  it('classifies invoicing paths', () => {
    expect(classifyModule('/api/invoices/123')).toBe('invoicing')
    expect(classifyModule('/api/square/charge')).toBe('invoicing')
  })

  it('classifies secretary/voice paths', () => {
    expect(classifyModule('/api/secretary/calls')).toBe('secretary')
    expect(classifyModule('/api/call-center/agents')).toBe('secretary')
    expect(classifyModule('/api/agents/list')).toBe('secretary')
  })

  it('routes solar paths to solar (before customer-portal generic match)', () => {
    expect(classifyModule('/api/customer/solar-pipeline/leads')).toBe('solar')
    expect(classifyModule('/api/storm-scout/dashboard')).toBe('solar')
    expect(classifyModule('/solar-')).toBe('solar')
  })

  it('classifies admin/super-admin tools', () => {
    expect(classifyModule('/api/admin/dashboard')).toBe('admin_tools')
    expect(classifyModule('/super-admin/inbox')).toBe('admin_tools')
    expect(classifyModule('/admin/dispatch')).toBe('admin_tools')
    expect(classifyModule('/api/admin/bi/business-intel')).toBe('analytics_view')
    expect(classifyModule('/api/analytics/dashboard')).toBe('analytics_view')
  })

  it('classifies customer portal', () => {
    expect(classifyModule('/customer/dashboard')).toBe('customer_portal')
    expect(classifyModule('/api/customer/orders')).toBe('customer_portal')
    expect(classifyModule('/api/customer-auth/me')).toBe('customer_portal')
  })

  it('classifies marketing & blog', () => {
    expect(classifyModule('/api/google-ads/campaigns')).toBe('marketing')
    expect(classifyModule('/api/blog/posts')).toBe('marketing')
    expect(classifyModule('/api/email-outreach/send')).toBe('marketing')
  })

  it('classifies reports/orders', () => {
    expect(classifyModule('/api/reports/123')).toBe('reports')
    expect(classifyModule('/api/orders/list')).toBe('reports')
    expect(classifyModule('/order/abc')).toBe('reports')
    expect(classifyModule('/report/abc')).toBe('reports')
  })

  it('falls back to "other" for authenticated paths that do not match', () => {
    expect(classifyModule('/something-random')).toBe('other')
    expect(classifyModule('/api/unknown')).toBe('other')
  })

  it('strips query strings before matching', () => {
    expect(classifyModule('/api/measure?lat=1&lng=2')).toBe('measurement')
  })

  it('handles empty input safely', () => {
    expect(classifyModule('')).toBeNull()
  })
})

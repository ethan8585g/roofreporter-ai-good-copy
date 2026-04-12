import { describe, it, expect } from 'vitest'
import { validateAppointmentInput, isValidApptStatus, APPT_VALID_STATUSES } from './d2d'

describe('D2D Appointment validation', () => {
  it('accepts a complete, well-formed payload', () => {
    const r = validateAppointmentInput({
      customer_name: 'Jane Homeowner',
      address: '123 Maple St, Toronto ON',
      appointment_date: '2026-05-10',
      appointment_time: '14:30',
    })
    expect(r.ok).toBe(true)
  })

  it('rejects missing customer name', () => {
    const r = validateAppointmentInput({
      customer_name: '',
      address: '123 Maple St',
      appointment_date: '2026-05-10',
      appointment_time: '14:30',
    })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/customer_name/)
  })

  it('rejects whitespace-only address', () => {
    const r = validateAppointmentInput({
      customer_name: 'Jane',
      address: '   ',
      appointment_date: '2026-05-10',
      appointment_time: '14:30',
    })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/address/)
  })

  it('rejects bad date format', () => {
    const r = validateAppointmentInput({
      customer_name: 'Jane',
      address: '123 Maple St',
      appointment_date: '05/10/2026',
      appointment_time: '14:30',
    })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/date/)
  })

  it('rejects bad time format', () => {
    const r = validateAppointmentInput({
      customer_name: 'Jane',
      address: '123 Maple St',
      appointment_date: '2026-05-10',
      appointment_time: '2:30 PM',
    })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/time/)
  })

  it('rejects injection-y but still schema-invalid payloads gracefully', () => {
    const r = validateAppointmentInput({
      customer_name: { $ne: null } as any,
      address: '123 Maple St',
      appointment_date: '2026-05-10',
      appointment_time: '14:30',
    })
    expect(r.ok).toBe(false)
  })
})

describe('D2D Appointment status', () => {
  it('accepts all canonical statuses', () => {
    APPT_VALID_STATUSES.forEach(s => expect(isValidApptStatus(s)).toBe(true))
  })

  it('rejects unknown statuses', () => {
    expect(isValidApptStatus('booked')).toBe(false)
    expect(isValidApptStatus('')).toBe(false)
    expect(isValidApptStatus(null)).toBe(false)
    expect(isValidApptStatus(123)).toBe(false)
  })
})

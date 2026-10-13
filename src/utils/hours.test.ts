import { describe, expect, it } from 'vitest'

import { minutesBefore, paidWindow, resolveEventHours } from './hours'

const ap = { name: 'Annual Program', paid_early_minutes: 15 }
const town = { name: 'Town Session', paid_early_minutes: 0 }
const campFull = { name: 'Camp-Full Day', paid_early_minutes: 0 }
const campLocation = { half_day_hours: 3, full_day_hours: 6 }

describe('paid-time rules (R3)', () => {
  it('pays an AP session from 15 minutes before start: 5:30–6:30 records 1.25 hours', () => {
    const event = { start_time: '17:30:00', end_time: '18:30:00' }
    expect(resolveEventHours(ap, event, undefined)).toBe(1.25)
    expect(paidWindow(ap, event)).toEqual({ start: '17:15:00', end: '18:30:00', earlyMinutes: 15 })
  })

  it('pays a game from its warm-up/arrival time (event override)', () => {
    const game = { start_time: '10:00:00', end_time: '11:00:00', paid_early_minutes: 30 }
    expect(resolveEventHours(town, game, undefined)).toBe(1.5)
    expect(paidWindow(town, game).start).toBe('09:30:00')
  })

  it('pays a Town Session practice its scheduled time only', () => {
    const practice = { start_time: '17:00:00', end_time: '18:00:00' }
    expect(resolveEventHours(town, practice, undefined)).toBe(1)
    expect(paidWindow(town, practice)).toEqual({ start: '17:00:00', end: '18:00:00', earlyMinutes: 0 })
  })

  it('lets an event override beat the program rule, including overriding it to 0', () => {
    expect(resolveEventHours(ap, { start_time: '17:30:00', end_time: '18:30:00', paid_early_minutes: 30 }, undefined)).toBe(1.5)
    expect(resolveEventHours(ap, { start_time: '17:30:00', end_time: '18:30:00', paid_early_minutes: 0 }, undefined)).toBe(1)
  })

  it('leaves Camp/Nurse fixed hours alone, whatever the offsets say', () => {
    const event = { start_time: '08:15:00', end_time: '15:00:00', paid_early_minutes: 5 }
    expect(resolveEventHours({ ...campFull, paid_early_minutes: 15 }, event, campLocation)).toBe(6)
    expect(paidWindow({ ...campFull, paid_early_minutes: 15 }, event).earlyMinutes).toBe(0)
  })

  it('treats a missing program rule as no early pay', () => {
    expect(resolveEventHours({ name: 'Futsal' }, { start_time: '18:00:00', end_time: '19:00:00' }, undefined)).toBe(1)
  })

  it('subtracts minutes across the hour and never wraps past midnight', () => {
    expect(minutesBefore('17:05:00', 15)).toBe('16:50:00')
    expect(minutesBefore('00:10', 15)).toBe('00:00:00')
  })
})

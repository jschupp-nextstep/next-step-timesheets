import { describe, expect, it } from 'vitest'

import { splitWeekly, weekStartFor, weeklyRateFor, type WeeklyPayment, type WeeklyRate } from './weeklyPay'

const SAT = 6
const MON = 1
const prince: WeeklyRate = {
  id: 'prince-all',
  coach_id: 'prince',
  program_id: null,
  weekly_amount: 1100,
  week_start_dow: SAT,
  effective_from: '2026-09-01',
  effective_to: null,
}
const hayleyAp: WeeklyRate = {
  id: 'hayley-ap',
  coach_id: 'hayley',
  program_id: 'ap',
  weekly_amount: 200,
  week_start_dow: MON,
  effective_from: '2026-10-01',
  effective_to: '2026-12-31',
}
const e = (id: string, coach_id: string, program_id: string, entry_date: string) => ({ id, coach_id, program_id, entry_date })

describe('weekStartFor', () => {
  it('finds the Saturday that starts a Sat–Fri week', () => {
    expect(weekStartFor('2026-09-19', SAT)).toBe('2026-09-19') // Saturday itself
    expect(weekStartFor('2026-09-25', SAT)).toBe('2026-09-19') // Friday
    expect(weekStartFor('2026-09-26', SAT)).toBe('2026-09-26') // next Saturday
  })

  it('finds the Monday that starts a Mon–Sun week', () => {
    expect(weekStartFor('2026-10-18', MON)).toBe('2026-10-12') // Sunday belongs to the week before
    expect(weekStartFor('2026-10-19', MON)).toBe('2026-10-19')
  })
})

describe('weeklyRateFor', () => {
  it('covers all of a coach’s work for an all-work rate, within its effective dates', () => {
    expect(weeklyRateFor(e('1', 'prince', 'town', '2026-09-20'), [prince])).toBe(prince)
    expect(weeklyRateFor(e('2', 'prince', 'town', '2026-08-31'), [prince])).toBeUndefined()
  })

  it('covers only its program for a program rate, and nothing after it ends', () => {
    expect(weeklyRateFor(e('3', 'hayley', 'ap', '2026-10-14'), [hayleyAp])).toBe(hayleyAp)
    expect(weeklyRateFor(e('4', 'hayley', 'town', '2026-10-14'), [hayleyAp])).toBeUndefined()
    expect(weeklyRateFor(e('5', 'hayley', 'ap', '2027-01-04'), [hayleyAp])).toBeUndefined()
  })

  it('prefers a program-specific rate over an all-work rate', () => {
    const princeAp = { ...prince, id: 'prince-ap', program_id: 'ap', weekly_amount: 500 }
    expect(weeklyRateFor(e('6', 'prince', 'ap', '2026-09-20'), [prince, princeAp])).toBe(princeAp)
  })
})

describe('splitWeekly', () => {
  it("groups Prince's Sat 9/19 – Fri 9/25 sessions into one week line, not hours", () => {
    const entries = [
      e('a', 'prince', 'town', '2026-09-19'),
      e('b', 'prince', 'ap', '2026-09-22'),
      e('c', 'prince', 'futsal', '2026-09-25'),
      e('d', 'prince', 'town', '2026-09-26'), // next week
      e('x', 'someone', 'town', '2026-09-22'), // hourly coach
    ]
    const { hourly, weeks } = splitWeekly(entries, [prince], [])
    expect(hourly.map((x) => x.id)).toEqual(['x'])
    expect(weeks.map((w) => [w.weekStart, w.weekEnd, w.entries.map((x) => x.id), w.rate.weekly_amount])).toEqual([
      ['2026-09-19', '2026-09-25', ['a', 'b', 'c'], 1100],
      ['2026-09-26', '2026-10-02', ['d'], 1100],
    ])
  })

  it('attaches the payment to a week already paid (e.g. in advance)', () => {
    const paid: WeeklyPayment = {
      id: 'p1',
      weekly_rate_id: 'prince-all',
      coach_id: 'prince',
      week_start: '2026-10-03',
      week_end: '2026-10-09',
      amount: 1100,
      paid_date: '2026-10-07',
    }
    const { weeks } = splitWeekly([e('a', 'prince', 'town', '2026-10-08')], [prince], [paid])
    expect(weeks[0].payment?.id).toBe('p1')
  })
})

describe('weeklyRateFor with a location', () => {
  const dedham: WeeklyRate = { ...prince, id: 'prince-town-dedham', program_id: 'town', location_id: 'dedham' }
  const le = (id: string, program_id: string, location_id: string | null) => ({ ...e(id, 'prince', program_id, '2026-12-05'), location_id })

  it('covers only sessions at that location', () => {
    expect(weeklyRateFor(le('1', 'town', 'dedham'), [dedham])).toBe(dedham)
    expect(weeklyRateFor(le('2', 'town', 'natick'), [dedham])).toBeUndefined() // a fill-in elsewhere stays hourly
    expect(weeklyRateFor(le('3', 'town', null), [dedham])).toBeUndefined()
    expect(weeklyRateFor(le('4', 'ap', 'dedham'), [dedham])).toBeUndefined()
  })

  it('prefers the most specific rate', () => {
    const town: WeeklyRate = { ...prince, id: 'prince-town', program_id: 'town' }
    const atDedham: WeeklyRate = { ...prince, id: 'prince-dedham', location_id: 'dedham' }
    expect(weeklyRateFor(le('5', 'town', 'dedham'), [prince, town, atDedham, dedham])).toBe(dedham)
    expect(weeklyRateFor(le('6', 'town', 'natick'), [prince, town, atDedham, dedham])).toBe(town)
    expect(weeklyRateFor(le('7', 'ap', 'dedham'), [prince, town, atDedham, dedham])).toBe(atDedham)
    expect(weeklyRateFor(le('8', 'ap', 'natick'), [prince, town, atDedham, dedham])).toBe(prince)
  })

  it('splits a week: Dedham sessions to the week, a fill-in elsewhere to hourly', () => {
    const { hourly, weeks } = splitWeekly([le('a', 'town', 'dedham'), le('b', 'town', 'natick')], [dedham], [])
    expect(hourly.map((x) => x.id)).toEqual(['b'])
    expect(weeks).toHaveLength(1)
    expect(weeks[0].entries.map((x) => x.id)).toEqual(['a'])
  })
})

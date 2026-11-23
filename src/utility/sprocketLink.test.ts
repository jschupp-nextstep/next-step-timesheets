import { describe, expect, it } from 'vitest'

import { fileDateRange, planLinks, type AppRowCandidate } from './sprocketLink'

const app = (rowId: string, team: string | null, extra: Partial<AppRowCandidate> = {}): AppRowCandidate => ({
  rowId,
  eventId: `e-${rowId}`,
  sprocketTeamId: team,
  locationSprocketId: '34507',
  eventDate: '2027-01-09',
  startTime: '19:00:00',
  expectedTitle: 'Annual Program',
  label: rowId,
  ...extra,
})
const row = (id: string, team: string, extra: Record<string, string> = {}) => ({
  ClubCalendarEventID: id,
  TeamID: team,
  LocationID: '34507',
  StartDate: '1/9/2027',
  StartDateTime: '07:00 PM',
  Title: 'Annual Program',
  ...extra,
})

describe('planLinks', () => {
  it('links each team row of an exported session to its Sprocket row', () => {
    const plan = planLinks([row('901', '73441'), row('902', '73601')], [app('a', '73441'), app('b', '73601')], new Set())
    expect(plan.auto.map((m) => [m.sprocket.ClubCalendarEventID, m.app.rowId])).toEqual([
      ['901', 'a'],
      ['902', 'b'],
    ])
    expect(plan.ambiguous).toEqual([])
    expect(plan.appLeft).toEqual([])
  })

  it('links a Club row by Sprocket location', () => {
    const plan = planLinks([row('903', '', { LocationID: '70435', Title: 'Futsal Session' })], [app('c', null, { locationSprocketId: '70435', expectedTitle: 'Futsal Session' })], new Set())
    expect(plan.auto).toHaveLength(1)
  })

  it('counts IDs already known and leaves rows not made here alone', () => {
    const plan = planLinks([row('1', '73441'), row('904', '99999')], [app('a', '73441')], new Set(['1']))
    expect(plan.alreadyLinked).toBe(1)
    expect(plan.notFromApp.map((r) => r.ClubCalendarEventID)).toEqual(['904'])
    expect(plan.appLeft.map((a) => a.rowId)).toEqual(['a'])
  })

  it('uses the title to break a tie, else asks', () => {
    const twoSessions = [app('a', '73441', { expectedTitle: 'Annual Program' }), app('b', '73441', { expectedTitle: 'Video Session' })]
    const plan = planLinks([row('905', '73441', { Title: 'Video Session' })], twoSessions, new Set())
    expect(plan.auto.map((m) => m.app.rowId)).toEqual(['b'])

    const sameTitle = [app('a', '73441'), app('b', '73441')]
    const asked = planLinks([row('906', '73441')], sameTitle, new Set())
    expect(asked.auto).toEqual([])
    expect(asked.ambiguous[0].candidates.map((c) => c.rowId)).toEqual(['a', 'b'])
  })

  it('asks when two Sprocket rows claim the same app row (uploaded twice)', () => {
    const plan = planLinks([row('907', '73441'), row('908', '73441')], [app('a', '73441')], new Set())
    expect(plan.auto).toEqual([])
    expect(plan.ambiguous).toHaveLength(2)
  })

  it('does not match a different start time or date', () => {
    const plan = planLinks([row('909', '73441', { StartDateTime: '07:30 PM' }), row('910', '73441', { StartDate: '1/10/2027' })], [app('a', '73441')], new Set())
    expect(plan.notFromApp).toHaveLength(2)
  })
})

describe('fileDateRange', () => {
  it('spans the file', () => {
    expect(fileDateRange([row('1', 'x', { StartDate: '3/13/2027' }), row('2', 'x'), row('3', 'x', { StartDate: '' })])).toEqual({
      from: '2027-01-09',
      to: '2027-03-13',
    })
  })
})

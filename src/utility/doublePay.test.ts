import { describe, expect, it } from 'vitest'

import { describeDoublePay, findDoublePay, type DPEntry } from './doublePay'

const entry = (id: string, coach_id: string, event_id = 'ev', status: DPEntry['status'] = 'pending', admin_flag: string | null = null) => ({
  id,
  coach_id,
  event_id,
  status,
  admin_flag,
})
const names: Record<string, string> = { pat: 'Pat', keith: 'Keith', norley: 'Norley', bryce: 'Bryce', amy: 'Amy' }
const name = (id: string) => names[id] ?? id

describe('findDoublePay (R5)', () => {
  it("flags Pat covering Keith when Keith was already paid and Pat also logged (the 9/14 case)", () => {
    const flags = findDoublePay(
      [entry('k', 'keith', 'ev', 'paid'), entry('p', 'pat')],
      [{ event_id: 'ev', coach_id: 'pat', covering_for_coach_id: 'keith' }],
      [],
      [],
    )
    expect(flags).toHaveLength(1)
    expect(flags[0].reasons.map((r) => describeDoublePay(r, name))).toContain('Pat covered for Keith, and both logged hours')
  })

  it('still flags it from the sub history after the covering assignment is gone', () => {
    const flags = findDoublePay(
      [entry('b', 'bryce'), entry('n', 'norley')],
      [],
      [{ event_id: 'ev', removed_coach_id: 'bryce', added_coach_id: 'norley', review_status: 'reviewed' }],
      [],
    )
    expect(flags[0].reasons[0]).toMatchObject({ kind: 'cover_and_original_logged', coverId: 'norley', originalId: 'bryce' })
  })

  it('ignores a reversed sub', () => {
    expect(
      findDoublePay(
        [entry('b', 'bryce'), entry('n', 'norley')],
        [],
        [{ event_id: 'ev', removed_coach_id: 'bryce', added_coach_id: 'norley', review_status: 'reversed' }],
        [],
      ),
    ).toEqual([])
  })

  it('flags more coaches logging than were scheduled', () => {
    const flags = findDoublePay(
      [entry('1', 'pat'), entry('2', 'amy')],
      [{ event_id: 'ev', coach_id: 'pat', covering_for_coach_id: null }],
      [],
      [],
    )
    expect(flags[0].reasons[0]).toEqual({ kind: 'more_logged_than_scheduled', logged: 2, scheduled: 1 })
  })

  it('flags an approved unassigned claim alongside the scheduled coach', () => {
    const flags = findDoublePay(
      [entry('1', 'pat'), entry('2', 'amy')],
      [
        { event_id: 'ev', coach_id: 'pat', covering_for_coach_id: null },
        { event_id: 'ev', coach_id: 'amy', covering_for_coach_id: null },
      ],
      [],
      [{ event_id: 'ev', coach_id: 'amy' }],
    )
    expect(flags[0].reasons).toEqual([{ kind: 'claim_and_assigned_logged', claimantId: 'amy', assignedIds: ['pat'] }])
  })

  it('does not flag a multi-coach session where everyone logging was scheduled', () => {
    expect(
      findDoublePay(
        [entry('1', 'pat'), entry('2', 'amy')],
        [
          { event_id: 'ev', coach_id: 'pat', covering_for_coach_id: null },
          { event_id: 'ev', coach_id: 'amy', covering_for_coach_id: null },
        ],
        [],
        [],
      ),
    ).toEqual([])
  })

  it('ignores entries already marked Canceled / Not Next Step', () => {
    expect(
      findDoublePay(
        [entry('k', 'keith', 'ev', 'pending', 'canceled'), entry('p', 'pat')],
        [{ event_id: 'ev', coach_id: 'pat', covering_for_coach_id: 'keith' }],
        [],
        [],
      ),
    ).toEqual([])
  })
})

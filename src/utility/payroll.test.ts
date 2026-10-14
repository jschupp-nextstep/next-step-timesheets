import { describe, expect, it } from 'vitest'

import { buildRateLookup, computeAmount, type OneVOneRateRow, type RateRow } from './payroll'

const COACHING = 'coaching'
const rates = buildRateLookup([
  { coach_id: 'pat', program_id: 'town', hourly_rate: 60 },
  { coach_id: 'pat', program_id: COACHING, hourly_rate: 50 },
  { coach_id: 'val', program_id: COACHING, hourly_rate: 35 },
] satisfies RateRow[])
const oneVOne = new Map<string, OneVOneRateRow>([['pat', { coach_id: 'pat', session_fee: 75 }]])
const entry = (overrides: Partial<Parameters<typeof computeAmount>[0]>) => ({
  id: 'e',
  coach_id: 'pat',
  program_id: 'town',
  entry_date: '2026-10-12',
  hours: 1.25,
  flat_amount: null,
  programs: { entry_mode: 'session' },
  ...overrides,
})

describe('computeAmount (R8: what gets saved when an entry is paid)', () => {
  it('uses the exact program rate and reports it', () => {
    expect(computeAmount(entry({}), rates, COACHING, oneVOne)).toEqual({ amount: 75, missingRate: false, rate: 60, basis: 'exact' })
  })

  it('falls back to the Coaching rate and says so', () => {
    expect(computeAmount(entry({ coach_id: 'val', hours: 2 }), rates, COACHING, oneVOne)).toEqual({
      amount: 70,
      missingRate: false,
      rate: 35,
      basis: 'coaching_fallback',
    })
  })

  it('pays flat amounts and 1v1 fees with no hourly rate', () => {
    expect(computeAmount(entry({ flat_amount: 107.5 }), rates, COACHING, oneVOne)).toEqual({
      amount: 107.5,
      missingRate: false,
      rate: null,
      basis: 'flat',
    })
    expect(computeAmount(entry({ programs: { entry_mode: 'direct_flat' } }), rates, COACHING, oneVOne)).toEqual({
      amount: 75,
      missingRate: false,
      rate: null,
      basis: 'one_v_one',
    })
  })

  it('never returns a silent $0: no rate, or nothing to pay from, is missing', () => {
    expect(computeAmount(entry({ coach_id: 'nobody' }), rates, COACHING, oneVOne).missingRate).toBe(true)
    expect(computeAmount(entry({ hours: null }), rates, COACHING, oneVOne).missingRate).toBe(true)
  })

  it('rounds to cents', () => {
    expect(computeAmount(entry({ hours: 1.333 }), rates, COACHING, oneVOne).amount).toBe(79.98)
  })
})

describe('rate history (R8: effective dates)', () => {
  // Pat: $50 through 9/30, $60 from 10/1 -- the doc's example.
  const history = buildRateLookup([
    { coach_id: 'pat', program_id: 'town', hourly_rate: 50, effective_from: null, effective_to: '2026-09-30' },
    { coach_id: 'pat', program_id: 'town', hourly_rate: 60, effective_from: '2026-10-01', effective_to: null },
    { coach_id: 'pat', program_id: COACHING, hourly_rate: 40, effective_from: '2026-10-01', effective_to: null, is_active: false },
  ])

  it('prices each entry at the rate in effect on its own date', () => {
    expect(computeAmount(entry({ entry_date: '2026-09-15', hours: 2 }), history, COACHING, oneVOne)).toMatchObject({ amount: 100, rate: 50 })
    expect(computeAmount(entry({ entry_date: '2026-09-30', hours: 2 }), history, COACHING, oneVOne)).toMatchObject({ amount: 100, rate: 50 })
    expect(computeAmount(entry({ entry_date: '2026-10-01', hours: 2 }), history, COACHING, oneVOne)).toMatchObject({ amount: 120, rate: 60 })
  })

  it('ignores inactive rates, so there is no silent fallback through them', () => {
    expect(computeAmount(entry({ program_id: 'futsal', entry_date: '2026-10-05' }), history, COACHING, oneVOne).missingRate).toBe(true)
  })
})

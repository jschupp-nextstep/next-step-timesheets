import { describe, expect, it } from 'vitest'

import { computeAmount, type OneVOneRateRow, type RateRow } from './payroll'

const COACHING = 'coaching'
const rates = new Map<string, RateRow>([
  ['pat|town', { coach_id: 'pat', program_id: 'town', hourly_rate: 60 }],
  ['pat|coaching', { coach_id: 'pat', program_id: COACHING, hourly_rate: 50 }],
  ['val|coaching', { coach_id: 'val', program_id: COACHING, hourly_rate: 35 }],
])
const oneVOne = new Map<string, OneVOneRateRow>([['pat', { coach_id: 'pat', session_fee: 75 }]])
const entry = (overrides: Partial<Parameters<typeof computeAmount>[0]>) => ({
  id: 'e',
  coach_id: 'pat',
  program_id: 'town',
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

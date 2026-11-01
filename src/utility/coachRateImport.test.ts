import { describe, expect, it } from 'vitest'

import { buildImportPlan, parseCoachRates, suggestInitials, type RateRef } from './coachRateImport'

const coaches = [
  { id: 'c1', name: 'Keith Thompson', is_active: true },
  { id: 'c2', name: 'Norley Tabares', is_active: true },
  { id: 'c3', name: 'Hayley Kowalski', is_active: true },
]
const programs = [
  { id: 'p1', name: 'Coaching' },
  { id: 'p2', name: 'Camp-Full Day' },
  { id: 'p3', name: 'Office Hours' },
]
const rates: RateRef[] = [
  { id: 'r1', coach_id: 'c1', program_id: 'p1', hourly_rate: 40, is_active: true, effective_from: null, effective_to: null },
  { id: 'r2', coach_id: 'c1', program_id: 'p3', hourly_rate: 18, is_active: true, effective_from: null, effective_to: null },
  // Ended rate -- not current.
  { id: 'r3', coach_id: 'c2', program_id: 'p1', hourly_rate: 35, is_active: true, effective_from: null, effective_to: '2026-09-30' },
]
const TODAY = '2026-11-01'

describe('parseCoachRates', () => {
  it('reads a pasted sheet with a header row (tab-separated, $ signs)', () => {
    const { rows, errors } = parseCoachRates('Coach Name\tProgram Type\tHourly Rate\nKeith  Thompson\tCoaching\t$40\nTanner Michelson\tCamp-Full Day\t27.5\n')
    expect(errors).toEqual([])
    expect(rows).toEqual([
      expect.objectContaining({ rowNumber: 2, coachName: 'Keith Thompson', programName: 'Coaching', rate: 40 }),
      expect.objectContaining({ rowNumber: 3, coachName: 'Tanner Michelson', rate: 27.5 }),
    ])
  })

  it('reads headerless CSV as name, program, rate', () => {
    const { rows } = parseCoachRates('Keith Thompson,Coaching,40')
    expect(rows[0]).toMatchObject({ rowNumber: 1, coachName: 'Keith Thompson', rate: 40 })
  })

  it('reads the optional new-coach columns and rejects bad values', () => {
    const { rows, errors } = parseCoachRates(
      'Name,Program,Rate,Initials,Email,Pay Type\nPat Doe,Coaching,30,PD,Pat@X.com,W-2\nSam Roe,Coaching,abc,,,\nLee Poe,Coaching,30,,,salary',
    )
    expect(rows).toEqual([expect.objectContaining({ coachName: 'Pat Doe', initials: 'PD', email: 'pat@x.com', payType: 'w2' })])
    expect(errors).toHaveLength(2)
  })
})

describe('suggestInitials', () => {
  it('uses first and last name', () => {
    expect(suggestInitials('Prince Loney-Bailey')).toBe('PL')
    expect(suggestInitials("Alannah O'Connor")).toBe('AO')
    expect(suggestInitials('Hayley')).toBe('H')
  })
})

describe('buildImportPlan', () => {
  const rows = parseCoachRates(
    [
      'Coach Name\tProgram Type\tHourly Rate',
      'Keith Thompson\tCoaching\t40', // unchanged
      'Keith Thompson\tOffice Hours\t20', // changed 18 -> 20
      'Keith Thompson\tCamp-Full Day\t40', // new
      'Norley Tabares\tCoaching\t40', // old rate ended -> new
      'Hayley K\tCamp-Full Day\t35', // unmatched, suggests Hayley Kowalski
      'Tanner Michelson\tCamp-Full Day\t20',
      'Tanner Michelson\tCamp-Full Day\t22', // conflict if Tanner is imported
      'Keith Thompson\tCoaching\t40', // exact duplicate -- fine
      'Keith Thompson\tAP\t30', // unknown program
    ].join('\n'),
  ).rows

  it('sorts rates into new / unchanged / changed and skips unmatched names by default', () => {
    const plan = buildImportPlan(rows, coaches, programs, rates, {}, TODAY)
    const byKey = Object.fromEntries(plan.rates.map((r) => [`${r.coachLabel}|${r.programName}`, r]))
    expect(byKey['Keith Thompson|Coaching']).toMatchObject({ status: 'unchanged', rowNumbers: [2, 9] })
    expect(byKey['Keith Thompson|Office Hours']).toMatchObject({ status: 'changed', rate: 20, current: { id: 'r2' } })
    expect(byKey['Keith Thompson|Camp-Full Day'].status).toBe('new')
    expect(byKey['Norley Tabares|Coaching']).toMatchObject({ status: 'new', startFrom: '2026-10-01' })
    expect(byKey['Keith Thompson|Camp-Full Day'].startFrom).toBeNull()
    expect(plan.unknownPrograms).toEqual([{ name: 'AP', rows: [10] }])
    expect(plan.unmatchedNames.map((u) => [u.name, u.suggestion?.name ?? null])).toEqual([
      ['Hayley K', 'Hayley Kowalski'],
      ['Tanner Michelson', null],
    ])
    // Hayley (1 row) + Tanner (2 rows) skipped; unknown program row too.
    expect(plan.skippedRows).toBe(4)
    expect(plan.conflicts).toEqual([])
  })

  it('maps an unmatched name to an existing coach or a new one, and flags conflicting rates', () => {
    const plan = buildImportPlan(
      rows,
      coaches,
      programs,
      rates,
      { 'hayley k': { kind: 'existing', coachId: 'c3' }, 'tanner michelson': { kind: 'new' } },
      TODAY,
    )
    expect(plan.rates.find((r) => r.coachKey === 'c3')).toMatchObject({ programName: 'Camp-Full Day', rate: 35, status: 'new' })
    expect(plan.newCoaches).toEqual([
      { key: 'new:tanner michelson', name: 'Tanner Michelson', initials: 'TM', email: null, payType: '1099' },
    ])
    expect(plan.conflicts).toEqual([
      { coachName: 'Tanner Michelson', programName: 'Camp-Full Day', rows: [7, 8], rates: [20, 22] },
    ])
  })
})

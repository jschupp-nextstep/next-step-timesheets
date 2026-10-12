import { describe, expect, it } from 'vitest'
import dayjs from 'dayjs'

import {
  isPreCutoverExcluded,
  partitionPendingEntries,
  type CutoverResolution,
  type PayrollRange,
} from './payrollFilters'

const CUTOVER = '2026-10-07'

type TestEntry = {
  id: string
  entry_date: string
  admin_entered: boolean
  cutover_resolution: CutoverResolution | null
}

let nextId = 0
const entry = (entry_date: string, overrides: Partial<TestEntry> = {}): TestEntry => ({
  id: `e${nextId++}`,
  entry_date,
  admin_entered: false,
  cutover_resolution: null,
  ...overrides,
})

const range = (from: string, to: string): PayrollRange => [dayjs(from), dayjs(to)]

describe('cleanup card (preCutover partition)', () => {
  it('never contains an entry dated on or after cutover, whatever its flags', () => {
    const postCutover = ['2026-10-07', '2026-10-08', '2026-11-30'].flatMap((d) => [
      entry(d),
      entry(d, { admin_entered: true }),
      entry(d, { cutover_resolution: 'still_owed' }),
      entry(d, { cutover_resolution: 'paid_in_sheets' }),
    ])
    const ranges = [range('2026-09-01', '2026-10-12'), range('2026-10-07', '2026-10-07'), range('2026-12-01', '2026-12-31')]
    for (const r of ranges) {
      expect(partitionPendingEntries(postCutover, r, CUTOVER).preCutover).toEqual([])
    }
  })

  it('lists coach-entered pre-cutover entries that have no decision yet', () => {
    const undecided = entry('2026-09-15')
    const { preCutover, payable } = partitionPendingEntries([undecided], range('2026-09-01', '2026-10-12'), CUTOVER)
    expect(preCutover).toEqual([undecided])
    expect(payable).toEqual([])
  })

  it('drops an entry once it is resolved as still owed, making it payable when in range', () => {
    const owed = entry('2026-09-15', { cutover_resolution: 'still_owed' })
    const { preCutover, payable } = partitionPendingEntries([owed], range('2026-09-01', '2026-10-12'), CUTOVER)
    expect(preCutover).toEqual([])
    expect(payable).toEqual([owed])
  })

  it('treats admin-entered pre-cutover entries as payable, not as cleanup items', () => {
    const adminEntered = entry('2026-09-15', { admin_entered: true })
    expect(isPreCutoverExcluded(adminEntered, CUTOVER)).toBe(false)
    expect(partitionPendingEntries([adminEntered], range('2026-09-01', '2026-10-12'), CUTOVER).preCutover).toEqual([])
  })

  it('excludes nothing when no cutover is configured', () => {
    expect(isPreCutoverExcluded(entry('2020-01-01'), null)).toBe(false)
  })
})

describe('Mark all paid scope (payable partition)', () => {
  const r = range('2026-10-07', '2026-10-10')
  const before = entry('2026-10-06', { admin_entered: true })
  const firstDay = entry('2026-10-07')
  const lastDay = entry('2026-10-10')
  const after = entry('2026-10-11')
  const preCutover = entry('2026-09-20')
  const result = partitionPendingEntries([before, firstDay, lastDay, after, preCutover], r, CUTOVER)

  it('includes only entries inside the selected range, boundaries inclusive', () => {
    expect(result.payable.map((e) => e.id)).toEqual([firstDay.id, lastDay.id])
  })

  it('reports entries outside the range separately instead of dropping them', () => {
    expect(result.beforeRange).toEqual([before])
    expect(result.afterRange).toEqual([after])
    expect(result.preCutover).toEqual([preCutover])
  })

  it('puts every entry in exactly one bucket', () => {
    const all = [...result.payable, ...result.beforeRange, ...result.afterRange, ...result.preCutover]
    expect(all).toHaveLength(5)
    expect(new Set(all.map((e) => e.id)).size).toBe(5)
  })
})

describe('payroll hold (held partition)', () => {
  const r = range('2026-10-07', '2026-10-20')
  const onChanged = { ...entry('2026-10-09'), event_id: 'changed' }
  const onChangedAdmin = { ...entry('2026-10-10', { admin_entered: true }), event_id: 'changed' }
  const onOther = { ...entry('2026-10-09'), event_id: 'other' }
  const offCalendar = { ...entry('2026-10-09'), event_id: null }
  const changedButAfter = { ...entry('2026-10-25'), event_id: 'changed' }
  const held = new Set(['changed'])
  const result = partitionPendingEntries([onChanged, onChangedAdmin, onOther, offCalendar, changedButAfter], r, CUTOVER, held)

  it('holds every in-range entry on an event with an unreviewed change, admin-entered or not', () => {
    expect(result.held.map((e) => e.id)).toEqual([onChanged.id, onChangedAdmin.id])
  })

  it('never lets a held entry into the payable bucket ("Mark all paid" scope)', () => {
    const payableIds = new Set(result.payable.map((e) => e.id))
    for (const e of result.held) expect(payableIds.has(e.id)).toBe(false)
    expect(result.payable.map((e) => e.id)).toEqual([onOther.id, offCalendar.id])
  })

  it('leaves out-of-range entries in their range buckets even if their event is held', () => {
    expect(result.afterRange).toEqual([changedButAfter])
  })

  it('holds nothing once the change is reviewed (event no longer in the held set)', () => {
    const reviewed = partitionPendingEntries([onChanged, onChangedAdmin], r, CUTOVER, new Set())
    expect(reviewed.held).toEqual([])
    expect(reviewed.payable).toHaveLength(2)
  })
})

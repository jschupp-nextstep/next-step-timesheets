import { describe, expect, it } from 'vitest'

import { differingFields, findSprocketChanges, mergedRows, normalizeField, type StoredRow } from './sprocketCompare'

const base = {
  ClubCalendarEventID: '100',
  StartDate: '1/9/2027',
  StartDateTime: '06:30 PM',
  EndDateTime: '07:30 PM',
  IsCancelled: 'No',
  LocationID: '70435',
  Notes: 'Coaches: Max Smith',
  Title: 'Futsal',
}
const stored = (id: string, event_id: string, row: Record<string, string>, state = 'linked'): StoredRow => ({
  id: `row-${id}`,
  event_id,
  club_calendar_event_id: id,
  state,
  sprocket_row: row,
})

describe('normalizeField', () => {
  it('treats the same date, time and yes/no written differently as equal', () => {
    expect(normalizeField('StartDate', '01/09/2027')).toBe(normalizeField('StartDate', '1/9/2027'))
    expect(normalizeField('StartDateTime', '6:30 PM')).toBe(normalizeField('StartDateTime', '06:30 PM'))
    expect(normalizeField('IsCancelled', 'YES')).toBe('yes')
  })
})

describe('findSprocketChanges', () => {
  const owned = new Set(['ev1'])

  it('finds a time changed in Sprocket and names the fields', () => {
    const file = [{ ...base, StartDateTime: '07:00 PM', EndDateTime: '08:00 PM' }]
    const r = findSprocketChanges(file, [stored('100', 'ev1', base)], owned)
    expect(r.changes).toHaveLength(1)
    expect(r.changes[0].rows[0].fields).toEqual(['start', 'end'])
  })

  it('ignores formatting-only differences', () => {
    const file = [{ ...base, StartDate: '01/09/2027', StartDateTime: '6:30 PM', IsCancelled: 'no' }]
    const r = findSprocketChanges(file, [stored('100', 'ev1', base)], owned)
    expect(r.changes).toHaveLength(0)
    expect(r.same).toBe(1)
  })

  it('leaves out sessions the app does not own and rows it has not linked', () => {
    const file = [{ ...base, Notes: 'Coaches: Someone Else' }]
    expect(findSprocketChanges(file, [stored('100', 'ev2', base)], owned).changes).toHaveLength(0)
    expect(findSprocketChanges(file, [stored('100', 'ev1', base, 'new')], owned).changes).toHaveLength(0)
  })

  it('counts the app’s own upload that is not marked uploaded yet, not as an edit', () => {
    const sent = { ...base, StartDateTime: '07:00 PM' }
    const r = findSprocketChanges([sent], [stored('100', 'ev1', base)], owned, new Map([['100', [sent]]]))
    expect(r.changes).toHaveLength(0)
    expect(r.awaitingUpload).toBe(1)
  })

  it('groups an AP session’s rows into one change', () => {
    const a = { ...base, ClubCalendarEventID: '1' }
    const b = { ...base, ClubCalendarEventID: '2' }
    const file = [{ ...a, IsCancelled: 'Yes' }, { ...b, IsCancelled: 'Yes' }]
    const r = findSprocketChanges(file, [stored('1', 'ev1', a), stored('2', 'ev1', b)], owned)
    expect(r.changes).toHaveLength(1)
    expect(r.changes[0].rows.map((x) => x.fields)).toEqual([['cancelled'], ['cancelled']])
  })
})

describe('differingFields / mergedRows', () => {
  it('reports coaches when Notes differ', () => {
    expect(differingFields(base, { ...base, Notes: 'Coaches: Max Smith/Jo Lee' })).toEqual(['coaches'])
  })

  it('keeps rows that are not in the file', () => {
    const a = { ...base, ClubCalendarEventID: '1' }
    const b = { ...base, ClubCalendarEventID: '2' }
    const changedA = { ...a, StartDateTime: '07:00 PM' }
    const m = mergedRows([stored('1', 'ev1', a), stored('2', 'ev1', b)], 'ev1', [changedA])
    expect(m.ids).toEqual(['1', '2'])
    expect(m.rows).toEqual([changedA, b])
  })
})

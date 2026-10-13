import { describe, expect, it } from 'vitest'

import { parseBulkImportCsv } from './parseBulkImportCsv'

const header = 'Program,Location,Date,Start Time,End Time,Session Name,Coaches,Arrival Time'

describe('bulk import Arrival Time (R3)', () => {
  it('turns an arrival time into minutes paid before the start', () => {
    const { events, errors } = parseBulkImportCsv(`${header}\nTown Session,Natick - Elm Bank,2026-10-17,10:00,11:00,U10 vs Wayland,TEST COACH,09:30`)
    expect(errors).toEqual([])
    expect(events[0].paidEarlyMinutes).toBe(30)
  })

  it('leaves it empty when the column is blank or absent', () => {
    expect(parseBulkImportCsv(`${header}\nTown Session,Natick - Elm Bank,2026-10-17,10:00,11:00,,,`).events[0].paidEarlyMinutes).toBeNull()
    expect(
      parseBulkImportCsv('Program,Location,Date,Start Time,End Time,Session Name,Coaches\nTown Session,Natick - Elm Bank,2026-10-17,10:00,11:00,,').events[0]
        .paidEarlyMinutes,
    ).toBeNull()
  })

  it('rejects an arrival at or after the start rather than guessing', () => {
    const { events, errors } = parseBulkImportCsv(`${header}\nTown Session,Natick - Elm Bank,2026-10-17,10:00,11:00,,,10:15`)
    expect(events).toEqual([])
    expect(errors[0]).toMatch(/Arrival Time/)
  })
})

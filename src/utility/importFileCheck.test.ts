import { describe, expect, it } from 'vitest'

import { checkImportFile } from './importFileCheck'

const sprocketHeader = 'ClubID,ClubName,Title,StartDate,StartDateTime,ClubEventType,ClubCalendarEventID\n1,a,b'
const bulkHeader = 'Program,Location,Date,Start Time,End Time,Session Name,Coaches\nx'

describe('checkImportFile', () => {
  it('refuses a Numbers file', () => {
    expect(checkImportFile('calendar-export (1).numbers', 'PK...', 'sprocket')).toMatch(/isn't a CSV/)
  })
  it('sends a Sprocket export dropped on Bulk Import to Import Calendar', () => {
    expect(checkImportFile('calendar-export.csv', sprocketHeader, 'bulk')).toMatch(/Import Calendar/)
  })
  it('sends a bulk file dropped on Import Calendar to Bulk Import', () => {
    expect(checkImportFile('fall.csv', bulkHeader, 'sprocket')).toMatch(/Bulk Import Events/)
  })
  it('accepts each file on its own importer', () => {
    expect(checkImportFile('calendar-export.csv', sprocketHeader, 'sprocket')).toBeNull()
    expect(checkImportFile('fall.csv', bulkHeader, 'bulk')).toBeNull()
  })
})

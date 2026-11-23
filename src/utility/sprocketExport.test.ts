import Papa from 'papaparse'
import { describe, expect, it } from 'vitest'

import { parseCoachNames, parseSprocketCsv } from './parseSprocketCsv'
import { buildChangedRows, buildNewRows, coachesNote, deleteRow, SPROCKET_COLUMNS, type ExportSession } from './sprocketExport'

const apTeams = [
  { id: 'r1', sprocket_team_id: '73441', name: 'Annual Program- Jr. Academy' },
  { id: 'r2', sprocket_team_id: '73601', name: 'Annual Program- Older AP Players' },
].map((t) => ({
  id: t.id,
  state: 'new' as const,
  club_calendar_event_id: null,
  sprocket_team_id: t.sprocket_team_id,
  team: { name: t.name, sprocket_program_id: '14796', programName: '2025-26 Annual Program' },
}))

const base: ExportSession = {
  id: 'e1',
  event_date: '2027-01-09',
  start_time: '19:00:00',
  end_time: '20:00:00',
  session_name: 'Annual Program',
  is_cancelled: false,
  event_type: 'practice',
  opponent: null,
  away_game: false,
  uniform: null,
  is_private: false,
  arrival_minutes: 15,
  programName: 'Annual Program',
  location: { name: 'AP Franklin - Downtown Sports', sprocket_location_id: '34507' },
  field: null,
  coachNames: ['Taron Mills', 'Keith Thompson'],
  rows: apTeams,
}

describe('buildNewRows', () => {
  it('writes one row per team in Sprocket’s layout, coaches in Notes', () => {
    const rsvp = new Map([['73441', { CollectRSVP: 'Yes', CollectStaffRSVP: 'Yes' }]])
    const { csvRows, rowIds, problems } = buildNewRows([base], rsvp)
    expect(problems).toEqual([])
    expect(rowIds).toEqual(['r1', 'r2'])
    expect(Object.keys(csvRows[0])).toHaveLength(SPROCKET_COLUMNS.length)
    expect(csvRows[0]).toMatchObject({
      ClubID: '371',
      Title: 'Annual Program',
      StartDate: '1/9/2027',
      StartDateTime: '07:00 PM',
      EndDateTime: '08:00 PM',
      ArrivalTime: '06:45 PM',
      LocationID: '34507',
      ProgramID: '14796',
      ProgramName: '2025-26 Annual Program',
      ClubEventType: 'Practice',
      TeamID: '73441',
      TeamName: 'Annual Program- Jr. Academy',
      CollectStaffRSVP: 'Yes',
      ClubCalendarEventID: '',
      Notes: 'Coaches: Keith Thompson/Taron Mills',
      TimeZoneID: '7',
    })
    expect(csvRows[1].CollectStaffRSVP).toBe('No') // no template for that team -> default
  })

  it('writes a Club session as one row with no program or team', () => {
    const club: ExportSession = {
      ...base,
      event_type: 'club',
      session_name: 'Futsal Session',
      arrival_minutes: null,
      coachNames: [],
      rows: [{ id: 'c1', state: 'new', club_calendar_event_id: null, sprocket_team_id: null, team: null }],
    }
    const { csvRows } = buildNewRows([club], new Map())
    expect(csvRows).toHaveLength(1)
    expect(csvRows[0]).toMatchObject({ ClubEventType: 'Club', ProgramID: '', TeamID: '', TeamName: '', ArrivalTime: '', Notes: '' })
  })

  it('leaves a game untitled (Sprocket names it) and carries opponent and away', () => {
    const game: ExportSession = { ...base, event_type: 'game', opponent: 'Wellesley', away_game: true, session_name: null }
    const { csvRows } = buildNewRows([game], new Map())
    expect(csvRows[0]).toMatchObject({ Title: '', Opponent: 'Wellesley', AwayGame: 'Yes', ClubEventType: 'Game' })
  })

  it('lists sessions it can’t export and skips them whole', () => {
    const noLoc = { ...base, id: 'e2', location: { name: 'Sluggers Academy', sprocket_location_id: null } }
    const noTeams = { ...base, id: 'e3', rows: [] }
    const noTime = { ...base, id: 'e4', start_time: null, end_time: null }
    const { csvRows, problems } = buildNewRows([noLoc, noTeams, noTime], new Map())
    expect(csvRows).toEqual([])
    expect(problems.map((p) => [p.sessionId, p.reason.split(' ')[0]])).toEqual([
      ['e4', 'No'],
      ['e2', 'Sluggers'],
      ['e3', 'No'],
    ])
  })

  it('skips rows already in Sprocket and new rows on cancelled sessions', () => {
    const linked = { ...base, id: 'e5', rows: apTeams.map((r) => ({ ...r, state: 'linked' as const, club_calendar_event_id: '1' })) }
    const cancelled = { ...base, id: 'e6', is_cancelled: true }
    const r = buildNewRows([linked, cancelled], new Map())
    expect(r.csvRows).toEqual([])
    expect(r.alreadyInSprocket).toBe(2)
    expect(r.cancelledSkipped).toBe(1)
    expect(r.problems).toEqual([])
  })

  it('round-trips through the importer: same date, times, team, coaches', () => {
    const { csvRows } = buildNewRows([base], new Map())
    const csv = Papa.unparse({ fields: [...SPROCKET_COLUMNS], data: csvRows.map((r) => SPROCKET_COLUMNS.map((c) => r[c])) })
    const { events } = parseSprocketCsv(csv, { combineProgramIds: new Set(['14796']) })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      eventDate: '2027-01-09',
      startTime: '19:00:00',
      endTime: '20:00:00',
      sessionName: 'Annual Program',
      assignedCoachNames: ['Keith Thompson', 'Taron Mills'],
    })
    expect(events[0].rows).toHaveLength(2)
  })
})

describe('coachesNote', () => {
  it('reads back with parseCoachNames', () => {
    expect(parseCoachNames(coachesNote(['Max Smith', 'Taron Mills']))).toEqual(['Max Smith', 'Taron Mills'])
    expect(coachesNote([])).toBe('')
  })
})

describe('buildChangedRows (step 5)', () => {
  // Fall's first row as Sprocket has it: Final Third Clinic, Keith in Notes.
  const stored = {
    ClubID: '371', ClubName: 'Next Step Training', Title: 'Final Third Clinic — Keith', StartDate: '10/19/2026',
    StartDateTime: '04:00 PM', EndDate: '10/19/2026', EndDateTime: '05:00 PM', ShowTime: 'Yes', IsPrivate: 'No',
    IsCancelled: 'No', ArrivalTime: '03:45 PM', AwayGame: 'No', LocationID: '34517', LocationName: 'Dover Sherborn - Laurel Fields',
    ProgramID: '29173', ProgramName: 'DSSC 2026-2027', ClubEventType: 'Practice', TeamID: '140275', TeamName: 'Final Third Clinic',
    TimeZoneID: '7', ClubCalendarEventID: '3740907', Notes: 'Keith', SavedBy: 'Schupp, Justin', SavedOn: '10/6/2026 12:36:08 PM', Draft: 'No',
  }
  const imported: ExportSession = {
    ...base,
    id: 'f1',
    event_date: '2026-10-19',
    start_time: '16:00:00',
    end_time: '17:00:00',
    session_name: 'Final Third Clinic',
    programName: 'Town Session',
    arrival_minutes: 15,
    location: { name: 'Dover Sherborn - Laurel Fields', sprocket_location_id: '34517' },
    coachNames: ['Keith Thompson'],
    coachIds: ['keith'],
    snapshotCoachIds: ['keith'],
    appManaged: false,
    rows: [{ id: 'x1', state: 'linked', club_calendar_event_id: '3740907', sprocket_team_id: '140275', team: { name: 'Final Third Clinic', sprocket_program_id: '29173', programName: 'DSSC 2026-2027' }, sprocketRow: stored }],
  }

  it('sends nothing for an imported session nobody changed (keeps Sprocket’s title and notes)', () => {
    const r = buildChangedRows([imported], '2026-10-01')
    expect(r.csvRows).toEqual([])
    expect(r.unchanged).toBe(1)
  })

  it('leaves sessions Sprocket still schedules alone before the switch', () => {
    const moved = { ...imported, start_time: '16:30:00' }
    const r = buildChangedRows([moved], null)
    expect(r.csvRows).toEqual([])
    expect(r.notYours).toBe(1)
  })

  it('sends a time change by ID with Sprocket’s own title and notes kept', () => {
    const moved = { ...imported, start_time: '16:30:00', end_time: '17:30:00' }
    const r = buildChangedRows([moved], '2026-10-01')
    expect(r.changes[0].fields).toEqual(['start', 'end', 'arrival'])
    expect(r.csvRows[0]).toMatchObject({
      ClubCalendarEventID: '3740907',
      StartDateTime: '04:30 PM',
      EndDateTime: '05:30 PM',
      ArrivalTime: '04:15 PM',
      Title: 'Final Third Clinic — Keith',
      Notes: 'Keith',
      TeamID: '140275',
      SavedBy: '',
      DeleteEvent: '',
    })
  })

  it('rewrites Notes when the coaches changed here (a sub)', () => {
    const subbed = { ...imported, coachIds: ['taron'], coachNames: ['Taron Mills'] }
    const r = buildChangedRows([subbed], '2026-10-01')
    expect(r.changes[0].fields).toEqual(['coaches'])
    expect(r.csvRows[0].Notes).toBe('Coaches: Taron Mills')
  })

  it('sends a cancellation as IsCancelled=Yes', () => {
    const r = buildChangedRows([{ ...imported, is_cancelled: true }], '2026-10-01')
    expect(r.changes[0].fields).toEqual(['cancelled'])
    expect(r.csvRows[0].IsCancelled).toBe('Yes')
  })

  it('owns title and notes on a session made here, before the switch too', () => {
    const uploaded = { ...stored, Title: 'Annual Program', Notes: 'Coaches: Keith Thompson' }
    const mine: ExportSession = {
      ...imported,
      appManaged: true,
      session_name: 'Annual Program',
      snapshotCoachIds: null,
      rows: [{ ...imported.rows[0], sprocketRow: uploaded }],
    }
    expect(buildChangedRows([mine], null).csvRows).toEqual([])
    const renamed = buildChangedRows([{ ...mine, session_name: 'AP Practice' }], null)
    expect(renamed.changes[0].fields).toEqual(['title'])
  })

  it('keeps Sprocket’s location when the app has the session at Location TBD', () => {
    const tbd = { ...imported, location: { name: 'Location TBD', sprocket_location_id: null } }
    expect(buildChangedRows([tbd], '2026-10-01').csvRows).toEqual([])
  })
})

describe('buildNewRows holds rows already in an open export file (step 6)', () => {
  it('leaves out held rows and lists the session', () => {
    const r = buildNewRows([base], new Map(), undefined, new Map([['r1', 'uploaded' as const]]))
    expect(r.rowIds).toEqual(['r2'])
    expect(r.held).toEqual([{ sessionId: 'e1', label: expect.any(String), status: 'uploaded' }])
  })
  it('sends nothing for a session whose rows are all held, without calling it a problem', () => {
    const r = buildNewRows([base], new Map(), undefined, new Map([['r1', 'waiting' as const], ['r2', 'uploaded' as const]]))
    expect(r.csvRows).toEqual([])
    expect(r.problems).toEqual([])
    expect(r.held[0].status).toBe('waiting')
  })
})

describe('deleteRow (step 7)', () => {
  it('sends Sprocket’s own row with DeleteEvent=Yes and its ID', () => {
    const row = deleteRow({
      id: 'd1',
      club_calendar_event_id: '3740907',
      label: 'x',
      sprocket_row: { Title: 'Final Third Clinic', StartDate: '10/19/2026', TeamID: '140275', SavedBy: 'Schupp, Justin', DeleteEvent: '' },
    })
    expect(Object.keys(row)).toHaveLength(SPROCKET_COLUMNS.length)
    expect(row).toMatchObject({ ClubCalendarEventID: '3740907', DeleteEvent: 'Yes', Title: 'Final Third Clinic', TeamID: '140275', SavedBy: '', ClubID: '371' })
  })
})

import dayjs from 'dayjs'

// Phase 9 step 3: write app sessions as rows Sprocket's calendar import
// reads. The import layout is the export's own 40 columns (Sprocket's
// template: "populated via the schedule download"), in this order.
export const SPROCKET_COLUMNS = [
  'ClubID',
  'ClubName',
  'Title',
  'ShortDescription',
  'Event Tag',
  'StartDate',
  'StartDateTime',
  'EndDate',
  'EndDateTime',
  'ShowTime',
  'ShowTimeTBD',
  'IsPrivate',
  'IsCancelled',
  'IsAllDayEvent',
  'ArrivalTime',
  'AwayGame',
  'DeleteEvent',
  'LocationID',
  'LocationName',
  'ProgramID',
  'ProgramName',
  'Opponent',
  'Uniform',
  'ClubEventType',
  'TeamID',
  'TeamName',
  'TimeZoneID',
  'CollectRSVP',
  'CollectStaffRSVP',
  'ClubCalendarEventID',
  'NotifyUsers',
  'Notes',
  'FieldID',
  'FieldIDs',
  'FieldName',
  'FieldNames',
  'IsStaffEvent',
  'SavedBy',
  'SavedOn',
  'Draft',
] as const

export type SprocketCsvRow = Record<(typeof SPROCKET_COLUMNS)[number], string>

// Same on every row of every export seen (July, fall, winter).
const CLUB = { ClubID: '371', ClubName: 'Next Step Training', TimeZoneID: '7' }

export type ExportRowRef = {
  id: string
  state: 'new' | 'linked' | 'delete_pending' | 'deleted'
  club_calendar_event_id: string | null
  sprocket_team_id: string | null
  team: { name: string; sprocket_program_id: string | null; programName: string | null } | null
}

export type ExportSession = {
  id: string
  event_date: string
  start_time: string | null
  end_time: string | null
  session_name: string | null
  is_cancelled: boolean
  event_type: 'practice' | 'game' | 'club' | 'other' | null
  opponent: string | null
  away_game: boolean
  uniform: string | null
  is_private: boolean
  arrival_minutes: number | null
  programName: string
  location: { name: string; sprocket_location_id: string | null }
  field: { name: string; sprocket_field_id: string | null } | null
  coachNames: string[]
  rows: ExportRowRef[]
}

// RSVP settings aren't kept on sessions here; they're copied from the team's
// own rows in Sprocket (DSSC collects staff RSVPs, AP doesn't), else Club
// rows' settings, else Sprocket's usual Yes/No.
export type RsvpTemplate = { CollectRSVP: string; CollectStaffRSVP: string }
export const DEFAULT_RSVP: RsvpTemplate = { CollectRSVP: 'Yes', CollectStaffRSVP: 'No' }

export type ExportProblem = { sessionId: string; label: string; reason: string }

export type ExportResult = {
  csvRows: SprocketCsvRow[]
  // event_sprocket_rows ids, parallel to csvRows.
  rowIds: string[]
  problems: ExportProblem[]
  cancelledSkipped: number
  alreadyInSprocket: number
}

const yesNo = (v: boolean) => (v ? 'Yes' : 'No')
const sprocketDate = (d: string) => dayjs(d).format('M/D/YYYY')
const sprocketTime = (t: string) => dayjs(`2000-01-01T${t}`).format('hh:mm A')
const TYPE_LABEL = { practice: 'Practice', game: 'Game', club: 'Club', other: 'Other' } as const

// "Coaches: Max Smith/Taron Mills" -- the importer reads it back
// (parseCoachNames strips the "Coaches:" label).
export const coachesNote = (names: string[]) => (names.length ? `Coaches: ${[...names].sort().join('/')}` : '')

export const sessionLabel = (s: Pick<ExportSession, 'event_date' | 'start_time' | 'session_name' | 'programName' | 'location'>) =>
  `${dayjs(s.event_date).format('ddd M/D')}${s.start_time ? ' ' + dayjs(`2000-01-01T${s.start_time}`).format('h:mm A') : ''} · ${
    s.session_name || s.programName
  } · ${s.location.name}`

// Rows for sessions not yet in Sprocket (state 'new'). Each session is all or
// nothing: one with a problem contributes no rows, and is listed instead.
export function buildNewRows(
  sessions: ExportSession[],
  rsvpByTeam: Map<string, RsvpTemplate>,
  clubRsvp: RsvpTemplate = DEFAULT_RSVP,
): ExportResult {
  const result: ExportResult = { csvRows: [], rowIds: [], problems: [], cancelledSkipped: 0, alreadyInSprocket: 0 }

  for (const s of [...sessions].sort((a, b) => (a.event_date + (a.start_time ?? '')).localeCompare(b.event_date + (b.start_time ?? '')))) {
    const newRows = s.rows.filter((r) => r.state === 'new')
    result.alreadyInSprocket += s.rows.filter((r) => r.state !== 'new').length
    if (newRows.length === 0) {
      if (s.rows.length === 0) {
        result.problems.push({
          sessionId: s.id,
          label: sessionLabel(s),
          reason:
            s.event_type === 'club'
              ? 'No Club row -- open it on Edit Event and save it as type Club again'
              : 'No Sprocket teams -- add them on the session (or set the program’s default teams)',
        })
      }
      continue
    }
    // Never in Sprocket and already cancelled: nothing to send.
    if (s.is_cancelled) {
      result.cancelledSkipped += 1
      continue
    }

    const reasons: string[] = []
    if (!s.location.sprocket_location_id) reasons.push(`${s.location.name} has no Sprocket location ID (set it on Sprocket Mappings)`)
    if (!s.start_time || !s.end_time) reasons.push('No start/end time')
    if (s.field && !s.field.sprocket_field_id) reasons.push(`Field ${s.field.name} has no Sprocket ID`)
    const isClub = s.event_type === 'club'
    for (const r of newRows) {
      if (isClub) continue
      if (!r.sprocket_team_id || !r.team) reasons.push('A team row has no Sprocket team')
      else if (!r.team.sprocket_program_id) reasons.push(`Team ${r.team.name} has no Sprocket program`)
    }
    if (isClub && newRows.some((r) => r.sprocket_team_id)) reasons.push('A Club session has a team row')
    if (reasons.length) {
      result.problems.push({ sessionId: s.id, label: sessionLabel(s), reason: [...new Set(reasons)].join('; ') })
      continue
    }

    const start = s.start_time!
    const arrival =
      s.arrival_minutes != null ? sprocketTime(dayjs(`2000-01-01T${start}`).subtract(s.arrival_minutes, 'minute').format('HH:mm:ss')) : ''
    const type = s.event_type ?? 'practice'
    const isGame = type === 'game'
    // Sprocket titles a game itself ("Team vs Opponent") when Title is blank.
    const title = isGame ? '' : s.session_name || s.programName

    for (const r of newRows) {
      const rsvp = isClub ? clubRsvp : (rsvpByTeam.get(r.sprocket_team_id!) ?? DEFAULT_RSVP)
      result.csvRows.push({
        ...CLUB,
        Title: title,
        ShortDescription: '',
        'Event Tag': '',
        StartDate: sprocketDate(s.event_date),
        StartDateTime: sprocketTime(start),
        EndDate: sprocketDate(s.event_date),
        EndDateTime: sprocketTime(s.end_time!),
        ShowTime: 'Yes',
        ShowTimeTBD: 'No',
        IsPrivate: yesNo(s.is_private),
        IsCancelled: 'No',
        IsAllDayEvent: 'No',
        ArrivalTime: arrival,
        AwayGame: yesNo(isGame && s.away_game),
        DeleteEvent: '',
        LocationID: s.location.sprocket_location_id!,
        LocationName: s.location.name,
        ProgramID: isClub ? '' : r.team!.sprocket_program_id!,
        ProgramName: isClub ? '' : (r.team!.programName ?? ''),
        Opponent: isGame ? (s.opponent ?? '') : '',
        Uniform: s.uniform ?? '',
        ClubEventType: TYPE_LABEL[type],
        TeamID: isClub ? '' : r.sprocket_team_id!,
        TeamName: isClub ? '' : r.team!.name,
        CollectRSVP: rsvp.CollectRSVP,
        CollectStaffRSVP: rsvp.CollectStaffRSVP,
        ClubCalendarEventID: '',
        NotifyUsers: '',
        Notes: coachesNote(s.coachNames),
        FieldID: s.field?.sprocket_field_id ?? '',
        FieldIDs: s.field?.sprocket_field_id ?? '',
        FieldName: s.field?.name ?? '',
        FieldNames: s.field?.name ?? '',
        IsStaffEvent: 'No',
        SavedBy: '',
        SavedOn: '',
        Draft: 'No',
      })
      result.rowIds.push(r.id)
    }
  }
  return result
}

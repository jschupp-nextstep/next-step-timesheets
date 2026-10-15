import Papa from 'papaparse'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'

dayjs.extend(customParseFormat)

export type SprocketRow = {
  Title: string
  StartDate: string
  StartDateTime: string
  EndDateTime: string
  LocationName: string
  ProgramName: string
  TeamName: string
  IsCancelled: string
  ArrivalTime?: string
  ClubEventType?: string
  Notes?: string
  Opponent?: string
  AwayGame?: string
  ClubCalendarEventID?: string
}

export type ParsedEvent = {
  key: string
  title: string
  programName: string
  locationName: string
  eventDate: string
  startTime: string | null
  endTime: string | null
  sessionName: string
  isCancelled: boolean
  assignedCoachNames: string[]
  // Minutes before start a coach is paid from (R3). Set only for games:
  // Sprocket fills ArrivalTime on nearly every row (5 min before camps,
  // 10-15 before AP practices), so it's only a warm-up signal on Game rows.
  // AP's early start comes from the program rule instead.
  paidEarlyMinutes: number | null
  // Sprocket's own row IDs (ClubCalendarEventID) -- the re-import match key.
  // Several for a Camp event (one row per staff member).
  sprocketIds: string[]
  // The raw rows, kept on the event for exporting changes back to Sprocket.
  rows: Record<string, string>[]
  teamName: string
  // No coach named anywhere on the row (Notes or title) -- the importer's
  // per-team default coach applies. Never set for Camp rows.
  needsTeamCoach: boolean
}

// Rows not turned into events, listed on the import screen.
export type SkippedRow = { title: string; eventDate: string; type: string; reason: string }

export type ParseResult = {
  events: ParsedEvent[]
  errors: string[]
  skipped: SkippedRow[]
}

export type LocationBlock = {
  key: string
  locationName: string
  label: string
  dates: string[]
  isCampProgram: boolean
}

export type LocationBlockResolution = {
  blocks: LocationBlock[]
  keyForEvent: (locationName: string, eventDate: string) => string
}

// A single Sprocket location name (e.g. "Ridgefield Academy") can host
// several unrelated camp weeks over a summer, each of which is a distinct
// location in our system (dated location names carried over from the
// historical import, e.g. "Ridgefield Academy - June 29- July 2"). Group
// each location name's dates into contiguous blocks (allowing a short gap,
// since a camp week isn't always daily) so each block can be mapped
// independently instead of forcing one mapping for the whole location name.
const BLOCK_GAP_TOLERANCE_DAYS = 3

function formatDateLabel(isoDate: string): string {
  return dayjs(isoDate).format('MMM D')
}

// Some Sprocket rows (e.g. remote "Video Analysis" sessions) legitimately
// carry no location at all -- rather than silently dropping them, group them
// under a single placeholder name so they still show up for manual mapping
// like any other unresolved location. Used consistently for both building
// and looking up blocks, so a blank locationName still resolves correctly.
function normalizeLocationName(locationName: string): string {
  return locationName || '(no location on Sprocket)'
}

// Blank-location rows get a placeholder per town -- the part of the team name
// before " - " ("Quincy - B6.2" -> Quincy), else the whole team name -- so
// each town maps to its own location instead of every blank row sharing one
// "(no location)" bucket, without one row per team (13 Quincy teams).
export const blankLocationLabel = (teamOrTitle: string) =>
  `(no location on Sprocket) · ${teamOrTitle.split(' - ')[0].trim() || teamOrTitle}`

export function groupEventsByLocationBlock(events: ParsedEvent[]): LocationBlockResolution {
  // Camp dates and non-Camp dates are tracked separately per location, since
  // only Camp locations need date-range splitting at all (our system ties
  // specific hours to a specific camp week). A Regular location (Annual
  // Program, Futsal, etc.) is just a reusable physical site -- one location
  // record covers every date it's used, so those dates always collapse into
  // a single block regardless of gaps.
  const campDatesByLocation = new Map<string, Set<string>>()
  const regularDatesByLocation = new Map<string, Set<string>>()
  for (const event of events) {
    const locationName = normalizeLocationName(event.locationName)
    const target = event.programName === 'Camps' ? campDatesByLocation : regularDatesByLocation
    if (!target.has(locationName)) target.set(locationName, new Set())
    target.get(locationName)?.add(event.eventDate)
  }

  const blocks: LocationBlock[] = []
  const blockKeyByLocationDate = new Map<string, string>()

  const addBlock = (locationName: string, blockIndex: number, dates: string[], isCampProgram: boolean) => {
    const key = `${locationName}::${isCampProgram ? 'camp' : 'regular'}::${blockIndex}`
    const first = dates[0]
    const last = dates[dates.length - 1]
    const label =
      first === last
        ? `${locationName} (${formatDateLabel(first)})`
        : `${locationName} (${formatDateLabel(first)} – ${formatDateLabel(last)})`
    blocks.push({ key, locationName, label, dates, isCampProgram })
    for (const date of dates) {
      blockKeyByLocationDate.set(`${locationName}|${date}`, key)
    }
  }

  for (const [locationName, dateSet] of campDatesByLocation) {
    const sortedDates = Array.from(dateSet).sort()
    let currentBlockDates: string[] = []
    let blockIndex = 0

    const flush = () => {
      if (currentBlockDates.length === 0) return
      addBlock(locationName, blockIndex, [...currentBlockDates], true)
      blockIndex += 1
      currentBlockDates = []
    }

    for (const date of sortedDates) {
      if (currentBlockDates.length === 0) {
        currentBlockDates.push(date)
        continue
      }
      const gap = dayjs(date).diff(dayjs(currentBlockDates[currentBlockDates.length - 1]), 'day')
      if (gap <= BLOCK_GAP_TOLERANCE_DAYS) {
        currentBlockDates.push(date)
      } else {
        flush()
        currentBlockDates.push(date)
      }
    }
    flush()
  }

  for (const [locationName, dateSet] of regularDatesByLocation) {
    addBlock(locationName, 0, Array.from(dateSet).sort(), false)
  }

  return {
    blocks,
    keyForEvent: (locationName, eventDate) =>
      blockKeyByLocationDate.get(`${normalizeLocationName(locationName)}|${eventDate}`) ?? '',
  }
}

// There's no single "Camp" program in our system -- a coach's rate depends
// on whether the specific session they worked was a half day or full day.
// Since a location stores both possible hour values, the event's own
// start/end span tells us which one actually applies: pick whichever of the
// location's two configured values it's closer to.
export function resolveCampDayType(
  startTime: string | null,
  endTime: string | null,
  location: { half_day_hours: number | null; full_day_hours: number | null },
): 'half' | 'full' | null {
  if (!startTime || !endTime) return null
  if (location.half_day_hours == null && location.full_day_hours == null) return null

  const start = dayjs(`2000-01-01T${startTime}`)
  const end = dayjs(`2000-01-01T${endTime}`)
  if (!start.isValid() || !end.isValid()) return null
  const workedHours = end.diff(start, 'minute') / 60

  const halfDiff = location.half_day_hours != null ? Math.abs(workedHours - location.half_day_hours) : Infinity
  const fullDiff = location.full_day_hours != null ? Math.abs(workedHours - location.full_day_hours) : Infinity
  if (halfDiff === Infinity && fullDiff === Infinity) return null
  return halfDiff <= fullDiff ? 'half' : 'full'
}

// Sprocket encodes a Camp session's staff role directly in the Title suffix.
// Rows sharing a title/time/location but differing only by this suffix are
// the same physical event, one row per assigned staff member.
const CAMP_ROLE_SUFFIXES = [' - Director', ' - Counselor']

function stripRoleSuffix(title: string): { base: string; isStaffed: boolean } {
  for (const suffix of CAMP_ROLE_SUFFIXES) {
    if (title.endsWith(suffix)) {
      return { base: title.slice(0, -suffix.length), isStaffed: true }
    }
  }
  return { base: title, isStaffed: false }
}

// "Robert McGehee - Camps" / "Bryan Kelly - Camp" -> "Robert McGehee"
function extractCoachName(teamName: string): string {
  return teamName.replace(/\s*-\s*Camps?\s*$/i, '').trim()
}

// Coach names written in Notes ("Max + Taron", "Matteus & Joselito",
// "Taron/Matteus", "Joselito (combined session with G4.2)") or after an em/en
// dash in the title ("Goalie Clinic — Jack"). Anything that doesn't look like
// a name (digits, long sentences like "Please arrive 30 minutes before game
// time.") is dropped; the import screen still makes the admin confirm every
// name it kept.
export function parseCoachNames(text: string | undefined): string[] {
  if (!text) return []
  const cleaned = text.replace(/\([^)]*\)/g, ' ')
  const names: string[] = []
  for (const part of cleaned.split(/\s*(?:\+|&|\/|,|;|\band\b)\s*/i)) {
    const name = part.replace(/\s+/g, ' ').trim().replace(/[.:]$/, '')
    if (!name || !/^[A-Za-z][A-Za-z.'\- ]*$/.test(name) || name.split(' ').length > 3) continue
    if (!names.some((n) => n.toLowerCase() === name.toLowerCase())) names.push(name)
  }
  return names
}

// "Final Third Clinic — Keith" -> base "Final Third Clinic", names ["Keith"].
// Only an em/en dash: "DSA BU09 - DSA Practice" is a hyphen and not a coach.
function splitTitleCoaches(title: string): { base: string; names: string[] } {
  const match = title.match(/^(.*?)\s+[—–]\s+(.+)$/)
  if (!match) return { base: title, names: [] }
  return { base: match[1].trim(), names: parseCoachNames(match[2]) }
}

function parseTime12h(value: string): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  const parsed = dayjs(trimmed, 'hh:mm A')
  return parsed.isValid() ? parsed.format('HH:mm:ss') : null
}

// Warm-up minutes for a Game row: start minus ArrivalTime. Null for any
// other event type, a missing/unparseable arrival, or an arrival that isn't
// actually before the start.
export function gameWarmupMinutes(row: Pick<SprocketRow, 'ClubEventType' | 'ArrivalTime' | 'StartDateTime'>): number | null {
  if (row.ClubEventType?.trim().toLowerCase() !== 'game') return null
  const arrival = parseTime12h(row.ArrivalTime ?? '')
  const start = parseTime12h(row.StartDateTime)
  if (!arrival || !start) return null
  const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  const minutes = toMinutes(start) - toMinutes(arrival)
  return minutes > 0 ? minutes : null
}

function parseDate(value: string): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  const parsed = dayjs(trimmed, 'M/D/YYYY')
  return parsed.isValid() ? parsed.format('YYYY-MM-DD') : null
}

export function parseSprocketCsv(csvText: string): ParseResult {
  const result = Papa.parse<SprocketRow>(csvText, { header: true, skipEmptyLines: true })
  const errors: string[] = result.errors.map((e) => `Row ${e.row}: ${e.message}`)

  const groups = new Map<string, ParsedEvent>()

  const skipped: SkippedRow[] = []
  const eventType = (row: SprocketRow) => row.ClubEventType?.trim().toLowerCase() ?? ''
  // A club-wide "Club" row at the same date, time and location as a team's
  // practice/game is a duplicate listing (fall export: Rehoboth "Annual
  // Program"/"Jr Academy" next to each AP group's own row). A Club row with no
  // team row beside it is a real session (July's "AP Mondays") and is kept.
  const teamSlots = new Set(
    result.data
      .filter((r) => ['practice', 'game'].includes(eventType(r)))
      .map((r) => [r.StartDate, r.StartDateTime, r.LocationName].join('|')),
  )

  for (const row of result.data) {
    const type = eventType(row)
    const teamNameRaw = row.TeamName?.trim() ?? ''
    // Games have no Title; Sprocket's own default is "Team vs./@ Opponent".
    const rawTitle =
      row.Title?.trim() ||
      (type === 'game' && teamNameRaw
        ? `${teamNameRaw} ${row.AwayGame?.trim().toLowerCase() === 'yes' ? '@' : 'vs'} ${row.Opponent?.trim() || 'TBD'}`
        : '')
    if (!rawTitle || !row.StartDate) continue
    if (type === 'other') {
      skipped.push({ title: rawTitle, eventDate: row.StartDate, type: 'Other', reason: 'Not a session (team event)' })
      continue
    }
    if (type === 'club' && teamSlots.has([row.StartDate, row.StartDateTime, row.LocationName].join('|'))) {
      skipped.push({ title: rawTitle, eventDate: row.StartDate, type: 'Club', reason: "Duplicate of a team's session at the same time and place" })
      continue
    }

    const titled = splitTitleCoaches(rawTitle)
    const { base, isStaffed } = stripRoleSuffix(titled.base)
    const eventDate = parseDate(row.StartDate)
    if (!eventDate) {
      errors.push(`Could not parse date "${row.StartDate}" for "${row.Title}"`)
      continue
    }
    const startTime = parseTime12h(row.StartDateTime)
    const endTime = parseTime12h(row.EndDateTime)
    const teamName = teamNameRaw
    const locationName = row.LocationName?.trim() || (isStaffed ? '' : blankLocationLabel(teamName || base))
    const programName = row.ProgramName?.trim() ?? ''
    const coachNames = isStaffed ? [] : [...titled.names, ...parseCoachNames(row.Notes)]

    // Staffed (Camp) rows collapse across staff members -- team name varies
    // per coach/role but represents the same event, so it's excluded from
    // the key. Unstaffed rows (e.g. Annual Program cohorts) keep team name
    // in the key, since each one is a genuinely distinct session.
    const groupKey = isStaffed
      ? [base, eventDate, startTime, endTime, locationName, programName].join('|')
      : [base, eventDate, startTime, endTime, locationName, programName, teamName].join('|')

    let event = groups.get(groupKey)
    if (!event) {
      event = {
        key: groupKey,
        title: base,
        programName,
        locationName,
        eventDate,
        startTime,
        endTime,
        sessionName: isStaffed ? base : type === 'game' ? base : teamName || base,
        isCancelled: row.IsCancelled?.trim().toLowerCase() === 'yes',
        assignedCoachNames: [],
        paidEarlyMinutes: gameWarmupMinutes(row),
        sprocketIds: [],
        rows: [],
        teamName,
        needsTeamCoach: false,
      }
      groups.set(groupKey, event)
    }
    const sprocketId = row.ClubCalendarEventID?.trim()
    if (sprocketId && !event.sprocketIds.includes(sprocketId)) event.sprocketIds.push(sprocketId)
    event.rows.push({ ...(row as unknown as Record<string, string>) })
    for (const name of coachNames) {
      if (!event.assignedCoachNames.some((n) => n.toLowerCase() === name.toLowerCase())) event.assignedCoachNames.push(name)
    }

    if (isStaffed && teamName) {
      const coachName = extractCoachName(teamName)
      if (coachName && !event.assignedCoachNames.includes(coachName)) {
        event.assignedCoachNames.push(coachName)
      }
    }
  }

  const events = Array.from(groups.values())
  for (const event of events) {
    event.needsTeamCoach = event.programName !== 'Camps' && event.assignedCoachNames.length === 0
  }
  return { events, errors, skipped }
}

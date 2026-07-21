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
}

export type ParseResult = {
  events: ParsedEvent[]
  errors: string[]
}

export type LocationBlock = {
  key: string
  locationName: string
  label: string
  dates: string[]
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

export function groupEventsByLocationBlock(events: ParsedEvent[]): LocationBlockResolution {
  const datesByLocation = new Map<string, Set<string>>()
  for (const event of events) {
    if (!event.locationName) continue
    if (!datesByLocation.has(event.locationName)) {
      datesByLocation.set(event.locationName, new Set())
    }
    datesByLocation.get(event.locationName)?.add(event.eventDate)
  }

  const blocks: LocationBlock[] = []
  const blockKeyByLocationDate = new Map<string, string>()

  for (const [locationName, dateSet] of datesByLocation) {
    const sortedDates = Array.from(dateSet).sort()
    let currentBlockDates: string[] = []
    let blockIndex = 0

    const flush = () => {
      if (currentBlockDates.length === 0) return
      const key = `${locationName}::${blockIndex}`
      const first = currentBlockDates[0]
      const last = currentBlockDates[currentBlockDates.length - 1]
      const label =
        first === last
          ? `${locationName} (${formatDateLabel(first)})`
          : `${locationName} (${formatDateLabel(first)} – ${formatDateLabel(last)})`
      blocks.push({ key, locationName, label, dates: [...currentBlockDates] })
      for (const date of currentBlockDates) {
        blockKeyByLocationDate.set(`${locationName}|${date}`, key)
      }
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

  return {
    blocks,
    keyForEvent: (locationName, eventDate) => blockKeyByLocationDate.get(`${locationName}|${eventDate}`) ?? '',
  }
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

function parseTime12h(value: string): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  const parsed = dayjs(trimmed, 'hh:mm A')
  return parsed.isValid() ? parsed.format('HH:mm:ss') : null
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

  for (const row of result.data) {
    if (!row.Title || !row.StartDate) continue

    const { base, isStaffed } = stripRoleSuffix(row.Title.trim())
    const eventDate = parseDate(row.StartDate)
    if (!eventDate) {
      errors.push(`Could not parse date "${row.StartDate}" for "${row.Title}"`)
      continue
    }
    const startTime = parseTime12h(row.StartDateTime)
    const endTime = parseTime12h(row.EndDateTime)
    const locationName = row.LocationName?.trim() ?? ''
    const programName = row.ProgramName?.trim() ?? ''
    const teamName = row.TeamName?.trim() ?? ''

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
        sessionName: isStaffed ? base : teamName || base,
        isCancelled: row.IsCancelled?.trim().toLowerCase() === 'yes',
        assignedCoachNames: [],
      }
      groups.set(groupKey, event)
    }

    if (isStaffed && teamName) {
      const coachName = extractCoachName(teamName)
      if (coachName && !event.assignedCoachNames.includes(coachName)) {
        event.assignedCoachNames.push(coachName)
      }
    }
  }

  return { events: Array.from(groups.values()), errors }
}

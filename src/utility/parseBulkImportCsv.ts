import Papa from 'papaparse'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'

dayjs.extend(customParseFormat)

// Native format this app defines itself, not modeled on Sprocket's export --
// see src/pages/bulk-import/index.tsx. One row = one event, always; multiple
// coaches on one event are listed in a single semicolon-separated Coaches
// column, so there's no Sprocket-style row-collapsing/grouping logic needed
// at all here.
export type BulkImportRow = {
  Program: string
  Location: string
  Date: string
  'Start Time': string
  'End Time': string
  'Session Name': string
  Coaches: string
  // Optional (R3): when coaches are paid from before the start, e.g. a
  // game's warm-up. HH:mm, must be before Start Time.
  'Arrival Time'?: string
}

export type ParsedBulkEvent = {
  rowNumber: number
  programName: string
  locationName: string
  eventDate: string
  startTime: string | null
  endTime: string | null
  sessionName: string | null
  coachNames: string[]
  signature: string
  paidEarlyMinutes: number | null
}

export type DuplicateRowGroup = {
  signature: string
  rowNumbers: number[]
}

export type BulkImportParseResult = {
  events: ParsedBulkEvent[]
  errors: string[]
  duplicateGroups: DuplicateRowGroup[]
}

// Strict parsing (the `true` third arg) -- YYYY-MM-DD and HH:mm only, no
// lenient fallback to other formats, since this is a format we define
// ourselves and want CSV authors to follow exactly, not guess around.
function parseDate(value: string | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  const parsed = dayjs(trimmed, 'YYYY-MM-DD', true)
  return parsed.isValid() ? parsed.format('YYYY-MM-DD') : null
}

function parseTime24h(value: string | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  const parsed = dayjs(trimmed, 'HH:mm', true)
  return parsed.isValid() ? parsed.format('HH:mm:ss') : null
}

export function parseBulkImportCsv(csvText: string): BulkImportParseResult {
  const result = Papa.parse<BulkImportRow>(csvText, { header: true, skipEmptyLines: true })
  const errors: string[] = result.errors.map((e) => `Row ${(e.row ?? 0) + 2}: ${e.message}`)

  const events: ParsedBulkEvent[] = []
  const rowsBySignature = new Map<string, number[]>()

  result.data.forEach((row, index) => {
    const rowNumber = index + 2 // +1 for 0-index, +1 for the header row
    const programName = row.Program?.trim() ?? ''
    const locationName = row.Location?.trim() ?? ''
    const dateRaw = row.Date?.trim() ?? ''

    if (!programName && !locationName && !dateRaw) return // genuinely blank row, ignore silently

    if (!programName || !locationName) {
      errors.push(`Row ${rowNumber}: missing Program or Location, skipped`)
      return
    }

    const eventDate = parseDate(row.Date)
    if (!eventDate) {
      errors.push(`Row ${rowNumber}: could not parse Date "${row.Date}" (expected YYYY-MM-DD)`)
      return
    }

    const startTime = parseTime24h(row['Start Time'])
    const endTime = parseTime24h(row['End Time'])
    const sessionName = row['Session Name']?.trim() || null

    let paidEarlyMinutes: number | null = null
    if (row['Arrival Time']?.trim()) {
      const arrival = parseTime24h(row['Arrival Time'])
      const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
      if (!arrival || !startTime || toMinutes(arrival) >= toMinutes(startTime)) {
        errors.push(`Row ${rowNumber}: Arrival Time "${row['Arrival Time']}" must be HH:mm and before Start Time, skipped`)
        return
      }
      paidEarlyMinutes = toMinutes(startTime) - toMinutes(arrival)
    }
    const coachNames = (row.Coaches ?? '')
      .split(';')
      .map((n) => n.trim())
      .filter((n) => n.length > 0)

    const signature = [programName, locationName, eventDate, startTime, endTime, sessionName].join('|')

    const rowsForSignature = rowsBySignature.get(signature) ?? []
    rowsForSignature.push(rowNumber)
    rowsBySignature.set(signature, rowsForSignature)

    events.push({
      rowNumber,
      programName,
      locationName,
      eventDate,
      startTime,
      endTime,
      sessionName,
      coachNames,
      signature,
      paidEarlyMinutes,
    })
  })

  // Two rows in the SAME upload sharing identical event identity but
  // different Coaches would otherwise silently drop the second row's
  // coaches at import time (the in-memory existing-signature set gets
  // updated after the first insert, so the second is skipped as
  // "already exists") -- surface this explicitly instead, since this format
  // has no Sprocket-style row-collapsing to merge them on purpose.
  const duplicateGroups: DuplicateRowGroup[] = Array.from(rowsBySignature.entries())
    .filter(([, rowNumbers]) => rowNumbers.length > 1)
    .map(([signature, rowNumbers]) => ({ signature, rowNumbers }))

  return { events, errors, duplicateGroups }
}

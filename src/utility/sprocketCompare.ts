import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'

import { COMPARED } from './sprocketExport'

dayjs.extend(customParseFormat)

// Phase 9 step 8 (0043): compare mode. After the switch the app keeps the
// schedule, so a Sprocket export is compared, not applied: for every session
// the app owns, each of its Sprocket rows in the file is checked against what
// the app last sent or saw (event_sprocket_rows.sprocket_row). A difference
// means someone changed it in Sprocket -- an admin takes Sprocket's version
// or keeps the app's.

export type StoredRow = {
  id: string
  event_id: string
  club_calendar_event_id: string | null
  state: string
  sprocket_row: Record<string, string> | null
}

export type RowDifference = {
  clubCalendarEventId: string
  fileRow: Record<string, string>
  stored: Record<string, string>
  fields: string[]
}

export type SprocketChange = { eventId: string; rows: RowDifference[] }

const DATE_FORMATS = ['M/D/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']
const TIME_FORMATS = ['hh:mm A', 'h:mm A', 'HH:mm', 'HH:mm:ss', 'h:mmA']

// Same value written two ways ("1/9/2027" / "01/09/2027", "6:30 PM" /
// "06:30 PM", "yes" / "Yes") compares equal.
export function normalizeField(column: string, value: string | undefined): string {
  const t = (value ?? '').trim()
  if (!t) return ''
  if (/^(yes|no)$/i.test(t)) return t.toLowerCase()
  if (column === 'StartDate' || column === 'EndDate') {
    const d = dayjs(t, DATE_FORMATS, true)
    return d.isValid() ? d.format('YYYY-MM-DD') : t
  }
  if (column === 'StartDateTime' || column === 'EndDateTime' || column === 'ArrivalTime') {
    const d = dayjs(t, TIME_FORMATS, true)
    return d.isValid() ? d.format('HH:mm') : t.toUpperCase()
  }
  return t.replace(/\s+/g, ' ')
}

export function differingFields(a: Record<string, string>, b: Record<string, string>): string[] {
  return [...new Set(COMPARED.filter(([c]) => normalizeField(c, a[c]) !== normalizeField(c, b[c])).map(([, label]) => label))]
}

// fileRows: the uploaded export's rows. stored: event_sprocket_rows for the
// sessions the app owns. waitingSent: rows in Export to Sprocket files still
// "Waiting for upload", by ClubCalendarEventID -- if Sprocket matches one of
// those, it's the app's own upload not yet marked uploaded, not an edit.
export function findSprocketChanges(
  fileRows: Record<string, string>[],
  stored: StoredRow[],
  ownedEventIds: Set<string>,
  waitingSent: Map<string, Record<string, string>[]> = new Map(),
): { changes: SprocketChange[]; same: number; awaitingUpload: number } {
  const byId = new Map(
    stored
      .filter((r) => r.state === 'linked' && r.club_calendar_event_id && ownedEventIds.has(r.event_id))
      .map((r) => [r.club_calendar_event_id!, r]),
  )
  const changes = new Map<string, SprocketChange>()
  let same = 0
  let awaitingUpload = 0
  for (const fileRow of fileRows) {
    const id = (fileRow.ClubCalendarEventID ?? '').trim()
    const s = id ? byId.get(id) : undefined
    if (!s) continue
    const fields = differingFields(fileRow, s.sprocket_row ?? {})
    if (!fields.length) {
      same += 1
      continue
    }
    if ((waitingSent.get(id) ?? []).some((sent) => differingFields(fileRow, sent).length === 0)) {
      awaitingUpload += 1
      continue
    }
    const change = changes.get(s.event_id) ?? { eventId: s.event_id, rows: [] }
    change.rows.push({ clubCalendarEventId: id, fileRow, stored: s.sprocket_row ?? {}, fields })
    changes.set(s.event_id, change)
  }
  return { changes: [...changes.values()], same, awaitingUpload }
}

// All of a session's Sprocket rows with the file's replacing by ID -- what
// sprocket_take_event stores, so rows not in the file aren't dropped.
export function mergedRows(stored: StoredRow[], eventId: string, fileRows: Record<string, string>[]) {
  const byId = new Map(fileRows.map((r) => [(r.ClubCalendarEventID ?? '').trim(), r]))
  const mine = stored.filter((r) => r.event_id === eventId && r.state === 'linked' && r.club_calendar_event_id)
  const rows = mine.map((r) => byId.get(r.club_calendar_event_id!) ?? r.sprocket_row ?? {})
  return { rows, ids: mine.map((r) => r.club_calendar_event_id!) }
}

export const describeRow = (r: Record<string, string>) =>
  [
    `${r.StartDate ?? ''} ${r.StartDateTime ?? ''}–${r.EndDateTime ?? ''}`.trim(),
    normalizeField('IsCancelled', r.IsCancelled) === 'yes' ? 'cancelled' : null,
    r.LocationName || null,
    r.Notes || null,
  ]
    .filter(Boolean)
    .join(' · ')

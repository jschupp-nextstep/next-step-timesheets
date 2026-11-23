import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'

dayjs.extend(customParseFormat)

// Phase 9 step 4: after uploading an export from this app, Sprocket gives
// each new row an ID (ClubCalendarEventID). Matching a Sprocket export back
// to the app's not-yet-linked rows saves those IDs, so later exports update
// the row instead of creating it again, and imports recognise it.
//
// A Sprocket row matches an app row with the same team (or, for a Club row,
// the same Sprocket location), date and start time; the title only breaks a
// tie. Exactly one candidate both ways = linked automatically; anything else
// is picked by hand.

export type SprocketRawRow = Record<string, string>

export type AppRowCandidate = {
  rowId: string
  eventId: string
  sprocketTeamId: string | null // null = Club row
  locationSprocketId: string | null
  eventDate: string // YYYY-MM-DD
  startTime: string | null // HH:mm:ss
  // What the export writes as Title ('' for games).
  expectedTitle: string
  label: string
}

export type LinkMatch = { sprocket: SprocketRawRow; app: AppRowCandidate }
export type LinkAmbiguous = { sprocket: SprocketRawRow; candidates: AppRowCandidate[] }

export type LinkPlan = {
  alreadyLinked: number
  auto: LinkMatch[]
  ambiguous: LinkAmbiguous[]
  // In Sprocket only (made there, or not from this app) -- nothing to link.
  notFromApp: SprocketRawRow[]
  // App rows in the file's dates that no Sprocket row matched (not uploaded
  // yet, or changed in Sprocket before linking).
  appLeft: AppRowCandidate[]
}

const sprocketDateIso = (d: string) => {
  const parsed = dayjs(d?.trim(), 'M/D/YYYY')
  return parsed.isValid() ? parsed.format('YYYY-MM-DD') : ''
}
const sprocketTimeIso = (t: string) => {
  const parsed = dayjs(t?.trim(), 'hh:mm A')
  return parsed.isValid() ? parsed.format('HH:mm:ss') : ''
}

const keyOf = (teamId: string | null, locationId: string | null, date: string, start: string | null) =>
  [teamId ? `team:${teamId}` : `club:${locationId ?? ''}`, date, start ?? ''].join('|')

export const sprocketRowKey = (r: SprocketRawRow) =>
  keyOf(r.TeamID?.trim() || null, r.LocationID?.trim() || null, sprocketDateIso(r.StartDate), sprocketTimeIso(r.StartDateTime))

export const appRowKey = (a: AppRowCandidate) => keyOf(a.sprocketTeamId, a.locationSprocketId, a.eventDate, a.startTime)

// The ISO dates a file covers, for loading the app rows to match against.
export function fileDateRange(rows: SprocketRawRow[]): { from: string; to: string } | null {
  const dates = rows.map((r) => sprocketDateIso(r.StartDate)).filter(Boolean).sort()
  return dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null
}

export function planLinks(sprocketRows: SprocketRawRow[], appRows: AppRowCandidate[], knownIds: ReadonlySet<string>): LinkPlan {
  const plan: LinkPlan = { alreadyLinked: 0, auto: [], ambiguous: [], notFromApp: [], appLeft: [] }
  const appByKey = new Map<string, AppRowCandidate[]>()
  for (const a of appRows) appByKey.set(appRowKey(a), [...(appByKey.get(appRowKey(a)) ?? []), a])

  const proposals: { sprocket: SprocketRawRow; candidates: AppRowCandidate[] }[] = []
  for (const r of sprocketRows) {
    const id = r.ClubCalendarEventID?.trim()
    if (!id) continue
    if (knownIds.has(id)) {
      plan.alreadyLinked += 1
      continue
    }
    let candidates = appByKey.get(sprocketRowKey(r)) ?? []
    if (candidates.length > 1) {
      const title = r.Title?.trim() ?? ''
      const byTitle = candidates.filter((c) => c.expectedTitle && c.expectedTitle === title)
      if (byTitle.length) candidates = byTitle
    }
    if (candidates.length === 0) plan.notFromApp.push(r)
    else proposals.push({ sprocket: r, candidates })
  }

  // Automatic only when the pairing is one-to-one both ways.
  const claims = new Map<string, number>()
  for (const p of proposals) if (p.candidates.length === 1) claims.set(p.candidates[0].rowId, (claims.get(p.candidates[0].rowId) ?? 0) + 1)
  for (const p of proposals) {
    if (p.candidates.length === 1 && claims.get(p.candidates[0].rowId) === 1) plan.auto.push({ sprocket: p.sprocket, app: p.candidates[0] })
    else plan.ambiguous.push(p)
  }

  const touched = new Set(proposals.flatMap((p) => p.candidates.map((c) => c.rowId)))
  plan.appLeft = appRows.filter((a) => !touched.has(a.rowId))
  return plan
}

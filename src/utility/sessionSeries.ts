import dayjs from 'dayjs'

// Phase 9 step 2: a session, or a weekday series of them ("Saturdays 1/9 to
// 3/13, not 1/16"; "Mon + Wed from 1/4 to 3/29"). The dates are worked out
// here, shown to the person before they create anything, and sent as-is to
// schedule_create_sessions (0036), which stores the rule alongside them.

export const MAX_SERIES_SESSIONS = 150

// 0 = Sunday ... 6 = Saturday (dayjs's day()).
export const WEEKDAY_OPTIONS = [
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
  { label: 'Sun', value: 0 },
]

export type SeriesRule = {
  firstDate: string // YYYY-MM-DD
  // null = one session on firstDate (no repeat).
  lastDate: string | null
  weekdays: number[]
  skipDates: string[]
}

export type SeriesResult = {
  dates: string[]
  // Skip dates that weren't going to be a session anyway (wrong weekday or
  // outside the range) -- shown so a typo in a skip date isn't silent.
  unusedSkips: string[]
  tooMany: boolean
}

export function seriesDates(rule: SeriesRule): SeriesResult {
  const skips = new Set(rule.skipDates)
  if (!rule.firstDate) return { dates: [], unusedSkips: [...skips], tooMany: false }

  const candidates: string[] = []
  if (!rule.lastDate) {
    candidates.push(rule.firstDate)
  } else {
    const days = new Set(rule.weekdays)
    const end = dayjs(rule.lastDate)
    // Hard stop well past the cap so a far-off end date can't spin.
    for (let d = dayjs(rule.firstDate), n = 0; !d.isAfter(end) && n < 800; d = d.add(1, 'day'), n++) {
      if (days.has(d.day())) candidates.push(d.format('YYYY-MM-DD'))
    }
  }
  const dates = candidates.filter((d) => !skips.has(d))
  const unusedSkips = [...skips].filter((s) => !candidates.includes(s)).sort()
  return { dates, unusedSkips, tooMany: dates.length > MAX_SERIES_SESSIONS }
}

// "Sat" / "Mon, Wed" for a short description of the rule.
export const weekdayNames = (weekdays: number[]) =>
  WEEKDAY_OPTIONS.filter((o) => weekdays.includes(o.value))
    .map((o) => o.label)
    .join(', ')

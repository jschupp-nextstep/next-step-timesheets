// Band math for the pay-period-based coach logging windows (see
// supabase/migrations/0013_pay_periods.sql and CLAUDE.md). Computed
// client-side, consistent with this app's convention -- the only Postgres
// functions in this schema are the trivial current_coach_id()/is_admin();
// everything else (e.g. mondayOf() in schedule-board/index.tsx) is plain
// client-side date math over a small fetched list.

export type PayPeriod = { id: string; start_date: string; end_date: string }

export type DateRange = { start: string; end: string }

export type Bands = {
  bandA: DateRange | null
  bandB: DateRange | null
  hasCurrentPeriod: boolean
}

export function sortPeriodsAsc(periods: PayPeriod[]): PayPeriod[] {
  return [...periods].sort((a, b) => a.start_date.localeCompare(b.start_date))
}

// "Current period" = the most recent period (by start_date order) that has
// actually started as of today -- a row-position definition, not "today is
// between start/end", so an admin running a few days behind on creating the
// next period doesn't strand today's date with no current period at all.
// Returns -1 if today is before every known period's start_date.
export function currentPeriodIndex(periodsAsc: PayPeriod[], todayStr: string): number {
  let idx = -1
  for (let i = 0; i < periodsAsc.length; i++) {
    if (periodsAsc[i].start_date <= todayStr) idx = i
  }
  return idx
}

export function computeBands(periods: PayPeriod[], todayStr: string): Bands {
  const periodsAsc = sortPeriodsAsc(periods)
  const idx = currentPeriodIndex(periodsAsc, todayStr)
  if (idx === -1) {
    return { bandA: null, bandB: null, hasCurrentPeriod: false }
  }

  const aPeriods = [periodsAsc[idx - 1], periodsAsc[idx]].filter((p): p is PayPeriod => !!p)
  const bandA: DateRange = {
    start: aPeriods[0].start_date,
    end: aPeriods[aPeriods.length - 1].end_date,
  }

  const bPeriods = [periodsAsc[idx - 3], periodsAsc[idx - 2]].filter((p): p is PayPeriod => !!p)
  const bandB: DateRange | null =
    bPeriods.length > 0 ? { start: bPeriods[0].start_date, end: bPeriods[bPeriods.length - 1].end_date } : null

  return { bandA, bandB, hasCurrentPeriod: true }
}

export type Band = 'A' | 'B' | 'C'

function inRange(dateStr: string, range: DateRange | null): boolean {
  if (!range) return false
  return dateStr >= range.start && dateStr <= range.end
}

export function classifyDate(bands: Bands, dateStr: string): Band {
  if (!bands.hasCurrentPeriod) return 'C'
  if (inRange(dateStr, bands.bandA)) return 'A'
  if (inRange(dateStr, bands.bandB)) return 'B'
  return 'C'
}

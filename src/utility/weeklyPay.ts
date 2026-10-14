import dayjs from 'dayjs'

// R7 (0026_weekly_rates.sql): coaches paid a flat amount per week (Prince
// $1,100 Sat–Fri, Hayley $200 Mon–Sun). Their sessions are still logged for
// the record; Payment Due shows one line per coach-week instead of hours.
// Shared by Payment Due and the Zoho export so both agree on what's owed.

export type WeeklyRate = {
  id: string
  coach_id: string
  // null = covers all of the coach's work; otherwise just this program.
  program_id: string | null
  weekly_amount: number
  // 0 = Sunday ... 6 = Saturday (dayjs().day() convention).
  week_start_dow: number
  effective_from: string
  effective_to: string | null
}

export type WeeklyPayment = {
  id: string
  weekly_rate_id: string
  coach_id: string
  week_start: string
  week_end: string
  amount: number
  paid_date: string
}

export type WeeklyEntry = { id: string; coach_id: string; program_id: string; entry_date: string }

export const DOW_LABEL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// First day of the week containing `date`, for a week starting on `dow`.
export function weekStartFor(date: string, dow: number): string {
  const d = dayjs(date)
  return d.subtract((d.day() - dow + 7) % 7, 'day').format('YYYY-MM-DD')
}

export const weekEndFor = (weekStart: string) => dayjs(weekStart).add(6, 'day').format('YYYY-MM-DD')

// The weekly rate that covers an entry, if any. A program-specific rate
// beats an all-work rate for the same coach; only rates in effect on the
// entry's date count.
export function weeklyRateFor<E extends WeeklyEntry>(entry: E, rates: WeeklyRate[]): WeeklyRate | undefined {
  const inEffect = rates.filter(
    (r) =>
      r.coach_id === entry.coach_id &&
      entry.entry_date >= r.effective_from &&
      (!r.effective_to || entry.entry_date <= r.effective_to) &&
      (r.program_id === null || r.program_id === entry.program_id),
  )
  return inEffect.find((r) => r.program_id !== null) ?? inEffect.find((r) => r.program_id === null)
}

export type WeekLine<E> = {
  key: string
  rate: WeeklyRate
  weekStart: string
  weekEnd: string
  entries: E[]
  // Set once the week has been paid (in arrears or in advance). Entries
  // still listed under a paid week are ones logged after it was paid --
  // they need attaching, not paying again.
  payment: WeeklyPayment | null
}

// Splits entries into those a weekly rate covers (grouped one line per
// coach-week) and the rest (paid hourly as before). Weeks with no logged
// sessions don't appear (Justin: only weeks with sessions are owed); a week
// paid in advance appears only once it has sessions to attach.
export function splitWeekly<E extends WeeklyEntry>(entries: E[], rates: WeeklyRate[], payments: WeeklyPayment[]) {
  const hourly: E[] = []
  const lines = new Map<string, WeekLine<E>>()
  for (const entry of entries) {
    const rate = weeklyRateFor(entry, rates)
    if (!rate) {
      hourly.push(entry)
      continue
    }
    const weekStart = weekStartFor(entry.entry_date, rate.week_start_dow)
    const key = `${rate.id}|${weekStart}`
    const line = lines.get(key) ?? {
      key,
      rate,
      weekStart,
      weekEnd: weekEndFor(weekStart),
      entries: [],
      payment: payments.find((p) => p.weekly_rate_id === rate.id && p.week_start === weekStart) ?? null,
    }
    line.entries.push(entry)
    lines.set(key, line)
  }
  return {
    hourly,
    weeks: [...lines.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart) || a.rate.coach_id.localeCompare(b.rate.coach_id)),
  }
}

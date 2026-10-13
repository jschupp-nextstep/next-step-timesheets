// Shared with src/pages/coach/log-session.tsx, EventClaimForm, the admin
// claim-approval logic in src/pages/reconciliation/index.tsx, and the
// schedule-change review queue -- every place that needs to know how many
// hours an event is worth should go through this, not reimplement it.

// Camp/Nurse programs pay a fixed number of hours looked up from the
// event's location -- never calculated from a time span, and locked from
// manual entry (mirrors the old system's Sheets data-validation rule).
export const FIXED_HOURS_HALF = new Set(['Camp-Half Day', 'Nurse-Half Day'])
export const FIXED_HOURS_FULL = new Set(['Camp-Full Day', 'Nurse-Full Day'])

// Paid-time rules (R3, 0023_paid_time.sql): a session can be paid from
// some minutes before its scheduled start -- AP from 15 min early (a
// program-wide rule), games from warm-up (a per-event override, set from
// Sprocket's ArrivalTime on Game rows). Stored as minutes-before-start, not
// a clock time, so a schedule time change carries the paid window along.
// Callers must pass the program record (not just its name) so the offset
// can't be silently dropped.
export type PaidTimeProgram = { name: string; paid_early_minutes?: number | null }
export type PaidTimeEvent = { start_time: string | null; end_time: string | null; paid_early_minutes?: number | null }
type FixedHoursLocation = { half_day_hours: number | null; full_day_hours: number | null }

const isFixedHours = (programName: string) => FIXED_HOURS_HALF.has(programName) || FIXED_HOURS_FULL.has(programName)

export function timeSpanHours(start: string | null, end: string | null): number | null {
  if (!start || !end) return null
  const startTime = new Date(`2000-01-01T${start}`)
  const endTime = new Date(`2000-01-01T${end}`)
  if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) return null
  const hours = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60)
  return hours > 0 ? hours : null
}

// 'HH:mm[:ss]' minus N minutes -> 'HH:mm:ss'. Clamped at midnight rather
// than wrapping to the previous day (no session starts that early).
export function minutesBefore(time: string, minutes: number): string {
  const [h, m, s = '0'] = time.split(':')
  const total = Math.max(0, Number(h) * 60 + Number(m) - minutes)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}:${pad(Number(s))}`
}

// Event override wins over the program rule; fixed-hours programs never
// get early minutes (their pay doesn't come from a time span at all).
export function paidEarlyMinutes(program: PaidTimeProgram, event: PaidTimeEvent): number {
  if (isFixedHours(program.name)) return 0
  const minutes = event.paid_early_minutes ?? program.paid_early_minutes ?? 0
  return minutes > 0 ? minutes : 0
}

// The window an entry records: paid start (scheduled start minus early
// minutes) to scheduled end.
export function paidWindow(program: PaidTimeProgram, event: PaidTimeEvent) {
  const earlyMinutes = paidEarlyMinutes(program, event)
  const start = event.start_time && earlyMinutes > 0 ? minutesBefore(event.start_time, earlyMinutes) : event.start_time
  return { start, end: event.end_time, earlyMinutes }
}

export function resolveEventHours(
  program: PaidTimeProgram,
  event: PaidTimeEvent,
  location: FixedHoursLocation | undefined,
): number | null {
  if (FIXED_HOURS_HALF.has(program.name)) return location?.half_day_hours ?? null
  if (FIXED_HOURS_FULL.has(program.name)) return location?.full_day_hours ?? null
  const { start, end } = paidWindow(program, event)
  return timeSpanHours(start, end)
}

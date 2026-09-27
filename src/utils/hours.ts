// Shared with src/pages/coach/log-session.tsx, BandBLateRequestForm,
// EventClaimForm, and the admin claim-approval logic in
// src/pages/reconciliation/index.tsx -- every place that needs to know how
// many hours an event is worth should go through this, not reimplement it.

// Camp/Nurse programs pay a fixed number of hours looked up from the
// event's location -- never calculated from a time span, and locked from
// manual entry (mirrors the old system's Sheets data-validation rule).
export const FIXED_HOURS_HALF = new Set(['Camp-Half Day', 'Nurse-Half Day'])
export const FIXED_HOURS_FULL = new Set(['Camp-Full Day', 'Nurse-Full Day'])

export function timeSpanHours(start: string | null, end: string | null): number | null {
  if (!start || !end) return null
  const startTime = new Date(`2000-01-01T${start}`)
  const endTime = new Date(`2000-01-01T${end}`)
  if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) return null
  const hours = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60)
  return hours > 0 ? hours : null
}

export function resolveEventHours(
  programName: string,
  event: { start_time: string | null; end_time: string | null },
  location: { half_day_hours: number | null; full_day_hours: number | null } | undefined,
): number | null {
  if (FIXED_HOURS_HALF.has(programName)) return location?.half_day_hours ?? null
  if (FIXED_HOURS_FULL.has(programName)) return location?.full_day_hours ?? null
  return timeSpanHours(event.start_time, event.end_time)
}

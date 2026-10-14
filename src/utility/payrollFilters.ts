// Shared between Payment Due and the Zoho export, same reasoning as
// payroll.ts: both screens must agree on exactly which entries a payroll
// run covers, or "Mark all paid" can mark entries the export never
// included (the original bug: Payment Due had no date range at all, while
// the export did).

import { useMemo } from 'react'
import { useList } from '@refinedev/core'
import { useSearchParams } from 'react-router'
import dayjs, { type Dayjs } from 'dayjs'

import { isBeforeCutover } from './appSettings'

export type PayrollRange = [Dayjs, Dayjs]

export type CutoverResolution = 'paid_in_sheets' | 'still_owed'

export type AdminFlag = 'hold' | 'canceled' | 'not_next_step'

export type PayrollFilterEntry = {
  entry_date: string
  admin_entered: boolean
  cutover_resolution: CutoverResolution | null
  // R4 (0025): payable = pending AND no admin flag.
  admin_flag?: AdminFlag | null
}

// Pre-cutover entries were paid in the old Sheets system -- excluded from
// payroll unless an admin entered them (admin_entered, set by trigger on
// insert and immutable afterward) or an admin resolved them as still owed
// on Payment Due's cleanup card. See 0015/0016 migrations.
export function isPreCutoverExcluded(entry: PayrollFilterEntry, cutoverDate: string | null): boolean {
  return isBeforeCutover(entry.entry_date, cutoverDate) && !entry.admin_entered && entry.cutover_resolution !== 'still_owed'
}

// Splits pending entries for Payment Due: `payable` is exactly what the
// table shows and what "Mark all paid" may touch; `preCutover` is exactly
// what the cleanup card lists; `held` is in-range entries on an event with
// a schedule change still awaiting review (R2c payroll hold); `onHold` is
// in-range entries an admin put on Hold with a question (R4); `excluded` is
// entries flagged Canceled / Not Next Step, whatever their date -- never
// payable, never counted as owed. Every entry lands in exactly one bucket,
// and nothing dated on or after cutover can ever land in `preCutover`.
export function partitionPendingEntries<T extends PayrollFilterEntry & { event_id?: string | null }>(
  entries: T[],
  range: PayrollRange,
  cutoverDate: string | null,
  heldEventIds: ReadonlySet<string> = new Set(),
) {
  const payable: T[] = []
  const held: T[] = []
  const onHold: T[] = []
  const excluded: T[] = []
  const preCutover: T[] = []
  const beforeRange: T[] = []
  const afterRange: T[] = []
  const start = range[0].format('YYYY-MM-DD')
  for (const entry of entries) {
    if (isPreCutoverExcluded(entry, cutoverDate)) preCutover.push(entry)
    else if (entry.admin_flag === 'canceled' || entry.admin_flag === 'not_next_step') excluded.push(entry)
    else if (!inRange(entry.entry_date, range)) (entry.entry_date < start ? beforeRange : afterRange).push(entry)
    else if (entry.admin_flag === 'hold') onHold.push(entry)
    else if (entry.event_id && heldEventIds.has(entry.event_id)) held.push(entry)
    else payable.push(entry)
  }
  return { payable, held, onHold, excluded, preCutover, beforeRange, afterRange }
}

// Events with at least one scheduler change still awaiting review -- their
// entries are held out of Payment Due and the Zoho export until reviewed.
export function useHeldEventIds() {
  const { result, query } = useList<{ event_id: string }>({
    resource: 'schedule_changes',
    meta: { select: 'event_id' },
    filters: [{ field: 'review_status', operator: 'eq', value: 'needs_review' }],
    pagination: { pageSize: 2000 },
  })
  const heldEventIds = useMemo(() => new Set((result?.data ?? []).map((r) => r.event_id)), [result?.data])
  return { heldEventIds, isLoading: query.isLoading, refetch: query.refetch }
}

// "Since last payroll": the day after paid_through_date through today. Falls
// back to cutover (nothing's been paid in the app yet), then to the start of
// the current month if neither setting exists.
export function defaultPayrollRange(paidThroughDate: string | null, cutoverDate: string | null): PayrollRange {
  const today = dayjs().startOf('day')
  let start = paidThroughDate
    ? dayjs(paidThroughDate).add(1, 'day')
    : cutoverDate
      ? dayjs(cutoverDate)
      : today.startOf('month')
  if (start.isAfter(today)) start = today
  return [start, today]
}

export function inRange(dateStr: string, range: PayrollRange): boolean {
  return dateStr >= range[0].format('YYYY-MM-DD') && dateStr <= range[1].format('YYYY-MM-DD')
}

export function formatRange(range: PayrollRange): string {
  return `${range[0].format('MMM D')} – ${range[1].format('MMM D, YYYY')}`
}

// The range lives in the URL (?from=YYYY-MM-DD&to=YYYY-MM-DD) so moving
// between the Zoho export and Payment Due keeps the same payroll run in
// view, rather than each screen picking its own default.
export function usePayrollRange(paidThroughDate: string | null, cutoverDate: string | null) {
  const [searchParams, setSearchParams] = useSearchParams()
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  const range: PayrollRange = useMemo(() => {
    if (from && to && dayjs(from).isValid() && dayjs(to).isValid()) return [dayjs(from), dayjs(to)]
    return defaultPayrollRange(paidThroughDate, cutoverDate)
  }, [from, to, paidThroughDate, cutoverDate])

  const setRange = (next: PayrollRange) => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev)
        params.set('from', next[0].format('YYYY-MM-DD'))
        params.set('to', next[1].format('YYYY-MM-DD'))
        return params
      },
      { replace: true },
    )
  }

  const queryString = `from=${range[0].format('YYYY-MM-DD')}&to=${range[1].format('YYYY-MM-DD')}`

  return { range, setRange, queryString }
}

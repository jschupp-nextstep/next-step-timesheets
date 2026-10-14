import { useMemo } from 'react'
import { useList } from '@refinedev/core'
import dayjs from 'dayjs'

import { findDoublePay, type DPAssignment, type DPClaim, type DPSub } from './doublePay'
import type { AdminFlag } from './payrollFilters'

export type DoublePayEntry = {
  id: string
  coach_id: string
  event_id: string
  entry_date: string
  status: 'pending' | 'paid'
  admin_flag: AdminFlag | null
  hours: number | null
  flat_amount: number | null
  paid_amount: number | null
  coaches: { name: string } | null
  events: { event_date: string; session_name: string | null; programs: { name: string } | null; locations: { name: string } | null } | null
}

// How far back to look. Covers a payroll cycle plus the "paid, then someone
// logged the same session later" pattern (Keith paid, Pat logged after).
const LOOKBACK_DAYS = 120

// R5: sessions that look double-paid, for Reconciliation's card and Payment
// Due's warning (admin-only data: schedule_changes, claims, all entries).
export function useDoublePayFlags() {
  const since = dayjs().subtract(LOOKBACK_DAYS, 'day').format('YYYY-MM-DD')
  const entriesQ = useList<DoublePayEntry>({
    resource: 'timesheet_entries',
    meta: {
      select:
        'id, coach_id, event_id, entry_date, status, admin_flag, hours, flat_amount, paid_amount, coaches(name), events(event_date, session_name, programs(name), locations(name))',
    },
    filters: [
      // value must be null: Refine's supabase provider turns nnull + true into
      // `IS TRUE`, which errors on a uuid column (the query then fails silently).
      { field: 'event_id', operator: 'nnull', value: null },
      { field: 'entry_date', operator: 'gte', value: since },
    ],
    pagination: { pageSize: 3000 },
  })
  const assignmentsQ = useList<DPAssignment>({
    resource: 'event_assignments',
    meta: { select: 'event_id, coach_id, covering_for_coach_id, events!inner(event_date)' },
    filters: [{ field: 'events.event_date', operator: 'gte', value: since }],
    pagination: { pageSize: 5000 },
  })
  const subsQ = useList<DPSub>({
    resource: 'schedule_changes',
    meta: { select: 'event_id, removed_coach_id, added_coach_id, review_status' },
    filters: [{ field: 'change_type', operator: 'eq', value: 'sub' }],
    pagination: { pageSize: 3000 },
  })
  const claimsQ = useList<DPClaim>({
    resource: 'payment_claims',
    meta: { select: 'event_id, coach_id' },
    filters: [
      { field: 'claim_type', operator: 'eq', value: 'unassigned_claim' },
      { field: 'status', operator: 'eq', value: 'approved' },
    ],
    pagination: { pageSize: 1000 },
  })

  const flags = useMemo(
    () =>
      findDoublePay(
        entriesQ.result?.data ?? [],
        assignmentsQ.result?.data ?? [],
        subsQ.result?.data ?? [],
        claimsQ.result?.data ?? [],
      ).sort((a, b) => (b.entries[0]?.entry_date ?? '').localeCompare(a.entries[0]?.entry_date ?? '')),
    [entriesQ.result?.data, assignmentsQ.result?.data, subsQ.result?.data, claimsQ.result?.data],
  )

  return {
    flags,
    // Still actionable: at least one entry on the session isn't paid yet.
    openFlags: flags.filter((f) => f.entries.some((e) => e.status === 'pending')),
    isLoading: entriesQ.query.isLoading || assignmentsQ.query.isLoading,
    refetch: () => {
      entriesQ.query.refetch()
      assignmentsQ.query.refetch()
      subsQ.query.refetch()
      claimsQ.query.refetch()
    },
  }
}

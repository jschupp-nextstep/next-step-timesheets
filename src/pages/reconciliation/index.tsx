import { useMemo, useState } from 'react'
import { useGetIdentity, useList } from '@refinedev/core'
import { App, Button, Card, InputNumber, Modal, Segmented, Select, Space, Table, Tag, Typography } from 'antd'

import { supabaseClient } from '../../utility/supabaseClient'
import type { Identity } from '../../providers/authProvider'
import { resolveEventHours } from '../../utils/hours'

type EventRef = {
  id: string
  is_cancelled: boolean
  event_assignments: { coach_id: string }[]
} | null

type EntryRow = {
  id: string
  entry_date: string
  coach_id: string
  program_id: string
  hours: number | null
  session_name: string | null
  status: 'pending' | 'paid'
  paid_date: string | null
  coaches: { name: string } | null
  programs: { name: string; entry_mode: string } | null
  events: EventRef
}

type OneVOneRateRow = {
  coach_id: string
  session_fee: number
  oversight_coach_id: string | null
  oversight_fee: number | null
}

type OversightApprovalRow = {
  id: string
  source_entry_id: string
  decision: 'approved' | 'declined'
}

type CoachRow = { id: string; name: string }

type SwapRequestRow = {
  id: string
  coach_id: string
  event_id: string
  reason: string | null
  requested_at: string
  events: {
    event_date: string
    session_name: string | null
    programs: { name: string } | null
    locations: { name: string } | null
  } | null
}

type PaymentClaimAdminRow = {
  id: string
  coach_id: string
  claim_type: 'late_event' | 'unassigned_claim' | 'unstructured' | 'hours_correction'
  event_id: string | null
  entry_id: string | null
  program_id: string
  location_id: string
  approx_date: string | null
  scheduled_hours: number | null
  requested_hours: number | null
  reason: string | null
  notes: string | null
  status: 'pending' | 'approved' | 'denied'
  requested_at: string
  events: { event_date: string; session_name: string | null; start_time: string | null; end_time: string | null } | null
  programs: { name: string } | null
  locations: { name: string; half_day_hours: number | null; full_day_hours: number | null } | null
}

const CLAIM_TYPE_LABELS: Record<PaymentClaimAdminRow['claim_type'], string> = {
  late_event: 'Late request',
  unassigned_claim: 'Unassigned claim',
  unstructured: 'Unverified claim',
  hours_correction: 'Hours correction',
}

type ReconciliationStatus =
  | 'match'
  | 'not_assigned'
  | 'cancelled'
  | 'missing_event'
  | 'unverifiable'
  | 'not_applicable'

type ReconciledEntry = EntryRow & { reconciliationStatus: ReconciliationStatus }

const STATUS_META: Record<ReconciliationStatus, { label: string; color?: string }> = {
  match: { label: 'Match', color: 'green' },
  not_assigned: { label: 'Coach not assigned', color: 'red' },
  cancelled: { label: 'Event cancelled', color: 'red' },
  missing_event: { label: 'Not on master calendar', color: 'gold' },
  unverifiable: { label: 'No assignment data', color: 'default' },
  not_applicable: { label: '—' },
}

// Only these represent something an admin might actually need to act on.
// "unverifiable" and "not_applicable" are both expected, normal states --
// there's nothing to check them against by design, not a data problem.
const FLAGGED: ReconciliationStatus[] = ['not_assigned', 'cancelled', 'missing_event']

// Mirrors the plan's verification rules exactly: cancelled always wins; a
// session-mode entry with no linked event is a real "Other" gap; an event
// with zero assignment records has nothing to check against (e.g. every
// Annual Program event, since Sprocket never tracked staff for those); an
// event WITH assignment records either includes this coach or doesn't.
function computeStatus(entry: EntryRow): ReconciliationStatus {
  const event = entry.events
  if (event?.is_cancelled) return 'cancelled'
  if (!event) {
    return entry.programs?.entry_mode === 'session' ? 'missing_event' : 'not_applicable'
  }
  const assignedCoachIds = event.event_assignments.map((a) => a.coach_id)
  if (assignedCoachIds.length === 0) return 'unverifiable'
  return assignedCoachIds.includes(entry.coach_id) ? 'match' : 'not_assigned'
}

export const Reconciliation = () => {
  const { message } = App.useApp()
  const { data: identity } = useGetIdentity<Identity>()
  const [paymentFilter, setPaymentFilter] = useState<'pending' | 'paid' | 'all'>('pending')
  const [onlyFlagged, setOnlyFlagged] = useState(true)
  const [decidingId, setDecidingId] = useState<string | null>(null)
  const [decidingSwapId, setDecidingSwapId] = useState<string | null>(null)
  const [decidingClaimId, setDecidingClaimId] = useState<string | null>(null)
  const [claimTypeFilter, setClaimTypeFilter] = useState<'all' | PaymentClaimAdminRow['claim_type']>('all')
  const [unstructuredModalClaim, setUnstructuredModalClaim] = useState<PaymentClaimAdminRow | null>(null)
  const [unstructuredHoursInput, setUnstructuredHoursInput] = useState<number | null>(null)
  const [approvingUnstructured, setApprovingUnstructured] = useState(false)

  const filters = useMemo(
    () => (paymentFilter === 'all' ? [] : [{ field: 'status', operator: 'eq' as const, value: paymentFilter }]),
    [paymentFilter],
  )

  const { result, query } = useList<EntryRow>({
    resource: 'timesheet_entries',
    meta: {
      select:
        '*, coaches(name), programs(name, entry_mode), events(id, is_cancelled, event_assignments(coach_id))',
    },
    filters,
    sorters: [{ field: 'entry_date', order: 'desc' }],
    pagination: { pageSize: 500 },
  })

  // Oversight review pulls from ALL direct-flat entries regardless of the
  // payment filter above -- whether oversight happened is a fact about the
  // session, not about whether it's been paid yet.
  const { result: allFlatResult, query: allFlatQuery } = useList<EntryRow>({
    resource: 'timesheet_entries',
    meta: { select: '*, coaches(name), programs(name, entry_mode)' },
    filters: [],
    pagination: { pageSize: 500 },
  })
  const { result: ratesResult, query: ratesQuery } = useList<OneVOneRateRow>({
    resource: 'one_v_one_rates',
    filters: [{ field: 'is_active', operator: 'eq', value: true }],
    pagination: { pageSize: 200 },
  })
  const { result: approvalsResult, query: approvalsQuery } = useList<OversightApprovalRow>({
    resource: 'oversight_approvals',
    pagination: { pageSize: 500 },
  })
  const { result: coachesResult } = useList<CoachRow>({
    resource: 'coaches',
    filters: [{ field: 'is_active', operator: 'eq', value: true }],
    pagination: { pageSize: 200 },
  })
  const { result: swapRequestsResult, query: swapRequestsQuery } = useList<SwapRequestRow>({
    resource: 'swap_requests',
    meta: { select: '*, events(event_date, session_name, programs(name), locations(name))' },
    filters: [{ field: 'status', operator: 'eq', value: 'pending' }],
    sorters: [{ field: 'requested_at', order: 'asc' }],
    pagination: { pageSize: 200 },
  })
  const swapRequests = swapRequestsResult?.data ?? []

  const { result: claimsResult, query: claimsQuery } = useList<PaymentClaimAdminRow>({
    resource: 'payment_claims',
    meta: {
      select:
        '*, events(event_date, session_name, start_time, end_time), programs(name), locations(name, half_day_hours, full_day_hours)',
    },
    filters: [{ field: 'status', operator: 'eq', value: 'pending' }],
    sorters: [{ field: 'requested_at', order: 'asc' }],
    pagination: { pageSize: 200 },
  })
  const claims = claimsResult?.data ?? []
  const visibleClaims = useMemo(
    () => (claimTypeFilter === 'all' ? claims : claims.filter((c) => c.claim_type === claimTypeFilter)),
    [claims, claimTypeFilter],
  )

  const ratesByCoachId = useMemo(
    () => new Map((ratesResult?.data ?? []).map((r) => [r.coach_id, r])),
    [ratesResult?.data],
  )
  const coachesById = useMemo(
    () => new Map((coachesResult?.data ?? []).map((c) => [c.id, c])),
    [coachesResult?.data],
  )
  const decidedSourceIds = useMemo(
    () => new Set((approvalsResult?.data ?? []).map((a) => a.source_entry_id)),
    [approvalsResult?.data],
  )

  const oversightCandidates = useMemo(
    () =>
      (allFlatResult?.data ?? []).filter((entry) => {
        if (entry.programs?.entry_mode !== 'direct_flat') return false
        if (decidedSourceIds.has(entry.id)) return false
        const rate = ratesByCoachId.get(entry.coach_id)
        return !!rate?.oversight_coach_id && rate.oversight_fee != null
      }),
    [allFlatResult?.data, decidedSourceIds, ratesByCoachId],
  )

  const refetchAll = () => {
    query.refetch()
    allFlatQuery.refetch()
    approvalsQuery.refetch()
  }

  const decide = async (entry: EntryRow, decision: 'approved' | 'declined') => {
    setDecidingId(entry.id)
    try {
      const rate = ratesByCoachId.get(entry.coach_id)
      let oversightEntryId: string | null = null

      if (decision === 'approved') {
        if (!rate?.oversight_coach_id || rate.oversight_fee == null) return
        const coachName = entry.coaches?.name ?? 'coach'
        const { data: inserted, error: insertError } = await supabaseClient
          .from('timesheet_entries')
          .insert({
            coach_id: rate.oversight_coach_id,
            program_id: entry.program_id,
            entry_date: entry.entry_date,
            flat_amount: rate.oversight_fee,
            session_name: `Oversight: ${coachName} (${entry.entry_date})`,
            notes: `Oversight fee for a 1v1 session logged by ${coachName}.`,
            status: 'pending',
          })
          .select('id')
          .single()
        if (insertError || !inserted) {
          message.error(`Couldn't create the oversight entry: ${insertError?.message}`)
          return
        }
        oversightEntryId = inserted.id
      }

      const { error } = await supabaseClient.from('oversight_approvals').insert({
        source_entry_id: entry.id,
        decision,
        oversight_entry_id: oversightEntryId,
      })
      if (error) {
        message.error(`Couldn't save the decision: ${error.message}`)
        return
      }
      message.success(decision === 'approved' ? 'Oversight fee approved' : 'Dismissed')
      refetchAll()
    } finally {
      setDecidingId(null)
    }
  }

  const decideSwap = async (request: SwapRequestRow, decision: 'approved' | 'denied') => {
    setDecidingSwapId(request.id)
    try {
      if (decision === 'approved') {
        const { error: deleteError } = await supabaseClient
          .from('event_assignments')
          .delete()
          .eq('event_id', request.event_id)
          .eq('coach_id', request.coach_id)
        if (deleteError) {
          message.error(`Couldn't remove the assignment: ${deleteError.message}`)
          return
        }
      }

      const { error } = await supabaseClient
        .from('swap_requests')
        .update({ status: decision, reviewed_by: identity?.id ?? null, reviewed_at: new Date().toISOString() })
        .eq('id', request.id)
      if (error) {
        message.error(`Couldn't save the decision: ${error.message}`)
        return
      }
      message.success(decision === 'approved' ? 'Swap approved -- coach removed from the assignment' : 'Swap denied')
      swapRequestsQuery.refetch()
    } finally {
      setDecidingSwapId(null)
    }
  }

  // Approve/deny for late_event, unassigned_claim, and hours_correction --
  // all three have enough information on the claim itself (plus its joined
  // event) to resolve hours automatically. 'unstructured' is handled
  // separately (see handleApproveUnstructured) since there's no event to
  // derive hours from -- the admin has to enter them by hand, same as
  // admin_only entries today.
  const decideClaim = async (claim: PaymentClaimAdminRow, decision: 'approved' | 'denied') => {
    setDecidingClaimId(claim.id)
    try {
      if (decision === 'approved') {
        if (claim.claim_type === 'late_event' || claim.claim_type === 'unassigned_claim') {
          if (!claim.events) {
            message.error("Couldn't find the linked event.")
            return
          }
          const hours = resolveEventHours(claim.programs?.name ?? '', claim.events, claim.locations ?? undefined)
          const { error: insertError } = await supabaseClient.from('timesheet_entries').insert({
            coach_id: claim.coach_id,
            program_id: claim.program_id,
            event_id: claim.event_id,
            location_id: claim.location_id,
            entry_date: claim.events.event_date,
            start_time: claim.events.start_time,
            end_time: claim.events.end_time,
            hours,
            session_name: claim.events.session_name,
            status: 'pending',
          })
          if (insertError) {
            message.error(`Couldn't create the entry: ${insertError.message}`)
            return
          }
        } else if (claim.claim_type === 'hours_correction') {
          if (claim.entry_id) {
            const { error: updateError } = await supabaseClient
              .from('timesheet_entries')
              .update({ hours: claim.requested_hours })
              .eq('id', claim.entry_id)
            if (updateError) {
              message.error(`Couldn't update the entry: ${updateError.message}`)
              return
            }
          } else {
            const { error: insertError } = await supabaseClient.from('timesheet_entries').insert({
              coach_id: claim.coach_id,
              program_id: claim.program_id,
              event_id: claim.event_id,
              location_id: claim.location_id,
              entry_date: claim.events?.event_date,
              start_time: claim.events?.start_time ?? null,
              end_time: claim.events?.end_time ?? null,
              hours: claim.requested_hours,
              session_name: claim.events?.session_name ?? null,
              status: 'pending',
            })
            if (insertError) {
              message.error(`Couldn't create the entry: ${insertError.message}`)
              return
            }
          }
        }
      }

      const { error } = await supabaseClient
        .from('payment_claims')
        .update({ status: decision, reviewed_by: identity?.id ?? null, reviewed_at: new Date().toISOString() })
        .eq('id', claim.id)
      if (error) {
        message.error(`Couldn't save the decision: ${error.message}`)
        return
      }
      message.success(decision === 'approved' ? 'Claim approved' : 'Claim denied')
      claimsQuery.refetch()
    } finally {
      setDecidingClaimId(null)
    }
  }

  const handleApproveUnstructured = async () => {
    if (!unstructuredModalClaim || unstructuredHoursInput == null) return
    setApprovingUnstructured(true)
    try {
      const claim = unstructuredModalClaim
      const { error: insertError } = await supabaseClient.from('timesheet_entries').insert({
        coach_id: claim.coach_id,
        program_id: claim.program_id,
        event_id: null,
        location_id: claim.location_id,
        entry_date: claim.approx_date,
        hours: unstructuredHoursInput,
        session_name: claim.reason,
        notes: claim.notes,
        status: 'pending',
      })
      if (insertError) {
        message.error(`Couldn't create the entry: ${insertError.message}`)
        return
      }
      const { error } = await supabaseClient
        .from('payment_claims')
        .update({ status: 'approved', reviewed_by: identity?.id ?? null, reviewed_at: new Date().toISOString() })
        .eq('id', claim.id)
      if (error) {
        message.error(`Couldn't save the decision: ${error.message}`)
        return
      }
      message.success('Claim approved')
      setUnstructuredModalClaim(null)
      setUnstructuredHoursInput(null)
      claimsQuery.refetch()
    } finally {
      setApprovingUnstructured(false)
    }
  }

  const rows: ReconciledEntry[] = useMemo(
    () => (result?.data ?? []).map((e) => ({ ...e, reconciliationStatus: computeStatus(e) })),
    [result?.data],
  )

  const flaggedCount = useMemo(() => rows.filter((r) => FLAGGED.includes(r.reconciliationStatus)).length, [rows])
  const visibleRows = useMemo(
    () => (onlyFlagged ? rows.filter((r) => FLAGGED.includes(r.reconciliationStatus)) : rows),
    [rows, onlyFlagged],
  )

  return (
    <div>
      <Typography.Title level={3}>Reconciliation</Typography.Title>
      <Typography.Paragraph type="secondary">
        Checks each logged session against the master calendar and Sprocket-derived assignment
        data, where that data exists. Verification only ever applies where real assignment
        records exist -- programs Sprocket doesn't track staff for (e.g. Annual Program) pass
        through unflagged, since there's nothing to check them against.
      </Typography.Paragraph>

      {oversightCandidates.length > 0 && (
        <Card
          title={`Oversight fee approval (${oversightCandidates.length})`}
          style={{ marginBottom: 16 }}
          size="small"
          loading={allFlatQuery.isLoading || ratesQuery.isLoading}
        >
          <Typography.Paragraph type="secondary">
            These coaches have an oversight coach configured on their 1v1 rate, but not every 1v1
            session necessarily had oversight actually happen -- confirm each one before it
            becomes a payable entry for the oversight coach.
          </Typography.Paragraph>
          <Table dataSource={oversightCandidates} rowKey="id" pagination={false} size="small">
            <Table.Column dataIndex="entry_date" title="Date" width={110} />
            <Table.Column title="Coach" render={(_, row: EntryRow) => row.coaches?.name ?? '—'} />
            <Table.Column
              title="Oversight coach"
              render={(_, row: EntryRow) => coachesById.get(ratesByCoachId.get(row.coach_id)?.oversight_coach_id ?? '')?.name ?? '—'}
            />
            <Table.Column
              title="Oversight fee"
              render={(_, row: EntryRow) => {
                const fee = ratesByCoachId.get(row.coach_id)?.oversight_fee
                return fee != null ? `$${fee.toFixed(2)}` : '—'
              }}
            />
            <Table.Column
              title="Actions"
              render={(_, row: EntryRow) => (
                <Space>
                  <Button
                    size="small"
                    type="primary"
                    loading={decidingId === row.id}
                    onClick={() => decide(row, 'approved')}
                  >
                    Approve
                  </Button>
                  <Button size="small" loading={decidingId === row.id} onClick={() => decide(row, 'declined')}>
                    Dismiss
                  </Button>
                </Space>
              )}
            />
          </Table>
        </Card>
      )}

      {swapRequests.length > 0 && (
        <Card
          title={`Swap requests (${swapRequests.length})`}
          style={{ marginBottom: 16 }}
          size="small"
          loading={swapRequestsQuery.isLoading}
        >
          <Table dataSource={swapRequests} rowKey="id" pagination={false} size="small">
            <Table.Column
              title="Date"
              width={110}
              render={(_, row: SwapRequestRow) => row.events?.event_date ?? '—'}
            />
            <Table.Column
              title="Coach"
              render={(_, row: SwapRequestRow) => coachesById.get(row.coach_id)?.name ?? '—'}
            />
            <Table.Column title="Program" render={(_, row: SwapRequestRow) => row.events?.programs?.name ?? '—'} />
            <Table.Column title="Location" render={(_, row: SwapRequestRow) => row.events?.locations?.name ?? '—'} />
            <Table.Column title="Session" render={(_, row: SwapRequestRow) => row.events?.session_name ?? '—'} />
            <Table.Column title="Reason" render={(_, row: SwapRequestRow) => row.reason || '—'} />
            <Table.Column
              title="Actions"
              render={(_, row: SwapRequestRow) => (
                <Space>
                  <Button
                    size="small"
                    type="primary"
                    loading={decidingSwapId === row.id}
                    onClick={() => decideSwap(row, 'approved')}
                  >
                    Approve
                  </Button>
                  <Button size="small" loading={decidingSwapId === row.id} onClick={() => decideSwap(row, 'denied')}>
                    Deny
                  </Button>
                </Space>
              )}
            />
          </Table>
        </Card>
      )}

      {claims.length > 0 && (
        <Card
          title={`Payment claims (${claims.length})`}
          style={{ marginBottom: 16 }}
          size="small"
          loading={claimsQuery.isLoading}
          extra={
            <Select
              size="small"
              style={{ width: 180 }}
              value={claimTypeFilter}
              onChange={(value) => setClaimTypeFilter(value)}
              options={[
                { label: 'All types', value: 'all' },
                { label: 'Late request', value: 'late_event' },
                { label: 'Unassigned claim', value: 'unassigned_claim' },
                { label: 'Unverified claim', value: 'unstructured' },
                { label: 'Hours correction', value: 'hours_correction' },
              ]}
            />
          }
        >
          <Table dataSource={visibleClaims} rowKey="id" pagination={false} size="small">
            <Table.Column
              title="Date"
              width={110}
              render={(_, row: PaymentClaimAdminRow) => row.events?.event_date ?? row.approx_date ?? '—'}
            />
            <Table.Column
              title="Coach"
              render={(_, row: PaymentClaimAdminRow) => coachesById.get(row.coach_id)?.name ?? '—'}
            />
            <Table.Column title="Type" render={(_, row: PaymentClaimAdminRow) => CLAIM_TYPE_LABELS[row.claim_type]} />
            <Table.Column title="Program" render={(_, row: PaymentClaimAdminRow) => row.programs?.name ?? '—'} />
            <Table.Column title="Location" render={(_, row: PaymentClaimAdminRow) => row.locations?.name ?? '—'} />
            <Table.Column title="Reason" render={(_, row: PaymentClaimAdminRow) => row.reason || '—'} />
            <Table.Column
              title="Hours"
              render={(_, row: PaymentClaimAdminRow) =>
                row.claim_type === 'hours_correction'
                  ? `${row.scheduled_hours?.toFixed(2) ?? '—'} → ${row.requested_hours?.toFixed(2) ?? '—'}`
                  : '—'
              }
            />
            <Table.Column
              title="Actions"
              render={(_, row: PaymentClaimAdminRow) => (
                <Space>
                  <Button
                    size="small"
                    type="primary"
                    loading={decidingClaimId === row.id}
                    onClick={() =>
                      row.claim_type === 'unstructured'
                        ? setUnstructuredModalClaim(row)
                        : decideClaim(row, 'approved')
                    }
                  >
                    Approve
                  </Button>
                  <Button size="small" loading={decidingClaimId === row.id} onClick={() => decideClaim(row, 'denied')}>
                    Deny
                  </Button>
                </Space>
              )}
            />
          </Table>
        </Card>
      )}

      <Space style={{ marginBottom: 16 }} wrap>
        <Segmented
          value={paymentFilter}
          onChange={(value) => setPaymentFilter(value as typeof paymentFilter)}
          options={[
            { label: 'Pending', value: 'pending' },
            { label: 'Paid', value: 'paid' },
            { label: 'All', value: 'all' },
          ]}
        />
        <Segmented
          value={onlyFlagged ? 'flagged' : 'all'}
          onChange={(value) => setOnlyFlagged(value === 'flagged')}
          options={[
            { label: `Flagged only (${flaggedCount})`, value: 'flagged' },
            { label: 'Show everything', value: 'all' },
          ]}
        />
      </Space>

      <Card size="small" loading={query.isLoading}>
        <Table<ReconciledEntry> dataSource={visibleRows} rowKey="id" pagination={{ pageSize: 50 }} size="small">
          <Table.Column dataIndex="entry_date" title="Date" width={110} />
          <Table.Column title="Coach" render={(_, row) => row.coaches?.name ?? '—'} />
          <Table.Column title="Program" render={(_, row) => row.programs?.name ?? '—'} />
          <Table.Column dataIndex="session_name" title="Session" render={(v) => v || '—'} />
          <Table.Column title="Hours" render={(_, row) => (row.hours != null ? row.hours.toFixed(2) : '—')} />
          <Table.Column
            title="Status"
            render={(_, row: ReconciledEntry) => {
              const meta = STATUS_META[row.reconciliationStatus]
              return meta.color ? <Tag color={meta.color}>{meta.label}</Tag> : <span>{meta.label}</span>
            }}
          />
          <Table.Column
            title="Payment"
            render={(_, row) =>
              row.status === 'paid' ? (
                <Tag color="green">Paid {row.paid_date}</Tag>
              ) : (
                <Tag>Pending</Tag>
              )
            }
          />
        </Table>
      </Card>

      <Modal
        title="Approve unverified claim"
        open={!!unstructuredModalClaim}
        onCancel={() => {
          setUnstructuredModalClaim(null)
          setUnstructuredHoursInput(null)
        }}
        onOk={handleApproveUnstructured}
        okText="Approve"
        okButtonProps={{ disabled: unstructuredHoursInput == null, loading: approvingUnstructured }}
      >
        <Typography.Paragraph type="secondary">
          There's no calendar event to derive hours from -- enter the hours to pay for this claim.
        </Typography.Paragraph>
        <InputNumber
          min={0}
          step={0.25}
          style={{ width: '100%' }}
          placeholder="Hours"
          value={unstructuredHoursInput ?? undefined}
          onChange={(value) => setUnstructuredHoursInput(value)}
        />
      </Modal>
    </div>
  )
}

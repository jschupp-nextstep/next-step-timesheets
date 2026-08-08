import { useMemo, useState } from 'react'
import { useList } from '@refinedev/core'
import { Card, Segmented, Space, Table, Tag, Typography } from 'antd'

type EventRef = {
  id: string
  is_cancelled: boolean
  event_assignments: { coach_id: string }[]
} | null

type EntryRow = {
  id: string
  entry_date: string
  coach_id: string
  hours: number | null
  session_name: string | null
  status: 'pending' | 'paid'
  paid_date: string | null
  coaches: { name: string } | null
  programs: { name: string; entry_mode: string } | null
  events: EventRef
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
  const [paymentFilter, setPaymentFilter] = useState<'pending' | 'paid' | 'all'>('pending')
  const [onlyFlagged, setOnlyFlagged] = useState(true)

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
    </div>
  )
}

import { useMemo, useState } from 'react'
import { useGetIdentity, useList, useDelete } from '@refinedev/core'
import { Button, Card, Empty, Popconfirm, Segmented, Space, Table, Typography } from 'antd'
import { Link } from 'react-router'
import dayjs from 'dayjs'

import type { Identity } from '../../providers/authProvider'

type EventAssignmentRow = {
  id: string
  event_id: string
  events: {
    id: string
    event_date: string
    start_time: string | null
    end_time: string | null
    session_name: string | null
    is_cancelled: boolean
    programs: { name: string } | null
    locations: { name: string } | null
  } | null
}

type NotYetLoggedRow = NonNullable<EventAssignmentRow['events']>

type TimesheetEntryRow = {
  id: string
  entry_date: string
  start_time: string | null
  end_time: string | null
  hours: number | null
  flat_amount: number | null
  session_name: string | null
  notes: string | null
  status: 'pending' | 'paid'
  paid_date: string | null
  event_id: string | null
  programs: { name: string } | null
  locations: { name: string } | null
}

const formatTimeRange = (start: string | null, end: string | null) => {
  if (!start) return ''
  const startLabel = dayjs(`2000-01-01T${start}`).format('h:mm A')
  if (!end) return startLabel
  return `${startLabel} – ${dayjs(`2000-01-01T${end}`).format('h:mm A')}`
}

const formatAmount = (row: TimesheetEntryRow) => {
  if (row.flat_amount != null) return `$${row.flat_amount.toFixed(2)}`
  return '—'
}

// Assignment data only exists where Sprocket actually tracks staff (Camp
// sessions) -- an Annual Program event never shows up here even when a
// coach worked it, since there's nothing to compare against. This view is
// a floor, not a full audit -- it can only surface gaps where we actually
// have something to check.
const ASSIGNMENT_LOOKBACK_DAYS = 90

export const MySessions = () => {
  const { data: identity } = useGetIdentity<Identity>()
  const coachId = identity?.role === 'coach' ? identity.coachId : undefined
  const [tab, setTab] = useState<'current' | 'paid'>('current')
  const { mutate: deleteEntry } = useDelete()

  const minAssignmentDate = dayjs().subtract(ASSIGNMENT_LOOKBACK_DAYS, 'day').format('YYYY-MM-DD')
  const today = dayjs().format('YYYY-MM-DD')

  const { result: assignmentsResult, query: assignmentsQuery } = useList<EventAssignmentRow>({
    resource: 'event_assignments',
    meta: {
      select:
        'id, event_id, events!inner(id, event_date, start_time, end_time, session_name, is_cancelled, programs(name), locations(name))',
    },
    filters: [
      { field: 'coach_id', operator: 'eq', value: coachId },
      { field: 'events.event_date', operator: 'gte', value: minAssignmentDate },
      { field: 'events.event_date', operator: 'lte', value: today },
    ],
    pagination: { pageSize: 200 },
    queryOptions: { enabled: !!coachId },
  })

  const { result: entriesResult, query: entriesQuery } = useList<TimesheetEntryRow>({
    resource: 'timesheet_entries',
    meta: { select: '*, programs(name), locations(name)' },
    filters: [{ field: 'coach_id', operator: 'eq', value: coachId }],
    sorters: [{ field: 'entry_date', order: 'desc' }],
    pagination: { pageSize: 500 },
    queryOptions: { enabled: !!coachId },
  })

  const assignments = assignmentsResult?.data ?? []
  const entries = entriesResult?.data ?? []

  const loggedEventIds = useMemo(
    () => new Set(entries.filter((e) => e.event_id).map((e) => e.event_id)),
    [entries],
  )

  const notYetLogged = useMemo(
    () =>
      assignments
        .filter((a) => a.events && !a.events.is_cancelled && !loggedEventIds.has(a.event_id))
        .map((a) => a.events!)
        .sort((a, b) => b.event_date.localeCompare(a.event_date)),
    [assignments, loggedEventIds],
  )

  const pendingEntries = useMemo(() => entries.filter((e) => e.status === 'pending'), [entries])
  const paidEntries = useMemo(() => entries.filter((e) => e.status === 'paid'), [entries])

  const isLoading = assignmentsQuery.isLoading || entriesQuery.isLoading

  const handleDelete = (id: string) => {
    deleteEntry({ resource: 'timesheet_entries', id })
  }

  return (
    <div>
      <Typography.Title level={3}>My Sessions</Typography.Title>

      <Segmented
        style={{ marginBottom: 16 }}
        value={tab}
        onChange={(value) => setTab(value as 'current' | 'paid')}
        options={[
          { label: 'Current', value: 'current' },
          { label: 'Paid history', value: 'paid' },
        ]}
      />

      {tab === 'current' && (
        <>
          <Card title="Not yet logged" style={{ marginBottom: 16 }} size="small" loading={isLoading}>
            {notYetLogged.length === 0 ? (
              <Empty
                description="Nothing outstanding -- every session you're scheduled for in the last 90 days has been logged."
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            ) : (
              <Table<NotYetLoggedRow>
                dataSource={notYetLogged}
                rowKey="id"
                pagination={false}
                size="small"
              >
                <Table.Column dataIndex="event_date" title="Date" width={110} />
                <Table.Column title="Program" render={(_, row) => row.programs?.name ?? '—'} />
                <Table.Column title="Location" render={(_, row) => row.locations?.name ?? '—'} />
                <Table.Column dataIndex="session_name" title="Session" />
                <Table.Column
                  title="Time"
                  render={(_, row) => formatTimeRange(row.start_time, row.end_time)}
                />
              </Table>
            )}
          </Card>

          <Card
            title="Logged, pending payment"
            size="small"
            loading={isLoading}
            extra={
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Editable until paid
              </Typography.Text>
            }
          >
            {pendingEntries.length === 0 ? (
              <Empty description="No pending entries yet." image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <Table dataSource={pendingEntries} rowKey="id" pagination={false} size="small">
                <Table.Column dataIndex="entry_date" title="Date" width={110} />
                <Table.Column
                  title="Program"
                  render={(_, row: TimesheetEntryRow) => row.programs?.name ?? '—'}
                />
                <Table.Column
                  title="Location"
                  render={(_, row: TimesheetEntryRow) => row.locations?.name ?? '—'}
                />
                <Table.Column dataIndex="session_name" title="Session" render={(v) => v || '—'} />
                <Table.Column
                  title="Hours"
                  render={(_, row: TimesheetEntryRow) => (row.hours != null ? row.hours.toFixed(2) : '—')}
                />
                <Table.Column title="Amount" render={(_, row: TimesheetEntryRow) => formatAmount(row)} />
                <Table.Column
                  title="Actions"
                  render={(_, row: TimesheetEntryRow) => (
                    <Space>
                      <Link to={`/log-session/edit/${row.id}`}>Edit</Link>
                      <Popconfirm
                        title="Delete this entry?"
                        okText="Delete"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => handleDelete(row.id)}
                      >
                        <Button type="link" danger size="small" style={{ padding: 0 }}>
                          Delete
                        </Button>
                      </Popconfirm>
                    </Space>
                  )}
                />
              </Table>
            )}
          </Card>
        </>
      )}

      {tab === 'paid' && (
        <Card title="Paid history" size="small" loading={isLoading}>
          {paidEntries.length === 0 ? (
            <Empty description="No paid entries yet." image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            <Table dataSource={paidEntries} rowKey="id" pagination={false} size="small">
              <Table.Column dataIndex="entry_date" title="Date" width={110} />
              <Table.Column
                title="Program"
                render={(_, row: TimesheetEntryRow) => row.programs?.name ?? '—'}
              />
              <Table.Column
                title="Location"
                render={(_, row: TimesheetEntryRow) => row.locations?.name ?? '—'}
              />
              <Table.Column dataIndex="session_name" title="Session" render={(v) => v || '—'} />
              <Table.Column
                title="Hours"
                render={(_, row: TimesheetEntryRow) => (row.hours != null ? row.hours.toFixed(2) : '—')}
              />
              <Table.Column title="Amount" render={(_, row: TimesheetEntryRow) => formatAmount(row)} />
              <Table.Column dataIndex="paid_date" title="Paid" width={110} render={(v) => v || '—'} />
            </Table>
          )}
        </Card>
      )}
    </div>
  )
}

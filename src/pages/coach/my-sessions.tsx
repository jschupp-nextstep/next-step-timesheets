import { useMemo, useState } from 'react'
import { useGetIdentity, useList, useDelete, useUpdate } from '@refinedev/core'
import { App, Button, Card, Empty, Input, Modal, Popconfirm, Segmented, Space, Table, Tag, Typography } from 'antd'
import { Link } from 'react-router'
import dayjs from 'dayjs'

import { supabaseClient } from '../../utility/supabaseClient'
import type { Identity } from '../../providers/authProvider'

type EventAssignmentRow = {
  id: string
  event_id: string
  coach_confirmed_at: string | null
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
type UpcomingRow = NotYetLoggedRow & { assignmentId: string; coachConfirmedAt: string | null }

type SwapRequestRow = {
  id: string
  event_id: string
  reason: string | null
  status: 'pending' | 'approved' | 'denied'
  requested_at: string
  events: {
    event_date: string
    session_name: string | null
    programs: { name: string } | null
    locations: { name: string } | null
  } | null
}

const SWAP_STATUS_META: Record<SwapRequestRow['status'], { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'gold' },
  approved: { label: 'Approved', color: 'green' },
  denied: { label: 'Denied', color: 'red' },
}

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
const ASSIGNMENT_LOOKAHEAD_DAYS = 30

export const MySessions = () => {
  const { message } = App.useApp()
  const { data: identity } = useGetIdentity<Identity>()
  const coachId = identity?.role === 'coach' ? identity.coachId : undefined
  const [tab, setTab] = useState<'current' | 'paid'>('current')
  const { mutate: deleteEntry } = useDelete()
  const { mutate: updateAssignment } = useUpdate()

  const [swapModalEvent, setSwapModalEvent] = useState<{ id: string; label: string } | null>(null)
  const [swapReason, setSwapReason] = useState('')
  const [submittingSwap, setSubmittingSwap] = useState(false)

  const minAssignmentDate = dayjs().subtract(ASSIGNMENT_LOOKBACK_DAYS, 'day').format('YYYY-MM-DD')
  const maxAssignmentDate = dayjs().add(ASSIGNMENT_LOOKAHEAD_DAYS, 'day').format('YYYY-MM-DD')
  const today = dayjs().format('YYYY-MM-DD')

  const { result: assignmentsResult, query: assignmentsQuery } = useList<EventAssignmentRow>({
    resource: 'event_assignments',
    meta: {
      select:
        'id, event_id, coach_confirmed_at, events!inner(id, event_date, start_time, end_time, session_name, is_cancelled, programs(name), locations(name))',
    },
    filters: [
      { field: 'coach_id', operator: 'eq', value: coachId },
      { field: 'events.event_date', operator: 'gte', value: minAssignmentDate },
      { field: 'events.event_date', operator: 'lte', value: maxAssignmentDate },
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

  const {
    result: swapRequestsResult,
    query: swapRequestsQuery,
  } = useList<SwapRequestRow>({
    resource: 'swap_requests',
    meta: { select: '*, events(event_date, session_name, programs(name), locations(name))' },
    filters: [{ field: 'coach_id', operator: 'eq', value: coachId }],
    sorters: [{ field: 'requested_at', order: 'desc' }],
    pagination: { pageSize: 200 },
    queryOptions: { enabled: !!coachId },
  })

  const assignments = assignmentsResult?.data ?? []
  const entries = entriesResult?.data ?? []
  const swapRequests = swapRequestsResult?.data ?? []

  const pendingSwapEventIds = useMemo(
    () => new Set(swapRequests.filter((r) => r.status === 'pending').map((r) => r.event_id)),
    [swapRequests],
  )

  const loggedEventIds = useMemo(
    () => new Set(entries.filter((e) => e.event_id).map((e) => e.event_id)),
    [entries],
  )

  const notYetLogged = useMemo(
    () =>
      assignments
        .filter(
          (a) => a.events && !a.events.is_cancelled && a.events.event_date <= today && !loggedEventIds.has(a.event_id),
        )
        .map((a) => a.events!)
        .sort((a, b) => b.event_date.localeCompare(a.event_date)),
    [assignments, loggedEventIds, today],
  )

  const upcoming = useMemo(
    () =>
      assignments
        .filter(
          (a) => a.events && !a.events.is_cancelled && a.events.event_date > today && !loggedEventIds.has(a.event_id),
        )
        .map((a) => ({ ...a.events!, assignmentId: a.id, coachConfirmedAt: a.coach_confirmed_at }))
        .sort((a, b) => a.event_date.localeCompare(b.event_date)),
    [assignments, loggedEventIds, today],
  )

  const pendingEntries = useMemo(() => entries.filter((e) => e.status === 'pending'), [entries])
  const paidEntries = useMemo(() => entries.filter((e) => e.status === 'paid'), [entries])

  const isLoading = assignmentsQuery.isLoading || entriesQuery.isLoading

  const handleDelete = (id: string) => {
    deleteEntry({ resource: 'timesheet_entries', id })
  }

  const handleConfirmAttendance = (assignmentId: string) => {
    updateAssignment({
      resource: 'event_assignments',
      id: assignmentId,
      values: { coach_confirmed_at: new Date().toISOString() },
    })
  }

  const handleSubmitSwap = async () => {
    if (!coachId || !swapModalEvent || !swapReason.trim()) return
    setSubmittingSwap(true)
    try {
      const { error } = await supabaseClient.from('swap_requests').insert({
        coach_id: coachId,
        event_id: swapModalEvent.id,
        reason: swapReason.trim(),
      })
      if (error) {
        message.error(`Couldn't submit swap request: ${error.message}`)
        return
      }
      message.success('Swap request sent to an admin for review.')
      setSwapModalEvent(null)
      setSwapReason('')
      swapRequestsQuery.refetch()
    } finally {
      setSubmittingSwap(false)
    }
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
          <Card title="Upcoming" style={{ marginBottom: 16 }} size="small" loading={isLoading}>
            {upcoming.length === 0 ? (
              <Empty
                description={`No upcoming assigned sessions in the next ${ASSIGNMENT_LOOKAHEAD_DAYS} days.`}
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            ) : (
              <Table<UpcomingRow> dataSource={upcoming} rowKey="assignmentId" pagination={false} size="small">
                <Table.Column dataIndex="event_date" title="Date" width={110} />
                <Table.Column title="Program" render={(_, row) => row.programs?.name ?? '—'} />
                <Table.Column title="Location" render={(_, row) => row.locations?.name ?? '—'} />
                <Table.Column dataIndex="session_name" title="Session" />
                <Table.Column
                  title="Time"
                  render={(_, row) => formatTimeRange(row.start_time, row.end_time)}
                />
                <Table.Column
                  title="Actions"
                  render={(_, row: UpcomingRow) => (
                    <Space>
                      {row.coachConfirmedAt ? (
                        <Tag color="green">Confirmed</Tag>
                      ) : (
                        <Button size="small" onClick={() => handleConfirmAttendance(row.assignmentId)}>
                          I'll be there
                        </Button>
                      )}
                      {pendingSwapEventIds.has(row.id) ? (
                        <Tag color="gold">Swap requested</Tag>
                      ) : (
                        <Button
                          size="small"
                          onClick={() =>
                            setSwapModalEvent({ id: row.id, label: `${row.event_date} — ${row.programs?.name ?? 'session'}` })
                          }
                        >
                          Request swap
                        </Button>
                      )}
                    </Space>
                  )}
                />
              </Table>
            )}
          </Card>

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
                <Table.Column
                  title="Actions"
                  render={(_, row: NotYetLoggedRow) => (
                    <Space>
                      <Link to={`/log-session/confirm/${row.id}`}>Confirm hours</Link>
                      {pendingSwapEventIds.has(row.id) ? (
                        <Tag color="gold">Swap requested</Tag>
                      ) : (
                        <Button
                          size="small"
                          onClick={() =>
                            setSwapModalEvent({ id: row.id, label: `${row.event_date} — ${row.programs?.name ?? 'session'}` })
                          }
                        >
                          Request swap
                        </Button>
                      )}
                    </Space>
                  )}
                />
              </Table>
            )}
          </Card>

          {swapRequests.length > 0 && (
            <Card title="Swap requests" style={{ marginBottom: 16 }} size="small" loading={isLoading}>
              <Table<SwapRequestRow> dataSource={swapRequests} rowKey="id" pagination={false} size="small">
                <Table.Column
                  title="Date"
                  width={110}
                  render={(_, row) => row.events?.event_date ?? '—'}
                />
                <Table.Column title="Program" render={(_, row) => row.events?.programs?.name ?? '—'} />
                <Table.Column title="Location" render={(_, row) => row.events?.locations?.name ?? '—'} />
                <Table.Column title="Session" render={(_, row) => row.events?.session_name ?? '—'} />
                <Table.Column dataIndex="reason" title="Reason" render={(v) => v || '—'} />
                <Table.Column
                  title="Status"
                  render={(_, row: SwapRequestRow) => {
                    const meta = SWAP_STATUS_META[row.status]
                    return <Tag color={meta.color}>{meta.label}</Tag>
                  }}
                />
              </Table>
            </Card>
          )}

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

      <Modal
        title="Request a swap"
        open={!!swapModalEvent}
        onCancel={() => {
          setSwapModalEvent(null)
          setSwapReason('')
        }}
        onOk={handleSubmitSwap}
        okText="Send request"
        okButtonProps={{ disabled: !swapReason.trim(), loading: submittingSwap }}
      >
        <Typography.Paragraph type="secondary">
          {swapModalEvent?.label} -- an admin will review this and, if approved, remove you from the
          assignment.
        </Typography.Paragraph>
        <Input.TextArea
          rows={3}
          placeholder="Why do you need to swap this session?"
          value={swapReason}
          onChange={(e) => setSwapReason(e.target.value)}
        />
      </Modal>
    </div>
  )
}

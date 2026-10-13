import { useMemo, useState } from 'react'
import { useList } from '@refinedev/core'
import { Alert, App, Button, Card, Empty, Input, Modal, Space, Table, Tag, Typography } from 'antd'
import dayjs from 'dayjs'
import { Link } from 'react-router'

import { supabaseClient } from '../../utility/supabaseClient'
import { useScheduleAction } from '../../utility/scheduleActions'
import { describeChange, formatTimeRange, type ScheduleChangeRow } from '../../utility/scheduleChanges'
import { paidWindow, resolveEventHours } from '../../utils/hours'

type ChangeWithEvent = ScheduleChangeRow & {
  events: {
    event_date: string
    start_time: string | null
    end_time: string | null
    session_name: string | null
    is_cancelled: boolean
    paid_early_minutes: number | null
    programs: { name: string } | null
    locations: { name: string; half_day_hours: number | null; full_day_hours: number | null } | null
  } | null
}

type AffectedEntry = {
  id: string
  coach_id: string
  event_id: string
  entry_date: string
  hours: number | null
  status: 'pending' | 'paid'
  paid_date: string | null
  coaches: { name: string } | null
  programs: { name: string; paid_early_minutes: number | null } | null
}

type EventGroup = { eventId: string; event: ChangeWithEvent['events']; changes: ChangeWithEvent[] }

// R2c review queue. Scheduler changes arrive as needs_review; entries on
// their events are held out of Payment Due / Zoho until every change on the
// event is reviewed or reversed. Admin changes never appear here -- they're
// recorded as reviewed already.
export const ScheduleChangesCard = ({ onReviewed }: { onReviewed?: () => void }) => {
  const { message } = App.useApp()
  const { run, running } = useScheduleAction()
  const [reversing, setReversing] = useState<ChangeWithEvent | null>(null)
  const [reverseReason, setReverseReason] = useState('')
  const [updatingEntryId, setUpdatingEntryId] = useState<string | null>(null)

  const { result, query } = useList<ChangeWithEvent>({
    resource: 'schedule_changes',
    meta: {
      select:
        '*, events(event_date, start_time, end_time, session_name, is_cancelled, paid_early_minutes, programs(name), locations(name, half_day_hours, full_day_hours))',
    },
    filters: [{ field: 'review_status', operator: 'eq', value: 'needs_review' }],
    sorters: [{ field: 'changed_at', order: 'asc' }],
    pagination: { pageSize: 500 },
  })
  const changes = useMemo(() => result?.data ?? [], [result?.data])
  const eventIds = useMemo(() => [...new Set(changes.map((c) => c.event_id))], [changes])

  const { result: entriesResult, query: entriesQuery } = useList<AffectedEntry>({
    resource: 'timesheet_entries',
    meta: { select: 'id, coach_id, event_id, entry_date, hours, status, paid_date, coaches(name), programs(name, paid_early_minutes)' },
    filters: [{ field: 'event_id', operator: 'in', value: eventIds }],
    pagination: { pageSize: 1000 },
    queryOptions: { enabled: eventIds.length > 0 },
  })
  const { result: assignmentsResult, query: assignmentsQuery } = useList<{ event_id: string; coach_id: string }>({
    resource: 'event_assignments',
    meta: { select: 'event_id, coach_id' },
    filters: [{ field: 'event_id', operator: 'in', value: eventIds }],
    pagination: { pageSize: 1000 },
    queryOptions: { enabled: eventIds.length > 0 },
  })
  const { result: directoryResult } = useList<{ id: string; name: string }>({
    resource: 'coach_directory',
    pagination: { pageSize: 500 },
  })

  const namesById = useMemo(() => new Map((directoryResult?.data ?? []).map((c) => [c.id, c.name])), [directoryResult?.data])
  const coachName = (id: string | null) => (id ? (namesById.get(id) ?? 'Unknown coach') : 'Unknown coach')

  const groups: EventGroup[] = useMemo(() => {
    const map = new Map<string, EventGroup>()
    for (const c of changes) {
      const g = map.get(c.event_id) ?? { eventId: c.event_id, event: c.events, changes: [] }
      g.changes.push(c)
      map.set(c.event_id, g)
    }
    return [...map.values()].sort((a, b) => (a.event?.event_date ?? '').localeCompare(b.event?.event_date ?? ''))
  }, [changes])

  const entriesByEvent = useMemo(() => {
    const map = new Map<string, AffectedEntry[]>()
    for (const e of entriesResult?.data ?? []) map.set(e.event_id, [...(map.get(e.event_id) ?? []), e])
    return map
  }, [entriesResult?.data])
  const assignedByEvent = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const a of assignmentsResult?.data ?? []) {
      if (!map.has(a.event_id)) map.set(a.event_id, new Set())
      map.get(a.event_id)!.add(a.coach_id)
    }
    return map
  }, [assignmentsResult?.data])

  const refetchAll = () => {
    query.refetch()
    entriesQuery.refetch()
    assignmentsQuery.refetch()
    onReviewed?.()
  }

  const markReviewed = async (ids: string[]) => {
    const ok = await run('schedule_mark_reviewed', { p_change_ids: ids }, ids.length === 1 ? 'Marked reviewed' : `${ids.length} changes marked reviewed`)
    if (ok) refetchAll()
  }

  const submitReverse = async () => {
    if (!reversing) return
    const ok = await run('schedule_reverse', { p_change_id: reversing.id, p_reason: reverseReason }, 'Change reversed')
    if (ok) {
      setReversing(null)
      setReverseReason('')
      refetchAll()
    }
  }

  // After a time change, an entry confirmed earlier still holds the old
  // hours. Admin-only fix-up: set it to what the session is worth now.
  const updateEntryHours = async (entry: AffectedEntry, group: EventGroup, hours: number) => {
    setUpdatingEntryId(entry.id)
    try {
      const { error } = await supabaseClient
        .from('timesheet_entries')
        .update({
          hours,
          start_time: group.event ? paidWindow(entry.programs ?? { name: '' }, group.event).start : null,
          end_time: group.event?.end_time ?? null,
        })
        .eq('id', entry.id)
        .eq('status', 'pending')
      if (error) message.error(`Couldn't update the entry: ${error.message}`)
      else message.success(`${entry.coaches?.name ?? 'Entry'} updated to ${hours.toFixed(2)} hrs`)
      entriesQuery.refetch()
    } finally {
      setUpdatingEntryId(null)
    }
  }

  const entryFlags = (entry: AffectedEntry, group: EventGroup) => {
    const flags: { text: string; action?: { label: string; hours: number } }[] = []
    const stillAssigned = assignedByEvent.get(group.eventId)?.has(entry.coach_id) ?? false
    const wasRemoved = group.changes.some(
      (c) => (c.change_type === 'remove' || c.change_type === 'sub') && c.removed_coach_id === entry.coach_id,
    )
    if (wasRemoved && !stillAssigned) {
      flags.push({
        text:
          entry.status === 'paid'
            ? `Already paid (${entry.paid_date ?? 'old system'}) before being taken off this session -- recorded, no clawback.`
            : 'Logged hours, then taken off this session. Entry kept -- edit or delete it in Timesheet Entries if they didn\'t work it.',
      })
    }
    if (group.changes.some((c) => c.change_type === 'time') && group.event) {
      const nowWorth = resolveEventHours(entry.programs ?? { name: '' }, group.event, group.event.locations ?? undefined)
      if (nowWorth != null && entry.hours != null && Math.abs(nowWorth - entry.hours) > 0.001) {
        flags.push({
          text: `Recorded ${entry.hours.toFixed(2)} hrs; the session is now ${nowWorth.toFixed(2)} hrs.${entry.status === 'paid' ? ' Already paid at the old hours -- no clawback.' : ''}`,
          action: entry.status === 'pending' ? { label: `Update to ${nowWorth.toFixed(2)} hrs`, hours: nowWorth } : undefined,
        })
      }
    }
    if (group.changes.some((c) => c.change_type === 'cancel') && group.event?.is_cancelled) {
      flags.push({ text: 'Session is now cancelled but has logged hours -- decide whether this is paid (R6 rules).' })
    }
    return flags
  }

  return (
    <Card
      title={`Schedule changes to review (${changes.length})`}
      size="small"
      style={{ marginBottom: 16 }}
      loading={query.isLoading}
    >
      <Typography.Paragraph type="secondary">
        Changes schedulers made. They're already live; entries on these sessions are held out of Payment Due and
        the Zoho export until every change on the session is reviewed or reversed. Your own changes don't need
        review.
      </Typography.Paragraph>
      {groups.length === 0 ? (
        <Empty description="Nothing to review" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        groups.map((group) => {
          const entries = entriesByEvent.get(group.eventId) ?? []
          return (
            <Card
              key={group.eventId}
              type="inner"
              size="small"
              style={{ marginBottom: 12 }}
              title={
                <Space wrap>
                  <Link to={`/schedule-board/event/${group.eventId}`}>
                    {group.event ? dayjs(group.event.event_date).format('ddd M/D') : '?'} ·{' '}
                    {formatTimeRange(group.event?.start_time ?? null, group.event?.end_time ?? null)}
                  </Link>
                  <Typography.Text type="secondary">
                    {group.event?.programs?.name} · {group.event?.locations?.name}
                    {group.event?.session_name ? ` · ${group.event.session_name}` : ''}
                  </Typography.Text>
                  {group.event?.is_cancelled && <Tag color="red">Cancelled</Tag>}
                </Space>
              }
              extra={
                group.changes.length > 1 && (
                  <Button size="small" loading={running} onClick={() => markReviewed(group.changes.map((c) => c.id))}>
                    Mark all reviewed
                  </Button>
                )
              }
            >
              <Table<ChangeWithEvent> dataSource={group.changes} rowKey="id" size="small" pagination={false} showHeader={false}>
                <Table.Column
                  render={(_, c: ChangeWithEvent) => (
                    <Space direction="vertical" size={0}>
                      <Typography.Text strong>{describeChange(c, coachName)}</Typography.Text>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {c.changed_by_email} · {dayjs(c.changed_at).format('MMM D, h:mm A')} · "{c.reason}"
                      </Typography.Text>
                    </Space>
                  )}
                />
                <Table.Column
                  width={210}
                  render={(_, c: ChangeWithEvent) => (
                    <Space>
                      <Button size="small" type="primary" loading={running} onClick={() => markReviewed([c.id])}>
                        Mark reviewed
                      </Button>
                      <Button size="small" onClick={() => setReversing(c)}>
                        Reverse
                      </Button>
                    </Space>
                  )}
                />
              </Table>

              {entries.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Entries on this session:
                  </Typography.Text>
                  {entries.map((entry) => {
                    const flags = entryFlags(entry, group)
                    return (
                      <div key={entry.id} style={{ padding: '4px 0' }}>
                        <Space wrap>
                          <Typography.Text>{entry.coaches?.name}</Typography.Text>
                          <Typography.Text type="secondary">
                            {entry.hours != null ? `${entry.hours.toFixed(2)} hrs` : '—'}
                          </Typography.Text>
                          {entry.status === 'paid' ? <Tag color="green">Paid</Tag> : <Tag color="gold">Held</Tag>}
                        </Space>
                        {flags.map((f) => (
                          <Alert
                            key={f.text}
                            style={{ marginTop: 4 }}
                            type="warning"
                            showIcon
                            message={f.text}
                            action={
                              f.action && (
                                <Button
                                  size="small"
                                  loading={updatingEntryId === entry.id}
                                  onClick={() => updateEntryHours(entry, group, f.action!.hours)}
                                >
                                  {f.action.label}
                                </Button>
                              )
                            }
                          />
                        ))}
                      </div>
                    )
                  })}
                </div>
              )}
            </Card>
          )
        })
      )}

      <Modal
        open={!!reversing}
        title="Reverse this change?"
        okText="Reverse"
        okButtonProps={{ danger: true, disabled: !reverseReason.trim(), loading: running }}
        onOk={submitReverse}
        onCancel={() => setReversing(null)}
        destroyOnHidden
      >
        {reversing && (
          <Typography.Paragraph>
            <strong>{describeChange(reversing, coachName)}</strong> will be undone and the undo logged as your change.
            {reversing.change_type === 'create' && ' The session will be cancelled, not deleted.'}
          </Typography.Paragraph>
        )}
        <Input.TextArea
          rows={2}
          placeholder="Reason (required)"
          value={reverseReason}
          onChange={(e) => setReverseReason(e.target.value)}
        />
      </Modal>
    </Card>
  )
}

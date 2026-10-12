import { useMemo, useState } from 'react'
import { useGetIdentity, useList, useOne } from '@refinedev/core'
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Select,
  Space,
  Tag,
  TimePicker,
  Typography,
} from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { Link, useParams } from 'react-router'

import type { Identity } from '../../providers/authProvider'
import { useScheduleAction, type ScheduleFunction } from '../../utility/scheduleActions'
import { describeChange, formatTimeRange, type ScheduleChangeRow } from '../../utility/scheduleChanges'

type Assignment = { id: string; coach_id: string; covering_for_coach_id: string | null; source: string }
type EventRow = {
  id: string
  event_date: string
  start_time: string | null
  end_time: string | null
  session_name: string | null
  is_cancelled: boolean
  series_id: string | null
  programs: { name: string } | null
  locations: { name: string } | null
  event_assignments: Assignment[]
}
type DirectoryRow = { id: string; name: string; is_active: boolean }

type Action =
  | { kind: 'sub'; coachId: string }
  | { kind: 'remove'; coachId: string }
  | { kind: 'add' }
  | { kind: 'time' }
  | { kind: 'cancel' }
  | { kind: 'restore' }

const ACTION_TITLES: Record<Action['kind'], string> = {
  sub: 'Sub in a coach',
  remove: 'Remove coach',
  add: 'Add a coach',
  time: 'Change time',
  cancel: 'Cancel this session',
  restore: 'Restore this session',
}

// One event, its coaches, the quick actions, and its change history.
// Shared by admins (/schedule-board/event/:id) and schedulers
// (/schedule/event/:id); the database decides what each may actually do,
// and any refusal is shown by useScheduleAction.
export const ScheduleEvent = () => {
  const { id } = useParams()
  const { data: identity } = useGetIdentity<Identity>()
  const backTo = identity?.role === 'admin' ? '/schedule-board' : '/schedule'
  const { run, running } = useScheduleAction()

  const [action, setAction] = useState<Action | null>(null)
  const [reason, setReason] = useState('')
  const [inCoachId, setInCoachId] = useState<string | undefined>()
  const [newStart, setNewStart] = useState<Dayjs | null>(null)
  const [newEnd, setNewEnd] = useState<Dayjs | null>(null)
  const [applyToSeries, setApplyToSeries] = useState(false)

  const { result: event, query: eventQuery } = useOne<EventRow>({
    resource: 'events',
    id,
    meta: {
      select:
        '*, programs(name), locations(name), event_assignments(id, coach_id, covering_for_coach_id, source)',
    },
  })
  const { result: directoryResult } = useList<DirectoryRow>({
    resource: 'coach_directory',
    sorters: [{ field: 'name', order: 'asc' }],
    pagination: { pageSize: 500 },
  })
  const { result: historyResult, query: historyQuery } = useList<ScheduleChangeRow>({
    resource: 'schedule_changes',
    filters: [{ field: 'event_id', operator: 'eq', value: id }],
    sorters: [{ field: 'changed_at', order: 'desc' }],
    pagination: { pageSize: 200 },
  })

  const directory = directoryResult?.data ?? []
  const namesById = useMemo(() => new Map(directory.map((c) => [c.id, c.name])), [directory])
  const coachName = (coachId: string | null) => (coachId ? (namesById.get(coachId) ?? 'Unknown coach') : 'Unknown coach')
  const assignedIds = new Set((event?.event_assignments ?? []).map((a) => a.coach_id))
  const pickableCoaches = directory.filter((c) => c.is_active && !assignedIds.has(c.id))

  const openAction = (next: Action) => {
    setAction(next)
    setReason('')
    setInCoachId(undefined)
    setApplyToSeries(false)
    setNewStart(event?.start_time ? dayjs(`2000-01-01T${event.start_time}`) : null)
    setNewEnd(event?.end_time ? dayjs(`2000-01-01T${event.end_time}`) : null)
  }

  // Deliberately NOT pre-validating permission or required fields beyond
  // what's needed to build the call: the database is the authority, and its
  // message is what the person sees.
  const submit = async () => {
    if (!action || !event) return
    let fn: ScheduleFunction
    let args: Record<string, unknown>
    let success: string
    switch (action.kind) {
      case 'sub':
        fn = 'schedule_sub'
        args = { p_event_id: event.id, p_out_coach_id: action.coachId, p_in_coach_id: inCoachId, p_reason: reason }
        success = `${coachName(inCoachId ?? null)} is now covering for ${coachName(action.coachId)}`
        break
      case 'remove':
        fn = 'schedule_remove'
        args = { p_event_id: event.id, p_coach_id: action.coachId, p_reason: reason }
        success = `Removed ${coachName(action.coachId)}`
        break
      case 'add':
        fn = 'schedule_add'
        args = { p_event_id: event.id, p_coach_id: inCoachId, p_reason: reason }
        success = `Added ${coachName(inCoachId ?? null)}`
        break
      case 'time':
        fn = 'schedule_change_time'
        args = {
          p_event_id: event.id,
          p_new_start: newStart?.format('HH:mm:ss') ?? null,
          p_new_end: newEnd?.format('HH:mm:ss') ?? null,
          p_reason: reason,
          p_apply_to_series: applyToSeries,
        }
        success = applyToSeries ? 'Time changed for this and later sessions' : 'Time changed'
        break
      case 'cancel':
      case 'restore':
        fn = 'schedule_set_cancelled'
        args = { p_event_id: event.id, p_cancelled: action.kind === 'cancel', p_reason: reason }
        success = action.kind === 'cancel' ? 'Session cancelled' : 'Session restored'
        break
    }
    const ok = await run(fn, args, success)
    if (ok) {
      setAction(null)
      eventQuery.refetch()
      historyQuery.refetch()
    }
  }

  const needsCoachPick = action?.kind === 'sub' || action?.kind === 'add'
  const canSubmit = !!reason.trim() && (!needsCoachPick || !!inCoachId) && (action?.kind !== 'time' || (!!newStart && !!newEnd))

  if (eventQuery.isLoading) return <Card loading style={{ maxWidth: 640 }} />
  if (!event) {
    return (
      <div style={{ maxWidth: 640 }}>
        <Alert type="warning" showIcon message="That event wasn't found." />
        <Link to={backTo}>← Back</Link>
      </div>
    )
  }

  const history = historyResult?.data ?? []

  return (
    <div style={{ maxWidth: 640 }}>
      <Link to={backTo}>← Back</Link>
      <Typography.Title level={3} style={{ marginTop: 8 }}>
        {dayjs(event.event_date).format('ddd, MMM D')} · {formatTimeRange(event.start_time, event.end_time)}
      </Typography.Title>
      <Typography.Paragraph>
        {event.programs?.name ?? '—'} · {event.locations?.name ?? '—'}
        {event.session_name ? ` · ${event.session_name}` : ''}
        {event.is_cancelled && (
          <Tag color="red" style={{ marginLeft: 8 }}>
            Cancelled
          </Tag>
        )}
      </Typography.Paragraph>

      <Card size="small" title="Coaches" style={{ marginBottom: 16 }}>
        {event.event_assignments.length === 0 ? (
          <Empty description="No one assigned" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <List
            dataSource={event.event_assignments}
            renderItem={(a) => (
              <List.Item
                actions={[
                  <Button key="sub" size="small" onClick={() => openAction({ kind: 'sub', coachId: a.coach_id })}>
                    Sub
                  </Button>,
                  <Button key="remove" size="small" danger onClick={() => openAction({ kind: 'remove', coachId: a.coach_id })}>
                    Remove
                  </Button>,
                ]}
              >
                <Space direction="vertical" size={0}>
                  <Typography.Text>{coachName(a.coach_id)}</Typography.Text>
                  {a.covering_for_coach_id && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      Covering for {coachName(a.covering_for_coach_id)}
                    </Typography.Text>
                  )}
                </Space>
              </List.Item>
            )}
          />
        )}
        <Space wrap style={{ marginTop: 12 }}>
          <Button onClick={() => openAction({ kind: 'add' })}>Add a coach</Button>
          <Button onClick={() => openAction({ kind: 'time' })}>Change time</Button>
          {event.is_cancelled ? (
            <Button onClick={() => openAction({ kind: 'restore' })}>Restore session</Button>
          ) : (
            <Button danger onClick={() => openAction({ kind: 'cancel' })}>
              Cancel session
            </Button>
          )}
        </Space>
      </Card>

      <Card size="small" title="History" loading={historyQuery.isLoading}>
        {history.length === 0 ? (
          <Typography.Text type="secondary">No changes since this session was scheduled.</Typography.Text>
        ) : (
          <List
            dataSource={history}
            renderItem={(c) => (
              <List.Item>
                <Space direction="vertical" size={0} style={{ width: '100%' }}>
                  <Space wrap>
                    <Typography.Text strong>{describeChange(c, coachName)}</Typography.Text>
                    {c.review_status === 'needs_review' && <Tag color="gold">Needs review</Tag>}
                    {c.review_status === 'reversed' && <Tag>Reversed</Tag>}
                  </Space>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {c.changed_by_email} · {dayjs(c.changed_at).format('MMM D, h:mm A')}
                  </Typography.Text>
                  <Typography.Text style={{ fontSize: 13 }}>"{c.reason}"</Typography.Text>
                </Space>
              </List.Item>
            )}
          />
        )}
      </Card>

      <Modal
        open={!!action}
        title={action ? ACTION_TITLES[action.kind] : ''}
        okText="Save change"
        okButtonProps={{ disabled: !canSubmit, loading: running }}
        onOk={submit}
        onCancel={() => setAction(null)}
        destroyOnHidden
      >
        <Form layout="vertical">
          {action?.kind === 'sub' && (
            <Typography.Paragraph>
              Replacing <strong>{coachName(action.coachId)}</strong>. They'll no longer see this session; the sub will.
            </Typography.Paragraph>
          )}
          {action?.kind === 'remove' && (
            <Typography.Paragraph>
              Removing <strong>{coachName(action.coachId)}</strong>. If they already confirmed hours, their entry stays and
              is flagged for review -- nothing is deleted.
            </Typography.Paragraph>
          )}
          {needsCoachPick && (
            <Form.Item label={action?.kind === 'sub' ? 'Sub' : 'Coach'} required>
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="Pick a coach"
                value={inCoachId}
                onChange={setInCoachId}
                options={pickableCoaches.map((c) => ({ label: c.name, value: c.id }))}
              />
            </Form.Item>
          )}
          {action?.kind === 'time' && (
            <>
              <Space wrap>
                <Form.Item label="Start" required>
                  <TimePicker format="h:mm A" minuteStep={5} use12Hours value={newStart} onChange={setNewStart} />
                </Form.Item>
                <Form.Item label="End" required>
                  <TimePicker format="h:mm A" minuteStep={5} use12Hours value={newEnd} onChange={setNewEnd} />
                </Form.Item>
              </Space>
              {event.series_id && (
                <Form.Item>
                  <Checkbox checked={applyToSeries} onChange={(e) => setApplyToSeries(e.target.checked)}>
                    Also change every later session in this series
                  </Checkbox>
                </Form.Item>
              )}
            </>
          )}
          <Form.Item label="Reason" required extra="Shown to payroll when this change is reviewed.">
            <Input.TextArea
              rows={2}
              placeholder="e.g. Keith out sick"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

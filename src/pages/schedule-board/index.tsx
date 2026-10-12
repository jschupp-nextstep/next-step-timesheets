import { useMemo, useState } from 'react'
import { useList } from '@refinedev/core'
import { Button, Card, Empty, Input, Popover, Select, Space, Tag, Typography } from 'antd'
import { LeftOutlined, RightOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'

import { Link } from 'react-router'

import { useScheduleAction } from '../../utility/scheduleActions'

type Assignment = {
  id: string
  coach_id: string
  coaches: { name: string } | null
}

type EventRow = {
  id: string
  event_date: string
  start_time: string | null
  end_time: string | null
  session_name: string | null
  is_cancelled: boolean
  programs: { name: string } | null
  locations: { name: string } | null
  event_assignments: Assignment[]
}

type CoachOption = { id: string; name: string }

const DAY_COUNT = 7

// Sprocket events (and manually-created ones) don't always carry a time --
// Camp/Nurse hours come from the location's fixed half/full-day config, not
// a time span. Those sort first in their day column under "No time set"
// rather than being dropped or crashing the sort.
const formatTimeRange = (start: string | null, end: string | null) => {
  if (!start) return 'No time set'
  const startLabel = dayjs(`2000-01-01T${start}`).format('h:mm A')
  if (!end) return startLabel
  return `${startLabel} – ${dayjs(`2000-01-01T${end}`).format('h:mm A')}`
}

const mondayOf = (d: Dayjs) => d.subtract((d.day() + 6) % 7, 'day').startOf('day')

// Card tags favor readability over brevity -- "Aimee H" over "AH" -- since
// the board is meant to be scanned quickly by someone who knows the staff
// by name, not by initials.
const coachLabel = (name: string) => {
  const parts = name.trim().split(/\s+/)
  return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[parts.length - 1][0]}`
}

export const ScheduleBoard = () => {
  const { run } = useScheduleAction()
  const [weekStart, setWeekStart] = useState(() => mondayOf(dayjs()))
  const [activeEventId, setActiveEventId] = useState<string | null>(null)
  const [draftCoachIds, setDraftCoachIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [reason, setReason] = useState('')

  const weekEnd = weekStart.add(DAY_COUNT - 1, 'day')
  const days = useMemo(
    () => Array.from({ length: DAY_COUNT }, (_, i) => weekStart.add(i, 'day')),
    [weekStart],
  )

  const { result, query } = useList<EventRow>({
    resource: 'events',
    meta: {
      select:
        '*, programs(name), locations(name), event_assignments(id, coach_id, coaches!event_assignments_coach_id_fkey(name))',
    },
    filters: [
      { field: 'event_date', operator: 'gte', value: weekStart.format('YYYY-MM-DD') },
      { field: 'event_date', operator: 'lte', value: weekEnd.format('YYYY-MM-DD') },
    ],
    sorters: [{ field: 'start_time', order: 'asc' }],
    pagination: { pageSize: 500 },
  })

  const { result: coachesResult } = useList<CoachOption>({
    resource: 'coaches',
    filters: [{ field: 'is_active', operator: 'eq', value: true }],
    sorters: [{ field: 'name', order: 'asc' }],
    pagination: { pageSize: 200 },
  })
  const coaches = coachesResult?.data ?? []

  const eventsByDate = useMemo(() => {
    const map = new Map<string, EventRow[]>()
    for (const event of result?.data ?? []) {
      const list = map.get(event.event_date) ?? []
      list.push(event)
      map.set(event.event_date, list)
    }
    // start_time asc from the query already orders each day's list; events
    // with a null start_time come back first from Postgres, which is also
    // the desired "No time set" grouping at the top.
    return map
  }, [result?.data])

  const openPicker = (event: EventRow) => {
    setActiveEventId(event.id)
    setDraftCoachIds(event.event_assignments.map((a) => a.coach_id))
    setReason('')
  }

  const closePicker = () => {
    setActiveEventId(null)
    setDraftCoachIds([])
  }

  // Adds/removes go through the logged schedule_* functions (one call per
  // coach), so board edits land in the event's history like any other
  // change. For a sub (with "covering for"), time changes, or cancelling,
  // use "Open event".
  const savePicker = async (event: EventRow) => {
    setSaving(true)
    try {
      const currentIds = event.event_assignments.map((a) => a.coach_id)
      const toRemove = currentIds.filter((id) => !draftCoachIds.includes(id))
      const toAdd = draftCoachIds.filter((id) => !currentIds.includes(id))
      const nameOf = (id: string) => coaches.find((c) => c.id === id)?.name ?? 'Coach'

      let allOk = true
      for (const coachId of toRemove) {
        allOk =
          (await run('schedule_remove', { p_event_id: event.id, p_coach_id: coachId, p_reason: reason }, `Removed ${nameOf(coachId)}`)) &&
          allOk
      }
      for (const coachId of toAdd) {
        allOk =
          (await run('schedule_add', { p_event_id: event.id, p_coach_id: coachId, p_reason: reason }, `Added ${nameOf(coachId)}`)) &&
          allOk
      }
      if (allOk) closePicker()
      query.refetch()
    } finally {
      setSaving(false)
    }
  }

  const renderCard = (event: EventRow) => {
    const assigned = event.event_assignments
    const isFilled = assigned.length > 0
    const isCancelled = event.is_cancelled

    return (
      <Popover
        key={event.id}
        trigger="click"
        open={activeEventId === event.id}
        onOpenChange={(open) => (open ? openPicker(event) : closePicker())}
        title="Assign coaches"
        content={
          <Space direction="vertical" style={{ width: 280 }}>
            <Select
              mode="multiple"
              style={{ width: '100%' }}
              placeholder="Select coach(es)"
              value={draftCoachIds}
              options={coaches.map((c) => ({ label: c.name, value: c.id }))}
              onChange={(value) => setDraftCoachIds(value)}
              optionFilterProp="label"
            />
            <Input.TextArea
              rows={2}
              placeholder="Reason (required), e.g. Keith out sick"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <Space style={{ justifyContent: 'space-between', width: '100%' }}>
              <Link to={`/schedule-board/event/${event.id}`}>Open event →</Link>
              <Space>
              <Button size="small" onClick={closePicker}>
                Cancel
              </Button>
              <Button
                size="small"
                type="primary"
                loading={saving}
                disabled={!reason.trim()}
                onClick={() => savePicker(event)}
              >
                Save
              </Button>
              </Space>
            </Space>
          </Space>
        }
      >
        <Card
          size="small"
          hoverable
          style={{
            marginBottom: 8,
            cursor: 'pointer',
            borderStyle: isFilled ? 'solid' : 'dashed',
            borderColor: isCancelled ? undefined : isFilled ? '#52c41a' : '#ff4d4f',
            opacity: isCancelled ? 0.55 : 1,
            background: isCancelled ? 'rgba(0,0,0,0.02)' : undefined,
          }}
          styles={{ body: { padding: 8 } }}
        >
          <Typography.Text strong style={{ fontSize: 12 }}>
            {formatTimeRange(event.start_time, event.end_time)}
          </Typography.Text>
          <div style={{ fontSize: 12 }}>{event.programs?.name ?? '—'}</div>
          <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{event.locations?.name ?? '—'}</div>
          {event.session_name && (
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{event.session_name}</div>
          )}
          <div style={{ marginTop: 4 }}>
            {isCancelled && (
              <Tag color="default" style={{ marginBottom: 4 }}>
                Cancelled
              </Tag>
            )}
            {isFilled ? (
              assigned.map((a) => (
                <Tag key={a.id} color="green" style={{ marginBottom: 4 }}>
                  {a.coaches ? coachLabel(a.coaches.name) : '?'}
                </Tag>
              ))
            ) : (
              <Tag color="red">Unfilled</Tag>
            )}
          </div>
        </Card>
      </Popover>
    )
  }

  return (
    <div>
      <Typography.Title level={3}>Schedule Board</Typography.Title>
      <Typography.Paragraph type="secondary">
        Click any event to assign or change which coach(es) are scheduled to work it. Dashed
        border = unfilled, solid = at least one coach assigned; cancelled events are shown muted
        regardless of fill status.
      </Typography.Paragraph>

      <Space style={{ marginBottom: 16 }}>
        <Button icon={<LeftOutlined />} onClick={() => setWeekStart((w) => w.subtract(7, 'day'))} />
        <Button onClick={() => setWeekStart(mondayOf(dayjs()))}>This week</Button>
        <Button icon={<RightOutlined />} onClick={() => setWeekStart((w) => w.add(7, 'day'))} />
        <Typography.Text strong>
          {weekStart.format('MMM D')} – {weekEnd.format('MMM D, YYYY')}
        </Typography.Text>
      </Space>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${DAY_COUNT}, minmax(180px, 1fr))`,
          gap: 8,
          overflowX: 'auto',
        }}
      >
        {days.map((day) => {
          const dateKey = day.format('YYYY-MM-DD')
          const dayEvents = eventsByDate.get(dateKey) ?? []
          return (
            <div key={dateKey}>
              <div style={{ marginBottom: 8, textAlign: 'center' }}>
                <Typography.Text strong>{day.format('ddd')}</Typography.Text>
                <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{day.format('MMM D')}</div>
              </div>
              {dayEvents.length === 0 ? (
                <Empty
                  description={null}
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  imageStyle={{ height: 32 }}
                />
              ) : (
                dayEvents.map((event) => renderCard(event))
              )}
            </div>
          )
        })}
      </div>

      {query.isLoading && (
        <Typography.Text type="secondary">Loading…</Typography.Text>
      )}
    </div>
  )
}

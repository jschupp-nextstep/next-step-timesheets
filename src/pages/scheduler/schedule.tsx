import { useMemo, useState } from 'react'
import { useList } from '@refinedev/core'
import { Button, Card, Empty, Space, Tag, Typography } from 'antd'
import { LeftOutlined, RightOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'

import { describeScope, type ScopeLabelRow } from '../../utility/schedulerScopes'

type EventRow = {
  id: string
  event_date: string
  start_time: string | null
  end_time: string | null
  session_name: string | null
  is_cancelled: boolean
  programs: { name: string } | null
  locations: { name: string } | null
  event_assignments: { id: string; coach_id: string; coaches: { name: string } | null }[]
}

type ScopeRow = ScopeLabelRow & { id: string }

const formatTimeRange = (start: string | null, end: string | null) => {
  if (!start) return 'No time set'
  const startLabel = dayjs(`2000-01-01T${start}`).format('h:mm A')
  if (!end) return startLabel
  return `${startLabel} – ${dayjs(`2000-01-01T${end}`).format('h:mm A')}`
}

// The scheduler's home screen: a phone-friendly, day-by-day list of the
// events they manage (in_my_scope is a computed column backed by the same
// is_scheduler_for_event() check RLS uses -- see 0017_roles.sql). Read-only
// for now; the quick actions (sub/add/remove/time/cancel) arrive in R2b.
export const Schedule = () => {
  const [weekStart, setWeekStart] = useState(() => dayjs().startOf('day'))
  const weekEnd = weekStart.add(6, 'day')

  // Coach names come from coach_directory (names only), not coaches --
  // schedulers can't read the coaches table since 0018_tighten_reads.sql.
  const { result, query } = useList<EventRow>({
    resource: 'events',
    meta: { select: '*, programs(name), locations(name), event_assignments(id, coach_id, coaches:coach_directory(name))' },
    filters: [
      { field: 'in_my_scope', operator: 'eq', value: true },
      { field: 'event_date', operator: 'gte', value: weekStart.format('YYYY-MM-DD') },
      { field: 'event_date', operator: 'lte', value: weekEnd.format('YYYY-MM-DD') },
    ],
    sorters: [
      { field: 'event_date', order: 'asc' },
      { field: 'start_time', order: 'asc' },
    ],
    pagination: { pageSize: 500 },
  })
  const { result: scopesResult } = useList<ScopeRow>({
    resource: 'scheduler_scopes',
    meta: { select: 'id, programs(name), locations(name), coaches:coach_directory(name)' },
    pagination: { pageSize: 100 },
  })

  const byDate = useMemo(() => {
    const map = new Map<string, EventRow[]>()
    for (const event of result?.data ?? []) map.set(event.event_date, [...(map.get(event.event_date) ?? []), event])
    return map
  }, [result?.data])

  const days = Array.from({ length: 7 }, (_, i) => weekStart.add(i, 'day'))
  const scopes = scopesResult?.data ?? []

  return (
    <div style={{ maxWidth: 640 }}>
      <Typography.Title level={3}>Schedule</Typography.Title>
      <Typography.Paragraph type="secondary">
        You manage: {scopes.length > 0 ? scopes.map(describeScope).join('; ') : 'nothing yet -- ask an admin to set your scope.'}
      </Typography.Paragraph>

      <Space style={{ marginBottom: 16 }} wrap>
        <Button icon={<LeftOutlined />} onClick={() => setWeekStart((w) => w.subtract(7, 'day'))} />
        <Button onClick={() => setWeekStart(dayjs().startOf('day'))}>Today</Button>
        <Button icon={<RightOutlined />} onClick={() => setWeekStart((w) => w.add(7, 'day'))} />
        <Typography.Text strong>
          {weekStart.format('MMM D')} – {weekEnd.format('MMM D, YYYY')}
        </Typography.Text>
      </Space>

      {days.map((day) => {
        const key = day.format('YYYY-MM-DD')
        const events = byDate.get(key) ?? []
        return (
          <Card
            key={key}
            size="small"
            title={day.format('dddd, MMM D')}
            style={{ marginBottom: 12 }}
            loading={query.isLoading}
          >
            {events.length === 0 ? (
              <Empty description="No sessions" image={Empty.PRESENTED_IMAGE_SIMPLE} imageStyle={{ height: 28 }} />
            ) : (
              events.map((event) => (
                <div
                  key={event.id}
                  style={{
                    padding: '8px 0',
                    borderBottom: '1px solid rgba(0,0,0,0.06)',
                    opacity: event.is_cancelled ? 0.55 : 1,
                  }}
                >
                  <Typography.Text strong>{formatTimeRange(event.start_time, event.end_time)}</Typography.Text>
                  <div>
                    {event.programs?.name ?? '—'} · {event.locations?.name ?? '—'}
                    {event.session_name ? ` · ${event.session_name}` : ''}
                  </div>
                  <div style={{ marginTop: 4 }}>
                    {event.is_cancelled && <Tag>Cancelled</Tag>}
                    {event.event_assignments.length > 0 ? (
                      event.event_assignments.map((a) => (
                        <Tag key={a.id} color="green">
                          {a.coaches?.name ?? '?'}
                        </Tag>
                      ))
                    ) : (
                      <Tag color="red">Unfilled</Tag>
                    )}
                  </div>
                </div>
              ))
            )}
          </Card>
        )
      })}
    </div>
  )
}

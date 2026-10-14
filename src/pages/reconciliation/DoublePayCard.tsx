import { useMemo, useState } from 'react'
import { useList } from '@refinedev/core'
import { Alert, Card, Empty, Segmented, Space, Table, Tag, Typography } from 'antd'
import dayjs from 'dayjs'
import { Link } from 'react-router'

import { EntryFlagActions } from '../../components/EntryFlagActions'
import { describeDoublePay } from '../../utility/doublePay'
import { useDoublePayFlags, type DoublePayEntry } from '../../utility/useDoublePay'

// R5: sessions where coverage and the scheduled coach's hours overlap, or
// more coaches logged than were scheduled. Flags only -- use Hold / Canceled
// on the entry that shouldn't be paid (paid ones: no clawback, note it).
export const DoublePayCard = () => {
  const { flags, openFlags, isLoading, refetch } = useDoublePayFlags()
  const [show, setShow] = useState<'open' | 'all'>('open')
  const { result: directoryResult } = useList<{ id: string; name: string }>({
    resource: 'coach_directory',
    pagination: { pageSize: 500 },
  })
  const nameOf = useMemo(() => {
    const map = new Map((directoryResult?.data ?? []).map((c) => [c.id, c.name]))
    return (id: string) => map.get(id) ?? 'Unknown coach'
  }, [directoryResult?.data])

  const list = show === 'open' ? openFlags : flags

  return (
    <Card
      size="small"
      style={{ marginBottom: 16 }}
      loading={isLoading}
      title={`Possible double pay (${openFlags.length} open)`}
      extra={
        <Segmented
          size="small"
          value={show}
          onChange={(v) => setShow(v as typeof show)}
          options={[
            { label: 'Unpaid', value: 'open' },
            { label: 'All (last 120 days)', value: 'all' },
          ]}
        />
      }
    >
      <Typography.Paragraph type="secondary">
        Sessions where a covering coach and the coach they covered for both logged hours, an approved unassigned claim
        sits next to the scheduled coach's entry, or more coaches logged than were scheduled. Hold or mark Canceled the
        entry that shouldn't be paid; if it's already paid, there's no clawback -- note it and move on.
      </Typography.Paragraph>
      {list.length === 0 ? (
        <Empty description="Nothing flagged" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        list.map((flag) => {
          const ev = flag.entries[0]?.events
          return (
            <Card
              key={flag.eventId}
              type="inner"
              size="small"
              style={{ marginBottom: 12 }}
              title={
                <Space wrap>
                  <Link to={`/schedule-board/event/${flag.eventId}`}>
                    {ev ? dayjs(ev.event_date).format('ddd M/D') : '?'}
                  </Link>
                  <Typography.Text type="secondary">
                    {ev?.programs?.name} · {ev?.locations?.name}
                    {ev?.session_name ? ` · ${ev.session_name}` : ''}
                  </Typography.Text>
                </Space>
              }
            >
              {flag.reasons.map((r, i) => (
                <Alert key={i} type="warning" showIcon style={{ marginBottom: 6 }} message={describeDoublePay(r, nameOf)} />
              ))}
              <Table<DoublePayEntry> dataSource={flag.entries} rowKey="id" size="small" pagination={false}>
                <Table.Column title="Coach" render={(_, e: DoublePayEntry) => e.coaches?.name ?? nameOf(e.coach_id)} />
                <Table.Column
                  title="Logged"
                  render={(_, e: DoublePayEntry) =>
                    e.flat_amount != null ? `$${e.flat_amount.toFixed(2)}` : `${e.hours?.toFixed(2) ?? '—'} hrs`
                  }
                />
                <Table.Column
                  title="Status"
                  render={(_, e: DoublePayEntry) =>
                    e.status === 'paid' ? (
                      <Tag color="green">Paid{e.paid_amount != null ? ` $${e.paid_amount.toFixed(2)}` : ''}</Tag>
                    ) : e.admin_flag ? (
                      <Tag color="gold">{e.admin_flag === 'hold' ? 'On hold' : e.admin_flag}</Tag>
                    ) : (
                      <Tag>Pending</Tag>
                    )
                  }
                />
                <Table.Column
                  title="Actions"
                  render={(_, e: DoublePayEntry) => <EntryFlagActions entry={e} onDone={refetch} />}
                />
              </Table>
            </Card>
          )
        })
      )}
    </Card>
  )
}

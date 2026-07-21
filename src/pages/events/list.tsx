import { EditButton, List, useTable } from '@refinedev/antd'
import { useUpdate } from '@refinedev/core'
import { Space, Switch, Table, Tag } from 'antd'
import dayjs from 'dayjs'

type Event = {
  id: string
  event_date: string
  start_time: string | null
  end_time: string | null
  session_name: string | null
  is_cancelled: boolean
  program: { name: string } | null
  location: { name: string } | null
}

export const EventList = () => {
  const { tableProps } = useTable<Event>({
    resource: 'events',
    meta: { select: '*, program:programs(name), location:locations(name)' },
    sorters: { initial: [{ field: 'event_date', order: 'desc' }] },
  })
  const { mutate } = useUpdate()

  return (
    <List>
      <Table {...tableProps} rowKey="id">
        <Table.Column dataIndex="event_date" title="Date" render={(v) => dayjs(v).format('MMM D, YYYY')} />
        <Table.Column dataIndex={['program', 'name']} title="Program" />
        <Table.Column dataIndex={['location', 'name']} title="Location" />
        <Table.Column dataIndex="session_name" title="Session / Team" render={(v) => v ?? '—'} />
        <Table.Column
          title="Time"
          render={(_, record: Event) =>
            record.start_time && record.end_time
              ? `${record.start_time.slice(0, 5)}–${record.end_time.slice(0, 5)}`
              : '—'
          }
        />
        <Table.Column
          dataIndex="is_cancelled"
          title="Status"
          render={(value: boolean) => <Tag color={value ? 'red' : 'green'}>{value ? 'Cancelled' : 'Scheduled'}</Tag>}
        />
        <Table.Column
          title="Actions"
          dataIndex="actions"
          render={(_, record: Event) => (
            <Space>
              <EditButton hideText size="small" recordItemId={record.id} />
              <Switch
                checked={!record.is_cancelled}
                checkedChildren="Scheduled"
                unCheckedChildren="Cancelled"
                onChange={(checked) =>
                  mutate({ resource: 'events', id: record.id, values: { is_cancelled: !checked } })
                }
              />
            </Space>
          )}
        />
      </Table>
    </List>
  )
}

import { EditButton, List, useTable } from '@refinedev/antd'
import { Space, Table, Tag } from 'antd'

import { describeScope, type ScopeLabelRow } from '../../utility/schedulerScopes'

type SchedulerRow = {
  id: string
  name: string
  email: string
  is_active: boolean
  scheduler_scopes: (ScopeLabelRow & { id: string })[]
}

export const SchedulerList = () => {
  const { tableProps } = useTable<SchedulerRow>({
    resource: 'schedulers',
    meta: { select: '*, scheduler_scopes(id, programs(name), locations(name), coaches(name))' },
    sorters: { initial: [{ field: 'name', order: 'asc' }] },
  })

  return (
    <List title="Schedulers">
      <Table {...tableProps} rowKey="id">
        <Table.Column dataIndex="name" title="Name" />
        <Table.Column dataIndex="email" title="Email" />
        <Table.Column
          title="Manages"
          render={(_, row: SchedulerRow) =>
            row.scheduler_scopes.length > 0 ? (
              <Space size={[4, 4]} wrap>
                {row.scheduler_scopes.map((s) => (
                  <Tag key={s.id}>{describeScope(s)}</Tag>
                ))}
              </Space>
            ) : (
              <Tag color="red">No scope -- sees nothing</Tag>
            )
          }
        />
        <Table.Column
          dataIndex="is_active"
          title="Status"
          render={(v: boolean) => (v ? <Tag color="green">Active</Tag> : <Tag>Inactive</Tag>)}
        />
        <Table.Column
          title="Actions"
          render={(_, row: SchedulerRow) => <EditButton hideText size="small" recordItemId={row.id} />}
        />
      </Table>
    </List>
  )
}

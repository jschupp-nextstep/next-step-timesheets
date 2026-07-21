import { EditButton, List, useTable } from '@refinedev/antd'
import { useUpdate } from '@refinedev/core'
import { Space, Switch, Table, Tag } from 'antd'

type Rate = {
  id: string
  hourly_rate: number
  is_active: boolean
  coach: { name: string } | null
  program: { name: string } | null
}

export const RateList = () => {
  const { tableProps } = useTable<Rate>({
    resource: 'rates',
    meta: { select: '*, coach:coaches(name), program:programs(name)' },
    sorters: { initial: [{ field: 'created_at', order: 'desc' }] },
  })
  const { mutate } = useUpdate()

  return (
    <List>
      <Table {...tableProps} rowKey="id">
        <Table.Column dataIndex={['coach', 'name']} title="Coach" />
        <Table.Column dataIndex={['program', 'name']} title="Program" />
        <Table.Column dataIndex="hourly_rate" title="Hourly Rate" render={(v) => `$${v}`} />
        <Table.Column
          dataIndex="is_active"
          title="Status"
          render={(value: boolean) => <Tag color={value ? 'green' : 'default'}>{value ? 'Active' : 'Inactive'}</Tag>}
        />
        <Table.Column
          title="Actions"
          dataIndex="actions"
          render={(_, record: Rate) => (
            <Space>
              <EditButton hideText size="small" recordItemId={record.id} />
              <Switch
                checked={record.is_active}
                checkedChildren="Active"
                unCheckedChildren="Inactive"
                onChange={(checked) =>
                  mutate({ resource: 'rates', id: record.id, values: { is_active: checked } })
                }
              />
            </Space>
          )}
        />
      </Table>
    </List>
  )
}

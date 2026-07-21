import { EditButton, List, useTable } from '@refinedev/antd'
import { useUpdate } from '@refinedev/core'
import { Space, Switch, Table, Tag } from 'antd'

type Coach = {
  id: string
  name: string
  initials: string
  is_active: boolean
}

export const CoachList = () => {
  const { tableProps } = useTable<Coach>({
    resource: 'coaches',
    sorters: { initial: [{ field: 'name', order: 'asc' }] },
  })
  const { mutate } = useUpdate()

  return (
    <List>
      <Table {...tableProps} rowKey="id">
        <Table.Column dataIndex="name" title="Name" />
        <Table.Column dataIndex="initials" title="Initials" />
        <Table.Column
          dataIndex="is_active"
          title="Status"
          render={(value: boolean) => <Tag color={value ? 'green' : 'default'}>{value ? 'Active' : 'Inactive'}</Tag>}
        />
        <Table.Column
          title="Actions"
          dataIndex="actions"
          render={(_, record: Coach) => (
            <Space>
              <EditButton hideText size="small" recordItemId={record.id} />
              <Switch
                checked={record.is_active}
                checkedChildren="Active"
                unCheckedChildren="Inactive"
                onChange={(checked) =>
                  mutate({ resource: 'coaches', id: record.id, values: { is_active: checked } })
                }
              />
            </Space>
          )}
        />
      </Table>
    </List>
  )
}

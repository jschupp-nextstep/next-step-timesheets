import { EditButton, List, useTable } from '@refinedev/antd'
import { useUpdate } from '@refinedev/core'
import { Space, Switch, Table, Tag } from 'antd'

type Program = {
  id: string
  name: string
  code: string
  is_active: boolean
}

export const ProgramList = () => {
  const { tableProps } = useTable<Program>({
    resource: 'programs',
    sorters: { initial: [{ field: 'name', order: 'asc' }] },
  })
  const { mutate } = useUpdate()

  return (
    <List>
      <Table {...tableProps} rowKey="id">
        <Table.Column dataIndex="name" title="Name" />
        <Table.Column dataIndex="code" title="Code" />
        <Table.Column
          dataIndex="is_active"
          title="Status"
          render={(value: boolean) => <Tag color={value ? 'green' : 'default'}>{value ? 'Active' : 'Inactive'}</Tag>}
        />
        <Table.Column
          title="Actions"
          dataIndex="actions"
          render={(_, record: Program) => (
            <Space>
              <EditButton hideText size="small" recordItemId={record.id} />
              <Switch
                checked={record.is_active}
                checkedChildren="Active"
                unCheckedChildren="Inactive"
                onChange={(checked) =>
                  mutate({ resource: 'programs', id: record.id, values: { is_active: checked } })
                }
              />
            </Space>
          )}
        />
      </Table>
    </List>
  )
}

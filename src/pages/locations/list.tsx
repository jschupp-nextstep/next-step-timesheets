import { EditButton, List, useTable } from '@refinedev/antd'
import { useUpdate } from '@refinedev/core'
import { Space, Switch, Table, Tag } from 'antd'

type Location = {
  id: string
  name: string
  category: 'camp_nurse' | 'regular'
  half_day_hours: number | null
  full_day_hours: number | null
  is_active: boolean
}

const categoryLabels: Record<Location['category'], string> = {
  camp_nurse: 'Camp / Nurse',
  regular: 'Regular',
}

export const LocationList = () => {
  const { tableProps } = useTable<Location>({
    resource: 'locations',
    sorters: { initial: [{ field: 'name', order: 'asc' }] },
  })
  const { mutate } = useUpdate()

  return (
    <List>
      <Table {...tableProps} rowKey="id">
        <Table.Column dataIndex="name" title="Name" />
        <Table.Column
          dataIndex="category"
          title="Category"
          render={(value: Location['category']) => categoryLabels[value]}
        />
        <Table.Column dataIndex="half_day_hours" title="Half Day Hours" render={(v) => v ?? '—'} />
        <Table.Column dataIndex="full_day_hours" title="Full Day Hours" render={(v) => v ?? '—'} />
        <Table.Column
          dataIndex="is_active"
          title="Status"
          render={(value: boolean) => <Tag color={value ? 'green' : 'default'}>{value ? 'Active' : 'Inactive'}</Tag>}
        />
        <Table.Column
          title="Actions"
          dataIndex="actions"
          render={(_, record: Location) => (
            <Space>
              <EditButton hideText size="small" recordItemId={record.id} />
              <Switch
                checked={record.is_active}
                checkedChildren="Active"
                unCheckedChildren="Inactive"
                onChange={(checked) =>
                  mutate({ resource: 'locations', id: record.id, values: { is_active: checked } })
                }
              />
            </Space>
          )}
        />
      </Table>
    </List>
  )
}

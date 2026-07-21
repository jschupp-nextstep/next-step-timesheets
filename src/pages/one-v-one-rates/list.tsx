import { EditButton, List, useTable } from '@refinedev/antd'
import { useUpdate } from '@refinedev/core'
import { Space, Switch, Table, Tag } from 'antd'

type OneVOneRate = {
  id: string
  session_fee: number
  oversight_fee: number | null
  is_active: boolean
  coach: { name: string } | null
  oversight_coach: { name: string } | null
}

export const OneVOneRateList = () => {
  const { tableProps } = useTable<OneVOneRate>({
    resource: 'one_v_one_rates',
    meta: {
      select:
        '*, coach:coaches!one_v_one_rates_coach_id_fkey(name), oversight_coach:coaches!one_v_one_rates_oversight_coach_id_fkey(name)',
    },
    sorters: { initial: [{ field: 'created_at', order: 'desc' }] },
  })
  const { mutate } = useUpdate()

  return (
    <List>
      <Table {...tableProps} rowKey="id">
        <Table.Column dataIndex={['coach', 'name']} title="Coach" />
        <Table.Column dataIndex="session_fee" title="Session Fee" render={(v) => `$${v}`} />
        <Table.Column dataIndex={['oversight_coach', 'name']} title="Oversight Coach" render={(v) => v ?? '—'} />
        <Table.Column
          dataIndex="oversight_fee"
          title="Oversight Fee"
          render={(v) => (v != null ? `$${v}` : '—')}
        />
        <Table.Column
          dataIndex="is_active"
          title="Status"
          render={(value: boolean) => <Tag color={value ? 'green' : 'default'}>{value ? 'Active' : 'Inactive'}</Tag>}
        />
        <Table.Column
          title="Actions"
          dataIndex="actions"
          render={(_, record: OneVOneRate) => (
            <Space>
              <EditButton hideText size="small" recordItemId={record.id} />
              <Switch
                checked={record.is_active}
                checkedChildren="Active"
                unCheckedChildren="Inactive"
                onChange={(checked) =>
                  mutate({ resource: 'one_v_one_rates', id: record.id, values: { is_active: checked } })
                }
              />
            </Space>
          )}
        />
      </Table>
    </List>
  )
}

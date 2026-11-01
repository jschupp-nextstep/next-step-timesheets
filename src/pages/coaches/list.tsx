import { CreateButton, EditButton, List, useTable } from '@refinedev/antd'
import { useUpdate } from '@refinedev/core'
import { Button, Space, Switch, Table, Tag } from 'antd'
import { UploadOutlined } from '@ant-design/icons'
import { Link } from 'react-router'

type Coach = {
  id: string
  name: string
  initials: string
  email: string | null
  is_active: boolean
  pay_type: '1099' | 'w2'
}

export const CoachList = () => {
  const { tableProps } = useTable<Coach>({
    resource: 'coaches',
    sorters: { initial: [{ field: 'name', order: 'asc' }] },
  })
  const { mutate } = useUpdate()

  return (
    <List
      headerButtons={
        <>
          <Link to="/coaches/import">
            <Button icon={<UploadOutlined />}>Import coaches &amp; rates</Button>
          </Link>
          <CreateButton>Add a coach</CreateButton>
        </>
      }
    >
      <Table {...tableProps} rowKey="id">
        <Table.Column
          dataIndex="name"
          title="Name"
          render={(name: string, record: Coach) => <Link to={`/coaches/show/${record.id}`}>{name}</Link>}
        />
        <Table.Column dataIndex="initials" title="Initials" />
        <Table.Column dataIndex="email" title="Email" render={(v) => v ?? '—'} />
        <Table.Column
          dataIndex="pay_type"
          title="Pay type"
          render={(value: Coach['pay_type']) => (
            <Tag color={value === 'w2' ? 'blue' : 'default'}>{value === 'w2' ? 'W-2' : '1099'}</Tag>
          )}
        />
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

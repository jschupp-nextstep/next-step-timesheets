import { useState } from 'react'
import { EditButton, List, useTable } from '@refinedev/antd'
import { useUpdate } from '@refinedev/core'
import { Button, Space, Switch, Table, Tag, Typography } from 'antd'
import dayjs from 'dayjs'

import { ChangeRateModal } from '../../components/ChangeRateModal'

type Rate = {
  id: string
  hourly_rate: number
  is_active: boolean
  effective_from: string | null
  effective_to: string | null
  coach: { name: string } | null
  program: { name: string } | null
}

export const RateList = () => {
  const { tableProps, tableQuery } = useTable<Rate>({
    resource: 'rates',
    meta: { select: '*, coach:coaches(name), program:programs(name)' },
    sorters: { initial: [{ field: 'created_at', order: 'desc' }] },
  })
  const { mutate } = useUpdate()
  const [changing, setChanging] = useState<Rate | null>(null)

  return (
    <List>
      <Table {...tableProps} rowKey="id">
        <Table.Column dataIndex={['coach', 'name']} title="Coach" />
        <Table.Column dataIndex={['program', 'name']} title="Program" />
        <Table.Column dataIndex="hourly_rate" title="Hourly Rate" render={(v) => `$${v}`} />
        <Table.Column
          title="In effect"
          render={(_, r: Rate) =>
            !r.effective_from && !r.effective_to ? (
              <Typography.Text type="secondary">Always</Typography.Text>
            ) : (
              `${r.effective_from ? dayjs(r.effective_from).format('M/D/YY') : 'start'} → ${r.effective_to ? dayjs(r.effective_to).format('M/D/YY') : 'now'}`
            )
          }
        />
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
              {!record.effective_to && record.is_active && (
                <Button
                  size="small"
                  onClick={() => setChanging(record)}
                >
                  Change rate…
                </Button>
              )}
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
      <ChangeRateModal
        rate={
          changing && {
            id: changing.id,
            hourly_rate: changing.hourly_rate,
            coachName: changing.coach?.name ?? '?',
            programName: changing.program?.name ?? '?',
          }
        }
        onClose={() => setChanging(null)}
        onDone={() => {
          setChanging(null)
          tableQuery.refetch()
        }}
      />
    </List>
  )
}

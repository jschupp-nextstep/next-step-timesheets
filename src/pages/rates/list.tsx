import { useState } from 'react'
import { EditButton, List, useTable } from '@refinedev/antd'
import { useUpdate } from '@refinedev/core'
import { App, Button, DatePicker, InputNumber, Modal, Space, Switch, Table, Tag, Typography } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'

import { supabaseClient } from '../../utility/supabaseClient'

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
  const { message } = App.useApp()
  const { tableProps, tableQuery } = useTable<Rate>({
    resource: 'rates',
    meta: { select: '*, coach:coaches(name), program:programs(name)' },
    sorters: { initial: [{ field: 'created_at', order: 'desc' }] },
  })
  const { mutate } = useUpdate()
  const [changing, setChanging] = useState<Rate | null>(null)
  const [newRate, setNewRate] = useState<number | null>(null)
  const [fromDate, setFromDate] = useState<Dayjs | null>(null)
  const [busy, setBusy] = useState(false)

  // R8: a dated rate change closes the current rate the day before and starts
  // a new one, so entries before that date keep the old rate (change_rate,
  // 0027_rate_history.sql).
  const submitChange = async () => {
    if (!changing || newRate == null || !fromDate) return
    setBusy(true)
    try {
      const { error } = await supabaseClient.rpc('change_rate', {
        p_rate_id: changing.id,
        p_new_rate: newRate,
        p_from: fromDate.format('YYYY-MM-DD'),
      })
      if (error) {
        message.error({ content: error.message, duration: 6 })
        return
      }
      message.success(`${changing.coach?.name}: $${newRate} from ${fromDate.format('MMM D, YYYY')}`)
      setChanging(null)
      tableQuery.refetch()
    } finally {
      setBusy(false)
    }
  }

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
                  onClick={() => {
                    setChanging(record)
                    setNewRate(record.hourly_rate)
                    setFromDate(null)
                  }}
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
      <Modal
        open={!!changing}
        title={changing ? `Change ${changing.coach?.name}'s ${changing.program?.name} rate` : ''}
        okText="Change rate"
        okButtonProps={{ loading: busy, disabled: newRate == null || !fromDate }}
        onOk={submitChange}
        onCancel={() => setChanging(null)}
        destroyOnHidden
      >
        <Typography.Paragraph>
          Currently ${changing?.hourly_rate}/hr. Sessions before the date below keep the current rate; sessions on or after
          it use the new one. Already-paid entries never change.
        </Typography.Paragraph>
        <Space wrap>
          <InputNumber min={0} step={0.5} addonBefore="$" addonAfter="/hr" value={newRate} onChange={setNewRate} />
          <DatePicker placeholder="Effective from" value={fromDate} onChange={setFromDate} />
        </Space>
      </Modal>
    </List>
  )
}

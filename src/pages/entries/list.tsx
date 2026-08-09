import { useState } from 'react'
import { EditButton, List, useSelect, useTable } from '@refinedev/antd'
import { useDelete } from '@refinedev/core'
import { Button, Popconfirm, Segmented, Select, Space, Table, Tag } from 'antd'
import { DeleteOutlined } from '@ant-design/icons'

type EntryRow = {
  id: string
  entry_date: string
  hours: number | null
  flat_amount: number | null
  session_name: string | null
  status: 'pending' | 'paid'
  paid_date: string | null
  coaches: { name: string } | null
  programs: { name: string } | null
}

export const EntryList = () => {
  const [statusFilter, setStatusFilter] = useState<'pending' | 'paid' | 'all'>('all')
  const [coachId, setCoachId] = useState<string | undefined>(undefined)

  const { tableProps, setFilters } = useTable<EntryRow>({
    resource: 'timesheet_entries',
    meta: { select: '*, coaches(name), programs(name)' },
    sorters: { initial: [{ field: 'entry_date', order: 'desc' }] },
  })
  const { selectProps: coachSelectProps } = useSelect({ resource: 'coaches', optionLabel: 'name', optionValue: 'id' })
  const { mutate: deleteEntry } = useDelete()

  const applyFilters = (nextStatus: typeof statusFilter, nextCoachId: string | undefined) => {
    const filters = []
    if (nextStatus !== 'all') filters.push({ field: 'status', operator: 'eq' as const, value: nextStatus })
    if (nextCoachId) filters.push({ field: 'coach_id', operator: 'eq' as const, value: nextCoachId })
    setFilters(filters, 'replace')
  }

  return (
    <List title="Timesheet Entries">
      <Space style={{ marginBottom: 16 }} wrap>
        <Segmented
          value={statusFilter}
          onChange={(value) => {
            const next = value as typeof statusFilter
            setStatusFilter(next)
            applyFilters(next, coachId)
          }}
          options={[
            { label: 'All', value: 'all' },
            { label: 'Pending', value: 'pending' },
            { label: 'Paid', value: 'paid' },
          ]}
        />
        <Select
          options={coachSelectProps.options}
          showSearch
          optionFilterProp="label"
          allowClear
          placeholder="Filter by coach"
          style={{ width: 220 }}
          value={coachId}
          onChange={(value: string | undefined) => {
            setCoachId(value)
            applyFilters(statusFilter, value)
          }}
        />
      </Space>

      <Table {...tableProps} rowKey="id">
        <Table.Column dataIndex="entry_date" title="Date" width={110} />
        <Table.Column dataIndex={['coaches', 'name']} title="Coach" render={(v) => v ?? '—'} />
        <Table.Column dataIndex={['programs', 'name']} title="Program" render={(v) => v ?? '—'} />
        <Table.Column dataIndex="session_name" title="Session" render={(v) => v || '—'} />
        <Table.Column
          title="Hours"
          render={(_, row: EntryRow) => (row.hours != null ? row.hours.toFixed(2) : '—')}
        />
        <Table.Column
          title="Amount"
          render={(_, row: EntryRow) => (row.flat_amount != null ? `$${row.flat_amount.toFixed(2)}` : '—')}
        />
        <Table.Column
          dataIndex="status"
          title="Status"
          render={(value: EntryRow['status'], row: EntryRow) =>
            value === 'paid' ? (
              <Tag color="green">Paid {row.paid_date}</Tag>
            ) : (
              <Tag>Pending</Tag>
            )
          }
        />
        <Table.Column
          title="Actions"
          dataIndex="actions"
          render={(_, record: EntryRow) => (
            <Space>
              <EditButton hideText size="small" resource="timesheet_entries" recordItemId={record.id} />
              <Popconfirm
                title="Delete this entry?"
                okText="Delete"
                okButtonProps={{ danger: true }}
                onConfirm={() => deleteEntry({ resource: 'timesheet_entries', id: record.id })}
              >
                <Button danger size="small" icon={<DeleteOutlined />} />
              </Popconfirm>
            </Space>
          )}
        />
      </Table>
    </List>
  )
}

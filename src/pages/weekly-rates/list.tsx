import { EditButton, List, useTable } from '@refinedev/antd'
import { Table, Tag } from 'antd'

import { DOW_LABEL } from '../../utility/weeklyPay'

type Row = {
  id: string
  weekly_amount: number
  week_start_dow: number
  effective_from: string
  effective_to: string | null
  coaches: { name: string } | null
  programs: { name: string } | null
}

export const WeeklyRateList = () => {
  const { tableProps } = useTable<Row>({
    resource: 'weekly_rates',
    meta: { select: '*, coaches(name), programs(name)' },
    sorters: { initial: [{ field: 'effective_from', order: 'desc' }] },
  })
  return (
    <List title="Weekly Rates">
      <Table {...tableProps} rowKey="id">
        <Table.Column title="Coach" render={(_, r: Row) => r.coaches?.name ?? '—'} />
        <Table.Column title="Covers" render={(_, r: Row) => r.programs?.name ?? <Tag>All their work</Tag>} />
        <Table.Column title="Amount" render={(_, r: Row) => `$${r.weekly_amount.toFixed(2)}/week`} />
        <Table.Column
          title="Week"
          render={(_, r: Row) => `${DOW_LABEL[r.week_start_dow]} – ${DOW_LABEL[(r.week_start_dow + 6) % 7]}`}
        />
        <Table.Column title="In effect" render={(_, r: Row) => `${r.effective_from} → ${r.effective_to ?? 'ongoing'}`} />
        <Table.Column title="" render={(_, r: Row) => <EditButton hideText size="small" recordItemId={r.id} />} />
      </Table>
    </List>
  )
}

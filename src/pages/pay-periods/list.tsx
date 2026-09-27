import { EditButton, List, useTable } from '@refinedev/antd'
import { Table } from 'antd'
import dayjs from 'dayjs'

type PayPeriod = {
  id: string
  start_date: string
  end_date: string
}

export const PayPeriodList = () => {
  const { tableProps } = useTable<PayPeriod>({
    resource: 'pay_periods',
    sorters: { initial: [{ field: 'start_date', order: 'desc' }] },
  })

  return (
    <List>
      <Table {...tableProps} rowKey="id">
        <Table.Column dataIndex="start_date" title="Start Date" render={(v) => dayjs(v).format('MMM D, YYYY')} />
        <Table.Column dataIndex="end_date" title="End Date" render={(v) => dayjs(v).format('MMM D, YYYY')} />
        <Table.Column
          title="Actions"
          render={(_, record: PayPeriod) => <EditButton hideText size="small" recordItemId={record.id} />}
        />
      </Table>
    </List>
  )
}

import { Create, useForm } from '@refinedev/antd'
import { DatePicker, Form } from 'antd'
import type { Dayjs } from 'dayjs'

type PayPeriodFormValues = {
  start_date: Dayjs
  end_date: Dayjs
}

export const PayPeriodCreate = () => {
  const { formProps, saveButtonProps } = useForm({ resource: 'pay_periods' })

  return (
    <Create saveButtonProps={saveButtonProps}>
      <Form
        {...formProps}
        layout="vertical"
        onFinish={(rawValues) => {
          const values = rawValues as PayPeriodFormValues
          formProps.onFinish?.({
            start_date: values.start_date.format('YYYY-MM-DD'),
            end_date: values.end_date.format('YYYY-MM-DD'),
          })
        }}
      >
        <Form.Item label="Start Date" name="start_date" rules={[{ required: true }]}>
          <DatePicker style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item label="End Date" name="end_date" rules={[{ required: true }]}>
          <DatePicker style={{ width: '100%' }} />
        </Form.Item>
      </Form>
    </Create>
  )
}

import { Edit, useForm } from '@refinedev/antd'
import { DatePicker, Form } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'

type PayPeriodFormValues = {
  start_date: Dayjs
  end_date: Dayjs
}

export const PayPeriodEdit = () => {
  const { formProps, saveButtonProps } = useForm({
    resource: 'pay_periods',
    queryOptions: {
      select: (data) => ({
        ...data,
        data: {
          ...data.data,
          start_date: data.data.start_date ? dayjs(data.data.start_date) : undefined,
          end_date: data.data.end_date ? dayjs(data.data.end_date) : undefined,
        },
      }),
    },
  })

  return (
    <Edit saveButtonProps={saveButtonProps}>
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
    </Edit>
  )
}

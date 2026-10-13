import { Edit, useForm, useSelect } from '@refinedev/antd'
import { DatePicker, Form, Input, InputNumber, Select, Switch, TimePicker } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'

type EventFormValues = {
  program_id: string
  location_id: string
  event_date: Dayjs
  start_time: Dayjs | null
  end_time: Dayjs | null
  session_name: string | null
  notes: string | null
  is_cancelled: boolean
  paid_early_minutes: number | null
}

export const EventEdit = () => {
  const { formProps, saveButtonProps } = useForm({
    resource: 'events',
    queryOptions: {
      select: (data) => ({
        ...data,
        data: {
          ...data.data,
          event_date: data.data.event_date ? dayjs(data.data.event_date) : undefined,
          start_time: data.data.start_time ? dayjs(data.data.start_time, 'HH:mm:ss') : undefined,
          end_time: data.data.end_time ? dayjs(data.data.end_time, 'HH:mm:ss') : undefined,
        },
      }),
    },
  })
  const { selectProps: programSelectProps } = useSelect({
    resource: 'programs',
    optionLabel: 'name',
    optionValue: 'id',
  })
  const { selectProps: locationSelectProps } = useSelect({
    resource: 'locations',
    optionLabel: 'name',
    optionValue: 'id',
  })

  return (
    <Edit saveButtonProps={saveButtonProps}>
      <Form
        {...formProps}
        layout="vertical"
        onFinish={(rawValues) => {
          const values = rawValues as EventFormValues
          formProps.onFinish?.({
            ...values,
            event_date: values.event_date.format('YYYY-MM-DD'),
            start_time: values.start_time?.format('HH:mm:ss') ?? null,
            end_time: values.end_time?.format('HH:mm:ss') ?? null,
            paid_early_minutes: values.paid_early_minutes ?? null,
          })
        }}
      >
        <Form.Item label="Program" name="program_id" rules={[{ required: true }]}>
          <Select {...programSelectProps} />
        </Form.Item>
        <Form.Item label="Location" name="location_id" rules={[{ required: true }]}>
          <Select {...locationSelectProps} />
        </Form.Item>
        <Form.Item label="Date" name="event_date" rules={[{ required: true }]}>
          <DatePicker style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item label="Start Time" name="start_time">
          <TimePicker format="HH:mm" style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item label="End Time" name="end_time">
          <TimePicker format="HH:mm" style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item
          label="Paid from (minutes before start) -- this event only"
          name="paid_early_minutes"
          extra="Leave blank to use the program's rule. Set it for a game's warm-up (e.g. 30), or 0 to pay scheduled time only. Already-confirmed entries aren't changed."
        >
          <InputNumber min={0} max={180} step={5} style={{ width: '100%' }} addonAfter="min" />
        </Form.Item>
        <Form.Item label="Session / Team Name" name="session_name">
          <Input />
        </Form.Item>
        <Form.Item label="Notes" name="notes">
          <Input.TextArea rows={3} />
        </Form.Item>
        <Form.Item label="Cancelled" name="is_cancelled" valuePropName="checked">
          <Switch checkedChildren="Cancelled" unCheckedChildren="Scheduled" />
        </Form.Item>
      </Form>
    </Edit>
  )
}

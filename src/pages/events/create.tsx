import { Create, useForm, useSelect } from '@refinedev/antd'
import { DatePicker, Form, Input, Select, TimePicker } from 'antd'
import type { Dayjs } from 'dayjs'

type EventFormValues = {
  program_id: string
  location_id: string
  event_date: Dayjs
  start_time: Dayjs | null
  end_time: Dayjs | null
  session_name: string | null
  notes: string | null
}

export const EventCreate = () => {
  const { formProps, saveButtonProps } = useForm({ resource: 'events' })
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
    <Create saveButtonProps={saveButtonProps}>
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
        <Form.Item label="Session / Team Name" name="session_name">
          <Input />
        </Form.Item>
        <Form.Item label="Notes" name="notes">
          <Input.TextArea rows={3} />
        </Form.Item>
      </Form>
    </Create>
  )
}

import { Edit, useForm, useSelect } from '@refinedev/antd'
import { DatePicker, Form, Input, InputNumber, Select, TimePicker } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'

type EntryFormValues = {
  coach_id: string
  program_id: string
  event_id: string | null
  location_id: string | null
  entry_date: Dayjs
  start_time: Dayjs | null
  end_time: Dayjs | null
  hours: number | null
  flat_amount: number | null
  session_name: string | null
  notes: string | null
  status: 'pending' | 'paid'
  paid_date: Dayjs | null
}

export const EntryEdit = () => {
  const { formProps, saveButtonProps } = useForm({
    resource: 'timesheet_entries',
    queryOptions: {
      select: (data) => ({
        ...data,
        data: {
          ...data.data,
          entry_date: data.data.entry_date ? dayjs(data.data.entry_date) : undefined,
          start_time: data.data.start_time ? dayjs(data.data.start_time, 'HH:mm:ss') : undefined,
          end_time: data.data.end_time ? dayjs(data.data.end_time, 'HH:mm:ss') : undefined,
          paid_date: data.data.paid_date ? dayjs(data.data.paid_date) : undefined,
        },
      }),
    },
  })
  const { selectProps: coachSelectProps } = useSelect({ resource: 'coaches', optionLabel: 'name', optionValue: 'id' })
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
  const { selectProps: eventSelectProps } = useSelect({
    resource: 'events',
    optionLabel: 'session_name',
    optionValue: 'id',
  })

  return (
    <Edit saveButtonProps={saveButtonProps}>
      <Form
        {...formProps}
        layout="vertical"
        onFinish={(rawValues) => {
          const values = rawValues as EntryFormValues
          formProps.onFinish?.({
            ...values,
            entry_date: values.entry_date.format('YYYY-MM-DD'),
            start_time: values.start_time?.format('HH:mm:ss') ?? null,
            end_time: values.end_time?.format('HH:mm:ss') ?? null,
            paid_date: values.paid_date?.format('YYYY-MM-DD') ?? null,
          })
        }}
      >
        <Form.Item label="Coach" name="coach_id" rules={[{ required: true }]}>
          <Select {...coachSelectProps} />
        </Form.Item>
        <Form.Item label="Program" name="program_id" rules={[{ required: true }]}>
          <Select {...programSelectProps} />
        </Form.Item>
        <Form.Item label="Linked event (optional)" name="event_id" extra="Only used for session-mode entries. Leave blank for Office Hours, 1v1, reimbursements, etc.">
          <Select {...eventSelectProps} allowClear />
        </Form.Item>
        <Form.Item label="Location (optional)" name="location_id">
          <Select {...locationSelectProps} allowClear />
        </Form.Item>
        <Form.Item label="Date" name="entry_date" rules={[{ required: true }]}>
          <DatePicker style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item label="Start Time" name="start_time">
          <TimePicker format="HH:mm" style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item label="End Time" name="end_time">
          <TimePicker format="HH:mm" style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item label="Hours" name="hours" extra="Leave blank for flat-fee entries (1v1, reimbursements).">
          <InputNumber min={0} step={0.25} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item
          label="Flat amount"
          name="flat_amount"
          extra="Used for 1v1 session fees, oversight fees, and reimbursements -- leave blank for hourly entries."
        >
          <InputNumber min={0} step={0.01} style={{ width: '100%' }} addonBefore="$" />
        </Form.Item>
        <Form.Item label="Session / description" name="session_name">
          <Input />
        </Form.Item>
        <Form.Item label="Notes" name="notes">
          <Input.TextArea rows={3} />
        </Form.Item>
        <Form.Item label="Status" name="status" rules={[{ required: true }]}>
          <Select
            options={[
              { label: 'Pending', value: 'pending' },
              { label: 'Paid', value: 'paid' },
            ]}
          />
        </Form.Item>
        <Form.Item label="Paid date" name="paid_date">
          <DatePicker style={{ width: '100%' }} />
        </Form.Item>
      </Form>
    </Edit>
  )
}

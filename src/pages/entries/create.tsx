import { Create, useForm, useSelect } from '@refinedev/antd'
import { DatePicker, Form, Input, InputNumber, Select, TimePicker } from 'antd'
import type { Dayjs } from 'dayjs'

type EntryFormValues = {
  coach_id: string
  program_id: string
  location_id: string | null
  entry_date: Dayjs
  start_time: Dayjs | null
  end_time: Dayjs | null
  hours: number | null
  flat_amount: number | null
  session_name: string | null
  notes: string | null
}

// Admin hand-entry: admin_only programs (Stipend, Set-up/Break-down), and
// anything dated before the cutover from the old system that genuinely
// still needs paying here. admin_entered is set by a database trigger from
// who's logged in -- it isn't a form field and can't be spoofed from here.
export const EntryCreate = () => {
  const { formProps, saveButtonProps } = useForm({ resource: 'timesheet_entries' })
  const { selectProps: coachSelectProps } = useSelect({
    resource: 'coaches',
    optionLabel: 'name',
    optionValue: 'id',
    filters: [{ field: 'is_active', operator: 'eq', value: true }],
    sorters: [{ field: 'name', order: 'asc' }],
    pagination: { pageSize: 200 },
  })
  const { selectProps: programSelectProps } = useSelect({
    resource: 'programs',
    optionLabel: 'name',
    optionValue: 'id',
    filters: [{ field: 'entry_mode', operator: 'ne', value: 'backend_only' }],
    sorters: [{ field: 'name', order: 'asc' }],
    pagination: { pageSize: 100 },
  })
  const { selectProps: locationSelectProps } = useSelect({
    resource: 'locations',
    optionLabel: 'name',
    optionValue: 'id',
    sorters: [{ field: 'name', order: 'asc' }],
    pagination: { pageSize: 200 },
  })

  return (
    <Create saveButtonProps={saveButtonProps} title="Add Timesheet Entry">
      <Form
        {...formProps}
        layout="vertical"
        onFinish={(rawValues) => {
          const values = rawValues as EntryFormValues
          formProps.onFinish?.({
            ...values,
            location_id: values.location_id ?? null,
            entry_date: values.entry_date.format('YYYY-MM-DD'),
            start_time: values.start_time?.format('HH:mm:ss') ?? null,
            end_time: values.end_time?.format('HH:mm:ss') ?? null,
            hours: values.hours ?? null,
            flat_amount: values.flat_amount ?? null,
            session_name: values.session_name || null,
            notes: values.notes || null,
            status: 'pending',
          })
        }}
      >
        <Form.Item label="Coach" name="coach_id" rules={[{ required: true }]}>
          <Select {...coachSelectProps} showSearch optionFilterProp="label" />
        </Form.Item>
        <Form.Item label="Program" name="program_id" rules={[{ required: true }]}>
          <Select {...programSelectProps} showSearch optionFilterProp="label" />
        </Form.Item>
        <Form.Item label="Location (optional)" name="location_id">
          <Select {...locationSelectProps} allowClear showSearch optionFilterProp="label" />
        </Form.Item>
        <Form.Item label="Date" name="entry_date" rules={[{ required: true }]}>
          <DatePicker style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item label="Start Time (optional)" name="start_time">
          <TimePicker format="HH:mm" style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item label="End Time (optional)" name="end_time">
          <TimePicker format="HH:mm" style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item
          label="Hours"
          name="hours"
          extra="For hourly programs -- paid at the coach's rate for this program. Leave blank for a flat amount."
        >
          <InputNumber min={0} step={0.25} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item
          label="Flat amount"
          name="flat_amount"
          extra="Stipends, reimbursements, one-off fees. Overrides any rate lookup -- leave blank for hourly entries."
          dependencies={['hours']}
          rules={[
            ({ getFieldValue }) => ({
              validator: (_, value) =>
                value != null || getFieldValue('hours') != null
                  ? Promise.resolve()
                  : Promise.reject(new Error('Enter hours or a flat amount')),
            }),
          ]}
        >
          <InputNumber min={0} step={0.01} style={{ width: '100%' }} addonBefore="$" />
        </Form.Item>
        <Form.Item label="Session / description" name="session_name">
          <Input />
        </Form.Item>
        <Form.Item label="Notes" name="notes">
          <Input.TextArea rows={3} />
        </Form.Item>
      </Form>
    </Create>
  )
}

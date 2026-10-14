import { useSelect } from '@refinedev/antd'
import { DatePicker, Form, Input, InputNumber, Select } from 'antd'
import type { FormProps } from 'antd'

import { DOW_LABEL } from '../../utility/weeklyPay'

// Shared by create and edit (R7, weekly_rates).
export const WeeklyRateForm = ({ formProps }: { formProps: FormProps }) => {
  const { selectProps: coachSelectProps } = useSelect({
    resource: 'coaches',
    optionLabel: 'name',
    optionValue: 'id',
    sorters: [{ field: 'name', order: 'asc' }],
    pagination: { pageSize: 200 },
  })
  const { selectProps: programSelectProps } = useSelect({
    resource: 'programs',
    optionLabel: 'name',
    optionValue: 'id',
    sorters: [{ field: 'name', order: 'asc' }],
    pagination: { pageSize: 100 },
  })

  return (
    <Form {...formProps} layout="vertical" style={{ maxWidth: 520 }}>
      <Form.Item label="Coach" name="coach_id" rules={[{ required: true }]}>
        <Select options={coachSelectProps.options} showSearch optionFilterProp="label" />
      </Form.Item>
      <Form.Item
        label="Covers"
        name="program_id"
        extra="Leave empty for all of this coach's work. Pick a program to cover only that; their other programs stay hourly."
      >
        <Select options={programSelectProps.options} allowClear placeholder="All their work" showSearch optionFilterProp="label" />
      </Form.Item>
      <Form.Item label="Weekly amount" name="weekly_amount" rules={[{ required: true }]}>
        <InputNumber min={0.01} step={50} style={{ width: '100%' }} addonBefore="$" addonAfter="/week" />
      </Form.Item>
      <Form.Item label="Week starts on" name="week_start_dow" rules={[{ required: true }]}>
        <Select options={DOW_LABEL.map((label, value) => ({ label, value }))} />
      </Form.Item>
      <Form.Item label="In effect from" name="effective_from" rules={[{ required: true }]}>
        <DatePicker style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item label="Until (optional)" name="effective_to" extra="Leave empty while the arrangement is ongoing.">
        <DatePicker style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item label="Notes" name="notes">
        <Input.TextArea rows={2} />
      </Form.Item>
    </Form>
  )
}

import { Edit, useForm, useSelect } from '@refinedev/antd'
import type { BaseRecord, GetOneResponse } from '@refinedev/core'
import { Alert, DatePicker, Form, InputNumber, Select, Switch } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'

type RateFormValues = {
  coach_id: string
  program_id: string
  hourly_rate: number
  is_active: boolean
  effective_from: Dayjs | null
  effective_to: Dayjs | null
}

// Module-level, not inline (an inline select resets the form every render).
const toFormValues = (data: GetOneResponse<BaseRecord>) => ({
  ...data,
  data: {
    ...data.data,
    effective_from: data.data.effective_from ? dayjs(data.data.effective_from) : null,
    effective_to: data.data.effective_to ? dayjs(data.data.effective_to) : null,
  },
})

export const RateEdit = () => {
  const { formProps, saveButtonProps } = useForm({ resource: 'rates', queryOptions: { select: toFormValues } })
  const { selectProps: coachSelectProps } = useSelect({ resource: 'coaches', optionLabel: 'name', optionValue: 'id' })
  const { selectProps: programSelectProps } = useSelect({
    resource: 'programs',
    optionLabel: 'name',
    optionValue: 'id',
  })

  return (
    <Edit saveButtonProps={saveButtonProps}>
      <Alert
        style={{ marginBottom: 16 }}
        type="info"
        showIcon
        message="For a raise or other change from a date, use “Change rate…” on the Rates list instead."
        description="Editing the amount here changes it for every unpaid entry this rate covers, back to its start date. Already-paid entries keep the amount they were paid."
      />
      <Form
        {...formProps}
        layout="vertical"
        onFinish={(rawValues) => {
          const values = rawValues as RateFormValues
          formProps.onFinish?.({
            ...values,
            effective_from: values.effective_from?.format('YYYY-MM-DD') ?? null,
            effective_to: values.effective_to?.format('YYYY-MM-DD') ?? null,
          })
        }}
      >
        <Form.Item label="Coach" name="coach_id" rules={[{ required: true }]}>
          <Select {...coachSelectProps} />
        </Form.Item>
        <Form.Item label="Program" name="program_id" rules={[{ required: true }]}>
          <Select {...programSelectProps} />
        </Form.Item>
        <Form.Item label="Hourly Rate" name="hourly_rate" rules={[{ required: true }]}>
          <InputNumber min={0} step={0.5} style={{ width: '100%' }} addonBefore="$" />
        </Form.Item>
        <Form.Item label="In effect from" name="effective_from" extra="Leave empty for “since the beginning”.">
          <DatePicker style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item label="Until" name="effective_to" extra="Leave empty while it's the current rate.">
          <DatePicker style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item label="Active" name="is_active" valuePropName="checked">
          <Switch checkedChildren="Active" unCheckedChildren="Inactive" />
        </Form.Item>
      </Form>
    </Edit>
  )
}

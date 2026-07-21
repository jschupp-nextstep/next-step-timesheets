import { Create, useForm, useSelect } from '@refinedev/antd'
import { Form, InputNumber, Select } from 'antd'

export const RateCreate = () => {
  const { formProps, saveButtonProps } = useForm({ resource: 'rates' })
  const { selectProps: coachSelectProps } = useSelect({ resource: 'coaches', optionLabel: 'name', optionValue: 'id' })
  const { selectProps: programSelectProps } = useSelect({
    resource: 'programs',
    optionLabel: 'name',
    optionValue: 'id',
  })

  return (
    <Create saveButtonProps={saveButtonProps}>
      <Form {...formProps} layout="vertical">
        <Form.Item label="Coach" name="coach_id" rules={[{ required: true }]}>
          <Select {...coachSelectProps} />
        </Form.Item>
        <Form.Item label="Program" name="program_id" rules={[{ required: true }]}>
          <Select {...programSelectProps} />
        </Form.Item>
        <Form.Item label="Hourly Rate" name="hourly_rate" rules={[{ required: true }]}>
          <InputNumber min={0} step={0.5} style={{ width: '100%' }} addonBefore="$" />
        </Form.Item>
      </Form>
    </Create>
  )
}

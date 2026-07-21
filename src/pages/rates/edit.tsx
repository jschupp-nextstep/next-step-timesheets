import { Edit, useForm, useSelect } from '@refinedev/antd'
import { Form, InputNumber, Select, Switch } from 'antd'

export const RateEdit = () => {
  const { formProps, saveButtonProps } = useForm({ resource: 'rates' })
  const { selectProps: coachSelectProps } = useSelect({ resource: 'coaches', optionLabel: 'name', optionValue: 'id' })
  const { selectProps: programSelectProps } = useSelect({
    resource: 'programs',
    optionLabel: 'name',
    optionValue: 'id',
  })

  return (
    <Edit saveButtonProps={saveButtonProps}>
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
        <Form.Item label="Active" name="is_active" valuePropName="checked">
          <Switch checkedChildren="Active" unCheckedChildren="Inactive" />
        </Form.Item>
      </Form>
    </Edit>
  )
}

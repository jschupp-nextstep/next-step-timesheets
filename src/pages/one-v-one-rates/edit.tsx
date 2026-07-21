import { Edit, useForm, useSelect } from '@refinedev/antd'
import { Form, InputNumber, Select, Switch } from 'antd'

export const OneVOneRateEdit = () => {
  const { formProps, saveButtonProps } = useForm({ resource: 'one_v_one_rates' })
  const { selectProps: coachSelectProps } = useSelect({ resource: 'coaches', optionLabel: 'name', optionValue: 'id' })
  const { selectProps: oversightSelectProps } = useSelect({
    resource: 'coaches',
    optionLabel: 'name',
    optionValue: 'id',
  })
  const oversightCoachId = Form.useWatch('oversight_coach_id', formProps.form)

  return (
    <Edit saveButtonProps={saveButtonProps}>
      <Form {...formProps} layout="vertical">
        <Form.Item label="Coach" name="coach_id" rules={[{ required: true }]}>
          <Select {...coachSelectProps} />
        </Form.Item>
        <Form.Item label="Session Fee" name="session_fee" rules={[{ required: true }]}>
          <InputNumber min={0} step={1} style={{ width: '100%' }} addonBefore="$" />
        </Form.Item>
        <Form.Item label="Oversight Coach" name="oversight_coach_id">
          <Select
            {...oversightSelectProps}
            allowClear
            onChange={(value) => {
              if (!value) {
                formProps.form?.setFieldValue('oversight_coach_id', null)
                formProps.form?.setFieldValue('oversight_fee', null)
              }
            }}
          />
        </Form.Item>
        <Form.Item
          label="Oversight Fee"
          name="oversight_fee"
          rules={[{ required: !!oversightCoachId, message: 'Required when an oversight coach is set' }]}
        >
          <InputNumber min={0} step={1} style={{ width: '100%' }} addonBefore="$" disabled={!oversightCoachId} />
        </Form.Item>
        <Form.Item label="Active" name="is_active" valuePropName="checked">
          <Switch checkedChildren="Active" unCheckedChildren="Inactive" />
        </Form.Item>
      </Form>
    </Edit>
  )
}

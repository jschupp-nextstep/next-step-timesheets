import { Create, useForm, useSelect } from '@refinedev/antd'
import { Form, InputNumber, Select } from 'antd'
import { useSearchParams } from 'react-router'

export const OneVOneRateCreate = () => {
  const { formProps, saveButtonProps } = useForm({ resource: 'one_v_one_rates' })
  const { selectProps: coachSelectProps } = useSelect({ resource: 'coaches', optionLabel: 'name', optionValue: 'id' })
  const { selectProps: oversightSelectProps } = useSelect({
    resource: 'coaches',
    optionLabel: 'name',
    optionValue: 'id',
  })
  const oversightCoachId = Form.useWatch('oversight_coach_id', formProps.form)
  const [searchParams] = useSearchParams()

  return (
    <Create saveButtonProps={saveButtonProps}>
      <Form
        {...formProps}
        layout="vertical"
        initialValues={{ coach_id: searchParams.get('coach_id') || undefined }}
      >
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
      </Form>
    </Create>
  )
}

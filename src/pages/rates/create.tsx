import { Create, useForm, useSelect } from '@refinedev/antd'
import { Form, InputNumber, Select } from 'antd'
import { useSearchParams } from 'react-router'

export const RateCreate = () => {
  const { formProps, saveButtonProps } = useForm({ resource: 'rates' })
  const { selectProps: coachSelectProps } = useSelect({ resource: 'coaches', optionLabel: 'name', optionValue: 'id' })
  const { selectProps: programSelectProps } = useSelect({
    resource: 'programs',
    optionLabel: 'name',
    optionValue: 'id',
  })
  // Lets pages like Zoho Export deep-link "fix this specific missing rate"
  // straight to a pre-filled form, instead of leaving the admin to hunt
  // down and re-select the right coach/program themselves.
  const [searchParams] = useSearchParams()

  return (
    <Create saveButtonProps={saveButtonProps}>
      <Form
        {...formProps}
        layout="vertical"
        initialValues={{
          coach_id: searchParams.get('coach_id') || undefined,
          program_id: searchParams.get('program_id') || undefined,
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
      </Form>
    </Create>
  )
}

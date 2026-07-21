import { Edit, useForm } from '@refinedev/antd'
import { Form, Input, InputNumber, Select, Switch } from 'antd'

const categoryOptions = [
  { label: 'Camp / Nurse (fixed hours by site)', value: 'camp_nurse' },
  { label: 'Regular (hours from start/end time)', value: 'regular' },
]

export const LocationEdit = () => {
  const { formProps, saveButtonProps } = useForm({ resource: 'locations' })
  const category = Form.useWatch('category', formProps.form)

  return (
    <Edit saveButtonProps={saveButtonProps}>
      <Form {...formProps} layout="vertical">
        <Form.Item label="Name" name="name" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item label="Category" name="category" rules={[{ required: true }]}>
          <Select options={categoryOptions} />
        </Form.Item>
        {category === 'camp_nurse' && (
          <>
            <Form.Item label="Half Day Hours" name="half_day_hours" rules={[{ required: true }]}>
              <InputNumber min={0} step={0.5} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="Full Day Hours" name="full_day_hours" rules={[{ required: true }]}>
              <InputNumber min={0} step={0.5} style={{ width: '100%' }} />
            </Form.Item>
          </>
        )}
        <Form.Item label="Active" name="is_active" valuePropName="checked">
          <Switch checkedChildren="Active" unCheckedChildren="Inactive" />
        </Form.Item>
      </Form>
    </Edit>
  )
}

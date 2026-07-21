import { Edit, useForm } from '@refinedev/antd'
import { Form, Input, Switch } from 'antd'

export const CoachEdit = () => {
  const { formProps, saveButtonProps } = useForm({ resource: 'coaches' })

  return (
    <Edit saveButtonProps={saveButtonProps}>
      <Form {...formProps} layout="vertical">
        <Form.Item label="Name" name="name" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item label="Initials" name="initials" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item label="Active" name="is_active" valuePropName="checked">
          <Switch checkedChildren="Active" unCheckedChildren="Inactive" />
        </Form.Item>
      </Form>
    </Edit>
  )
}

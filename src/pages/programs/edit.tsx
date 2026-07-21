import { Edit, useForm } from '@refinedev/antd'
import { Form, Input, Switch } from 'antd'

export const ProgramEdit = () => {
  const { formProps, saveButtonProps } = useForm({ resource: 'programs' })

  return (
    <Edit saveButtonProps={saveButtonProps}>
      <Form {...formProps} layout="vertical">
        <Form.Item label="Name" name="name" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item label="Code" name="code" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item label="Active" name="is_active" valuePropName="checked">
          <Switch checkedChildren="Active" unCheckedChildren="Inactive" />
        </Form.Item>
      </Form>
    </Edit>
  )
}

import { Create, useForm } from '@refinedev/antd'
import { Form, Input } from 'antd'

export const CoachCreate = () => {
  const { formProps, saveButtonProps } = useForm({ resource: 'coaches' })

  return (
    <Create saveButtonProps={saveButtonProps}>
      <Form {...formProps} layout="vertical">
        <Form.Item label="Name" name="name" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item label="Initials" name="initials" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
      </Form>
    </Create>
  )
}

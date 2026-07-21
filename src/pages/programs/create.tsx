import { Create, useForm } from '@refinedev/antd'
import { Form, Input } from 'antd'

export const ProgramCreate = () => {
  const { formProps, saveButtonProps } = useForm({ resource: 'programs' })

  return (
    <Create saveButtonProps={saveButtonProps}>
      <Form {...formProps} layout="vertical">
        <Form.Item label="Name" name="name" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item label="Code" name="code" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
      </Form>
    </Create>
  )
}

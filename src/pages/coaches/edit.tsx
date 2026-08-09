import { Edit, useForm } from '@refinedev/antd'
import { Form, Input, Select, Switch } from 'antd'

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
        <Form.Item
          label="Email"
          name="email"
          rules={[{ type: 'email' }]}
          extra="Lets this coach log in. Type their email here, then use Supabase's Invite user action for the same address."
        >
          <Input />
        </Form.Item>
        <Form.Item
          label="Pay type"
          name="pay_type"
          rules={[{ required: true }]}
          extra="Determines which Zoho Books accounts this coach's pay routes to on export."
        >
          <Select
            options={[
              { label: '1099 Contractor', value: '1099' },
              { label: 'W-2 Employee', value: 'w2' },
            ]}
          />
        </Form.Item>
        <Form.Item label="Active" name="is_active" valuePropName="checked">
          <Switch checkedChildren="Active" unCheckedChildren="Inactive" />
        </Form.Item>
      </Form>
    </Edit>
  )
}

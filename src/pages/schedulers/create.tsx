import { Create, useForm } from '@refinedev/antd'
import { Form, Input } from 'antd'

type SchedulerFormValues = { name: string; email: string }

export const SchedulerCreate = () => {
  const { formProps, saveButtonProps } = useForm({ resource: 'schedulers', redirect: 'edit' })

  return (
    <Create saveButtonProps={saveButtonProps} title="Add Scheduler">
      <Form
        {...formProps}
        layout="vertical"
        onFinish={(rawValues) => {
          const values = rawValues as SchedulerFormValues
          formProps.onFinish?.({ name: values.name.trim(), email: values.email.trim().toLowerCase() })
        }}
      >
        <Form.Item label="Name" name="name" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item
          label="Email"
          name="email"
          rules={[{ required: true, type: 'email' }]}
          extra="Their login email. If they also coach, use the same email that's on their coach record -- they'll get both the schedule and their own coach screens. Sign-ups are off, so create their login in Supabase (Authentication → Users → Add user) if they don't have one yet."
        >
          <Input />
        </Form.Item>
      </Form>
    </Create>
  )
}

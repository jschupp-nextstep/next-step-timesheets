import { Edit, useForm } from '@refinedev/antd'
import { Form, Input, InputNumber, Switch } from 'antd'

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
        <Form.Item
          label="Paid from (minutes before start)"
          name="paid_early_minutes"
          rules={[{ required: true }]}
          extra="Coaches on this program's sessions are paid from this many minutes before the scheduled start -- e.g. 15 for Annual Program. 0 for scheduled time only. Ignored for Camp/Nurse fixed-hours programs. A single event can override it (e.g. a game's warm-up)."
        >
          <InputNumber min={0} max={120} step={5} style={{ width: '100%' }} addonAfter="min" />
        </Form.Item>
        <Form.Item label="Active" name="is_active" valuePropName="checked">
          <Switch checkedChildren="Active" unCheckedChildren="Inactive" />
        </Form.Item>
      </Form>
    </Edit>
  )
}

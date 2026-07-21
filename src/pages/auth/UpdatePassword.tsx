import { useUpdatePassword } from '@refinedev/core'
import { Button, Card, Form, Input, Typography } from 'antd'
import { Link } from 'react-router'

type UpdatePasswordVariables = { password: string; confirmPassword: string }

export const UpdatePassword = () => {
  const { mutate: updatePassword, isPending } = useUpdatePassword<UpdatePasswordVariables>()

  return (
    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 64 }}>
      <Card style={{ width: 380 }}>
        <Typography.Title level={3} style={{ textAlign: 'center' }}>
          Set a password
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ textAlign: 'center' }}>
          Set a password now so you can sign in directly next time, without waiting for another
          email link.
        </Typography.Paragraph>
        <Form<UpdatePasswordVariables>
          layout="vertical"
          onFinish={(values) => updatePassword(values)}
        >
          <Form.Item label="New password" name="password" rules={[{ required: true, min: 6 }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item
            label="Confirm password"
            name="confirmPassword"
            dependencies={['password']}
            rules={[
              { required: true },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('password') === value) {
                    return Promise.resolve()
                  }
                  return Promise.reject(new Error('Passwords do not match'))
                },
              }),
            ]}
          >
            <Input.Password />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" block loading={isPending}>
              Set password
            </Button>
          </Form.Item>
        </Form>
        <div style={{ textAlign: 'center' }}>
          <Link to="/">Skip for now</Link>
        </div>
      </Card>
    </div>
  )
}

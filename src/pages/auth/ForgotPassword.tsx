import { useForgotPassword } from '@refinedev/core'
import { Button, Card, Form, Input, Typography } from 'antd'
import { Link } from 'react-router'

type ForgotPasswordVariables = { email: string }

export const ForgotPassword = () => {
  const { mutate: forgotPassword, isPending } = useForgotPassword<ForgotPasswordVariables>()

  return (
    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 64 }}>
      <Card style={{ width: 380 }}>
        <Typography.Title level={3} style={{ textAlign: 'center' }}>
          Forgot your password?
        </Typography.Title>
        <Form<ForgotPasswordVariables> layout="vertical" onFinish={(values) => forgotPassword(values)}>
          <Form.Item label="Email" name="email" rules={[{ required: true, type: 'email' }]}>
            <Input />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" block loading={isPending}>
              Send reset instructions
            </Button>
          </Form.Item>
        </Form>
        <div style={{ textAlign: 'center' }}>
          <Link to="/login">Have an account? Sign in</Link>
        </div>
      </Card>
    </div>
  )
}

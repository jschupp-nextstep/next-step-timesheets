import { useLogin } from '@refinedev/core'
import { Button, Card, Divider, Form, Input, Typography } from 'antd'
import { Link } from 'react-router'

type LoginVariables = { email: string; password?: string; magicLink?: boolean }

export const Login = () => {
  const { mutate: login, isPending } = useLogin<LoginVariables>()
  const [magicLinkForm] = Form.useForm<{ email: string }>()

  return (
    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 64 }}>
      <Card style={{ width: 380 }}>
        <Typography.Title level={3} style={{ textAlign: 'center' }}>
          Sign in to your account
        </Typography.Title>
        <Form<LoginVariables> layout="vertical" onFinish={(values) => login(values)}>
          <Form.Item label="Email" name="email" rules={[{ required: true, type: 'email' }]}>
            <Input />
          </Form.Item>
          <Form.Item label="Password" name="password" rules={[{ required: true }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" block loading={isPending}>
              Sign in
            </Button>
          </Form.Item>
        </Form>
        <div style={{ textAlign: 'center' }}>
          <Link to="/forgot-password">Forgot password?</Link>
        </div>

        <Divider>or</Divider>

        <Form
          form={magicLinkForm}
          layout="vertical"
          onFinish={(values) => login({ email: values.email, magicLink: true })}
        >
          <Form.Item label="Email" name="email" rules={[{ required: true, type: 'email' }]}>
            <Input placeholder="you@example.com" />
          </Form.Item>
          <Form.Item>
            <Button block loading={isPending} htmlType="submit">
              Email me a sign-in link
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  )
}

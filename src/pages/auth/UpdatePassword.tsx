import { useState } from 'react'
import { useUpdatePassword } from '@refinedev/core'
import { Alert, Button, Card, Form, Input, Typography } from 'antd'
import { Link } from 'react-router'

type UpdatePasswordVariables = { password: string; confirmPassword: string }

type UpdatePasswordProps = {
  // When rendered inline (from AuthenticatedShell, right after an
  // otp/recovery login) there's no dedicated route to navigate away from --
  // the caller supplies its own dismiss behavior instead of the default
  // Link-to-"/".
  onSkip?: () => void
  onSuccess?: () => void
}

export const UpdatePassword = ({ onSkip, onSuccess }: UpdatePasswordProps = {}) => {
  const { mutate: updatePassword, isPending } = useUpdatePassword<UpdatePasswordVariables>()
  // A recovery/magic-link session can go stale between page load and form
  // submit -- e.g. an older link clicked after a newer one was requested, an
  // email client's link-scanner consuming the one-time token before the
  // person does, or just sitting on the page too long. Rather than leaving
  // someone stuck on a cryptic "Auth session missing" error with no way
  // forward, treat it as an expected, recoverable case.
  const [sessionExpired, setSessionExpired] = useState(false)

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
        {sessionExpired && (
          <Alert
            style={{ marginBottom: 16 }}
            type="warning"
            showIcon
            message="That link has expired or was already used"
            description={
              onSkip ? (
                "Request a new sign-in link and try again -- you're still signed in for now, so you can also just skip this and set a password later."
              ) : (
                <>
                  Request a new sign-in link and try again -- go to{' '}
                  <Link to="/forgot-password">Forgot password</Link>.
                </>
              )
            }
          />
        )}
        <Form<UpdatePasswordVariables>
          layout="vertical"
          onFinish={(values) =>
            updatePassword(values, {
              onSuccess: (result) => {
                if (result?.success) onSuccess?.()
              },
              onError: (error) => {
                if (error?.message?.toLowerCase().includes('auth session missing')) {
                  setSessionExpired(true)
                }
              },
            })
          }
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
          {onSkip ? (
            <Typography.Link onClick={onSkip}>Skip for now</Typography.Link>
          ) : (
            <Link to="/">Skip for now</Link>
          )}
        </div>
      </Card>
    </div>
  )
}

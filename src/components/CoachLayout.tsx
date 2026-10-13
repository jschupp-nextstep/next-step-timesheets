import type { ReactNode } from 'react'
import { useGetIdentity, useLogout } from '@refinedev/core'
import { Alert, Button, Layout, Menu, Typography } from 'antd'
import { Link, useLocation } from 'react-router'

import { coachIdOf, isInactiveCoach, type Identity } from '../providers/authProvider'

// Shared by coaches and schedulers (the non-admin roles). A scheduler who
// also coaches gets both sets of menu items.
export const CoachLayout = ({ children }: { children: ReactNode }) => {
  const { data: identity } = useGetIdentity<Identity>()
  const { mutate: logout } = useLogout()
  const location = useLocation()

  const coachName = identity?.role === 'coach' || identity?.role === 'scheduler' ? identity.name : ''
  const isScheduler = identity?.role === 'scheduler'
  const isCoach = !!coachIdOf(identity)

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Header style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
        <Typography.Text style={{ color: 'white', fontWeight: 600 }}>Next Step</Typography.Text>
        <Menu
          theme="dark"
          mode="horizontal"
          selectedKeys={[location.pathname]}
          style={{ flex: 1 }}
          items={[
            ...(isScheduler ? [{ key: '/schedule', label: <Link to="/schedule">Schedule</Link> }] : []),
            ...(isCoach
              ? [
                  { key: '/log-session', label: <Link to="/log-session">Log a Session</Link> },
                  { key: '/my-sessions', label: <Link to="/my-sessions">My Sessions</Link> },
                ]
              : []),
          ]}
        />
        {coachName && <Typography.Text style={{ color: 'white' }}>{coachName}</Typography.Text>}
        <Button onClick={() => logout()}>Log out</Button>
      </Layout.Header>
      <Layout.Content style={{ padding: 24 }}>
        {isInactiveCoach(identity) && (
          <Alert
            style={{ marginBottom: 16 }}
            type="info"
            showIcon
            message="Your coach account is inactive."
            description="You can still see your sessions and paid history, but you can't log sessions, send claims, or request swaps. Contact Next Step if this is a mistake."
          />
        )}
        {children}
      </Layout.Content>
    </Layout>
  )
}

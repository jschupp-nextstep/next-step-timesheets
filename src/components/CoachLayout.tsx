import type { ReactNode } from 'react'
import { useGetIdentity, useLogout } from '@refinedev/core'
import { Button, Layout, Menu, Typography } from 'antd'
import { Link, useLocation } from 'react-router'

import type { Identity } from '../providers/authProvider'

export const CoachLayout = ({ children }: { children: ReactNode }) => {
  const { data: identity } = useGetIdentity<Identity>()
  const { mutate: logout } = useLogout()
  const location = useLocation()

  const coachName = identity?.role === 'coach' ? identity.name : ''

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
            { key: '/log-session', label: <Link to="/log-session">Log a Session</Link> },
            { key: '/my-sessions', label: <Link to="/my-sessions">My Sessions</Link> },
          ]}
        />
        {coachName && <Typography.Text style={{ color: 'white' }}>{coachName}</Typography.Text>}
        <Button onClick={() => logout()}>Log out</Button>
      </Layout.Header>
      <Layout.Content style={{ padding: 24 }}>{children}</Layout.Content>
    </Layout>
  )
}

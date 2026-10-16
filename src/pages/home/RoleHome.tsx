import { useGetIdentity } from '@refinedev/core'
import { Typography } from 'antd'
import { CalendarOutlined, EditOutlined, QuestionCircleOutlined, ScheduleOutlined } from '@ant-design/icons'

import { TileGrid, type TileSection } from '../../components/TileGrid'
import { coachIdOf, type Identity } from '../../providers/authProvider'

// Home page for coaches and schedulers (Justin, 2026-10-16) -- same tiles as
// the admin home. A scheduler who also coaches sees both groups.
export const RoleHome = () => {
  const { data: identity } = useGetIdentity<Identity>()
  const isScheduler = identity?.role === 'scheduler'
  const isCoach = !!coachIdOf(identity)
  const name = identity?.role === 'coach' || identity?.role === 'scheduler' ? identity.name : ''

  const sections: TileSection[] = []
  if (isScheduler) {
    sections.push({
      title: isCoach ? 'Scheduling' : undefined,
      tiles: [
        {
          to: '/schedule',
          title: 'Schedule',
          description:
            'The sessions you manage, by day. Assign coaches, sub, change times, add a session, or cancel a session or a whole day.',
          icon: <ScheduleOutlined />,
        },
      ],
    })
  }
  if (isCoach) {
    sections.push({
      title: isScheduler ? 'Coaching' : undefined,
      tiles: [
        {
          to: '/log-session',
          title: 'Log a Session',
          description: 'Record a session you coached, office hours, a 1v1, or a reimbursement.',
          icon: <EditOutlined />,
        },
        {
          to: '/my-sessions',
          title: 'My Sessions',
          description:
            "Your upcoming sessions, Confirm hours, request a swap or correction, answer Next Step's questions, and see what you've been paid.",
          icon: <CalendarOutlined />,
        },
        {
          to: '/my-sessions/unassigned-claim',
          title: "Don't see something you coached?",
          description: "Claim a session you worked but weren't listed on. Next Step reviews it before it's paid.",
          icon: <QuestionCircleOutlined />,
        },
      ],
    })
  }

  return (
    <div style={{ maxWidth: 1200 }}>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        {name ? `Hi, ${name.split(' ')[0]}` : 'Next Step'}
      </Typography.Title>
      <TileGrid sections={sections} />
    </div>
  )
}

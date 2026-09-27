import { useGetIdentity, useList } from '@refinedev/core'
import { Card, Typography } from 'antd'
import { useNavigate } from 'react-router'
import dayjs from 'dayjs'

import type { Identity } from '../../providers/authProvider'
import { computeBands, type PayPeriod } from '../../utils/payPeriods'
import { EventClaimForm } from './EventClaimForm'

// The only way to claim an event you weren't assigned to -- Band A's normal
// picker (log-session.tsx) is now restricted to this coach's own
// event_assignments, so without this page there'd be no way to flag a
// session you actually coached but weren't listed on (or nobody was).
export const UnassignedClaim = () => {
  const navigate = useNavigate()
  const { data: identity } = useGetIdentity<Identity>()
  const coachId = identity?.role === 'coach' ? identity.coachId : undefined

  const { result: periodsResult, query: periodsQuery } = useList<PayPeriod>({
    resource: 'pay_periods',
    sorters: [{ field: 'start_date', order: 'asc' }],
    pagination: { pageSize: 500 },
  })
  const bands = computeBands(periodsResult?.data ?? [], dayjs().format('YYYY-MM-DD'))

  if (periodsQuery.isLoading) {
    return (
      <div style={{ maxWidth: 560 }}>
        <Typography.Title level={3}>Don't See Something You Coached?</Typography.Title>
        <Card loading />
      </div>
    )
  }

  if (!bands.hasCurrentPeriod || !bands.bandA || !coachId) {
    return (
      <div style={{ maxWidth: 560 }}>
        <Typography.Title level={3}>Don't See Something You Coached?</Typography.Title>
        <Card>
          <Typography.Paragraph>
            Pay periods haven't been configured for today — contact an admin.
          </Typography.Paragraph>
        </Card>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <Typography.Title level={3}>Don't See Something You Coached?</Typography.Title>
      <Card>
        <EventClaimForm
          coachId={coachId}
          claimType="unassigned_claim"
          minDate={bands.bandA.start}
          maxDate={bands.bandA.end}
          description="Flag a session you actually coached but weren't listed on (or nobody was listed on at all). An admin will review this before it becomes payable."
          submitLabel="Send for review"
          onSubmitted={() => navigate('/my-sessions')}
        />
      </Card>
    </div>
  )
}

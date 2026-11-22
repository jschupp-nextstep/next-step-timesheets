import { useList, useNavigation } from '@refinedev/core'
import { Card, Typography } from 'antd'

import { SessionForm } from '../../components/SessionForm'

type IdName = { id: string; name: string }

// Phase 9 step 2: one session or a weekday series with skip dates, Sprocket
// teams and session details -- the same form schedulers get (SessionForm).
export const EventCreate = () => {
  const { list } = useNavigation()
  const { result: programsResult } = useList<IdName>({
    resource: 'programs',
    filters: [
      { field: 'is_active', operator: 'eq', value: true },
      { field: 'entry_mode', operator: 'eq', value: 'session' },
    ],
    sorters: [{ field: 'name', order: 'asc' }],
    pagination: { pageSize: 100 },
  })
  const { result: locationsResult } = useList<IdName>({
    resource: 'locations',
    filters: [{ field: 'is_active', operator: 'eq', value: true }],
    sorters: [{ field: 'name', order: 'asc' }],
    pagination: { pageSize: 300 },
  })
  const locations = locationsResult?.data ?? []

  return (
    <div style={{ maxWidth: 720 }}>
      <Typography.Title level={3}>Create sessions</Typography.Title>
      <Typography.Paragraph type="secondary">
        One session, or a weekly series (pick the days, the last date, and any dates to skip). Each date becomes its
        own session; coaches are assigned to all of them.
      </Typography.Paragraph>
      <Card>
        <SessionForm
          role="admin"
          programs={programsResult?.data ?? []}
          locationsFor={() => locations}
          onCreated={() => list('events')}
          onCancel={() => list('events')}
        />
      </Card>
    </div>
  )
}

import { useMemo } from 'react'
import { useList } from '@refinedev/core'
import { Modal } from 'antd'

import { SessionForm } from '../../components/SessionForm'
import { creatableOptions, type CreateScopeRow, type IdName } from '../../utility/schedulerScopes'

// A scheduler's "New session": one session or a weekly series, limited to
// the programs/locations their rules allow (schedule_create_sessions checks
// again and its refusal is shown).
export const NewSessionModal = ({
  open,
  scopes,
  onClose,
  onCreated,
}: {
  open: boolean
  scopes: CreateScopeRow[]
  onClose: () => void
  onCreated: () => void
}) => {
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
  const programs = useMemo(() => programsResult?.data ?? [], [programsResult?.data])
  const locations = useMemo(() => locationsResult?.data ?? [], [locationsResult?.data])
  const { programOptions } = useMemo(() => creatableOptions(scopes, programs, locations), [scopes, programs, locations])

  return (
    <Modal open={open} title="New session" footer={null} onCancel={onClose} width={640} destroyOnHidden>
      <SessionForm
        role="scheduler"
        programs={programOptions}
        locationsFor={(programId) => creatableOptions(scopes, programs, locations, programId).locationOptions}
        onCreated={onCreated}
        onCancel={onClose}
      />
    </Modal>
  )
}

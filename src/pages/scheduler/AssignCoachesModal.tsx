import { useState } from 'react'
import { useList } from '@refinedev/core'
import { Input, Modal, Select, Typography } from 'antd'

import { useScheduleAction } from '../../utility/scheduleActions'

// R9: staff a session from the schedule list without opening it -- e.g.
// Luis assigning the week's AP coaches. One logged schedule_add per coach;
// the database checks scope and shows any refusal.
export const AssignCoachesModal = ({
  event,
  onClose,
  onDone,
}: {
  event: { id: string; label: string; assignedIds: string[] } | null
  onClose: () => void
  onDone: () => void
}) => {
  const { run, running } = useScheduleAction()
  const [coachIds, setCoachIds] = useState<string[]>([])
  const [reason, setReason] = useState('Scheduled')
  const { result } = useList<{ id: string; name: string; is_active: boolean }>({
    resource: 'coach_directory',
    filters: [{ field: 'is_active', operator: 'eq', value: true }],
    sorters: [{ field: 'name', order: 'asc' }],
    pagination: { pageSize: 500 },
    queryOptions: { enabled: !!event },
  })

  const submit = async () => {
    if (!event) return
    let allOk = true
    for (const coachId of coachIds) {
      const name = result?.data?.find((c) => c.id === coachId)?.name ?? 'Coach'
      allOk = (await run('schedule_add', { p_event_id: event.id, p_coach_id: coachId, p_reason: reason }, `Added ${name}`)) && allOk
    }
    if (allOk) {
      setCoachIds([])
      onClose()
    }
    onDone()
  }

  return (
    <Modal
      open={!!event}
      title={event ? `Assign coaches -- ${event.label}` : ''}
      okText="Assign"
      okButtonProps={{ loading: running, disabled: coachIds.length === 0 || !reason.trim() }}
      onOk={submit}
      onCancel={onClose}
      destroyOnHidden
    >
      <Select
        mode="multiple"
        showSearch
        optionFilterProp="label"
        placeholder="Coaches"
        style={{ width: '100%' }}
        value={coachIds}
        onChange={setCoachIds}
        options={(result?.data ?? [])
          .filter((c) => !event?.assignedIds.includes(c.id))
          .map((c) => ({ label: c.name, value: c.id }))}
      />
      <Typography.Text style={{ display: 'block', marginTop: 12 }}>Reason</Typography.Text>
      <Input value={reason} onChange={(e) => setReason(e.target.value)} />
    </Modal>
  )
}

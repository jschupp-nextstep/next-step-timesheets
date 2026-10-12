import { useMemo, useState } from 'react'
import { useList } from '@refinedev/core'
import { DatePicker, Form, Input, Modal, Select, Space, TimePicker } from 'antd'
import type { Dayjs } from 'dayjs'

import { useScheduleAction } from '../../utility/scheduleActions'
import { creatableOptions, type CreateScopeRow, type IdName } from '../../utility/schedulerScopes'

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
  const { run, running } = useScheduleAction()
  const [programId, setProgramId] = useState<string | undefined>()
  const [locationId, setLocationId] = useState<string | undefined>()
  const [date, setDate] = useState<Dayjs | null>(null)
  const [start, setStart] = useState<Dayjs | null>(null)
  const [end, setEnd] = useState<Dayjs | null>(null)
  const [sessionName, setSessionName] = useState('')
  const [coachIds, setCoachIds] = useState<string[]>([])
  const [reason, setReason] = useState('')

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
  const { result: directoryResult } = useList<IdName & { is_active: boolean }>({
    resource: 'coach_directory',
    filters: [{ field: 'is_active', operator: 'eq', value: true }],
    sorters: [{ field: 'name', order: 'asc' }],
    pagination: { pageSize: 500 },
  })

  const { programOptions, locationOptions } = useMemo(
    () => creatableOptions(scopes, programsResult?.data ?? [], locationsResult?.data ?? [], programId),
    [scopes, programsResult?.data, locationsResult?.data, programId],
  )

  const reset = () => {
    setProgramId(undefined)
    setLocationId(undefined)
    setDate(null)
    setStart(null)
    setEnd(null)
    setSessionName('')
    setCoachIds([])
    setReason('')
  }

  const submit = async () => {
    const ok = await run(
      'schedule_create_event',
      {
        p_program_id: programId,
        p_location_id: locationId,
        p_event_date: date?.format('YYYY-MM-DD') ?? null,
        p_start: start?.format('HH:mm:ss') ?? null,
        p_end: end?.format('HH:mm:ss') ?? null,
        p_session_name: sessionName,
        p_coach_ids: coachIds,
        p_reason: reason,
      },
      'Session created',
    )
    if (ok) {
      reset()
      onCreated()
    }
  }

  return (
    <Modal
      open={open}
      title="New session"
      okText="Create session"
      okButtonProps={{ disabled: !programId || !locationId || !date || !reason.trim(), loading: running }}
      onOk={submit}
      onCancel={onClose}
    >
      <Form layout="vertical">
        <Form.Item label="Program" required>
          <Select
            value={programId}
            onChange={(v) => {
              setProgramId(v)
              setLocationId(undefined)
            }}
            options={programOptions.map((p) => ({ label: p.name, value: p.id }))}
            placeholder="Program"
          />
        </Form.Item>
        <Form.Item label="Location" required>
          <Select
            value={locationId}
            onChange={setLocationId}
            disabled={!programId}
            showSearch
            optionFilterProp="label"
            options={locationOptions.map((l) => ({ label: l.name, value: l.id }))}
            placeholder="Location"
          />
        </Form.Item>
        <Form.Item label="Date" required>
          <DatePicker style={{ width: '100%' }} value={date} onChange={setDate} />
        </Form.Item>
        <Space wrap>
          <Form.Item label="Start">
            <TimePicker format="h:mm A" minuteStep={5} use12Hours value={start} onChange={setStart} />
          </Form.Item>
          <Form.Item label="End">
            <TimePicker format="h:mm A" minuteStep={5} use12Hours value={end} onChange={setEnd} />
          </Form.Item>
        </Space>
        <Form.Item label="Session name (optional)">
          <Input value={sessionName} onChange={(e) => setSessionName(e.target.value)} />
        </Form.Item>
        <Form.Item label="Coaches (optional)">
          <Select
            mode="multiple"
            showSearch
            optionFilterProp="label"
            value={coachIds}
            onChange={setCoachIds}
            options={(directoryResult?.data ?? []).map((c) => ({ label: c.name, value: c.id }))}
          />
        </Form.Item>
        <Form.Item label="Reason" required extra="Why this extra session exists -- shown to payroll on review.">
          <Input.TextArea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

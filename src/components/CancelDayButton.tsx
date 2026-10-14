import { useState } from 'react'
import { useList } from '@refinedev/core'
import { App, Button, DatePicker, Input, Modal, Select, Space, Typography } from 'antd'
import type { Dayjs } from 'dayjs'

import { supabaseClient } from '../utility/supabaseClient'
import { scheduleErrorMessage } from '../utility/scheduleActions'
import { CANCELLATION_TIMING_OPTIONS } from '../utility/scheduleChanges'

// R6: cancel every session on a day (storm, holiday) in one step, optionally
// only some programs. An admin cancels all matching sessions; a scheduler
// only the ones they manage (schedule_cancel_day, 0028).
export const CancelDayButton = ({ onDone, scopeNote }: { onDone: () => void; scopeNote?: string }) => {
  const { message } = App.useApp()
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState<Dayjs | null>(null)
  const [programIds, setProgramIds] = useState<string[]>([])
  const [timing, setTiming] = useState<string | undefined>()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const { result: programsResult } = useList<{ id: string; name: string }>({
    resource: 'programs',
    filters: [{ field: 'entry_mode', operator: 'eq', value: 'session' }],
    sorters: [{ field: 'name', order: 'asc' }],
    pagination: { pageSize: 100 },
    queryOptions: { enabled: open },
  })

  const submit = async () => {
    if (!date) return
    setBusy(true)
    try {
      const { data, error } = await supabaseClient.rpc('schedule_cancel_day', {
        p_date: date.format('YYYY-MM-DD'),
        p_program_ids: programIds.length > 0 ? programIds : null,
        p_reason: reason,
        p_timing: timing ?? null,
      })
      const err = scheduleErrorMessage(error)
      if (err) {
        message.error({ content: err, duration: 6 })
        return
      }
      message.success(`Cancelled ${data} session${data === 1 ? '' : 's'} on ${date.format('ddd M/D')}`)
      setOpen(false)
      setDate(null)
      setProgramIds([])
      setTiming(undefined)
      setReason('')
      onDone()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button danger onClick={() => setOpen(true)}>
        Cancel a day…
      </Button>
      <Modal
        open={open}
        title="Cancel a whole day"
        okText="Cancel these sessions"
        okButtonProps={{ danger: true, loading: busy, disabled: !date || !timing || !reason.trim() }}
        onOk={submit}
        onCancel={() => setOpen(false)}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary">
          Every active session that day{scopeNote ? ` ${scopeNote}` : ''} is cancelled in one step, each logged with this
          reason. Coaches see them as cancelled; any hours already logged on them are held for your decision instead of
          being paid.
        </Typography.Paragraph>
        <Space direction="vertical" style={{ width: '100%' }}>
          <DatePicker style={{ width: '100%' }} placeholder="Day" value={date} onChange={setDate} />
          <Select
            mode="multiple"
            allowClear
            style={{ width: '100%' }}
            placeholder="All programs (or pick some)"
            value={programIds}
            onChange={setProgramIds}
            options={(programsResult?.data ?? []).map((p) => ({ label: p.name, value: p.id }))}
            optionFilterProp="label"
          />
          <Select
            style={{ width: '100%' }}
            placeholder="When was it cancelled?"
            value={timing}
            onChange={setTiming}
            options={CANCELLATION_TIMING_OPTIONS}
          />
          <Input.TextArea rows={2} placeholder="Reason (required), e.g. Storm -- fields closed" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Space>
      </Modal>
    </>
  )
}

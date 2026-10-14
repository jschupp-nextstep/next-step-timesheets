import { useState } from 'react'
import { useList } from '@refinedev/core'
import { App, Button, DatePicker, Input, InputNumber, Modal, Select, Space, Typography } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'

import { supabaseClient } from '../../utility/supabaseClient'

// R8: a one-off dollar adjustment for a coach (rate correction catch-up,
// weekly top-up...) with a required reason. Stored as an ordinary pending
// entry on the admin-only "Adjustment" program (0027) with a flat amount, so
// it flows through Payment Due, Mark all paid (basis 'flat'), and the Zoho
// export exactly like any other flat-amount entry. Positive only: per the
// payroll rules there are no clawbacks -- fix the record instead.
export const AdjustmentButton = ({ adjustmentProgramId, onAdded }: { adjustmentProgramId?: string; onAdded: () => void }) => {
  const { message } = App.useApp()
  const [open, setOpen] = useState(false)
  const [coachId, setCoachId] = useState<string | undefined>()
  const [amount, setAmount] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const [date, setDate] = useState<Dayjs>(dayjs())
  const [busy, setBusy] = useState(false)

  const { result: coachesResult } = useList<{ id: string; name: string }>({
    resource: 'coaches',
    filters: [{ field: 'is_active', operator: 'eq', value: true }],
    sorters: [{ field: 'name', order: 'asc' }],
    pagination: { pageSize: 300 },
    queryOptions: { enabled: open },
  })

  const submit = async () => {
    if (!adjustmentProgramId || !coachId || !amount || !reason.trim()) return
    setBusy(true)
    try {
      const { error } = await supabaseClient.from('timesheet_entries').insert({
        coach_id: coachId,
        program_id: adjustmentProgramId,
        entry_date: date.format('YYYY-MM-DD'),
        flat_amount: amount,
        session_name: `Adjustment: ${reason.trim()}`.slice(0, 200),
        notes: reason.trim(),
        status: 'pending',
      })
      if (error) {
        message.error({ content: `Couldn't add the adjustment: ${error.message}`, duration: 6 })
        return
      }
      message.success('Adjustment added -- it pays with the rest of the run')
      setOpen(false)
      setCoachId(undefined)
      setAmount(null)
      setReason('')
      onAdded()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button
        disabled={!adjustmentProgramId}
        title={adjustmentProgramId ? undefined : 'Run migration 0027 to add the Adjustment program'}
        onClick={() => setOpen(true)}
      >
        Add adjustment…
      </Button>
      <Modal
        open={open}
        title="Add a pay adjustment"
        okText="Add adjustment"
        okButtonProps={{ loading: busy, disabled: !coachId || !amount || amount <= 0 || !reason.trim() }}
        onOk={submit}
        onCancel={() => setOpen(false)}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary">
          For a one-off amount like a rate-correction catch-up. It's added as a pending entry in this payroll run and
          exported to Zoho with everything else. Positive amounts only (no clawbacks).
        </Typography.Paragraph>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Select
            showSearch
            optionFilterProp="label"
            placeholder="Coach"
            style={{ width: '100%' }}
            value={coachId}
            onChange={setCoachId}
            options={(coachesResult?.data ?? []).map((c) => ({ label: c.name, value: c.id }))}
          />
          <Space wrap>
            <InputNumber min={0.01} step={0.01} addonBefore="$" placeholder="Amount" value={amount} onChange={setAmount} />
            <DatePicker value={date} onChange={(d) => d && setDate(d)} allowClear={false} />
          </Space>
          <Input.TextArea
            rows={2}
            placeholder="Reason (required), e.g. Pat rate correction $50 → $60 for 9/1–9/30"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Space>
      </Modal>
    </>
  )
}

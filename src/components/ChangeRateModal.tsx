import { useEffect, useState } from 'react'
import { App, DatePicker, InputNumber, Modal, Space, Typography } from 'antd'
import type { Dayjs } from 'dayjs'

import { supabaseClient } from '../utility/supabaseClient'

export type ChangingRate = { id: string; hourly_rate: number; coachName: string; programName: string }

// R8: a dated rate change closes the current rate the day before and starts
// a new one, so entries before that date keep the old rate (change_rate,
// 0027_rate_history_adjustments.sql). Used by the Rates list and the coach
// profile.
export const ChangeRateModal = ({
  rate,
  onClose,
  onDone,
}: {
  rate: ChangingRate | null
  onClose: () => void
  onDone: () => void
}) => {
  const { message } = App.useApp()
  const [newRate, setNewRate] = useState<number | null>(null)
  const [fromDate, setFromDate] = useState<Dayjs | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setNewRate(rate?.hourly_rate ?? null)
    setFromDate(null)
  }, [rate])

  const submit = async () => {
    if (!rate || newRate == null || !fromDate) return
    setBusy(true)
    try {
      const { error } = await supabaseClient.rpc('change_rate', {
        p_rate_id: rate.id,
        p_new_rate: newRate,
        p_from: fromDate.format('YYYY-MM-DD'),
      })
      if (error) {
        message.error({ content: error.message, duration: 6 })
        return
      }
      message.success(`${rate.coachName}: $${newRate} from ${fromDate.format('MMM D, YYYY')}`)
      onDone()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={!!rate}
      title={rate ? `Change ${rate.coachName}'s ${rate.programName} rate` : ''}
      okText="Change rate"
      okButtonProps={{ loading: busy, disabled: newRate == null || !fromDate }}
      onOk={submit}
      onCancel={onClose}
      destroyOnHidden
    >
      <Typography.Paragraph>
        Currently ${rate?.hourly_rate}/hr. Sessions before the date below keep the current rate; sessions on or after it
        use the new one. Already-paid entries never change.
      </Typography.Paragraph>
      <Space wrap>
        <InputNumber min={0} step={0.5} addonBefore="$" addonAfter="/hr" value={newRate} onChange={setNewRate} />
        <DatePicker placeholder="Effective from" value={fromDate} onChange={setFromDate} />
      </Space>
    </Modal>
  )
}

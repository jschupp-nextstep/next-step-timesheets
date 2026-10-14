import { useState } from 'react'
import { App, Button, Card, DatePicker, Input, InputNumber, Modal, Select, Space, Table, Tag, Typography } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'

import { supabaseClient } from '../../utility/supabaseClient'
import {
  DOW_LABEL,
  weekEndFor,
  weekStartFor,
  type WeekLine,
  type WeeklyPayment,
  type WeeklyRate,
} from '../../utility/weeklyPay'

export type WeeklyRateWithNames = WeeklyRate & { coaches: { name: string } | null; programs: { name: string } | null }
type WeekEntry = { id: string; coach_id: string; program_id: string; entry_date: string; session_name: string | null }

const fmtWeek = (start: string, end: string) => `${dayjs(start).format('ddd M/D')} – ${dayjs(end).format('ddd M/D')}`

// R7: one line per coach-week for weekly-rate coaches (0026). Unpaid weeks
// get "Pay"; weeks already paid (e.g. in advance) that have new sessions get
// "Attach". The money lives on weekly_payments; the sessions are marked paid
// against it with amount $0.
export const WeeklyPayCard = ({
  weeks,
  rates,
  onPaid,
}: {
  weeks: WeekLine<WeekEntry>[]
  rates: WeeklyRateWithNames[]
  onPaid: (paidEntryIds: string[]) => void
}) => {
  const { message } = App.useApp()
  const [paying, setPaying] = useState<{ rateId: string; weekStart: string; entryIds: string[]; advance: boolean } | null>(
    null,
  )
  const [amount, setAmount] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [advanceRateId, setAdvanceRateId] = useState<string | undefined>()
  const [advanceDate, setAdvanceDate] = useState<Dayjs | null>(null)
  const [busy, setBusy] = useState(false)

  const rateById = new Map(rates.map((r) => [r.id, r]))
  const label = (rateId: string) => {
    const r = rateById.get(rateId)
    return r ? `${r.coaches?.name ?? '?'}${r.programs ? ` (${r.programs.name})` : ''}` : '?'
  }

  const openPay = (rateId: string, weekStart: string, entryIds: string[], advance: boolean) => {
    setPaying({ rateId, weekStart, entryIds, advance })
    setAmount(rateById.get(rateId)?.weekly_amount ?? null)
    setNote('')
  }

  const pay = async () => {
    if (!paying) return
    setBusy(true)
    try {
      const { error } = await supabaseClient.rpc('pay_weekly', {
        p_weekly_rate_id: paying.rateId,
        p_week_start: paying.weekStart,
        p_amount: amount,
        p_note: note || null,
        p_entry_ids: paying.entryIds,
        p_paid_date: dayjs().format('YYYY-MM-DD'),
      })
      if (error) {
        message.error({ content: error.message, duration: 6 })
        return
      }
      message.success(`Paid ${label(paying.rateId)} for ${fmtWeek(paying.weekStart, weekEndFor(paying.weekStart))}`)
      setPaying(null)
      setAdvanceRateId(undefined)
      setAdvanceDate(null)
      onPaid(paying.entryIds)
    } finally {
      setBusy(false)
    }
  }

  const attach = async (paymentId: string, entryIds: string[]) => {
    setBusy(true)
    try {
      const { error } = await supabaseClient.rpc('attach_weekly_entries', { p_payment_id: paymentId, p_entry_ids: entryIds })
      if (error) {
        message.error({ content: error.message, duration: 6 })
        return
      }
      message.success(`${entryIds.length} session(s) attached to the paid week`)
      onPaid(entryIds)
    } finally {
      setBusy(false)
    }
  }

  const rate = paying ? rateById.get(paying.rateId) : undefined
  const differs = !!rate && amount != null && amount !== rate.weekly_amount
  const advanceRate = advanceRateId ? rateById.get(advanceRateId) : undefined

  return (
    <Card
      size="small"
      style={{ marginTop: 16 }}
      title={`Weekly pay (${weeks.length})`}
      extra={
        rates.length > 0 && (
          <Space>
            <Select
              size="small"
              placeholder="Pay a week in advance…"
              style={{ width: 220 }}
              value={advanceRateId}
              onChange={setAdvanceRateId}
              options={rates.map((r) => ({ label: label(r.id), value: r.id }))}
            />
            {advanceRate && (
              <>
                <DatePicker
                  size="small"
                  placeholder={`Any day in the week`}
                  value={advanceDate}
                  onChange={setAdvanceDate}
                />
                <Button
                  size="small"
                  disabled={!advanceDate}
                  onClick={() =>
                    advanceDate &&
                    openPay(advanceRate.id, weekStartFor(advanceDate.format('YYYY-MM-DD'), advanceRate.week_start_dow), [], true)
                  }
                >
                  Pay…
                </Button>
              </>
            )}
          </Space>
        )
      }
    >
      <Typography.Paragraph type="secondary">
        Coaches paid by the week. Their sessions aren't in the hourly table above; each line is one week, paid at the
        weekly rate (you can change the amount when paying, with a note). Weeks with no logged sessions don't appear.
      </Typography.Paragraph>
      <Table dataSource={weeks} rowKey="key" size="small" pagination={false}>
        <Table.Column title="Coach" render={(_, w: WeekLine<WeekEntry>) => label(w.rate.id)} />
        <Table.Column
          title="Week"
          render={(_, w: WeekLine<WeekEntry>) =>
            `${fmtWeek(w.weekStart, w.weekEnd)} (${DOW_LABEL[w.rate.week_start_dow].slice(0, 3)}–${DOW_LABEL[(w.rate.week_start_dow + 6) % 7].slice(0, 3)})`
          }
        />
        <Table.Column title="Sessions logged" render={(_, w: WeekLine<WeekEntry>) => w.entries.length} />
        <Table.Column
          title="Amount"
          align="right"
          render={(_, w: WeekLine<WeekEntry>) =>
            w.payment ? (
              <Space direction="vertical" size={0} align="end">
                <span>${w.payment.amount.toFixed(2)}</span>
                <Tag color="green">Paid {w.payment.paid_date}</Tag>
              </Space>
            ) : (
              `$${w.rate.weekly_amount.toFixed(2)}`
            )
          }
        />
        <Table.Column
          title="Actions"
          render={(_, w: WeekLine<WeekEntry>) =>
            w.payment ? (
              <Button size="small" loading={busy} onClick={() => attach(w.payment!.id, w.entries.map((e) => e.id))}>
                Attach {w.entries.length} new session(s)
              </Button>
            ) : (
              <Button size="small" type="primary" onClick={() => openPay(w.rate.id, w.weekStart, w.entries.map((e) => e.id), false)}>
                Pay week…
              </Button>
            )
          }
        />
      </Table>

      <Modal
        open={!!paying}
        title={paying ? `Pay ${label(paying.rateId)} -- ${fmtWeek(paying.weekStart, weekEndFor(paying.weekStart))}` : ''}
        okText="Pay week"
        okButtonProps={{ loading: busy, disabled: amount == null || (differs && !note.trim()) }}
        onOk={pay}
        onCancel={() => setPaying(null)}
        destroyOnHidden
      >
        {paying?.advance && (
          <Typography.Paragraph>
            <Tag color="blue">In advance</Tag> No sessions are logged for this week yet; ones logged later can be attached to
            this payment.
          </Typography.Paragraph>
        )}
        {paying && !paying.advance && (
          <Typography.Paragraph>{paying.entryIds.length} session(s) will be marked paid as part of this week.</Typography.Paragraph>
        )}
        <Typography.Text>Amount</Typography.Text>
        <InputNumber
          style={{ width: '100%', marginTop: 4 }}
          min={0}
          step={50}
          addonBefore="$"
          value={amount}
          onChange={setAmount}
        />
        {rate && (
          <Typography.Paragraph type="secondary" style={{ marginTop: 4 }}>
            Weekly rate: ${rate.weekly_amount.toFixed(2)}
          </Typography.Paragraph>
        )}
        <Typography.Text>Note{differs ? ' (required -- the amount differs from the rate)' : ' (optional)'}</Typography.Text>
        <Input.TextArea rows={2} style={{ marginTop: 4 }} value={note} onChange={(e) => setNote(e.target.value)} />
      </Modal>
    </Card>
  )
}

// Paid history for weekly-rate coaches: one row per paid week overlapping
// the selected range.
export const WeeklyPaidHistory = ({
  payments,
  rates,
}: {
  payments: (WeeklyPayment & { note?: string | null; standard_amount?: number })[]
  rates: WeeklyRateWithNames[]
}) => {
  if (payments.length === 0) return null
  const rateById = new Map(rates.map((r) => [r.id, r]))
  return (
    <Card size="small" style={{ marginTop: 16 }} title={`Weekly pay (${payments.length})`}>
      <Table dataSource={payments} rowKey="id" size="small" pagination={false}>
        <Table.Column
          title="Coach"
          render={(_, p: WeeklyPayment) => {
            const r = rateById.get(p.weekly_rate_id)
            return r ? `${r.coaches?.name ?? '?'}${r.programs ? ` (${r.programs.name})` : ''}` : '?'
          }}
        />
        <Table.Column title="Week" render={(_, p: WeeklyPayment) => fmtWeek(p.week_start, p.week_end)} />
        <Table.Column title="Amount" align="right" render={(_, p: WeeklyPayment) => `$${p.amount.toFixed(2)}`} />
        <Table.Column dataIndex="paid_date" title="Paid" />
        <Table.Column dataIndex="note" title="Note" render={(v) => v || '—'} />
      </Table>
    </Card>
  )
}

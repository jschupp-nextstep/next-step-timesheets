import { useState } from 'react'
import { App, Button, Card, Input, Modal, Space, Table, Tag, Typography } from 'antd'
import dayjs from 'dayjs'

import { supabaseClient } from '../../utility/supabaseClient'
import { EntryFlagActions } from '../../components/EntryFlagActions'
import type { AdminFlag } from '../../utility/payrollFilters'
import { CANCELLATION_TIMING_LABEL } from '../../utility/scheduleChanges'

type Row = {
  id: string
  entry_date: string
  hours: number | null
  flat_amount: number | null
  session_name: string | null
  status: 'pending' | 'paid'
  admin_flag: AdminFlag | null
  coaches: { name: string } | null
  programs: { name: string } | null
  events: { is_cancelled: boolean; cancellation_timing: string | null } | null
}

// R6: entries logged on a session that was later cancelled. Not paid by
// default; decide each one: pay anyway (an exception, e.g. the coach wasn't
// told and showed up), mark Canceled (not paid), or Hold and ask.
export const CanceledSessionsCard = ({ entries, onDone }: { entries: Row[]; onDone: () => void }) => {
  const { message } = App.useApp()
  const [approving, setApproving] = useState<Row | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const approve = async () => {
    if (!approving) return
    setBusy(true)
    try {
      const { error } = await supabaseClient.rpc('approve_canceled_event_pay', { p_entry_id: approving.id, p_reason: reason })
      if (error) {
        message.error({ content: error.message, duration: 6 })
        return
      }
      message.success(`${approving.coaches?.name ?? 'Entry'} will be paid as an exception`)
      setApproving(null)
      setReason('')
      onDone()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card size="small" style={{ marginTop: 16 }} title={`Entries on canceled sessions (${entries.length})`}>
      <Typography.Paragraph type="secondary">
        Canceled sessions aren't paid by default. Pay one anyway only as an exception (e.g. the coach wasn't told and
        showed up) -- the reason goes to the coach. Otherwise mark it Canceled, or Hold it to ask.
      </Typography.Paragraph>
      <Table<Row> dataSource={entries} rowKey="id" size="small" pagination={false}>
        <Table.Column title="Date" render={(_, r: Row) => dayjs(r.entry_date).format('M/D')} width={70} />
        <Table.Column title="Coach" render={(_, r: Row) => r.coaches?.name ?? '—'} />
        <Table.Column
          title="Session"
          render={(_, r: Row) => `${r.programs?.name ?? '—'}${r.session_name ? ` · ${r.session_name}` : ''}`}
        />
        <Table.Column
          title="Logged"
          render={(_, r: Row) => (r.flat_amount != null ? `$${r.flat_amount.toFixed(2)}` : `${r.hours?.toFixed(2) ?? '—'} hrs`)}
        />
        <Table.Column
          title="Cancellation"
          render={(_, r: Row) => <Tag>{CANCELLATION_TIMING_LABEL[r.events?.cancellation_timing ?? ''] ?? 'Cancelled (timing not recorded)'}</Tag>}
        />
        <Table.Column
          title="Decide"
          render={(_, r: Row) => (
            <Space wrap size={4}>
              <Button
                size="small"
                type="primary"
                onClick={() => {
                  setApproving(r)
                  setReason('')
                }}
              >
                Pay anyway…
              </Button>
              <EntryFlagActions entry={r} onDone={onDone} />
            </Space>
          )}
        />
      </Table>
      <Modal
        open={!!approving}
        title="Pay this entry despite the cancellation?"
        okText="Pay as exception"
        okButtonProps={{ loading: busy, disabled: !reason.trim() }}
        onOk={approve}
        onCancel={() => setApproving(null)}
        destroyOnHidden
      >
        <Typography.Paragraph>It moves into Payment Due. The reason is posted to the entry for the coach to see.</Typography.Paragraph>
        <Input.TextArea
          rows={2}
          placeholder="Reason (required), e.g. Coach wasn't told about the rain-out and showed up"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Modal>
    </Card>
  )
}

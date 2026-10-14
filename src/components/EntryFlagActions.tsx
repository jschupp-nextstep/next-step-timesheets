import { useState } from 'react'
import { Button, Input, Modal, Space, Tag, Typography } from 'antd'

import { useEntryAction } from '../utility/scheduleActions'
import type { AdminFlag } from '../utility/payrollFilters'
import { ADMIN_FLAG_LABEL } from '../utility/entryFlags'

export const AdminFlagTag = ({ flag }: { flag: AdminFlag | null | undefined }) =>
  flag ? <Tag color={flag === 'hold' ? 'gold' : 'default'}>{ADMIN_FLAG_LABEL[flag]}</Tag> : null

type Action = 'hold' | 'canceled' | 'not_next_step' | 'clear'

const ACTION_COPY: Record<Action, { title: string; label: string; placeholder: string; required: boolean; ok: string }> = {
  hold: {
    title: 'Put on hold and ask the coach',
    label: 'Question for the coach',
    placeholder: 'e.g. Did you stay until 8:30?',
    required: true,
    ok: 'Put on hold',
  },
  canceled: {
    title: 'Mark canceled (not paid)',
    label: 'Reason (the coach sees it)',
    placeholder: 'e.g. Session canceled for weather before start',
    required: true,
    ok: 'Mark canceled',
  },
  not_next_step: {
    title: 'Mark Not Next Step (not paid)',
    label: 'Reason (the coach sees it)',
    placeholder: 'e.g. MSC game -- paid by MSC, not Next Step',
    required: true,
    ok: 'Mark Not Next Step',
  },
  clear: {
    title: 'Clear the flag',
    label: 'Note to the coach (optional)',
    placeholder: 'e.g. Thanks -- paying it as logged',
    required: false,
    ok: 'Clear flag',
  },
}

// Admin Hold / Canceled / Not Next Step / Clear buttons for one entry (R4).
// Everything goes through the 0025 functions; the database decides and any
// refusal is shown by useEntryAction.
export const EntryFlagActions = ({
  entry,
  onDone,
  size = 'small',
}: {
  entry: { id: string; status: 'pending' | 'paid'; admin_flag?: AdminFlag | null }
  onDone: () => void
  size?: 'small' | 'middle'
}) => {
  const { run, running } = useEntryAction()
  const [action, setAction] = useState<Action | null>(null)
  const [text, setText] = useState('')

  if (entry.status !== 'pending') return null

  const open = (a: Action) => {
    setAction(a)
    setText('')
  }

  const submit = async () => {
    if (!action) return
    const ok =
      action === 'hold'
        ? await run('hold_entry', { p_entry_id: entry.id, p_question: text }, 'On hold -- the coach will see your question')
        : action === 'clear'
          ? await run('clear_entry_flag', { p_entry_id: entry.id, p_note: text || null }, 'Flag cleared')
          : await run('flag_entry', { p_entry_id: entry.id, p_flag: action, p_reason: text }, `Marked ${ADMIN_FLAG_LABEL[action]}`)
    if (ok) {
      setAction(null)
      onDone()
    }
  }

  const copy = action ? ACTION_COPY[action] : null

  return (
    <>
      <Space size={4} wrap>
        {entry.admin_flag ? (
          <Button size={size} onClick={() => open('clear')}>
            {entry.admin_flag === 'hold' ? 'Release' : 'Clear flag'}
          </Button>
        ) : (
          <>
            <Button size={size} onClick={() => open('hold')}>
              Hold…
            </Button>
            <Button size={size} onClick={() => open('canceled')}>
              Canceled…
            </Button>
            <Button size={size} onClick={() => open('not_next_step')}>
              Not NS…
            </Button>
          </>
        )}
      </Space>
      <Modal
        open={!!action}
        title={copy?.title}
        okText={copy?.ok}
        okButtonProps={{ loading: running, disabled: !!copy?.required && !text.trim() }}
        onOk={submit}
        onCancel={() => setAction(null)}
        destroyOnHidden
      >
        <Typography.Text>{copy?.label}</Typography.Text>
        <Input.TextArea
          rows={3}
          style={{ marginTop: 4 }}
          placeholder={copy?.placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {action === 'hold' && (
          <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
            The entry stays out of Payment Due until you release it. The coach sees the question in My Sessions and can
            reply there; they can't edit or delete the entry meanwhile.
          </Typography.Paragraph>
        )}
      </Modal>
    </>
  )
}

import { useState } from 'react'
import { useList } from '@refinedev/core'
import { Button, Empty, Input, Space, Typography } from 'antd'
import dayjs from 'dayjs'

import { useEntryAction } from '../utility/scheduleActions'
import type { EntryMessage } from '../utility/entryFlags'

// The admin <-> coach question thread on one entry (R4, entry_messages).
// Admins can always post; a coach can reply only while the entry is on
// Hold -- the database enforces both (coach_reply_entry / admin_entry_message).
export const EntryThread = ({
  entryId,
  as,
  canReply,
  onPosted,
}: {
  entryId: string
  as: 'admin' | 'coach'
  canReply: boolean
  onPosted?: () => void
}) => {
  const { run, running } = useEntryAction()
  const [draft, setDraft] = useState('')
  const { result, query } = useList<EntryMessage>({
    resource: 'entry_messages',
    filters: [{ field: 'entry_id', operator: 'eq', value: entryId }],
    sorters: [{ field: 'created_at', order: 'asc' }],
    pagination: { pageSize: 200 },
  })
  const messages = result?.data ?? []

  const send = async () => {
    const ok = await run(
      as === 'admin' ? 'admin_entry_message' : 'coach_reply_entry',
      { p_entry_id: entryId, p_body: draft },
      'Sent',
    )
    if (ok) {
      setDraft('')
      query.refetch()
      onPosted?.()
    }
  }

  return (
    <div>
      {messages.length === 0 ? (
        <Empty description="No messages yet" image={Empty.PRESENTED_IMAGE_SIMPLE} imageStyle={{ height: 24 }} />
      ) : (
        messages.map((m) => (
          <div key={m.id} style={{ marginBottom: 8 }}>
            <Typography.Text strong>{m.author_role === 'admin' ? 'Next Step' : 'Coach'}</Typography.Text>{' '}
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {dayjs(m.created_at).format('MMM D, h:mm A')}
            </Typography.Text>
            <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
          </div>
        ))
      )}
      {canReply && (
        <Space.Compact style={{ width: '100%', marginTop: 4 }}>
          <Input.TextArea
            autoSize={{ minRows: 1, maxRows: 4 }}
            placeholder={as === 'admin' ? 'Follow-up question or note' : 'Your answer'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <Button type="primary" loading={running} disabled={!draft.trim()} onClick={send}>
            {as === 'admin' ? 'Send' : 'Reply'}
          </Button>
        </Space.Compact>
      )}
    </div>
  )
}

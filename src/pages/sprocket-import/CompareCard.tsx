import { useEffect, useState } from 'react'
import { App, Button, Card, Popconfirm, Space, Table, Tag, Typography } from 'antd'
import dayjs from 'dayjs'

import { supabaseClient } from '../../utility/supabaseClient'
import { describeRow, type SprocketChange } from '../../utility/sprocketCompare'

// Phase 9 step 8 (0043): sessions the app keeps that were changed in
// Sprocket. Each is decided on its own, right away (not on Confirm import).

export type TakePayload = {
  snapshot: Record<string, unknown>
  rows: Record<string, string>[]
  ids: string[]
  // Coaches Sprocket's Notes name, mapped -- null if any isn't mapped yet.
  sprocketCoachIds: string[] | null
  note: string | null
}

type EventInfo = { id: string; event_date: string; start_time: string | null; session_name: string | null; locations: { name: string } | null }

const FIELD_LABEL: Record<string, string> = { coaches: 'coaches (Notes)' }

export const CompareCard = ({
  changes,
  build,
}: {
  changes: SprocketChange[]
  build: (change: SprocketChange) => TakePayload | { error: string }
}) => {
  const { message } = App.useApp()
  const [info, setInfo] = useState<Map<string, EventInfo>>(new Map())
  const [done, setDone] = useState<Map<string, string>>(new Map())
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    const ids = changes.map((c) => c.eventId)
    if (!ids.length) return
    void supabaseClient
      .from('events')
      .select('id, event_date, start_time, session_name, locations(name)')
      .in('id', ids)
      .then(({ data }) => setInfo(new Map(((data ?? []) as unknown as EventInfo[]).map((e) => [e.id, e]))))
  }, [changes])

  const label = (c: SprocketChange) => {
    const e = info.get(c.eventId)
    if (!e) return c.rows[0] ? describeRow(c.rows[0].fileRow) : c.eventId
    return [
      dayjs(e.event_date).format('ddd M/D'),
      e.start_time ? dayjs(`2000-01-01T${e.start_time}`).format('h:mm A') : null,
      e.session_name,
      e.locations?.name,
    ]
      .filter(Boolean)
      .join(' · ')
  }

  const take = async (c: SprocketChange) => {
    const p = build(c)
    if ('error' in p) {
      message.error({ content: p.error, duration: 8 })
      return
    }
    setBusy(c.eventId)
    try {
      const { data, error } = await supabaseClient.rpc('sprocket_take_event', {
        p_event_id: c.eventId,
        p_snapshot: p.snapshot,
        p_rows: p.rows,
        p_ids: p.ids,
      })
      if (error) {
        message.error({ content: error.message, duration: 8 })
        return
      }
      const changed = ((data as { changes: string[] }).changes ?? []).join(', ')
      setDone((m) => new Map(m).set(c.eventId, `Took Sprocket's${changed ? `: ${changed}` : ''}${p.note ? ` (${p.note})` : ''}`))
    } finally {
      setBusy(null)
    }
  }

  const keep = async (c: SprocketChange) => {
    const p = build(c)
    setBusy(c.eventId)
    try {
      const { error } = await supabaseClient.rpc('sprocket_keep_app', {
        p_event_id: c.eventId,
        p_rows: c.rows.map((r) => ({ club_calendar_event_id: r.clubCalendarEventId, sprocket_row: r.fileRow })),
        p_sprocket_coach_ids: 'error' in p ? null : p.sprocketCoachIds,
      })
      if (error) {
        message.error({ content: error.message, duration: 8 })
        return
      }
      setDone((m) => new Map(m).set(c.eventId, "Kept the app's -- the next Export to Sprocket sends it back"))
    } finally {
      setBusy(null)
    }
  }

  const open = changes.filter((c) => !done.has(c.eventId)).length

  return (
    <Card title={`Changed in Sprocket (${open} to decide)`} size="small" style={{ marginTop: 16 }}>
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        These sessions are kept in this app, but Sprocket now differs from what the app last sent. Take
        Sprocket's version (the app's session changes to match, logged in its history), or keep the app's
        (the next Export to Sprocket, New and changed, puts it back in Sprocket). Each choice is saved right
        away; Confirm import below doesn't change these sessions.
      </Typography.Paragraph>
      <Table dataSource={changes} rowKey="eventId" size="small" pagination={{ pageSize: 20 }} scroll={{ x: true }}>
        <Table.Column title="Session" render={(_, c: SprocketChange) => label(c)} />
        <Table.Column
          title="Changed"
          render={(_, c: SprocketChange) =>
            [...new Set(c.rows.flatMap((r) => r.fields))].map((f) => <Tag key={f}>{FIELD_LABEL[f] ?? f}</Tag>)
          }
        />
        <Table.Column
          title="App last sent → Sprocket now"
          render={(_, c: SprocketChange) => (
            <Space direction="vertical" size={2}>
              {c.rows.map((r) => (
                <span key={r.clubCalendarEventId} style={{ fontSize: 12 }}>
                  {r.fileRow.TeamName ? <strong>{r.fileRow.TeamName}: </strong> : null}
                  {describeRow(r.stored)} → <strong>{describeRow(r.fileRow)}</strong>
                </span>
              ))}
            </Space>
          )}
        />
        <Table.Column
          title=""
          render={(_, c: SprocketChange) =>
            done.has(c.eventId) ? (
              <Typography.Text type="success">{done.get(c.eventId)}</Typography.Text>
            ) : (
              <Space wrap>
                <Popconfirm
                  title="Take Sprocket's version?"
                  description="The session changes to match Sprocket. Logged as an admin change."
                  okText="Take Sprocket's"
                  onConfirm={() => take(c)}
                >
                  <Button size="small" loading={busy === c.eventId}>
                    Take Sprocket's
                  </Button>
                </Popconfirm>
                <Button size="small" type="primary" disabled={busy === c.eventId} onClick={() => keep(c)}>
                  Keep the app's
                </Button>
              </Space>
            )
          }
        />
      </Table>
    </Card>
  )
}

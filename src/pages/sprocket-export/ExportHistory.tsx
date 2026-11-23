import { useCallback, useEffect, useState } from 'react'
import { App, Button, Card, Empty, Popconfirm, Space, Table, Tag, Typography } from 'antd'
import dayjs from 'dayjs'
import { Link } from 'react-router'

import { supabaseClient } from '../../utility/supabaseClient'

// Phase 9 step 6 (0039): every Export to Sprocket file, newest first. A file
// waits for upload until it's marked uploaded (changes then count as what
// Sprocket has) or discarded (its new sessions can go in another file).

type Batch = {
  id: string
  created_at: string
  created_by_email: string | null
  mode: 'changes' | 'new'
  range_from: string
  range_to: string
  new_rows: number
  changed_rows: number
  status: 'waiting_upload' | 'uploaded' | 'abandoned'
  decided_by_email: string | null
  decided_at: string | null
}

export const saveCsv = (csv: string, filename: string) => {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

const STATUS = {
  waiting_upload: { label: 'Waiting for upload', color: 'gold' },
  uploaded: { label: 'Uploaded', color: 'green' },
  abandoned: { label: 'Discarded', color: 'default' },
} as const

export const ExportHistory = ({ refreshKey }: { refreshKey: number }) => {
  const { message } = App.useApp()
  const [batches, setBatches] = useState<Batch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  // Uploaded files' new rows still not linked, per file.
  const [unlinked, setUnlinked] = useState<Map<string, number>>(new Map())

  const load = useCallback(async () => {
    setLoading(true)
    const [b, rows] = await Promise.all([
      supabaseClient
        .from('sprocket_export_batches')
        .select('id, created_at, created_by_email, mode, range_from, range_to, new_rows, changed_rows, status, decided_by_email, decided_at')
        .order('created_at', { ascending: false })
        .limit(30),
      supabaseClient
        .from('sprocket_export_batch_rows')
        .select('batch_id, event_sprocket_rows!inner(state)')
        .eq('kind', 'new')
        .eq('event_sprocket_rows.state', 'new')
        .range(0, 9999),
    ])
    const err = b.error ?? rows.error
    setError(err ? err.message : null)
    setBatches((b.data ?? []) as Batch[])
    const counts = new Map<string, number>()
    for (const r of (rows.data ?? []) as { batch_id: string }[]) counts.set(r.batch_id, (counts.get(r.batch_id) ?? 0) + 1)
    setUnlinked(counts)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const downloadAgain = async (batch: Batch) => {
    const { data, error: e } = await supabaseClient.from('sprocket_export_batches').select('csv').eq('id', batch.id).single()
    if (e || !data) {
      message.error(e?.message ?? 'Not found')
      return
    }
    saveCsv(data.csv as string, `sprocket-${batch.mode === 'changes' ? 'changes' : 'new-sessions'}-${batch.range_from}-to-${batch.range_to}.csv`)
  }

  const decide = async (batch: Batch, status: 'uploaded' | 'abandoned') => {
    setBusyId(batch.id)
    try {
      const { error: e } = await supabaseClient.rpc('sprocket_decide_batch', { p_batch_id: batch.id, p_status: status })
      if (e) message.error({ content: e.message, duration: 8 })
      else message.success(status === 'uploaded' ? 'Marked uploaded' : 'Discarded')
      await load()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Card title="Export files" size="small" style={{ marginTop: 16 }} loading={loading}>
      {error && <Typography.Text type="danger">{error} -- has migration 0039 been run?</Typography.Text>}
      {!error && batches.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No files yet" />
      ) : (
        <Table dataSource={batches} rowKey="id" size="small" pagination={false} scroll={{ x: true }}>
          <Table.Column
            title="Made"
            render={(_, b: Batch) => (
              <Space direction="vertical" size={0}>
                <span>{dayjs(b.created_at).format('MMM D, h:mm A')}</span>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {b.created_by_email}
                </Typography.Text>
              </Space>
            )}
          />
          <Table.Column
            title="Sessions dated"
            render={(_, b: Batch) => `${dayjs(b.range_from).format('M/D')} – ${dayjs(b.range_to).format('M/D/YYYY')}`}
          />
          <Table.Column
            title="Rows"
            render={(_, b: Batch) => [b.new_rows && `${b.new_rows} new`, b.changed_rows && `${b.changed_rows} changed`].filter(Boolean).join(', ')}
          />
          <Table.Column
            title="Status"
            render={(_, b: Batch) => (
              <Space direction="vertical" size={0}>
                <Tag color={STATUS[b.status].color}>{STATUS[b.status].label}</Tag>
                {b.decided_at && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {dayjs(b.decided_at).format('MMM D')} · {b.decided_by_email}
                  </Typography.Text>
                )}
                {b.status === 'uploaded' && (unlinked.get(b.id) ?? 0) > 0 && (
                  <Typography.Text type="warning" style={{ fontSize: 12 }}>
                    {unlinked.get(b.id)} new row(s) to link -- <Link to="/sprocket-link">Link Sprocket IDs</Link>
                  </Typography.Text>
                )}
              </Space>
            )}
          />
          <Table.Column
            title=""
            render={(_, b: Batch) => (
              <Space wrap>
                <Button size="small" onClick={() => downloadAgain(b)}>
                  Download again
                </Button>
                {b.status === 'waiting_upload' && (
                  <>
                    <Popconfirm
                      title="Is this file in Sprocket?"
                      description="Mark it only once Sprocket has taken it. Its changes then count as what Sprocket has; link its new sessions next."
                      okText="Yes, uploaded"
                      onConfirm={() => decide(b, 'uploaded')}
                    >
                      <Button size="small" type="primary" loading={busyId === b.id}>
                        Mark uploaded
                      </Button>
                    </Popconfirm>
                    <Popconfirm
                      title="Discard this file?"
                      description="Only if it was never uploaded. Its new sessions can then go in another file."
                      okText="Discard"
                      okButtonProps={{ danger: true }}
                      onConfirm={() => decide(b, 'abandoned')}
                    >
                      <Button size="small" danger>
                        Discard
                      </Button>
                    </Popconfirm>
                  </>
                )}
              </Space>
            )}
          />
        </Table>
      )}
    </Card>
  )
}

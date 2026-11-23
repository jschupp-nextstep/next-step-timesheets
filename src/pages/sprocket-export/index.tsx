import { useMemo, useState } from 'react'
import { useList } from '@refinedev/core'
import { Alert, App, Button, Card, DatePicker, Popconfirm, Radio, Select, Space, Table, Tag, Typography } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import Papa from 'papaparse'
import dayjs, { type Dayjs } from 'dayjs'

import { supabaseClient } from '../../utility/supabaseClient'
import { useAppSettings } from '../../utility/appSettings'
import {
  buildChangedRows,
  buildNewRows,
  DEFAULT_RSVP,
  SPROCKET_COLUMNS,
  type ChangedResult,
  type ExportResult,
  type ExportSession,
  type SprocketCsvRow,
  type RsvpTemplate,
} from '../../utility/sprocketExport'

// Phase 9 step 3: download the sessions that aren't in Sprocket yet as a CSV
// Sprocket's calendar import reads. New rows only -- changes to sessions
// already in Sprocket, cancellations and deletes come in later steps.

type EventRow = {
  id: string
  event_date: string
  start_time: string | null
  end_time: string | null
  session_name: string | null
  is_cancelled: boolean
  event_type: ExportSession['event_type']
  opponent: string | null
  away_game: boolean
  uniform: string | null
  is_private: boolean
  arrival_minutes: number | null
  app_managed: boolean
  snapshot_coach_ids: string[] | null
  programs: { name: string } | null
  locations: { name: string; sprocket_location_id: string | null } | null
  fields: { name: string; sprocket_field_id: string | null } | null
  event_assignments: { coach_id: string; coaches: { name: string } | null }[]
  event_sprocket_rows: {
    id: string
    state: ExportSession['rows'][number]['state']
    club_calendar_event_id: string | null
    sprocket_team_id: string | null
    sprocket_row: Record<string, string> | null
    sprocket_teams: { name: string; sprocket_program_id: string | null; sprocket_programs: { name: string } | null } | null
  }[]
}

const SELECT = [
  'id, event_date, start_time, end_time, session_name, is_cancelled, event_type, opponent, away_game, uniform, is_private, arrival_minutes, app_managed',
  'snapshot_coach_ids:sprocket_snapshot->coach_ids',
  'programs(name), locations(name, sprocket_location_id), fields(name, sprocket_field_id)',
  'event_assignments(coach_id, coaches:coach_directory!event_assignments_coach_id_fkey(name))',
  'event_sprocket_rows(id, state, club_calendar_event_id, sprocket_team_id, sprocket_row, sprocket_teams(name, sprocket_program_id, sprocket_programs(name)))',
].join(', ')

const toSession = (e: EventRow): ExportSession => ({
  id: e.id,
  event_date: e.event_date,
  start_time: e.start_time,
  end_time: e.end_time,
  session_name: e.session_name,
  is_cancelled: e.is_cancelled,
  event_type: e.event_type,
  opponent: e.opponent,
  away_game: e.away_game,
  uniform: e.uniform,
  is_private: e.is_private,
  arrival_minutes: e.arrival_minutes,
  programName: e.programs?.name ?? '',
  location: { name: e.locations?.name ?? '?', sprocket_location_id: e.locations?.sprocket_location_id ?? null },
  field: e.fields,
  coachNames: e.event_assignments.map((a) => a.coaches?.name).filter((n): n is string => !!n),
  coachIds: e.event_assignments.map((a) => a.coach_id),
  snapshotCoachIds: e.snapshot_coach_ids,
  appManaged: e.app_managed,
  rows: e.event_sprocket_rows.map((r) => ({
    id: r.id,
    state: r.state,
    club_calendar_event_id: r.club_calendar_event_id,
    sprocket_team_id: r.sprocket_team_id,
    sprocketRow: r.sprocket_row,
    team: r.sprocket_teams
      ? {
          name: r.sprocket_teams.name,
          sprocket_program_id: r.sprocket_teams.sprocket_program_id,
          programName: r.sprocket_teams.sprocket_programs?.name ?? null,
        }
      : null,
  })),
})

export const SprocketExport = () => {
  const { message } = App.useApp()
  const { settings } = useAppSettings()
  const scheduleSourceFrom = settings?.schedule_source_from ?? null
  const [mode, setMode] = useState<'changes' | 'new'>('changes')
  const [changed, setChanged] = useState<ChangedResult | null>(null)
  const [recording, setRecording] = useState(false)
  const [recorded, setRecorded] = useState<number | null>(null)
  const [range, setRange] = useState<[Dayjs, Dayjs]>(() => [dayjs().startOf('day'), dayjs().add(120, 'day')])
  const [programIds, setProgramIds] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ExportResult | null>(null)
  const [built, setBuilt] = useState<{ from: string; to: string } | null>(null)

  const { result: programsResult } = useList<{ id: string; name: string }>({
    resource: 'programs',
    filters: [{ field: 'entry_mode', operator: 'eq', value: 'session' }],
    sorters: [{ field: 'name', order: 'asc' }],
    pagination: { pageSize: 100 },
  })

  const build = async () => {
    setLoading(true)
    setError(null)
    setResult(null)
    setChanged(null)
    setRecorded(null)
    try {
      const from = range[0].format('YYYY-MM-DD')
      const to = range[1].format('YYYY-MM-DD')
      let query = supabaseClient
        .from('events')
        .select(SELECT)
        .gte('event_date', from)
        .lte('event_date', to)
        .order('event_date')
        .order('start_time')
        .range(0, 4999)
      if (programIds.length) query = query.in('program_id', programIds)
      const [events, templates] = await Promise.all([
        query,
        // RSVP settings from each team's (and Club) rows already in Sprocket.
        supabaseClient
          .from('event_sprocket_rows')
          .select('sprocket_team_id, rsvp:sprocket_row->>CollectRSVP, staff:sprocket_row->>CollectStaffRSVP')
          .eq('state', 'linked')
          .range(0, 9999),
      ])
      const err = events.error ?? templates.error
      if (err) {
        setError(err.message)
        return
      }
      const rsvpByTeam = new Map<string, RsvpTemplate>()
      let clubRsvp: RsvpTemplate = DEFAULT_RSVP
      for (const t of (templates.data ?? []) as unknown as { sprocket_team_id: string | null; rsvp: string | null; staff: string | null }[]) {
        const template = { CollectRSVP: t.rsvp || DEFAULT_RSVP.CollectRSVP, CollectStaffRSVP: t.staff || DEFAULT_RSVP.CollectStaffRSVP }
        if (t.sprocket_team_id) rsvpByTeam.set(t.sprocket_team_id, template)
        else clubRsvp = template
      }
      const sessions = ((events.data ?? []) as unknown as EventRow[]).map(toSession)
      setResult(buildNewRows(sessions, rsvpByTeam, clubRsvp))
      setChanged(mode === 'changes' ? buildChangedRows(sessions, scheduleSourceFrom) : null)
      setBuilt({ from, to })
    } finally {
      setLoading(false)
    }
  }

  // New rows first, then changes by ID.
  const fileRows: SprocketCsvRow[] = [...(result?.csvRows ?? []), ...(changed?.csvRows ?? [])]

  const download = () => {
    if (!result || !built) return
    const csv = Papa.unparse({
      fields: [...SPROCKET_COLUMNS],
      data: fileRows.map((r) => SPROCKET_COLUMNS.map((c) => r[c])),
    })
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `sprocket-${changed ? 'changes' : 'new-sessions'}-${built.from}-to-${built.to}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // After the file is in Sprocket: what Sprocket has for each changed row is
  // now what was sent (0038), so it isn't listed again.
  const recordUpload = async () => {
    if (!changed?.csvRows.length) return
    setRecording(true)
    try {
      const { data, error: rpcError } = await supabaseClient.rpc('sprocket_mark_uploaded', {
        p_rows: changed.csvRows.map((row, i) => ({ row_id: changed.rowIds[i], sprocket_row: row })),
      })
      if (rpcError) {
        message.error({ content: rpcError.message, duration: 8 })
        return
      }
      setRecorded(data as number)
      setChanged(null)
      setResult(null)
      message.success('Recorded')
    } finally {
      setRecording(false)
    }
  }

  const sessionCount = useMemo(() => {
    if (!result) return 0
    return new Set(result.csvRows.map((r) => `${r.StartDate}|${r.StartDateTime}|${r.LocationID}|${r.Title}`)).size
  }, [result])

  return (
    <div>
      <Typography.Title level={3}>Export to Sprocket</Typography.Title>
      <Typography.Paragraph type="secondary">
        Downloads a file for Sprocket's calendar import: sessions made in this app that aren't in Sprocket yet (one row
        per Sprocket team, one per Club session, coaches in Notes), and changes to sessions already there -- times,
        coaches, cancellations -- sent by Sprocket ID so they update instead of duplicating. Deleting comes later: for
        now delete in Sprocket by hand.
      </Typography.Paragraph>

      <Card size="small">
        <Space wrap>
          <DatePicker.RangePicker
            value={range}
            format="M/D/YYYY"
            allowClear={false}
            onChange={(v) => v?.[0] && v[1] && setRange([v[0], v[1]])}
          />
          <Select
            mode="multiple"
            allowClear
            style={{ minWidth: 260 }}
            placeholder="All programs"
            value={programIds}
            onChange={setProgramIds}
            options={(programsResult?.data ?? []).map((p) => ({ label: p.name, value: p.id }))}
          />
          <Radio.Group
            optionType="button"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            options={[
              { label: 'New and changed', value: 'changes' },
              { label: 'New sessions only', value: 'new' },
            ]}
          />
          <Button type="primary" loading={loading} onClick={build}>
            Check sessions
          </Button>
        </Space>
        <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
          {scheduleSourceFrom
            ? `Scheduled in the app from ${dayjs(scheduleSourceFrom).format('M/D/YYYY')} (Settings): changes to any session from then on are included; before it, only sessions made here.`
            : 'Until the switch date is set in Settings, only sessions made in this app are included -- imported ones are still edited in Sprocket.'}
        </Typography.Paragraph>
      </Card>

      {recorded !== null && (
        <Alert
          style={{ marginTop: 16 }}
          type="success"
          showIcon
          message={`Recorded ${recorded} row(s) as uploaded`}
          description="Sessions made in this file's new rows still need Link Sprocket IDs."
        />
      )}

      {error && <Alert type="error" style={{ marginTop: 16 }} message="Couldn't load sessions" description={error} />}

      {result && built && (
        <>
          <Alert
            style={{ marginTop: 16 }}
            type={fileRows.length ? 'success' : 'info'}
            showIcon
            message={
              fileRows.length
                ? `${result.csvRows.length} new row(s) from ${sessionCount} session(s)${
                    changed ? `, ${changed.csvRows.length} changed row(s)` : ''
                  }, ${dayjs(built.from).format('M/D')} – ${dayjs(built.to).format('M/D/YYYY')}`
                : 'Nothing to send to Sprocket in this range'
            }
            description={
              <>
                {changed ? (
                  <>
                    {changed.unchanged > 0 && <div>{changed.unchanged} row(s) already in Sprocket and unchanged.</div>}
                    {changed.notYours > 0 && (
                      <div>{changed.notYours} row(s) on sessions still scheduled in Sprocket (before the switch) -- not included.</div>
                    )}
                  </>
                ) : (
                  result.alreadyInSprocket > 0 && <div>{result.alreadyInSprocket} row(s) already in Sprocket -- not included.</div>
                )}
                {result.cancelledSkipped > 0 && (
                  <div>{result.cancelledSkipped} new session(s) already cancelled -- never sent, so nothing to send.</div>
                )}
              </>
            }
            action={
              fileRows.length > 0 && (
                <Space direction="vertical">
                  <Button type="primary" icon={<DownloadOutlined />} onClick={download}>
                    Download CSV
                  </Button>
                  {!!changed?.csvRows.length && (
                    <Popconfirm
                      title="Uploaded to Sprocket?"
                      description="Only once Sprocket has taken the file. The changed rows then stop being listed."
                      okText="Yes, it's uploaded"
                      onConfirm={recordUpload}
                    >
                      <Button loading={recording}>I've uploaded this file</Button>
                    </Popconfirm>
                  )}
                </Space>
              )
            }
          />
          {result.csvRows.length > 0 && (
            <Alert
              style={{ marginTop: 12 }}
              type="warning"
              showIcon
              message="Upload this file to Sprocket once"
              description="Sprocket creates a new event for every row without an ID. Until the IDs are linked back here (the next step), exporting and uploading the same sessions again would create them twice in Sprocket."
            />
          )}

          {changed && changed.changes.length > 0 && (
            <Card title={`Changed since Sprocket last had it (${changed.changes.length})`} size="small" style={{ marginTop: 16 }}>
              <Typography.Paragraph type="secondary">
                Sent with each row's Sprocket ID, so Sprocket updates the event instead of adding one.
              </Typography.Paragraph>
              <Table dataSource={changed.changes} rowKey="rowId" size="small" pagination={{ pageSize: 25 }}>
                <Table.Column dataIndex="label" title="Session" />
                <Table.Column dataIndex="team" title="Team" />
                <Table.Column
                  title="What changed"
                  render={(_, c: ChangedResult['changes'][number]) => c.fields.map((f) => <Tag key={f}>{f}</Tag>)}
                />
                <Table.Column dataIndex="before" title="Sprocket has" />
                <Table.Column dataIndex="after" title="Will be" />
              </Table>
            </Card>
          )}

          {[...result.problems, ...(changed?.problems ?? [])].length > 0 && (
            <Card title={`Can't export yet (${[...result.problems, ...(changed?.problems ?? [])].length})`} size="small" style={{ marginTop: 16 }}>
              <Typography.Paragraph type="secondary">
                These sessions aren't in the file. Fix the reason and check again.
              </Typography.Paragraph>
              <Table
                dataSource={[...result.problems, ...(changed?.problems ?? [])]}
                rowKey={(p) => `${p.sessionId}-${p.reason}`}
                size="small"
                pagination={{ pageSize: 20 }}
              >
                <Table.Column dataIndex="label" title="Session" />
                <Table.Column dataIndex="reason" title="Why" />
              </Table>
            </Card>
          )}

          {result.csvRows.length > 0 && (
            <Card title="New rows in the file" size="small" style={{ marginTop: 16 }}>
              <Table
                dataSource={result.csvRows.map((r, i) => ({ ...r, key: result.rowIds[i] }))}
                size="small"
                pagination={{ pageSize: 25 }}
                scroll={{ x: true }}
              >
                <Table.Column dataIndex="StartDate" title="Date" />
                <Table.Column title="Time" render={(_, r: Record<string, string>) => `${r.StartDateTime} – ${r.EndDateTime}`} />
                <Table.Column title="Title" render={(_, r: Record<string, string>) => r.Title || `(game) vs ${r.Opponent || 'TBD'}`} />
                <Table.Column dataIndex="ClubEventType" title="Type" />
                <Table.Column title="Team" render={(_, r: Record<string, string>) => r.TeamName || 'Club'} />
                <Table.Column dataIndex="LocationName" title="Location" />
                <Table.Column dataIndex="Notes" title="Notes" />
              </Table>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

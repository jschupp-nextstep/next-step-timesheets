import { useMemo, useState } from 'react'
import { useList } from '@refinedev/core'
import { Alert, Button, Card, DatePicker, Select, Space, Table, Typography } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import Papa from 'papaparse'
import dayjs, { type Dayjs } from 'dayjs'

import { supabaseClient } from '../../utility/supabaseClient'
import {
  buildNewRows,
  DEFAULT_RSVP,
  SPROCKET_COLUMNS,
  type ExportResult,
  type ExportSession,
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
  programs: { name: string } | null
  locations: { name: string; sprocket_location_id: string | null } | null
  fields: { name: string; sprocket_field_id: string | null } | null
  event_assignments: { coaches: { name: string } | null }[]
  event_sprocket_rows: {
    id: string
    state: ExportSession['rows'][number]['state']
    club_calendar_event_id: string | null
    sprocket_team_id: string | null
    sprocket_teams: { name: string; sprocket_program_id: string | null; sprocket_programs: { name: string } | null } | null
  }[]
}

const SELECT = [
  'id, event_date, start_time, end_time, session_name, is_cancelled, event_type, opponent, away_game, uniform, is_private, arrival_minutes',
  'programs(name), locations(name, sprocket_location_id), fields(name, sprocket_field_id)',
  'event_assignments(coaches:coach_directory!event_assignments_coach_id_fkey(name))',
  'event_sprocket_rows(id, state, club_calendar_event_id, sprocket_team_id, sprocket_teams(name, sprocket_program_id, sprocket_programs(name)))',
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
  rows: e.event_sprocket_rows.map((r) => ({
    id: r.id,
    state: r.state,
    club_calendar_event_id: r.club_calendar_event_id,
    sprocket_team_id: r.sprocket_team_id,
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
      setResult(buildNewRows(((events.data ?? []) as unknown as EventRow[]).map(toSession), rsvpByTeam, clubRsvp))
      setBuilt({ from, to })
    } finally {
      setLoading(false)
    }
  }

  const download = () => {
    if (!result || !built) return
    const csv = Papa.unparse({
      fields: [...SPROCKET_COLUMNS],
      data: result.csvRows.map((r) => SPROCKET_COLUMNS.map((c) => r[c])),
    })
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `sprocket-new-sessions-${built.from}-to-${built.to}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const sessionCount = useMemo(() => {
    if (!result) return 0
    return new Set(result.csvRows.map((r) => `${r.StartDate}|${r.StartDateTime}|${r.LocationID}|${r.Title}`)).size
  }, [result])

  return (
    <div>
      <Typography.Title level={3}>Export to Sprocket</Typography.Title>
      <Typography.Paragraph type="secondary">
        Downloads the sessions made in this app that aren't in Sprocket yet, as a file for Sprocket's calendar import --
        one row per Sprocket team (a Club session is one row), coaches in Notes. Sessions imported from Sprocket are
        already there and aren't included. Changes, cancellations and deletes come later.
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
          <Button type="primary" loading={loading} onClick={build}>
            Check sessions
          </Button>
        </Space>
      </Card>

      {error && <Alert type="error" style={{ marginTop: 16 }} message="Couldn't load sessions" description={error} />}

      {result && built && (
        <>
          <Alert
            style={{ marginTop: 16 }}
            type={result.csvRows.length ? 'success' : 'info'}
            showIcon
            message={
              result.csvRows.length
                ? `${result.csvRows.length} Sprocket row(s) from ${sessionCount} session(s), ${dayjs(built.from).format('M/D')} – ${dayjs(built.to).format('M/D/YYYY')}`
                : 'Nothing new to send to Sprocket in this range'
            }
            description={
              <>
                {result.alreadyInSprocket > 0 && <div>{result.alreadyInSprocket} row(s) already in Sprocket -- not included.</div>}
                {result.cancelledSkipped > 0 && (
                  <div>{result.cancelledSkipped} new session(s) already cancelled -- never sent, so nothing to send.</div>
                )}
              </>
            }
            action={
              result.csvRows.length > 0 && (
                <Button type="primary" icon={<DownloadOutlined />} onClick={download}>
                  Download CSV
                </Button>
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

          {result.problems.length > 0 && (
            <Card title={`Can't export yet (${result.problems.length})`} size="small" style={{ marginTop: 16 }}>
              <Typography.Paragraph type="secondary">
                These sessions aren't in the file. Fix the reason and check again.
              </Typography.Paragraph>
              <Table dataSource={result.problems} rowKey="sessionId" size="small" pagination={{ pageSize: 20 }}>
                <Table.Column dataIndex="label" title="Session" />
                <Table.Column dataIndex="reason" title="Why" />
              </Table>
            </Card>
          )}

          {result.csvRows.length > 0 && (
            <Card title="Rows in the file" size="small" style={{ marginTop: 16 }}>
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

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, App, Card, Input, Select, Space, Switch, Table, Tag, Typography } from 'antd'

import { supabaseClient } from '../../utility/supabaseClient'

// Phase 9: Sprocket's own IDs for programs, teams, locations and fields
// (0033). Filled automatically from every import; edited here. The export
// (later steps) uses them to write rows Sprocket can import.

type SprocketProgram = { sprocket_program_id: string; name: string; combine_teams: boolean; is_active: boolean }
type SprocketTeam = {
  sprocket_team_id: string
  name: string
  sprocket_program_id: string | null
  program_id: string | null
  is_default: boolean
  is_active: boolean
}
type LocationRow = { id: string; name: string; is_active: boolean; sprocket_location_id: string | null }
type FieldRow = { id: string; name: string; sprocket_field_id: string | null; location_id: string; is_active: boolean }
type IdName = { id: string; name: string }

export const SprocketMappings = () => {
  const { message } = App.useApp()
  const [programs, setPrograms] = useState<SprocketProgram[]>([])
  const [teams, setTeams] = useState<SprocketTeam[]>([])
  const [locations, setLocations] = useState<LocationRow[]>([])
  const [fields, setFields] = useState<FieldRow[]>([])
  const [appPrograms, setAppPrograms] = useState<IdName[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [teamProgramFilter, setTeamProgramFilter] = useState<string | undefined>()
  const [showInactiveTeams, setShowInactiveTeams] = useState(false)
  const [locationFilter, setLocationFilter] = useState<'all' | 'missing'>('all')

  const load = useCallback(async () => {
    setLoading(true)
    const [p, t, l, f, ap] = await Promise.all([
      supabaseClient.from('sprocket_programs').select('*').order('name'),
      supabaseClient.from('sprocket_teams').select('*').order('name'),
      supabaseClient.from('locations').select('id, name, is_active, sprocket_location_id').order('name'),
      supabaseClient.from('fields').select('*').order('name'),
      supabaseClient.from('programs').select('id, name').order('name'),
    ])
    const error = p.error ?? t.error ?? l.error ?? f.error ?? ap.error
    setLoadError(error ? error.message : null)
    setPrograms((p.data ?? []) as SprocketProgram[])
    setTeams((t.data ?? []) as SprocketTeam[])
    setLocations((l.data ?? []) as LocationRow[])
    setFields((f.data ?? []) as FieldRow[])
    setAppPrograms((ap.data ?? []) as IdName[])
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Every edit saves straight away; the screen reloads from the database so
  // it always shows what was actually saved.
  const save = async (
    table: 'sprocket_programs' | 'sprocket_teams' | 'locations' | 'fields',
    keyColumn: string,
    key: string,
    values: Record<string, unknown>,
  ) => {
    const { error } = await supabaseClient.from(table).update(values).eq(keyColumn, key)
    if (error) message.error({ content: error.message, duration: 8 })
    else message.success('Saved')
    await load()
  }

  const programName = useMemo(() => new Map(programs.map((p) => [p.sprocket_program_id, p.name])), [programs])
  const appProgramName = useMemo(() => new Map(appPrograms.map((p) => [p.id, p.name])), [appPrograms])
  const locationName = useMemo(() => new Map(locations.map((l) => [l.id, l.name])), [locations])

  const shownTeams = teams.filter(
    (t) =>
      (showInactiveTeams || t.is_active) && (!teamProgramFilter || t.sprocket_program_id === teamProgramFilter),
  )
  const shownLocations = locations.filter(
    (l) => l.is_active && (locationFilter === 'all' || !l.sprocket_location_id) && l.name !== 'Location TBD',
  )
  const defaultsByProgram = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const t of teams) if (t.is_default && t.is_active && t.program_id) m.set(t.program_id, [...(m.get(t.program_id) ?? []), t.name])
    return m
  }, [teams])

  return (
    <div>
      <Typography.Title level={3}>Sprocket mappings</Typography.Title>
      <Typography.Paragraph type="secondary">
        Sprocket's own IDs for its programs, teams, locations and fields. They fill in automatically from
        every Sprocket import; change them here. Exporting sessions to Sprocket (coming next) uses them, and
        lists anything still missing an ID.
      </Typography.Paragraph>
      {loadError && (
        <Alert type="error" style={{ marginBottom: 16 }} message="Couldn't load the mappings" description={`${loadError} -- has migration 0033 been run?`} />
      )}

      <Card title="Sprocket programs" size="small" loading={loading}>
        <Table dataSource={programs} rowKey="sprocket_program_id" pagination={false} size="small">
          <Table.Column dataIndex="name" title="Sprocket program" />
          <Table.Column dataIndex="sprocket_program_id" title="Sprocket ID" />
          <Table.Column
            title="Teams share one session"
            render={(_, p: SprocketProgram) => (
              <Switch
                checked={p.combine_teams}
                onChange={(v) => save('sprocket_programs', 'sprocket_program_id', p.sprocket_program_id, { combine_teams: v })}
              />
            )}
          />
          <Table.Column
            title="Active"
            render={(_, p: SprocketProgram) => (
              <Switch
                checked={p.is_active}
                onChange={(v) => save('sprocket_programs', 'sprocket_program_id', p.sprocket_program_id, { is_active: v })}
              />
            )}
          />
        </Table>
        <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
          <b>Teams share one session</b>: all its teams at the same date, time and location are one session in
          the app (one set of coaches, paid once), with one Sprocket row per team — Annual Program's groups.
          Takes effect on the next import. Turn a program off as its season ends.
        </Typography.Paragraph>
      </Card>

      <Card
        title="Sprocket teams"
        size="small"
        style={{ marginTop: 16 }}
        loading={loading}
        extra={
          <Space wrap>
            <Select
              allowClear
              placeholder="All programs"
              style={{ width: 260 }}
              value={teamProgramFilter}
              onChange={setTeamProgramFilter}
              options={programs.map((p) => ({ label: p.name, value: p.sprocket_program_id }))}
            />
            <Space size={4}>
              <Switch size="small" checked={showInactiveTeams} onChange={setShowInactiveTeams} />
              <Typography.Text>Show inactive</Typography.Text>
            </Space>
          </Space>
        }
      >
        {defaultsByProgram.size > 0 && (
          <Typography.Paragraph>
            New sessions get these teams:{' '}
            {[...defaultsByProgram].map(([id, names]) => (
              <span key={id} style={{ marginRight: 12 }}>
                <b>{appProgramName.get(id) ?? '?'}</b> → {names.join(', ')}
              </span>
            ))}
          </Typography.Paragraph>
        )}
        <Table dataSource={shownTeams} rowKey="sprocket_team_id" pagination={{ pageSize: 25 }} size="small">
          <Table.Column dataIndex="name" title="Sprocket team" />
          <Table.Column dataIndex="sprocket_team_id" title="Sprocket ID" />
          <Table.Column
            title="Sprocket program"
            render={(_, t: SprocketTeam) => (t.sprocket_program_id ? programName.get(t.sprocket_program_id) ?? t.sprocket_program_id : '—')}
          />
          <Table.Column
            title="App program"
            render={(_, t: SprocketTeam) => (
              <Select
                style={{ width: 200 }}
                placeholder="Not set"
                allowClear
                value={t.program_id ?? undefined}
                options={appPrograms.map((p) => ({ label: p.name, value: p.id }))}
                onChange={(v) => save('sprocket_teams', 'sprocket_team_id', t.sprocket_team_id, { program_id: v ?? null })}
              />
            )}
          />
          <Table.Column
            title="Default for new sessions"
            render={(_, t: SprocketTeam) => (
              <Switch
                checked={t.is_default}
                onChange={(v) => save('sprocket_teams', 'sprocket_team_id', t.sprocket_team_id, { is_default: v })}
              />
            )}
          />
          <Table.Column
            title="Active"
            render={(_, t: SprocketTeam) => (
              <Switch
                checked={t.is_active}
                onChange={(v) => save('sprocket_teams', 'sprocket_team_id', t.sprocket_team_id, { is_active: v })}
              />
            )}
          />
        </Table>
      </Card>

      <Card
        title="Locations"
        size="small"
        style={{ marginTop: 16 }}
        loading={loading}
        extra={
          <Select
            style={{ width: 200 }}
            value={locationFilter}
            onChange={setLocationFilter}
            options={[
              { label: 'All active locations', value: 'all' },
              { label: 'Missing a Sprocket ID', value: 'missing' },
            ]}
          />
        }
      >
        <Table dataSource={shownLocations} rowKey="id" pagination={{ pageSize: 25 }} size="small">
          <Table.Column dataIndex="name" title="Location" />
          <Table.Column
            title="Sprocket location ID"
            render={(_, l: LocationRow) => (
              <Input
                key={`${l.id}-${l.sprocket_location_id ?? ''}`}
                style={{ width: 160 }}
                defaultValue={l.sprocket_location_id ?? ''}
                placeholder="Not set"
                status={l.sprocket_location_id ? undefined : 'warning'}
                onBlur={(e) => {
                  const v = e.target.value.trim() || null
                  if (v !== l.sprocket_location_id) void save('locations', 'id', l.id, { sprocket_location_id: v })
                }}
                onPressEnter={(e) => (e.target as HTMLInputElement).blur()}
              />
            )}
          />
          <Table.Column
            title="Fields"
            render={(_, l: LocationRow) =>
              fields
                .filter((f) => f.location_id === l.id)
                .map((f) => <Tag key={f.id}>{f.name}</Tag>)
            }
          />
        </Table>
        <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
          The ID is Sprocket's LocationID (in any Sprocket export). Several dated camp locations here can share
          one Sprocket location.
        </Typography.Paragraph>
      </Card>

      <Card title={`Fields (${fields.length})`} size="small" style={{ marginTop: 16 }} loading={loading}>
        <Table dataSource={fields} rowKey="id" pagination={{ pageSize: 25 }} size="small">
          <Table.Column dataIndex="name" title="Field" />
          <Table.Column title="Location" render={(_, f: FieldRow) => locationName.get(f.location_id) ?? '?'} />
          <Table.Column dataIndex="sprocket_field_id" title="Sprocket ID" />
          <Table.Column
            title="Active"
            render={(_, f: FieldRow) => (
              <Switch checked={f.is_active} onChange={(v) => save('fields', 'id', f.id, { is_active: v })} />
            )}
          />
        </Table>
      </Card>
    </div>
  )
}

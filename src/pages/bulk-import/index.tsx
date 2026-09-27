import { useMemo, useState } from 'react'
import { useList } from '@refinedev/core'
import { Alert, App, Button, Card, Select, Space, Table, Typography, Upload } from 'antd'
import { InboxOutlined } from '@ant-design/icons'

import { supabaseClient } from '../../utility/supabaseClient'
import {
  parseBulkImportCsv,
  type DuplicateRowGroup,
  type ParsedBulkEvent,
} from '../../utility/parseBulkImportCsv'
import { loadStoredMappings, saveStoredMapping } from '../../utility/importMappingStorage'

type IdName = { id: string; name: string }

// Same "don't import this, it's not paid work" escape hatch as the Sprocket
// importer's Programs/Locations mapping.
const IGNORE = '__ignore__'
const IGNORE_OPTION = { label: "Don't import (valid event, not paid)", value: IGNORE }

// Deliberately distinct from "unresolved" -- an admin explicitly choosing
// this is a decision, not a gap, so it counts as resolved for the Confirm
// gate even though no coach_id ever gets attached to that slot.
const UNASSIGNED = '__unassigned__'
const UNASSIGNED_OPTION = { label: 'Leave unassigned', value: UNASSIGNED }

const STORAGE_KEY = 'bulk-import-mappings-v1'

type SkippedEvent = {
  eventDate: string
  sessionName: string
  locationName: string
  programName: string
  reason: string
}

type ImportSummary = {
  eventsCreated: number
  eventsSkippedExisting: number
  eventsSkippedUnresolved: number
  eventsSkippedIgnored: number
  assignmentsCreated: number
  assignmentsLeftUnassigned: number
  skippedEvents: SkippedEvent[]
  ignoredEvents: SkippedEvent[]
}

const programLabel = (name: string) => name || '(blank)'

export const BulkImport = () => {
  const { message } = App.useApp()
  const [parsed, setParsed] = useState<ParsedBulkEvent[] | null>(null)
  const [parseErrors, setParseErrors] = useState<string[]>([])
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateRowGroup[]>([])
  const [programMap, setProgramMap] = useState<Record<string, string | null>>({})
  const [locationMap, setLocationMap] = useState<Record<string, string | null>>({})
  const [coachMap, setCoachMap] = useState<Record<string, string | null>>({})
  const [importing, setImporting] = useState(false)
  const [summary, setSummary] = useState<ImportSummary | null>(null)

  const { result: programsResult } = useList<IdName>({
    resource: 'programs',
    filters: [{ field: 'is_active', operator: 'eq', value: true }],
    pagination: { pageSize: 100 },
  })
  const { result: locationsResult } = useList<IdName>({
    resource: 'locations',
    filters: [{ field: 'is_active', operator: 'eq', value: true }],
    pagination: { pageSize: 200 },
  })
  const { result: coachesResult } = useList<IdName>({
    resource: 'coaches',
    filters: [{ field: 'is_active', operator: 'eq', value: true }],
    pagination: { pageSize: 200 },
  })
  const programs = programsResult?.data ?? []
  const locations = locationsResult?.data ?? []
  const coaches = coachesResult?.data ?? []

  const distinctProgramNames = useMemo(
    () => Array.from(new Set(parsed?.map((e) => e.programName) ?? [])),
    [parsed],
  )
  const distinctLocationNames = useMemo(
    () => Array.from(new Set(parsed?.map((e) => e.locationName) ?? [])),
    [parsed],
  )
  const distinctCoachNames = useMemo(
    () => Array.from(new Set(parsed?.flatMap((e) => e.coachNames) ?? [])),
    [parsed],
  )

  const handleFile = async (file: File) => {
    const text = await file.text()
    const { events, errors, duplicateGroups: dupes } = parseBulkImportCsv(text)
    setParsed(events)
    setParseErrors(errors)
    setDuplicateGroups(dupes)
    setSummary(null)

    const stored = loadStoredMappings(STORAGE_KEY)

    const nextProgramMap: Record<string, string | null> = {}
    for (const name of new Set(events.map((e) => e.programName))) {
      const cached = stored.programs[name]
      if (cached && (cached === IGNORE || programs.some((p) => p.id === cached))) {
        nextProgramMap[name] = cached
        continue
      }
      const match = programs.find((p) => p.name === name)
      nextProgramMap[name] = match?.id ?? null
    }
    setProgramMap(nextProgramMap)

    const nextLocationMap: Record<string, string | null> = {}
    for (const name of new Set(events.map((e) => e.locationName))) {
      const cached = stored.locations[name]
      if (cached && (cached === IGNORE || locations.some((l) => l.id === cached))) {
        nextLocationMap[name] = cached
        continue
      }
      const match = locations.find((l) => l.name === name)
      nextLocationMap[name] = match?.id ?? null
    }
    setLocationMap(nextLocationMap)

    const nextCoachMap: Record<string, string | null> = {}
    for (const name of new Set(events.flatMap((e) => e.coachNames))) {
      const cached = stored.coaches[name]
      if (cached && (cached === UNASSIGNED || coaches.some((c) => c.id === cached))) {
        nextCoachMap[name] = cached
        continue
      }
      const match = coaches.find((c) => c.name === name)
      nextCoachMap[name] = match?.id ?? null
    }
    setCoachMap(nextCoachMap)

    return false // prevent antd Upload from actually uploading anywhere
  }

  const allProgramsResolved = distinctProgramNames.every((n) => programMap[n])
  const allLocationsResolved = distinctLocationNames.every((n) => locationMap[n])
  // Unlike Programs/Locations (where IGNORE is the "not this" answer),
  // Coaches has no import-blocking IGNORE -- the gate is just "you made a
  // choice" (a real coach id OR the explicit UNASSIGNED sentinel), never a
  // silently-skipped unmatched name.
  const allCoachesResolved = distinctCoachNames.every((n) => coachMap[n] != null)
  const noDuplicates = duplicateGroups.length === 0
  const readyToImport =
    !!parsed && parsed.length > 0 && allProgramsResolved && allLocationsResolved && allCoachesResolved && noDuplicates

  const runImport = async () => {
    if (!parsed) return
    setImporting(true)
    try {
      const minDate = parsed.reduce((min, e) => (e.eventDate < min ? e.eventDate : min), parsed[0].eventDate)
      const maxDate = parsed.reduce((max, e) => (e.eventDate > max ? e.eventDate : max), parsed[0].eventDate)

      const { data: existingEvents } = await supabaseClient
        .from('events')
        .select('id, program_id, location_id, event_date, start_time, end_time, session_name')
        .gte('event_date', minDate)
        .lte('event_date', maxDate)

      const existingKey = (e: {
        program_id: string
        location_id: string
        event_date: string
        start_time: string | null
        end_time: string | null
        session_name: string | null
      }) => [e.program_id, e.location_id, e.event_date, e.start_time, e.end_time, e.session_name].join('|')

      const existingSignatures = new Set((existingEvents ?? []).map(existingKey))

      let eventsCreated = 0
      let eventsSkippedExisting = 0
      let eventsSkippedUnresolved = 0
      let eventsSkippedIgnored = 0
      let assignmentsCreated = 0
      let assignmentsLeftUnassigned = 0
      const skippedEvents: SkippedEvent[] = []
      const ignoredEvents: SkippedEvent[] = []
      const describeEvent = (event: ParsedBulkEvent, reason: string): SkippedEvent => ({
        eventDate: event.eventDate,
        sessionName: event.sessionName || '(no session name)',
        locationName: event.locationName,
        programName: programLabel(event.programName),
        reason,
      })

      for (const event of parsed) {
        const programId = programMap[event.programName]
        const locationId = locationMap[event.locationName]

        if (programId === IGNORE || locationId === IGNORE) {
          eventsSkippedIgnored += 1
          ignoredEvents.push(
            describeEvent(event, programId === IGNORE ? 'Program marked "don\'t import"' : 'Location marked "don\'t import"'),
          )
          continue
        }
        if (!programId || !locationId) {
          eventsSkippedUnresolved += 1
          skippedEvents.push(describeEvent(event, 'No program/location mapping selected'))
          continue
        }

        const signature = existingKey({
          program_id: programId,
          location_id: locationId,
          event_date: event.eventDate,
          start_time: event.startTime,
          end_time: event.endTime,
          session_name: event.sessionName,
        })
        if (existingSignatures.has(signature)) {
          eventsSkippedExisting += 1
          continue
        }

        const { data: inserted, error } = await supabaseClient
          .from('events')
          .insert({
            program_id: programId,
            location_id: locationId,
            event_date: event.eventDate,
            start_time: event.startTime,
            end_time: event.endTime,
            session_name: event.sessionName,
            is_cancelled: false,
          })
          .select('id')
          .single()

        if (error || !inserted) continue
        eventsCreated += 1
        existingSignatures.add(signature)

        if (event.coachNames.length > 0) {
          const assignmentRows = event.coachNames
            .map((name) => coachMap[name])
            .filter((id): id is string => !!id && id !== UNASSIGNED)
            .map((coachId) => ({ event_id: inserted.id, coach_id: coachId }))

          assignmentsLeftUnassigned += event.coachNames.filter((name) => coachMap[name] === UNASSIGNED).length

          if (assignmentRows.length > 0) {
            const { error: assignError } = await supabaseClient.from('event_assignments').insert(assignmentRows)
            if (!assignError) assignmentsCreated += assignmentRows.length
          }
        }
      }

      setSummary({
        eventsCreated,
        eventsSkippedExisting,
        eventsSkippedUnresolved,
        eventsSkippedIgnored,
        assignmentsCreated,
        assignmentsLeftUnassigned,
        skippedEvents,
        ignoredEvents,
      })
      message.success('Import complete')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div>
      <Typography.Title level={3}>Bulk Import Events</Typography.Title>
      <Typography.Paragraph type="secondary">
        Upload a CSV in this app's native format (Program, Location, Date, Start Time, End Time,
        Session Name, Coaches) to create events and assign coaches directly -- unlike the Sprocket
        importer, this supports multiple coaches per session natively, for any program, not just
        Camp.
      </Typography.Paragraph>

      <Upload.Dragger beforeUpload={handleFile} accept=".csv" showUploadList={false} maxCount={1}>
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p>Click or drag a bulk-import CSV here</p>
      </Upload.Dragger>

      {parseErrors.length > 0 && (
        <Alert
          style={{ marginTop: 16 }}
          type="warning"
          message={`${parseErrors.length} row(s) had issues and were skipped`}
          description={parseErrors.slice(0, 10).join('; ')}
        />
      )}

      {duplicateGroups.length > 0 && (
        <Alert
          style={{ marginTop: 16 }}
          type="error"
          showIcon
          message="Duplicate rows found in this file"
          description={
            <div>
              <Typography.Paragraph style={{ marginBottom: 8 }}>
                These rows share the same Program/Location/Date/Time/Session Name but different
                Coaches -- if you meant one session with multiple coaches, list them all in a
                single row's Coaches column (semicolon-separated) instead of one row per coach;
                otherwise only the first row's coaches would be kept. Fix the file and re-upload.
              </Typography.Paragraph>
              <ul style={{ marginBottom: 0 }}>
                {duplicateGroups.map((g) => (
                  <li key={g.signature}>Rows {g.rowNumbers.join(', ')}</li>
                ))}
              </ul>
            </div>
          }
        />
      )}

      {parsed && (
        <>
          <Alert
            style={{ marginTop: 16 }}
            type="info"
            message={`${parsed.length} events found, referencing ${distinctProgramNames.length} program name(s), ${distinctLocationNames.length} location name(s), and ${distinctCoachNames.length} coach name(s).`}
          />

          <Card title="Programs" style={{ marginTop: 16 }} size="small">
            <Table dataSource={distinctProgramNames.map((name) => ({ name }))} rowKey="name" pagination={false} size="small">
              <Table.Column dataIndex="name" title="Program (from CSV)" render={(name: string) => programLabel(name)} />
              <Table.Column
                title="Maps to"
                render={(_, record: { name: string }) => (
                  <Select
                    style={{ width: 260 }}
                    placeholder="Select a program"
                    value={programMap[record.name] ?? undefined}
                    options={[...programs.map((p) => ({ label: p.name, value: p.id })), IGNORE_OPTION]}
                    onChange={(value) => {
                      setProgramMap((prev) => ({ ...prev, [record.name]: value }))
                      saveStoredMapping(STORAGE_KEY, 'programs', record.name, value ?? null)
                    }}
                    status={programMap[record.name] ? undefined : 'error'}
                  />
                )}
              />
            </Table>
          </Card>

          <Card title="Locations" style={{ marginTop: 16 }} size="small">
            <Table dataSource={distinctLocationNames.map((name) => ({ name }))} rowKey="name" pagination={false} size="small">
              <Table.Column dataIndex="name" title="Location (from CSV)" render={(name: string) => programLabel(name)} />
              <Table.Column
                title="Maps to"
                render={(_, record: { name: string }) => (
                  <Select
                    style={{ width: 300 }}
                    placeholder="Select a location"
                    value={locationMap[record.name] ?? undefined}
                    options={[...locations.map((l) => ({ label: l.name, value: l.id })), IGNORE_OPTION]}
                    onChange={(value) => {
                      setLocationMap((prev) => ({ ...prev, [record.name]: value }))
                      saveStoredMapping(STORAGE_KEY, 'locations', record.name, value ?? null)
                    }}
                    status={locationMap[record.name] ? undefined : 'error'}
                  />
                )}
              />
            </Table>
          </Card>

          <Card title="Coaches" style={{ marginTop: 16 }} size="small">
            <Table dataSource={distinctCoachNames.map((name) => ({ name }))} rowKey="name" pagination={false} size="small">
              <Table.Column dataIndex="name" title="Coach (from CSV)" />
              <Table.Column
                title="Maps to"
                render={(_, record: { name: string }) => (
                  <Select
                    style={{ width: 260 }}
                    placeholder="Select a coach or leave unassigned"
                    value={coachMap[record.name] ?? undefined}
                    options={[...coaches.map((c) => ({ label: c.name, value: c.id })), UNASSIGNED_OPTION]}
                    onChange={(value) => {
                      setCoachMap((prev) => ({ ...prev, [record.name]: value }))
                      saveStoredMapping(STORAGE_KEY, 'coaches', record.name, value ?? null)
                    }}
                    status={coachMap[record.name] ? undefined : 'error'}
                  />
                )}
              />
            </Table>
            <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
              No coach with a matching name? Create the coach first from the Coaches admin screen,
              then come back and re-upload -- this screen never creates coach records on its own.
              "Leave unassigned" is for a genuinely TBD slot; it still requires an explicit choice,
              just like every other row here.
            </Typography.Paragraph>
          </Card>

          <Space style={{ marginTop: 16 }}>
            <Button type="primary" disabled={!readyToImport} loading={importing} onClick={runImport}>
              Confirm import
            </Button>
            {!readyToImport && (
              <Typography.Text type="warning">
                Resolve all programs, locations, and coaches above (and any duplicate rows) before
                importing.
              </Typography.Text>
            )}
          </Space>
        </>
      )}

      {summary && (
        <>
          <Alert
            style={{ marginTop: 16 }}
            type="success"
            message="Import summary"
            description={
              <ul style={{ marginBottom: 0 }}>
                <li>{summary.eventsCreated} events created</li>
                <li>{summary.eventsSkippedExisting} events already existed, skipped</li>
                <li>{summary.eventsSkippedUnresolved} events skipped (unresolved program/location)</li>
                <li>{summary.eventsSkippedIgnored} events intentionally not imported (marked "don't import")</li>
                <li>{summary.assignmentsCreated} coach assignments created</li>
                <li>{summary.assignmentsLeftUnassigned} slots intentionally left unassigned</li>
              </ul>
            }
          />

          {summary.skippedEvents.length > 0 && (
            <Card title="Skipped events" style={{ marginTop: 16 }} size="small">
              <Table
                dataSource={summary.skippedEvents}
                rowKey={(row, index) => `${row.eventDate}-${row.sessionName}-${index}`}
                pagination={false}
                size="small"
              >
                <Table.Column dataIndex="eventDate" title="Date" />
                <Table.Column dataIndex="sessionName" title="Session" />
                <Table.Column dataIndex="programName" title="Program" />
                <Table.Column dataIndex="locationName" title="Location" />
                <Table.Column dataIndex="reason" title="Reason" />
              </Table>
            </Card>
          )}

          {summary.ignoredEvents.length > 0 && (
            <Card title="Intentionally not imported" style={{ marginTop: 16 }} size="small">
              <Table
                dataSource={summary.ignoredEvents}
                rowKey={(row, index) => `${row.eventDate}-${row.sessionName}-${index}`}
                pagination={false}
                size="small"
              >
                <Table.Column dataIndex="eventDate" title="Date" />
                <Table.Column dataIndex="sessionName" title="Session" />
                <Table.Column dataIndex="programName" title="Program" />
                <Table.Column dataIndex="locationName" title="Location" />
                <Table.Column dataIndex="reason" title="Reason" />
              </Table>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

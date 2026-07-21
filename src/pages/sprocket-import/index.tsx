import { useMemo, useState } from 'react'
import { useList } from '@refinedev/core'
import { Alert, Button, Card, Select, Space, Table, Typography, Upload, message } from 'antd'
import { InboxOutlined } from '@ant-design/icons'

import { supabaseClient } from '../../utility/supabaseClient'
import {
  groupEventsByLocationBlock,
  parseSprocketCsv,
  type LocationBlock,
  type ParsedEvent,
} from '../../utility/parseSprocketCsv'

type IdName = { id: string; name: string }

// Sprocket's program names don't match ours verbatim -- adjust here if
// Sprocket's naming changes.
const PROGRAM_NAME_MAP: Record<string, string> = {
  Camps: 'Camp',
  '2025-26 Annual Program': 'Annual Program',
}

type ImportSummary = {
  eventsCreated: number
  eventsSkippedExisting: number
  eventsSkippedUnresolved: number
  assignmentsCreated: number
  assignmentsSkippedUnmatched: number
}

export const SprocketImport = () => {
  const [parsed, setParsed] = useState<ParsedEvent[] | null>(null)
  const [parseErrors, setParseErrors] = useState<string[]>([])
  const [programMap, setProgramMap] = useState<Record<string, string | null>>({})
  const [locationBlocks, setLocationBlocks] = useState<LocationBlock[]>([])
  const [locationMap, setLocationMap] = useState<Record<string, string | null>>({})
  const [coachMap, setCoachMap] = useState<Record<string, string | null>>({})
  const [coachProgramOverride, setCoachProgramOverride] = useState<Record<string, string | null>>({})
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
    () => Array.from(new Set(parsed?.map((e) => e.programName).filter(Boolean) ?? [])),
    [parsed],
  )
  const distinctCoachNames = useMemo(
    () => Array.from(new Set(parsed?.flatMap((e) => e.assignedCoachNames) ?? [])),
    [parsed],
  )

  const handleFile = async (file: File) => {
    const text = await file.text()
    const { events, errors } = parseSprocketCsv(text)
    setParsed(events)
    setParseErrors(errors)
    setSummary(null)

    // Auto-resolve anything that matches exactly or via the fixed program
    // name translation; leave everything else for manual mapping below.
    const nextProgramMap: Record<string, string | null> = {}
    for (const name of new Set(events.map((e) => e.programName).filter(Boolean))) {
      const mappedName = PROGRAM_NAME_MAP[name] ?? name
      const match = programs.find((p) => p.name === mappedName)
      nextProgramMap[name] = match?.id ?? null
    }
    setProgramMap(nextProgramMap)

    const { blocks } = groupEventsByLocationBlock(events)
    setLocationBlocks(blocks)
    const nextLocationMap: Record<string, string | null> = {}
    for (const block of blocks) {
      // A block's date span is often an exact or near-exact match for one of
      // our dated location names -- try that before falling back to a bare
      // name match.
      const match =
        locations.find((l) => l.name.startsWith(block.locationName) && l.name !== block.locationName) ??
        locations.find((l) => l.name === block.locationName)
      nextLocationMap[block.key] = blocks.length === 1 ? (match?.id ?? null) : null
    }
    setLocationMap(nextLocationMap)

    const nextCoachMap: Record<string, string | null> = {}
    for (const name of new Set(events.flatMap((e) => e.assignedCoachNames))) {
      const match = coaches.find((c) => c.name === name)
      nextCoachMap[name] = match?.id ?? null
    }
    setCoachMap(nextCoachMap)
    setCoachProgramOverride({})

    return false // prevent antd Upload from actually uploading anywhere
  }

  const { keyForEvent } = useMemo(() => groupEventsByLocationBlock(parsed ?? []), [parsed])

  const allProgramsResolved = distinctProgramNames.every((n) => programMap[n])
  const allLocationsResolved = locationBlocks.every((b) => locationMap[b.key])
  const readyToImport = !!parsed && parsed.length > 0 && allProgramsResolved && allLocationsResolved

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
      let assignmentsCreated = 0
      let assignmentsSkippedUnmatched = 0

      for (const event of parsed) {
        const programId = programMap[event.programName]
        const blockKey = keyForEvent(event.locationName, event.eventDate)
        const locationId = locationMap[blockKey]
        if (!programId || !locationId) {
          eventsSkippedUnresolved += 1
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
            is_cancelled: event.isCancelled,
          })
          .select('id')
          .single()

        if (error || !inserted) continue
        eventsCreated += 1
        existingSignatures.add(signature)

        if (event.assignedCoachNames.length > 0) {
          const assignmentRows = event.assignedCoachNames
            .map((name) => ({ name, coachId: coachMap[name] }))
            .filter((entry): entry is { name: string; coachId: string } => !!entry.coachId)
            .map(({ name, coachId }) => ({
              event_id: inserted.id,
              coach_id: coachId,
              program_id: coachProgramOverride[name] ?? null,
            }))

          assignmentsSkippedUnmatched += event.assignedCoachNames.length - assignmentRows.length

          if (assignmentRows.length > 0) {
            const { error: assignError } = await supabaseClient
              .from('event_assignments')
              .insert(assignmentRows)
            if (!assignError) assignmentsCreated += assignmentRows.length
          }
        }
      }

      setSummary({
        eventsCreated,
        eventsSkippedExisting,
        eventsSkippedUnresolved,
        assignmentsCreated,
        assignmentsSkippedUnmatched,
      })
      message.success('Import complete')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div>
      <Typography.Title level={3}>Import Sprocket Calendar</Typography.Title>
      <Typography.Paragraph type="secondary">
        Upload a Sprocket calendar export (CSV). Camp sessions with multiple staff rows are
        collapsed into one event with their staff assignments recorded; everything else becomes
        one event per row.
      </Typography.Paragraph>

      <Upload.Dragger beforeUpload={handleFile} accept=".csv" showUploadList={false} maxCount={1}>
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p>Click or drag a Sprocket CSV export here</p>
      </Upload.Dragger>

      {parseErrors.length > 0 && (
        <Alert
          style={{ marginTop: 16 }}
          type="warning"
          message={`${parseErrors.length} row(s) had parse issues and were skipped`}
          description={parseErrors.slice(0, 10).join('; ')}
        />
      )}

      {parsed && (
        <>
          <Alert
            style={{ marginTop: 16 }}
            type="info"
            message={`${parsed.length} events found, referencing ${distinctProgramNames.length} program name(s), ${locationBlocks.length} location/date block(s), and ${distinctCoachNames.length} coach name(s).`}
          />

          <Card title="Programs" style={{ marginTop: 16 }} size="small">
            <Table
              dataSource={distinctProgramNames.map((name) => ({ name }))}
              rowKey="name"
              pagination={false}
              size="small"
            >
              <Table.Column dataIndex="name" title="Sprocket name" />
              <Table.Column
                title="Maps to"
                render={(_, record: { name: string }) => (
                  <Select
                    style={{ width: 260 }}
                    placeholder="Select a program"
                    value={programMap[record.name] ?? undefined}
                    options={programs.map((p) => ({ label: p.name, value: p.id }))}
                    onChange={(value) => setProgramMap((prev) => ({ ...prev, [record.name]: value }))}
                    status={programMap[record.name] ? undefined : 'error'}
                  />
                )}
              />
            </Table>
          </Card>

          <Card title="Locations" style={{ marginTop: 16 }} size="small">
            <Table dataSource={locationBlocks} rowKey="key" pagination={false} size="small">
              <Table.Column dataIndex="label" title="Sprocket location + date range" />
              <Table.Column
                title="Maps to"
                render={(_, block: LocationBlock) => (
                  <Select
                    style={{ width: 340 }}
                    placeholder="Select an existing location"
                    value={locationMap[block.key] ?? undefined}
                    options={locations.map((l) => ({ label: l.name, value: l.id }))}
                    onChange={(value) => setLocationMap((prev) => ({ ...prev, [block.key]: value }))}
                    status={locationMap[block.key] ? undefined : 'error'}
                  />
                )}
              />
            </Table>
            <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
              A single Sprocket location can host several unrelated camp weeks, so each contiguous
              date range gets its own row here. Unmatched ones need mapping to an existing
              location, or create the new location first via the Locations admin screen, then come
              back and select it here.
            </Typography.Paragraph>
          </Card>

          <Card title="Coach assignments" style={{ marginTop: 16 }} size="small">
            <Table
              dataSource={distinctCoachNames.map((name) => ({ name }))}
              rowKey="name"
              pagination={false}
              size="small"
            >
              <Table.Column dataIndex="name" title="Sprocket name" />
              <Table.Column
                title="Maps to"
                render={(_, record: { name: string }) => (
                  <Select
                    style={{ width: 240 }}
                    placeholder="Unmatched -- assignment will be skipped"
                    allowClear
                    value={coachMap[record.name] ?? undefined}
                    options={coaches.map((c) => ({ label: c.name, value: c.id }))}
                    onChange={(value) =>
                      setCoachMap((prev) => ({ ...prev, [record.name]: value ?? null }))
                    }
                  />
                )}
              />
              <Table.Column
                title="Program (optional override)"
                render={(_, record: { name: string }) => (
                  <Select
                    style={{ width: 220 }}
                    placeholder="Use event's program"
                    allowClear
                    value={coachProgramOverride[record.name] ?? undefined}
                    options={programs.map((p) => ({ label: p.name, value: p.id }))}
                    onChange={(value) =>
                      setCoachProgramOverride((prev) => ({ ...prev, [record.name]: value ?? null }))
                    }
                  />
                )}
              />
            </Table>
            <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
              An unmatched coach name isn't required to proceed -- that event still gets created,
              just without that particular assignment recorded. The program override applies to
              every assignment for that coach in this import (e.g. mark someone as Nurse rather
              than the session's default Camp/Counselor program) -- leave blank for a plain
              assignment with no specific program noted.
            </Typography.Paragraph>
          </Card>

          <Space style={{ marginTop: 16 }}>
            <Button type="primary" disabled={!readyToImport} loading={importing} onClick={runImport}>
              Confirm import
            </Button>
            {!readyToImport && (
              <Typography.Text type="warning">
                Resolve all programs and locations above before importing.
              </Typography.Text>
            )}
          </Space>
        </>
      )}

      {summary && (
        <Alert
          style={{ marginTop: 16 }}
          type="success"
          message="Import summary"
          description={
            <ul style={{ marginBottom: 0 }}>
              <li>{summary.eventsCreated} events created</li>
              <li>{summary.eventsSkippedExisting} events already existed, skipped</li>
              <li>{summary.eventsSkippedUnresolved} events skipped (unresolved program/location)</li>
              <li>{summary.assignmentsCreated} staff assignments created</li>
              <li>{summary.assignmentsSkippedUnmatched} assignments skipped (unmatched coach)</li>
            </ul>
          }
        />
      )}
    </div>
  )
}

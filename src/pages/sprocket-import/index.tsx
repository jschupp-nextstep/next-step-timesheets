import { useMemo, useState } from 'react'
import { useList } from '@refinedev/core'
import { Alert, App, Button, Card, Select, Space, Table, Typography, Upload } from 'antd'
import { InboxOutlined } from '@ant-design/icons'

import { supabaseClient } from '../../utility/supabaseClient'
import {
  groupEventsByLocationBlock,
  parseSprocketCsv,
  resolveCampDayType,
  type LocationBlock,
  type ParsedEvent,
  type SkippedRow,
} from '../../utility/parseSprocketCsv'

type IdName = { id: string; name: string }
type LocationRow = {
  id: string
  name: string
  category: 'camp_nurse' | 'regular'
  half_day_hours: number | null
  full_day_hours: number | null
}

// Sprocket's program names don't match ours verbatim -- adjust here if
// Sprocket's naming changes. "Camps" is handled separately (see below):
// there's no single "Camp" program, so it resolves per-event to Camp-Half
// Day or Camp-Full Day based on the location's configured hours.
const PROGRAM_NAME_MAP: Record<string, string> = {
  '2025-26 Annual Program': 'Annual Program',
  // Justin, 2026-10-14: DSSC and Dover-Sherborn Academy are Town Sessions.
  'DSSC 2026-2027': 'Town Sessions',
  'Dover-Sherborn Academy 2026-2027': 'Town Sessions',
}

// Sprocket names carry a season ("Town Sessions 2026-2027"); ours don't.
// Compared loosely (case, trailing season, singular/plural).
const looseProgramName = (name: string) =>
  name
    .replace(/\s*\d{4}\s*-\s*\d{2,4}\s*$/, '')
    .replace(/^\d{4}\s*-\s*\d{2,4}\s*/, '')
    .trim()
    .toLowerCase()
    .replace(/s$/, '')

// "Leave unassigned" for a coach name or a team's default coach -- an
// explicit decision, unlike an unanswered mapping (which blocks Confirm).
const LEAVE = '__leave__'
const LEAVE_OPTION = { label: 'Leave unassigned', value: LEAVE }

// A blank Sprocket program name is a real, mappable value (some rows carry no
// program at all) -- never drop it from the review table, just give it a
// readable label so the admin can still map it.
const programNameLabel = (name: string) => name || '(blank on Sprocket)'

// A Sprocket program name or location can be a genuine, real event that
// still shouldn't hit payroll -- e.g. Annual Program's "Video Analysis"
// sessions are valid for players but no coach is paid for them. Mapping to
// this sentinel (instead of a real program/location id) marks that on
// purpose, so the importer skips those events cleanly instead of either
// creating a bogus timesheet-eligible event or flagging it as an error.
const IGNORE = '__ignore__'
const IGNORE_OPTION = { label: "Don't import (valid event, not paid)", value: IGNORE }

// "Decide later": unlike Don't import / Leave unassigned, never remembered,
// so the next upload asks again. Sessions with a location/program left for
// later aren't created (listed as skipped) and come in as new on a later
// upload; a coach/team left for later imports unassigned and is filled in on
// re-upload once decided (sprocket_sync_event adds the coach).
const LATER = '__later__'
const LATER_OPTION = { label: 'Decide later (skip these sessions for now)', value: LATER }
const LATER_COACH_OPTION = { label: 'Decide later (import unassigned for now)', value: LATER }
const realIds = (ids: (string | null | undefined)[]) =>
  ids.filter((id): id is string => !!id && id !== LEAVE && id !== LATER)

// Every mapping decision (program, location, coach) is remembered in
// localStorage and reapplied on the next upload -- without this, every
// re-run of a periodic import would force re-mapping everything from
// scratch, including things already resolved correctly last time.
const STORAGE_KEY = 'sprocket-import-mappings-v1'

type StoredMappings = {
  programs: Record<string, string>
  locations: Record<string, string>
  coaches: Record<string, string>
  // Team name -> default coach ids for rows that name no coach ([] = leave
  // unassigned). Fall export: DSA teams and AP groups (incl. their games).
  teamCoaches: Record<string, string[]>
}

function loadStoredMappings(): StoredMappings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return {
      programs: parsed.programs ?? {},
      locations: parsed.locations ?? {},
      coaches: parsed.coaches ?? {},
      teamCoaches: parsed.teamCoaches ?? {},
    }
  } catch {
    return { programs: {}, locations: {}, coaches: {}, teamCoaches: {} }
  }
}

function saveTeamCoaches(team: string, coachIds: string[] | null) {
  try {
    const stored = loadStoredMappings()
    if (coachIds) stored.teamCoaches[team] = coachIds
    else delete stored.teamCoaches[team]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
  } catch {
    // remembering is a convenience only
  }
}

const teamKey = (event: ParsedEvent) => event.teamName || event.title

function saveStoredMapping(category: 'programs' | 'locations' | 'coaches', key: string, value: string | null) {
  try {
    const stored = loadStoredMappings()
    if (value) {
      stored[category][key] = value
    } else {
      delete stored[category][key]
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
  } catch {
    // remembering is a convenience only
  }
}

// A Regular location always collapses to one block per name (see
// groupEventsByLocationBlock), so its name alone is a stable cache key. A
// Camp location's block is tied to a specific date range -- the same
// location name can mean a different camp week (and a different real
// place/hours) next time, so the date range has to be part of the key too.
const locationCacheKey = (block: LocationBlock) =>
  block.isCampProgram
    ? `camp::${block.locationName}::${block.dates.join(',')}`
    : `regular::${block.locationName}`

type SkippedEvent = {
  eventDate: string
  sessionName: string
  locationName: string
  programName: string
  reason: string
}

type ImportSummary = {
  eventsUpdated: number
  eventsUnchanged: number
  changes: string[]
  conflicts: string[]
  failures: string[]
  eventsCreated: number
  eventsSkippedExisting: number
  eventsSkippedUnresolved: number
  eventsSkippedIgnored: number
  assignmentsCreated: number
  assignmentsSkippedUnmatched: number
  skippedEvents: SkippedEvent[]
  ignoredEvents: SkippedEvent[]
}

export const SprocketImport = () => {
  const { message } = App.useApp()
  const [parsed, setParsed] = useState<ParsedEvent[] | null>(null)
  const [parseErrors, setParseErrors] = useState<string[]>([])
  const [programMap, setProgramMap] = useState<Record<string, string | null>>({})
  const [locationBlocks, setLocationBlocks] = useState<LocationBlock[]>([])
  const [locationMap, setLocationMap] = useState<Record<string, string | null>>({})
  const [coachMap, setCoachMap] = useState<Record<string, string | null>>({})
  const [coachProgramOverride, setCoachProgramOverride] = useState<Record<string, string | null>>({})
  const [teamCoachMap, setTeamCoachMap] = useState<Record<string, string[] | undefined>>({})
  const [skippedRows, setSkippedRows] = useState<SkippedRow[]>([])
  // Sprocket row id -> our event id, for events imported before.
  const [existingBySprocketId, setExistingBySprocketId] = useState<Map<string, string>>(new Map())
  const [matchError, setMatchError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [summary, setSummary] = useState<ImportSummary | null>(null)

  const { result: programsResult } = useList<IdName>({
    resource: 'programs',
    filters: [{ field: 'is_active', operator: 'eq', value: true }],
    pagination: { pageSize: 100 },
  })
  const { result: locationsResult } = useList<LocationRow>({
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

  const campHalfDayProgram = programs.find((p) => p.name === 'Camp-Half Day')
  const campFullDayProgram = programs.find((p) => p.name === 'Camp-Full Day')

  const distinctProgramNames = useMemo(
    () => Array.from(new Set(parsed?.map((e) => e.programName) ?? [])).filter((name) => name !== 'Camps'),
    [parsed],
  )
  const hasCampEvents = useMemo(() => parsed?.some((e) => e.programName === 'Camps') ?? false, [parsed])
  const distinctCoachNames = useMemo(
    () => Array.from(new Set(parsed?.flatMap((e) => e.assignedCoachNames) ?? [])),
    [parsed],
  )
  const teamsNeedingCoach = useMemo(() => {
    const counts = new Map<string, number>()
    for (const e of parsed ?? []) if (e.needsTeamCoach) counts.set(teamKey(e), (counts.get(teamKey(e)) ?? 0) + 1)
    return Array.from(counts, ([team, count]) => ({ team, count })).sort((a, b) => a.team.localeCompare(b.team))
  }, [parsed])
  const matchedCount = useMemo(
    () => (parsed ?? []).filter((e) => e.sprocketIds.some((id) => existingBySprocketId.has(id))).length,
    [parsed, existingBySprocketId],
  )

  const handleFile = async (file: File) => {
    const text = await file.text()
    const { events, errors, skipped } = parseSprocketCsv(text)
    setParsed(events)
    setParseErrors(errors)
    setSkippedRows(skipped)
    setSummary(null)

    // Auto-resolve anything that matches a mapping remembered from a
    // previous import, then anything that matches exactly or via the fixed
    // program name translation; leave everything else for manual mapping
    // below. "Camps" is excluded -- it resolves per-event, not via this map.
    const stored = loadStoredMappings()

    const nextProgramMap: Record<string, string | null> = {}
    for (const name of new Set(events.map((e) => e.programName).filter((n) => n !== 'Camps'))) {
      const cached = stored.programs[name]
      if (cached && (cached === IGNORE || programs.some((p) => p.id === cached))) {
        nextProgramMap[name] = cached
        continue
      }
      const mappedName = PROGRAM_NAME_MAP[name] ?? name
      const match =
        programs.find((p) => p.name === mappedName) ??
        programs.find((p) => looseProgramName(p.name) === looseProgramName(mappedName))
      nextProgramMap[name] = match?.id ?? LATER
    }
    setProgramMap(nextProgramMap)

    const { blocks } = groupEventsByLocationBlock(events)
    setLocationBlocks(blocks)
    const nextLocationMap: Record<string, string | null> = {}
    for (const block of blocks) {
      const cached = stored.locations[locationCacheKey(block)]
      if (cached && (cached === IGNORE || locations.some((l) => l.id === cached))) {
        nextLocationMap[block.key] = cached
        continue
      }
      const candidates = locations.filter((l) =>
        block.isCampProgram ? l.category === 'camp_nurse' : l.category === 'regular',
      )
      // A block's date span is often an exact or near-exact match for one of
      // our dated location names -- try that before falling back to a bare
      // name match.
      const match =
        candidates.find((l) => l.name.startsWith(block.locationName) && l.name !== block.locationName) ??
        candidates.find((l) => l.name === block.locationName)
      nextLocationMap[block.key] = match?.id ?? LATER
    }
    setLocationMap(nextLocationMap)

    const nextCoachMap: Record<string, string | null> = {}
    for (const name of new Set(events.flatMap((e) => e.assignedCoachNames))) {
      const cached = stored.coaches[name]
      if (cached && (cached === LEAVE || coaches.some((c) => c.id === cached))) {
        nextCoachMap[name] = cached
        continue
      }
      // Full name, else a first name only one active coach has ("Keith").
      const lower = name.toLowerCase()
      const exact = coaches.find((c) => c.name.trim().toLowerCase() === lower)
      const byFirst = coaches.filter((c) => c.name.trim().toLowerCase().split(/\s+/)[0] === lower)
      nextCoachMap[name] = exact?.id ?? (byFirst.length === 1 ? byFirst[0].id : LATER)
    }
    setCoachMap(nextCoachMap)
    setCoachProgramOverride({})

    const nextTeamMap: Record<string, string[] | undefined> = {}
    for (const e of events) {
      if (!e.needsTeamCoach) continue
      const cached = stored.teamCoaches[teamKey(e)]
      nextTeamMap[teamKey(e)] =
        cached && cached.every((id) => coaches.some((c) => c.id === id)) ? cached : [LATER]
    }
    setTeamCoachMap(nextTeamMap)

    // Events imported before, matched by Sprocket's own id.
    setMatchError(null)
    const ids = events.flatMap((e) => e.sprocketIds)
    const found = new Map<string, string>()
    for (let i = 0; i < ids.length; i += 150) {
      const { data, error } = await supabaseClient
        .from('events')
        .select('id, sprocket_event_ids')
        .overlaps('sprocket_event_ids', ids.slice(i, i + 150))
      if (error) {
        setMatchError(error.message)
        break
      }
      for (const row of data ?? []) for (const id of row.sprocket_event_ids ?? []) found.set(id, row.id)
    }
    setExistingBySprocketId(found)

    return false // prevent antd Upload from actually uploading anywhere
  }

  const { keyForEvent } = useMemo(() => groupEventsByLocationBlock(parsed ?? []), [parsed])

  // Anything not picked is "Decide later" (Justin, 2026-10-15) -- it never
  // blocks the import; the counts are shown next to the Confirm button.
  const isLater = (v: string | null | undefined) => !v || v === LATER
  const laterCounts = {
    programs: distinctProgramNames.filter((n) => isLater(programMap[n])).length,
    locations: locationBlocks.filter((b) => isLater(locationMap[b.key])).length,
    coaches: distinctCoachNames.filter((n) => isLater(coachMap[n])).length,
    teams: teamsNeedingCoach.filter((t) => !teamCoachMap[t.team] || teamCoachMap[t.team]?.includes(LATER)).length,
  }
  const campProgramsAvailable = !hasCampEvents || (!!campHalfDayProgram && !!campFullDayProgram)
  const readyToImport = !!parsed && parsed.length > 0 && campProgramsAvailable && !matchError

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
      const locationsById = new Map(locations.map((l) => [l.id, l]))

      let eventsUpdated = 0
      let eventsUnchanged = 0
      const changes: string[] = []
      const conflicts: string[] = []
      const failures: string[] = []
      let eventsCreated = 0
      let eventsSkippedExisting = 0
      let eventsSkippedUnresolved = 0
      let eventsSkippedIgnored = 0
      let assignmentsCreated = 0
      let assignmentsSkippedUnmatched = 0
      const skippedEvents: SkippedEvent[] = []
      const ignoredEvents: SkippedEvent[] = []
      const describeEvent = (event: ParsedEvent, reason: string): SkippedEvent => ({
        eventDate: event.eventDate,
        sessionName: event.sessionName,
        locationName: event.locationName || '(blank on Sprocket)',
        programName: programNameLabel(event.programName),
        reason,
      })
      const recordSkip = (event: ParsedEvent, reason: string) => {
        eventsSkippedUnresolved += 1
        skippedEvents.push(describeEvent(event, reason))
      }
      const recordIgnored = (event: ParsedEvent, reason: string) => {
        eventsSkippedIgnored += 1
        ignoredEvents.push(describeEvent(event, reason))
      }

      for (const event of parsed) {
        const blockKey = keyForEvent(event.locationName, event.eventDate)
        const locationId = locationMap[blockKey]
        if (locationId === IGNORE) {
          recordIgnored(event, 'Location marked "don\'t import"')
          continue
        }
        if (locationId === LATER) {
          recordSkip(event, 'Location left for later -- map it and upload again')
          continue
        }
        if (!locationId) {
          recordSkip(event, 'Location left for later -- map it and upload again')
          continue
        }

        let programId: string | null
        if (event.programName === 'Camps') {
          const location = locationsById.get(locationId)
          const dayType = location
            ? resolveCampDayType(event.startTime, event.endTime, location)
            : null
          programId =
            dayType === 'half'
              ? (campHalfDayProgram?.id ?? null)
              : dayType === 'full'
                ? (campFullDayProgram?.id ?? null)
                : null
        } else {
          programId = programMap[event.programName]
        }

        if (programId === IGNORE) {
          recordIgnored(event, 'Program marked "don\'t import"')
          continue
        }
        if (programId === LATER) {
          recordSkip(event, 'Program left for later -- map it and upload again')
          continue
        }
        if (!programId) {
          recordSkip(
            event,
            event.programName === 'Camps'
              ? "Couldn't determine Camp-Half Day vs Camp-Full Day (check the mapped location's half/full day hours)"
              : 'Program left for later -- map it and upload again',
          )
          continue
        }

        const namedCoachIds = realIds(event.assignedCoachNames.map((name) => coachMap[name]))
        const coachIds = Array.from(
          new Set(event.needsTeamCoach ? realIds(teamCoachMap[teamKey(event)] ?? []) : namedCoachIds),
        ).sort()
        const snapshot = {
          event_date: event.eventDate,
          start_time: event.startTime,
          end_time: event.endTime,
          is_cancelled: event.isCancelled,
          coach_ids: coachIds,
        }

        const existingId = event.sprocketIds.map((id) => existingBySprocketId.get(id)).find(Boolean)
        if (existingId) {
          const { data: result, error: syncError } = await supabaseClient.rpc('sprocket_sync_event', {
            p_event_id: existingId,
            p_snapshot: snapshot,
            p_rows: event.rows,
            p_ids: event.sprocketIds,
          })
          if (syncError) {
            failures.push(`${event.eventDate} ${event.sessionName}: ${syncError.message}`)
            continue
          }
          const r = result as { changes: string[]; conflicts: string[] }
          changes.push(...r.changes)
          conflicts.push(...r.conflicts)
          if (r.changes.length > 0) eventsUpdated += 1
          else eventsUnchanged += 1
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
            paid_early_minutes: event.paidEarlyMinutes,
            sprocket_event_ids: event.sprocketIds,
            sprocket_rows: event.rows,
            sprocket_snapshot: snapshot,
          })
          .select('id')
          .single()

        if (error || !inserted) {
          failures.push(`${event.eventDate} ${event.sessionName}: ${error?.message ?? 'not created'}`)
          continue
        }
        eventsCreated += 1
        existingSignatures.add(signature)

        if (coachIds.length > 0) {
          const nameFor = (id: string) => event.assignedCoachNames.find((n) => coachMap[n] === id)
          const assignmentRows = coachIds.map((coachId) => {
            const name = nameFor(coachId)
            return {
              event_id: inserted.id,
              coach_id: coachId,
              program_id: (name && coachProgramOverride[name]) || null,
              // Re-import policy: Sprocket may replace only its own rows.
              source: 'sprocket',
            }
          })

          assignmentsSkippedUnmatched += event.needsTeamCoach ? 0 : event.assignedCoachNames.length - namedCoachIds.length

          if (assignmentRows.length > 0) {
            const { error: assignError } = await supabaseClient
              .from('event_assignments')
              .insert(assignmentRows)
            if (!assignError) assignmentsCreated += assignmentRows.length
          }
        }
      }

      setSummary({
        eventsUpdated,
        eventsUnchanged,
        changes,
        conflicts,
        failures,
        eventsCreated,
        eventsSkippedExisting,
        eventsSkippedUnresolved,
        eventsSkippedIgnored,
        assignmentsCreated,
        assignmentsSkippedUnmatched,
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
      <Typography.Title level={3}>Import Sprocket Calendar</Typography.Title>
      <Typography.Paragraph type="secondary">
        Upload a Sprocket calendar export (CSV). Camp sessions with multiple staff rows are
        collapsed into one event with their staff assignments recorded; everything else becomes
        one event per row, with coaches read from Notes or a "Title — Coach" suffix. Re-uploading
        a later export updates the sessions it already created (matched by Sprocket's event ID)
        instead of duplicating them.
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
            message={`${parsed.length} events found, referencing ${distinctProgramNames.length + (hasCampEvents ? 1 : 0)} program name(s), ${locationBlocks.length} location/date block(s), and ${distinctCoachNames.length} coach name(s).`}
            description={
              matchedCount > 0
                ? `${matchedCount} of them were imported before (matched by Sprocket's event ID) and will only change where Sprocket changed something since; ${parsed.length - matchedCount} are new.`
                : `None of these were imported before -- all ${parsed.length} are new.`
            }
          />
          {matchError && (
            <Alert
              style={{ marginTop: 16 }}
              type="error"
              message="Couldn't check for sessions imported before"
              description={`${matchError} -- has migration 0030 been run?`}
            />
          )}
          {skippedRows.length > 0 && (
            <Card title={`Not imported (${skippedRows.length})`} style={{ marginTop: 16 }} size="small">
              <Table dataSource={skippedRows} rowKey={(r, i) => `${r.eventDate}-${r.title}-${i}`} pagination={{ pageSize: 10 }} size="small">
                <Table.Column dataIndex="eventDate" title="Date" />
                <Table.Column dataIndex="title" title="Sprocket title" />
                <Table.Column dataIndex="type" title="Type" />
                <Table.Column dataIndex="reason" title="Why" />
              </Table>
            </Card>
          )}

          {hasCampEvents && !campProgramsAvailable && (
            <Alert
              style={{ marginTop: 16 }}
              type="error"
              message="Camp-Half Day and/or Camp-Full Day programs are missing or inactive"
              description="Camp sessions need both of these to exist and be active, since each one resolves to whichever matches the location's configured hours."
            />
          )}

          <Card title="Programs" style={{ marginTop: 16 }} size="small">
            {hasCampEvents && (
              <Alert
                style={{ marginBottom: 12 }}
                type="info"
                showIcon
                message="Camp sessions map automatically"
                description="Each Camp event resolves to Camp-Half Day or Camp-Full Day based on how its time span compares to the matched location's configured hours -- no manual mapping needed here."
              />
            )}
            <Table
              dataSource={distinctProgramNames.map((name) => ({ name }))}
              rowKey="name"
              pagination={false}
              size="small"
            >
              <Table.Column dataIndex="name" title="Sprocket name" render={(name: string) => programNameLabel(name)} />
              <Table.Column
                title="Maps to"
                render={(_, record: { name: string }) => (
                  <Select
                    style={{ width: 260 }}
                    placeholder="Select a program"
                    value={programMap[record.name] ?? undefined}
                    options={[...programs.map((p) => ({ label: p.name, value: p.id })), IGNORE_OPTION, LATER_OPTION]}
                    onChange={(value) => {
                      setProgramMap((prev) => ({ ...prev, [record.name]: value }))
                      saveStoredMapping('programs', record.name, value === LATER ? null : (value ?? null))
                    }}
                    status={isLater(programMap[record.name]) ? 'warning' : undefined}
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
                render={(_, block: LocationBlock) => {
                  const candidates = locations.filter((l) =>
                    block.isCampProgram ? l.category === 'camp_nurse' : l.category === 'regular',
                  )
                  return (
                    <Select
                      style={{ width: 340 }}
                      placeholder={
                        block.isCampProgram ? 'Select a Camp/Nurse location' : 'Select a Regular location'
                      }
                      value={locationMap[block.key] ?? undefined}
                      options={[...candidates.map((l) => ({ label: l.name, value: l.id })), IGNORE_OPTION, LATER_OPTION]}
                      onChange={(value) => {
                        setLocationMap((prev) => ({ ...prev, [block.key]: value }))
                        saveStoredMapping('locations', locationCacheKey(block), value === LATER ? null : (value ?? null))
                      }}
                      status={isLater(locationMap[block.key]) ? 'warning' : undefined}
                    />
                  )
                }}
              />
            </Table>
            <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
              A single Sprocket location can host several unrelated camp weeks, so each contiguous
              date range gets its own row here. Each one only offers locations matching its
              program's category (Camp/Nurse sessions only see Camp/Nurse locations; everything
              else only sees Regular locations). Unmatched ones need mapping to an existing
              location, or create the new location first via the Locations admin screen, then come
              back and select it here. If a block is a real event that just isn't paid work (e.g.
              a remote Video Analysis session), map it to "Don't import" instead.
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
                    placeholder="Pick a coach or Leave unassigned"
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    status={isLater(coachMap[record.name]) ? 'warning' : undefined}
                    value={coachMap[record.name] ?? undefined}
                    options={[...coaches.map((c) => ({ label: c.name, value: c.id })), LEAVE_OPTION, LATER_COACH_OPTION]}
                    onChange={(value) => {
                      setCoachMap((prev) => ({ ...prev, [record.name]: value ?? null }))
                      saveStoredMapping('coaches', record.name, value === LATER ? null : (value ?? null))
                    }}
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
              Names come from Camp staff rows, Notes ("Max + Taron"), and title suffixes ("Goalie Clinic —
              Jack"). A first name matches automatically when only one active coach has it; decide the rest
              (a coach, or Leave unassigned) before importing. The program override applies to
              every assignment for that coach in this import (e.g. mark someone as Nurse rather
              than the session's default Camp/Counselor program) -- leave blank for a plain
              assignment with no specific program noted.
            </Typography.Paragraph>
          </Card>

          {teamsNeedingCoach.length > 0 && (
            <Card title="Team coaches (sessions with no coach named)" style={{ marginTop: 16 }} size="small">
              <Typography.Paragraph type="secondary">
                These sessions (including games) name no coach in Sprocket. Pick who coaches each team --
                they're assigned to every such session for that team, and remembered for next time. A sub
                for one game is done afterwards with Sub on the session's page.
              </Typography.Paragraph>
              <Table dataSource={teamsNeedingCoach} rowKey="team" pagination={false} size="small">
                <Table.Column dataIndex="team" title="Sprocket team" />
                <Table.Column dataIndex="count" title="Sessions" />
                <Table.Column
                  title="Coach(es)"
                  render={(_, record: { team: string }) => {
                    const value = teamCoachMap[record.team]
                    return (
                      <Select
                        mode="multiple"
                        style={{ width: 320 }}
                        placeholder="Pick coach(es) or Leave unassigned"
                        showSearch
                        optionFilterProp="label"
                        status={!value || value.includes(LATER) ? 'warning' : undefined}
                        value={value === undefined ? [] : value.length === 0 ? [LEAVE] : value}
                        options={[...coaches.map((c) => ({ label: c.name, value: c.id })), LEAVE_OPTION, LATER_COACH_OPTION]}
                        onChange={(values: string[]) => {
                          const last = values[values.length - 1]
                          const next =
                            values.length === 0
                              ? undefined
                              : last === LEAVE
                                ? []
                                : last === LATER
                                  ? [LATER]
                                  : values.filter((v) => v !== LEAVE && v !== LATER)
                          setTeamCoachMap((prev) => ({ ...prev, [record.team]: next }))
                          saveTeamCoaches(record.team, next && !next.includes(LATER) ? next : null)
                        }}
                      />
                    )
                  }}
                />
              </Table>
            </Card>
          )}

          <Space style={{ marginTop: 16 }}>
            <Button type="primary" disabled={!readyToImport} loading={importing} onClick={runImport}>
              Confirm import
            </Button>
            {(() => {
              const parts = [
                laterCounts.locations && `${laterCounts.locations} location(s)`,
                laterCounts.programs && `${laterCounts.programs} program(s)`,
                laterCounts.coaches && `${laterCounts.coaches} coach name(s)`,
                laterCounts.teams && `${laterCounts.teams} team coach(es)`,
              ].filter(Boolean)
              return parts.length > 0 ? (
                <Typography.Text type="warning">
                  Left for later: {parts.join(', ')}. Sessions at those locations/programs are skipped this
                  time; coaches left for later import unassigned.
                </Typography.Text>
              ) : null
            })()}
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
                <li>{summary.eventsUpdated} previously imported events updated from Sprocket</li>
                <li>{summary.eventsUnchanged} previously imported events unchanged</li>
                <li>{summary.eventsSkippedExisting} events already existed, skipped</li>
                <li>{summary.eventsSkippedUnresolved} events skipped (unresolved program/location)</li>
                <li>{summary.eventsSkippedIgnored} events intentionally not imported (marked "don't import")</li>
                <li>{summary.assignmentsCreated} staff assignments created</li>
                <li>{summary.assignmentsSkippedUnmatched} assignments skipped (unmatched coach)</li>
              </ul>
            }
          />

          {summary.failures.length > 0 && (
            <Alert
              style={{ marginTop: 16 }}
              type="error"
              message={`${summary.failures.length} event(s) failed`}
              description={<ul style={{ marginBottom: 0 }}>{summary.failures.map((f, i) => <li key={i}>{f}</li>)}</ul>}
            />
          )}
          {summary.conflicts.length > 0 && (
            <Alert
              style={{ marginTop: 16 }}
              type="warning"
              message="Changed both in Sprocket and here -- kept this app's version"
              description={<ul style={{ marginBottom: 0 }}>{summary.conflicts.map((c, i) => <li key={i}>{c}</li>)}</ul>}
            />
          )}
          {summary.changes.length > 0 && (
            <Card title="Updated from Sprocket (logged in each session's history)" style={{ marginTop: 16 }} size="small">
              <ul style={{ marginBottom: 0 }}>{summary.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>
            </Card>
          )}

          {summary.skippedEvents.length > 0 && (
            <Card title="Skipped events" style={{ marginTop: 16 }} size="small">
              <Typography.Paragraph type="secondary">
                These events weren't created. Fix the mapping (or add a matching location/program)
                and re-run the import -- already-created events won't be duplicated.
              </Typography.Paragraph>
              <Table
                dataSource={summary.skippedEvents}
                rowKey={(row, index) => `${row.eventDate}-${row.sessionName}-${index}`}
                pagination={false}
                size="small"
              >
                <Table.Column dataIndex="eventDate" title="Date" />
                <Table.Column dataIndex="sessionName" title="Session" />
                <Table.Column dataIndex="programName" title="Sprocket program" />
                <Table.Column dataIndex="locationName" title="Sprocket location" />
                <Table.Column dataIndex="reason" title="Reason" />
              </Table>
            </Card>
          )}

          {summary.ignoredEvents.length > 0 && (
            <Card title="Intentionally not imported" style={{ marginTop: 16 }} size="small">
              <Typography.Paragraph type="secondary">
                These are real events, but their program or location is marked "don't import" --
                nothing to fix here.
              </Typography.Paragraph>
              <Table
                dataSource={summary.ignoredEvents}
                rowKey={(row, index) => `${row.eventDate}-${row.sessionName}-${index}`}
                pagination={false}
                size="small"
              >
                <Table.Column dataIndex="eventDate" title="Date" />
                <Table.Column dataIndex="sessionName" title="Session" />
                <Table.Column dataIndex="programName" title="Sprocket program" />
                <Table.Column dataIndex="locationName" title="Sprocket location" />
                <Table.Column dataIndex="reason" title="Reason" />
              </Table>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

import { useMemo, useState } from 'react'
import { useGetIdentity, useList } from '@refinedev/core'
import { Alert, App, Button, Card, DatePicker, Form, Input, Select, Space, TimePicker, Typography } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'

import { supabaseClient } from '../../utility/supabaseClient'
import type { Identity } from '../../providers/authProvider'

type ProgramRow = { id: string; name: string; entry_mode: string }
type LocationRow = { id: string; name: string; half_day_hours: number | null; full_day_hours: number | null }
type EventRow = {
  id: string
  program_id: string
  location_id: string
  event_date: string
  start_time: string | null
  end_time: string | null
  session_name: string | null
}

// Camp/Nurse programs pay a fixed number of hours looked up from the
// event's location -- never calculated from a time span, and locked from
// manual entry (mirrors the old system's Sheets data-validation rule).
const FIXED_HOURS_HALF = new Set(['Camp-Half Day', 'Nurse-Half Day'])
const FIXED_HOURS_FULL = new Set(['Camp-Full Day', 'Nurse-Full Day'])

const OTHER = '__other__'

// 1v1 / Private Training pay is a flat fee looked up by coach (not
// calculated from these hours) -- but the session length still needs
// tracking, both for the coach's own record and because a future payroll
// pass may end up keying the flat fee off which length was worked.
const DIRECT_FLAT_DURATIONS = [
  { label: '60 minutes', value: 60 },
  { label: '90 minutes', value: 90 },
  { label: '120 minutes', value: 120 },
]

function timeSpanHours(start: string | null, end: string | null): number | null {
  if (!start || !end) return null
  const startTime = dayjs(`2000-01-01T${start}`)
  const endTime = dayjs(`2000-01-01T${end}`)
  if (!startTime.isValid() || !endTime.isValid()) return null
  const hours = endTime.diff(startTime, 'minute') / 60
  return hours > 0 ? hours : null
}

function resolveEventHours(programName: string, event: EventRow, location: LocationRow | undefined): number | null {
  if (FIXED_HOURS_HALF.has(programName)) return location?.half_day_hours ?? null
  if (FIXED_HOURS_FULL.has(programName)) return location?.full_day_hours ?? null
  return timeSpanHours(event.start_time, event.end_time)
}

export const LogSession = () => {
  const { message } = App.useApp()
  const { data: identity } = useGetIdentity<Identity>()
  const coachId = identity?.role === 'coach' ? identity.coachId : undefined

  const [entryDate, setEntryDate] = useState<Dayjs>(dayjs())
  const [programId, setProgramId] = useState<string | null>(null)
  const [locationId, setLocationId] = useState<string | null>(null)
  const [eventId, setEventId] = useState<string | null>(null)
  const [otherSessionName, setOtherSessionName] = useState('')
  const [otherStart, setOtherStart] = useState<Dayjs | null>(null)
  const [otherEnd, setOtherEnd] = useState<Dayjs | null>(null)
  const [directStart, setDirectStart] = useState<Dayjs | null>(null)
  const [directEnd, setDirectEnd] = useState<Dayjs | null>(null)
  const [directFlatMinutes, setDirectFlatMinutes] = useState<number | null>(null)
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const { result: programsResult } = useList<ProgramRow>({
    resource: 'programs',
    filters: [
      { field: 'is_active', operator: 'eq', value: true },
      { field: 'entry_mode', operator: 'in', value: ['session', 'direct_time', 'direct_flat'] },
    ],
    sorters: [{ field: 'name', order: 'asc' }],
    pagination: { pageSize: 100 },
  })
  const { result: locationsResult } = useList<LocationRow>({
    resource: 'locations',
    filters: [{ field: 'is_active', operator: 'eq', value: true }],
    pagination: { pageSize: 200 },
  })

  const programs = programsResult?.data ?? []
  const locations = locationsResult?.data ?? []
  const locationsById = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations])

  const selectedProgram = programs.find((p) => p.id === programId)
  const isSessionMode = selectedProgram?.entry_mode === 'session'
  const isDirectTime = selectedProgram?.entry_mode === 'direct_time'
  const isDirectFlat = selectedProgram?.entry_mode === 'direct_flat'

  const { result: eventsResult } = useList<EventRow>({
    resource: 'events',
    filters: [
      { field: 'event_date', operator: 'eq', value: entryDate.format('YYYY-MM-DD') },
      { field: 'program_id', operator: 'eq', value: programId },
      { field: 'is_cancelled', operator: 'eq', value: false },
    ],
    pagination: { pageSize: 200 },
    queryOptions: { enabled: isSessionMode && !!programId },
  })
  const events = eventsResult?.data ?? []

  const locationOptions = useMemo(() => {
    const distinctIds = Array.from(new Set(events.map((e) => e.location_id)))
    return distinctIds
      .map((id) => locationsById.get(id))
      .filter((l): l is LocationRow => !!l)
      .map((l) => ({ label: l.name, value: l.id }))
  }, [events, locationsById])

  const eventOptions = useMemo(
    () =>
      events
        .filter((e) => e.location_id === locationId)
        .map((e) => ({
          label: `${e.session_name || 'Untitled session'}${e.start_time ? ` (${dayjs(`2000-01-01T${e.start_time}`).format('h:mm A')}${e.end_time ? ` – ${dayjs(`2000-01-01T${e.end_time}`).format('h:mm A')}` : ''})` : ''}`,
          value: e.id,
        })),
    [events, locationId],
  )

  const selectedEvent = events.find((e) => e.id === eventId)
  const selectedLocation = locationId ? locationsById.get(locationId) : undefined
  const resolvedHours =
    selectedProgram && selectedEvent ? resolveEventHours(selectedProgram.name, selectedEvent, selectedLocation) : null
  const otherHours = timeSpanHours(
    otherStart?.format('HH:mm:ss') ?? null,
    otherEnd?.format('HH:mm:ss') ?? null,
  )
  const directHours = timeSpanHours(
    directStart?.format('HH:mm:ss') ?? null,
    directEnd?.format('HH:mm:ss') ?? null,
  )
  const directFlatHours = directFlatMinutes != null ? directFlatMinutes / 60 : null

  const resetForm = () => {
    setProgramId(null)
    setLocationId(null)
    setEventId(null)
    setOtherSessionName('')
    setOtherStart(null)
    setOtherEnd(null)
    setDirectStart(null)
    setDirectEnd(null)
    setDirectFlatMinutes(null)
    setNotes('')
  }

  const canSubmit = (() => {
    if (!coachId || !programId) return false
    if (isDirectFlat) return !!notes.trim() && directFlatMinutes != null
    if (isDirectTime) return !!directStart && !!directEnd && directHours != null
    if (isSessionMode) {
      if (locationId === OTHER) return !!otherSessionName.trim() && !!otherStart && !!otherEnd && otherHours != null
      return !!locationId && !!eventId && resolvedHours != null
    }
    return false
  })()

  const handleSubmit = async () => {
    if (!coachId || !programId || !selectedProgram) return
    setSubmitting(true)
    try {
      let payload: Record<string, unknown>
      if (isDirectFlat) {
        payload = {
          coach_id: coachId,
          program_id: programId,
          entry_date: entryDate.format('YYYY-MM-DD'),
          hours: directFlatHours,
          session_name: directFlatMinutes != null ? `${directFlatMinutes} minute session` : null,
          notes: notes || null,
          status: 'pending',
        }
      } else if (isDirectTime) {
        payload = {
          coach_id: coachId,
          program_id: programId,
          entry_date: entryDate.format('YYYY-MM-DD'),
          start_time: directStart?.format('HH:mm:ss'),
          end_time: directEnd?.format('HH:mm:ss'),
          hours: directHours,
          session_name: selectedProgram.name,
          notes: notes || null,
          status: 'pending',
        }
      } else if (locationId === OTHER) {
        payload = {
          coach_id: coachId,
          program_id: programId,
          event_id: null,
          location_id: null,
          entry_date: entryDate.format('YYYY-MM-DD'),
          start_time: otherStart?.format('HH:mm:ss'),
          end_time: otherEnd?.format('HH:mm:ss'),
          hours: otherHours,
          session_name: otherSessionName.trim(),
          notes: notes || null,
          status: 'pending',
        }
      } else {
        payload = {
          coach_id: coachId,
          program_id: programId,
          event_id: eventId,
          location_id: locationId,
          entry_date: entryDate.format('YYYY-MM-DD'),
          start_time: selectedEvent?.start_time ?? null,
          end_time: selectedEvent?.end_time ?? null,
          hours: resolvedHours,
          session_name: selectedEvent?.session_name ?? null,
          notes: notes || null,
          status: 'pending',
        }
      }

      const { error } = await supabaseClient.from('timesheet_entries').insert(payload)
      if (error) {
        message.error(`Couldn't save: ${error.message}`)
        return
      }
      message.success('Session logged')
      resetForm()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <Typography.Title level={3}>Log a Session</Typography.Title>

      <Card>
        <Form layout="vertical">
          <Form.Item label="Date" required>
            <DatePicker
              style={{ width: '100%' }}
              value={entryDate}
              disabledDate={(d) => d.isAfter(dayjs(), 'day')}
              onChange={(value) => {
                setEntryDate(value ?? dayjs())
                setProgramId(null)
                setLocationId(null)
                setEventId(null)
              }}
              allowClear={false}
            />
          </Form.Item>

          <Form.Item label="Program" required>
            <Select
              placeholder="Select a program"
              value={programId ?? undefined}
              options={programs.map((p) => ({ label: p.name, value: p.id }))}
              onChange={(value) => {
                setProgramId(value)
                setLocationId(null)
                setEventId(null)
              }}
            />
          </Form.Item>

          {isSessionMode && (
            <>
              <Form.Item label="Location" required>
                <Select
                  placeholder={
                    locationOptions.length > 0 ? 'Select a location' : 'No scheduled sessions for this date/program'
                  }
                  value={locationId ?? undefined}
                  options={[...locationOptions, { label: "Other (not on the calendar)", value: OTHER }]}
                  onChange={(value) => {
                    setLocationId(value)
                    setEventId(null)
                  }}
                />
              </Form.Item>

              {locationId && locationId !== OTHER && (
                <Form.Item label="Session / Team" required>
                  <Select
                    placeholder="Select a session"
                    value={eventId ?? undefined}
                    options={eventOptions}
                    onChange={(value) => setEventId(value)}
                  />
                </Form.Item>
              )}

              {locationId && locationId !== OTHER && eventId && (
                <Form.Item label="Hours">
                  <Input
                    readOnly
                    value={resolvedHours != null ? `${resolvedHours.toFixed(2)} hrs` : 'Unable to calculate'}
                  />
                  {resolvedHours == null && (
                    <Alert
                      style={{ marginTop: 8 }}
                      type="warning"
                      showIcon
                      message="This location is missing hour data -- contact an admin before submitting."
                    />
                  )}
                </Form.Item>
              )}

              {locationId === OTHER && (
                <>
                  <Form.Item label="Session name" required>
                    <Input
                      placeholder="What was this session?"
                      value={otherSessionName}
                      onChange={(e) => setOtherSessionName(e.target.value)}
                    />
                  </Form.Item>
                  <Form.Item label="Start time" required>
                    <TimePicker
                      style={{ width: '100%' }}
                      format="h:mm A"
                      minuteStep={5}
                      value={otherStart}
                      onChange={setOtherStart}
                    />
                  </Form.Item>
                  <Form.Item label="End time" required>
                    <TimePicker
                      style={{ width: '100%' }}
                      format="h:mm A"
                      minuteStep={5}
                      value={otherEnd}
                      onChange={setOtherEnd}
                    />
                  </Form.Item>
                  {otherStart && otherEnd && (
                    <Form.Item label="Hours">
                      <Input readOnly value={otherHours != null ? `${otherHours.toFixed(2)} hrs` : 'Invalid range'} />
                    </Form.Item>
                  )}
                </>
              )}
            </>
          )}

          {isDirectTime && (
            <>
              <Form.Item label="Start time" required>
                <TimePicker
                  style={{ width: '100%' }}
                  format="h:mm A"
                  minuteStep={5}
                  value={directStart}
                  onChange={setDirectStart}
                />
              </Form.Item>
              <Form.Item label="End time" required>
                <TimePicker
                  style={{ width: '100%' }}
                  format="h:mm A"
                  minuteStep={5}
                  value={directEnd}
                  onChange={setDirectEnd}
                />
              </Form.Item>
              {directStart && directEnd && (
                <Form.Item label="Hours">
                  <Input readOnly value={directHours != null ? `${directHours.toFixed(2)} hrs` : 'Invalid range'} />
                </Form.Item>
              )}
            </>
          )}

          {isDirectFlat && (
            <>
              <Form.Item label="Session length" required>
                <Select
                  placeholder="Select session length"
                  value={directFlatMinutes ?? undefined}
                  options={DIRECT_FLAT_DURATIONS}
                  onChange={(value) => setDirectFlatMinutes(value)}
                />
              </Form.Item>
              {directFlatMinutes != null && (
                <Form.Item label="Hours">
                  <Input readOnly value={`${directFlatHours!.toFixed(2)} hrs`} />
                </Form.Item>
              )}
            </>
          )}

          {programId && (
            <Form.Item label="Notes" required={isDirectFlat}>
              <Input.TextArea
                rows={3}
                placeholder={isDirectFlat ? 'Who was this session for?' : 'Optional'}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Form.Item>
          )}

          <Space>
            <Button type="primary" disabled={!canSubmit} loading={submitting} onClick={handleSubmit}>
              Submit
            </Button>
          </Space>
        </Form>
      </Card>
    </div>
  )
}

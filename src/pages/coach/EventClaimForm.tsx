import { useMemo, useState } from 'react'
import { useList } from '@refinedev/core'
import { Alert, App, Button, DatePicker, Form, Input, Select, Space } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'

import { supabaseClient } from '../../utility/supabaseClient'

type ProgramRow = { id: string; name: string }
type LocationRow = { id: string; name: string }
type EventRow = {
  id: string
  location_id: string
  event_date: string
  start_time: string | null
  end_time: string | null
  session_name: string | null
}

type EventClaimFormProps = {
  coachId: string
  claimType: 'late_event' | 'unassigned_claim'
  minDate: string
  maxDate: string
  initialDate?: string
  description: string
  submitLabel: string
  onSubmitted?: () => void
}

// Shared by Band B's "late request" flow (log-session.tsx) and the "Don't
// see something you coached?" page (unassigned-claim.tsx) -- both are the
// same shape: an event picker unfiltered by the coach's own assignments,
// constrained to a date window, that always submits into payment_claims for
// review rather than straight into timesheet_entries.
export const EventClaimForm = ({
  coachId,
  claimType,
  minDate,
  maxDate,
  initialDate,
  description,
  submitLabel,
  onSubmitted,
}: EventClaimFormProps) => {
  const { message } = App.useApp()
  const clampedInitial = initialDate && initialDate >= minDate && initialDate <= maxDate ? initialDate : maxDate
  const [date, setDate] = useState<Dayjs>(dayjs(clampedInitial))
  const [programId, setProgramId] = useState<string | null>(null)
  const [locationId, setLocationId] = useState<string | null>(null)
  const [eventId, setEventId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const { result: programsResult } = useList<ProgramRow>({
    resource: 'programs',
    filters: [
      { field: 'is_active', operator: 'eq', value: true },
      { field: 'entry_mode', operator: 'eq', value: 'session' },
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

  const { result: eventsResult } = useList<EventRow>({
    resource: 'events',
    filters: [
      { field: 'event_date', operator: 'eq', value: date.format('YYYY-MM-DD') },
      { field: 'program_id', operator: 'eq', value: programId },
      { field: 'is_cancelled', operator: 'eq', value: false },
    ],
    pagination: { pageSize: 200 },
    queryOptions: { enabled: !!programId },
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

  const canSubmit = !!programId && !!locationId && !!eventId && !!reason.trim()

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const { error } = await supabaseClient.from('payment_claims').insert({
        coach_id: coachId,
        claim_type: claimType,
        event_id: eventId,
        program_id: programId,
        location_id: locationId,
        reason: reason.trim(),
        status: 'pending',
      })
      if (error) {
        message.error(
          error.code === '23505'
            ? "You already have a pending claim for this event."
            : `Couldn't submit: ${error.message}`,
        )
        return
      }
      message.success('Sent to an admin for review.')
      setProgramId(null)
      setLocationId(null)
      setEventId(null)
      setReason('')
      onSubmitted?.()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Form layout="vertical">
      <Alert style={{ marginBottom: 16 }} type="info" showIcon message={description} />

      <Form.Item label="Date" required>
        <DatePicker
          style={{ width: '100%' }}
          value={date}
          disabledDate={(d) => d.format('YYYY-MM-DD') < minDate || d.format('YYYY-MM-DD') > maxDate}
          onChange={(value) => {
            setDate(value ?? dayjs(clampedInitial))
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

      {programId && (
        <Form.Item label="Location" required>
          <Select
            placeholder={locationOptions.length > 0 ? 'Select a location' : 'No scheduled sessions for this date/program'}
            value={locationId ?? undefined}
            options={locationOptions}
            onChange={(value) => {
              setLocationId(value)
              setEventId(null)
            }}
          />
        </Form.Item>
      )}

      {locationId && (
        <Form.Item label="Session / Team" required>
          <Select
            placeholder="Select a session"
            value={eventId ?? undefined}
            options={eventOptions}
            onChange={(value) => setEventId(value)}
          />
        </Form.Item>
      )}

      <Form.Item label="Reason" required>
        <Input.TextArea
          rows={3}
          placeholder="Why are you submitting this now, rather than through the normal picker?"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Form.Item>

      <Space>
        <Button type="primary" disabled={!canSubmit} loading={submitting} onClick={handleSubmit}>
          {submitLabel}
        </Button>
      </Space>
    </Form>
  )
}

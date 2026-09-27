import { useState } from 'react'
import { useList } from '@refinedev/core'
import { Alert, App, Button, Form, Input, Select, Space } from 'antd'
import type { Dayjs } from 'dayjs'

import { supabaseClient } from '../../utility/supabaseClient'

type LocationRow = { id: string; name: string }

const REASON_OPTIONS = [
  { label: "Session wasn't in the system", value: "Session wasn't in the system" },
  { label: 'Assigned to someone else in error', value: 'Assigned to someone else in error' },
  { label: 'Forgot to log at the time', value: 'Forgot to log at the time' },
  { label: 'Other', value: 'Other' },
]

type BandCUnstructuredClaimFormProps = {
  coachId: string
  programId: string
  date: Dayjs
  onSubmitted?: () => void
}

// Older than the 4th-most-recent pay period -- there's no calendar event to
// pick from at all in this window, so this is a fully structured, always-
// reviewed claim rather than an event picker of any kind. Program and date
// are already chosen by the parent form (log-session.tsx) before this
// branch renders; only Location and the reason are asked for here.
export const BandCUnstructuredClaimForm = ({ coachId, programId, date, onSubmitted }: BandCUnstructuredClaimFormProps) => {
  const { message } = App.useApp()
  const [locationId, setLocationId] = useState<string | null>(null)
  const [reasonCategory, setReasonCategory] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const { result: locationsResult } = useList<LocationRow>({
    resource: 'locations',
    filters: [{ field: 'is_active', operator: 'eq', value: true }],
    pagination: { pageSize: 200 },
  })
  const locations = locationsResult?.data ?? []

  const requiresNotes = reasonCategory === 'Other'
  const canSubmit = !!locationId && !!reasonCategory && (!requiresNotes || !!notes.trim())

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const { error } = await supabaseClient.from('payment_claims').insert({
        coach_id: coachId,
        claim_type: 'unstructured',
        event_id: null,
        program_id: programId,
        location_id: locationId,
        approx_date: date.format('YYYY-MM-DD'),
        reason: reasonCategory,
        notes: notes.trim() || null,
        status: 'pending',
      })
      if (error) {
        message.error(`Couldn't submit: ${error.message}`)
        return
      }
      message.success('Sent to an admin for review.')
      setLocationId(null)
      setReasonCategory(null)
      setNotes('')
      onSubmitted?.()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Alert
        style={{ marginBottom: 16 }}
        type="info"
        showIcon
        message="This date is too far back to verify against the calendar directly. Describe the session below and an admin will review it."
      />

      <Form.Item label="Location" required>
        <Select
          placeholder="Select a location"
          value={locationId ?? undefined}
          options={locations.map((l) => ({ label: l.name, value: l.id }))}
          onChange={setLocationId}
        />
      </Form.Item>

      <Form.Item label="Reason" required>
        <Select placeholder="What happened?" value={reasonCategory ?? undefined} options={REASON_OPTIONS} onChange={setReasonCategory} />
      </Form.Item>

      <Form.Item label="Notes" required={requiresNotes}>
        <Input.TextArea
          rows={3}
          placeholder={requiresNotes ? 'Please describe what happened' : 'Optional additional detail'}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Form.Item>

      <Space>
        <Button type="primary" disabled={!canSubmit} loading={submitting} onClick={handleSubmit}>
          Submit for review
        </Button>
      </Space>
    </>
  )
}

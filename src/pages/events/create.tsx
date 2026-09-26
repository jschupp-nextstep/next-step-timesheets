import { useState } from 'react'
import { Create, useSelect } from '@refinedev/antd'
import { useList, useNavigation } from '@refinedev/core'
import { App, DatePicker, Form, Input, InputNumber, Radio, Select, TimePicker } from 'antd'
import type { Dayjs } from 'dayjs'

import { supabaseClient } from '../../utility/supabaseClient'

type EventFormValues = {
  program_id: string
  location_id: string
  event_date: Dayjs
  start_time: Dayjs | null
  end_time: Dayjs | null
  session_name: string | null
  notes: string | null
  recurrence: 'none' | 'weekly'
  weeks: number | null
  coach_ids: string[] | null
}

type IdName = { id: string; name: string }

export const EventCreate = () => {
  const { message } = App.useApp()
  const { list } = useNavigation()
  const [form] = Form.useForm<EventFormValues>()
  const [submitting, setSubmitting] = useState(false)
  const recurrence = Form.useWatch('recurrence', form)

  const { selectProps: programSelectProps } = useSelect({
    resource: 'programs',
    optionLabel: 'name',
    optionValue: 'id',
  })
  const { selectProps: locationSelectProps } = useSelect({
    resource: 'locations',
    optionLabel: 'name',
    optionValue: 'id',
  })
  const { result: coachesResult } = useList<IdName>({
    resource: 'coaches',
    filters: [{ field: 'is_active', operator: 'eq', value: true }],
    sorters: [{ field: 'name', order: 'asc' }],
    pagination: { pageSize: 200 },
  })
  const coaches = coachesResult?.data ?? []

  const handleSubmit = async () => {
    const values = await form.validateFields()
    setSubmitting(true)
    try {
      // Recurrence materializes as N independent events rows (date + 7 days
      // each), not a recurrence-template concept -- series_id just tags
      // which rows were created together, for the board's future bulk-edit.
      const weekCount = values.recurrence === 'weekly' ? (values.weeks ?? 2) : 1
      const dates = Array.from({ length: weekCount }, (_, i) =>
        values.event_date.add(i * 7, 'day').format('YYYY-MM-DD'),
      )
      const seriesId = dates.length > 1 ? crypto.randomUUID() : null

      const { data: insertedEvents, error: eventsError } = await supabaseClient
        .from('events')
        .insert(
          dates.map((event_date) => ({
            program_id: values.program_id,
            location_id: values.location_id,
            event_date,
            start_time: values.start_time?.format('HH:mm:ss') ?? null,
            end_time: values.end_time?.format('HH:mm:ss') ?? null,
            session_name: values.session_name || null,
            notes: values.notes || null,
            series_id: seriesId,
          })),
        )
        .select('id')

      if (eventsError || !insertedEvents) {
        message.error(`Couldn't create event(s): ${eventsError?.message}`)
        return
      }

      if (values.coach_ids && values.coach_ids.length > 0) {
        const assignmentRows = insertedEvents.flatMap((event) =>
          values.coach_ids!.map((coach_id) => ({ event_id: event.id, coach_id })),
        )
        const { error: assignError } = await supabaseClient.from('event_assignments').insert(assignmentRows)
        if (assignError) {
          message.error(
            `Event(s) created, but couldn't assign coach(es): ${assignError.message}. Assign them from the Schedule Board instead.`,
          )
          list('events')
          return
        }
      }

      message.success(dates.length > 1 ? `${dates.length} events created` : 'Event created')
      list('events')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Create saveButtonProps={{ onClick: handleSubmit, loading: submitting }}>
      <Form form={form} layout="vertical" initialValues={{ recurrence: 'none', weeks: 2 }}>
        <Form.Item label="Program" name="program_id" rules={[{ required: true }]}>
          <Select {...programSelectProps} />
        </Form.Item>
        <Form.Item label="Location" name="location_id" rules={[{ required: true }]}>
          <Select {...locationSelectProps} />
        </Form.Item>
        <Form.Item label="Date" name="event_date" rules={[{ required: true }]}>
          <DatePicker style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item label="Start Time" name="start_time">
          <TimePicker format="HH:mm" style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item label="End Time" name="end_time">
          <TimePicker format="HH:mm" style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item label="Session / Team Name" name="session_name">
          <Input />
        </Form.Item>
        <Form.Item label="Notes" name="notes">
          <Input.TextArea rows={3} />
        </Form.Item>

        <Form.Item label="Recurrence" name="recurrence">
          <Radio.Group
            options={[
              { label: 'Does not repeat', value: 'none' },
              { label: 'Weekly', value: 'weekly' },
            ]}
          />
        </Form.Item>
        {recurrence === 'weekly' && (
          <Form.Item
            label="Number of weeks"
            name="weeks"
            rules={[{ required: true, type: 'number', min: 2 }]}
            extra="Including the date above -- e.g. 4 creates that date plus 3 more, one week apart."
          >
            <InputNumber min={2} max={52} style={{ width: '100%' }} />
          </Form.Item>
        )}

        <Form.Item
          label="Assign coach(es) (optional)"
          name="coach_ids"
          extra="Applied to every date created above. Adjust assignments later from the Schedule Board."
        >
          <Select
            mode="multiple"
            placeholder="Select coach(es)"
            options={coaches.map((c) => ({ label: c.name, value: c.id }))}
            optionFilterProp="label"
          />
        </Form.Item>
      </Form>
    </Create>
  )
}

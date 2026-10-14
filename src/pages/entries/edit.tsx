import { useEffect, useMemo } from 'react'
import { Edit, useForm, useSelect } from '@refinedev/antd'
import { useList, type BaseRecord, type GetOneResponse } from '@refinedev/core'
import { Alert, DatePicker, Form, Input, InputNumber, Select, TimePicker } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'

import {
  buildRateLookup,
  computeAmount,
  PAID_RATE_BASIS_LABEL,
  type OneVOneRateRow,
  type PaidRateBasis,
  type RateRow,
} from '../../utility/payroll'

type EntryFormValues = {
  coach_id: string
  program_id: string
  event_id: string | null
  location_id: string | null
  entry_date: Dayjs
  start_time: Dayjs | null
  end_time: Dayjs | null
  hours: number | null
  flat_amount: number | null
  session_name: string | null
  notes: string | null
  status: 'pending' | 'paid'
  paid_date: Dayjs | null
  paid_rate: number | null
  paid_amount: number | null
}

type ProgramRow = { id: string; name: string; entry_mode: string }

// Defined once, outside the component: react-query re-runs an inline
// `select` on every render, which hands Refine a "new" record each time and
// makes it reset the form -- wiping an edit (e.g. Status -> Paid) the moment
// the live Paid fields below trigger a re-render.
const toFormValues = (data: GetOneResponse<BaseRecord>) => ({
  ...data,
  data: {
    ...data.data,
    entry_date: data.data.entry_date ? dayjs(data.data.entry_date) : undefined,
    start_time: data.data.start_time ? dayjs(data.data.start_time, 'HH:mm:ss') : undefined,
    end_time: data.data.end_time ? dayjs(data.data.end_time, 'HH:mm:ss') : undefined,
    paid_date: data.data.paid_date ? dayjs(data.data.paid_date) : undefined,
  },
})

export const EntryEdit = () => {
  const { formProps, saveButtonProps, query } = useForm({
    resource: 'timesheet_entries',
    queryOptions: { select: toFormValues },
  })
  const record = query?.data?.data as
    | { cutover_resolution: string | null; paid_rate_basis: PaidRateBasis | null }
    | undefined
  const paidInSheets = record?.cutover_resolution === 'paid_in_sheets'

  const { selectProps: coachSelectProps } = useSelect({ resource: 'coaches', optionLabel: 'name', optionValue: 'id' })
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
  const { selectProps: eventSelectProps } = useSelect({
    resource: 'events',
    optionLabel: 'session_name',
    optionValue: 'id',
  })

  // R8: pre-fill Paid rate / Paid amount from the same lookup Payment Due
  // uses, so a hand-marked payment matches unless deliberately overridden.
  const { result: ratesResult } = useList<RateRow>({
    resource: 'rates',
    filters: [{ field: 'is_active', operator: 'eq', value: true }],
    pagination: { pageSize: 1000 },
  })
  const { result: oneVOneResult } = useList<OneVOneRateRow>({
    resource: 'one_v_one_rates',
    filters: [{ field: 'is_active', operator: 'eq', value: true }],
    pagination: { pageSize: 200 },
  })
  const { result: programsResult } = useList<ProgramRow>({ resource: 'programs', pagination: { pageSize: 100 } })

  const form = formProps.form!
  const status = Form.useWatch('status', form)
  const coachId = Form.useWatch('coach_id', form)
  const programId = Form.useWatch('program_id', form)
  const hours = Form.useWatch('hours', form)
  const flatAmount = Form.useWatch('flat_amount', form)
  const entryDate = Form.useWatch('entry_date', form)

  const program = (programsResult?.data ?? []).find((p) => p.id === programId)
  const computed = useMemo(() => {
    if (!coachId || !programId) return null
    return computeAmount(
      {
        id: '',
        coach_id: coachId,
        program_id: programId,
        entry_date: entryDate ? entryDate.format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD'),
        hours: hours ?? null,
        flat_amount: flatAmount ?? null,
        programs: program ?? null,
      },
      buildRateLookup(ratesResult?.data ?? []),
      (programsResult?.data ?? []).find((p) => p.name === 'Coaching')?.id,
      new Map((oneVOneResult?.data ?? []).map((r) => [r.coach_id, r])),
    )
  }, [coachId, programId, entryDate, hours, flatAmount, program, ratesResult?.data, oneVOneResult?.data, programsResult?.data])

  // Hourly entries need a rate; flat fees and 1v1 sessions don't have one.
  const isHourly = flatAmount == null && program?.entry_mode !== 'direct_flat'
  const showPaidFields = status === 'paid' && !paidInSheets

  // Switching to Paid fills in today's paid date and the looked-up
  // rate/amount, each only if it's still empty.
  useEffect(() => {
    if (!showPaidFields) return
    if (form.getFieldValue('paid_date') == null) form.setFieldsValue({ paid_date: dayjs() })
    if (!computed || computed.missingRate) return
    if (form.getFieldValue('paid_amount') == null) {
      form.setFieldsValue({ paid_amount: computed.amount, paid_rate: computed.rate })
    }
  }, [showPaidFields, computed, form])

  return (
    <Edit saveButtonProps={saveButtonProps}>
      <Form
        {...formProps}
        layout="vertical"
        onFinish={(rawValues) => {
          const values = rawValues as EntryFormValues
          const isPaid = values.status === 'paid' && !paidInSheets
          const matchesLookup =
            !!computed &&
            !computed.missingRate &&
            values.paid_amount === computed.amount &&
            (values.paid_rate ?? null) === computed.rate
          formProps.onFinish?.({
            ...values,
            entry_date: values.entry_date.format('YYYY-MM-DD'),
            start_time: values.start_time?.format('HH:mm:ss') ?? null,
            end_time: values.end_time?.format('HH:mm:ss') ?? null,
            paid_date: values.paid_date?.format('YYYY-MM-DD') ?? null,
            // Paid rate/amount only mean anything on a paid entry; the
            // database refuses Paid without an amount (0024).
            paid_rate: isPaid ? (values.paid_rate ?? null) : null,
            paid_amount: isPaid ? (values.paid_amount ?? null) : null,
            paid_rate_basis: isPaid ? (matchesLookup ? computed!.basis : 'manual') : null,
          })
        }}
      >
        <Form.Item label="Coach" name="coach_id" rules={[{ required: true }]}>
          <Select {...coachSelectProps} />
        </Form.Item>
        <Form.Item label="Program" name="program_id" rules={[{ required: true }]}>
          <Select {...programSelectProps} />
        </Form.Item>
        <Form.Item label="Linked event (optional)" name="event_id" extra="Only used for session-mode entries. Leave blank for Office Hours, 1v1, reimbursements, etc.">
          <Select {...eventSelectProps} allowClear />
        </Form.Item>
        <Form.Item label="Location (optional)" name="location_id">
          <Select {...locationSelectProps} allowClear />
        </Form.Item>
        <Form.Item label="Date" name="entry_date" rules={[{ required: true }]}>
          <DatePicker style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item label="Start Time" name="start_time">
          <TimePicker format="HH:mm" style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item label="End Time" name="end_time">
          <TimePicker format="HH:mm" style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item label="Hours" name="hours" extra="Leave blank for flat-fee entries (1v1, reimbursements).">
          <InputNumber min={0} step={0.25} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item
          label="Flat amount"
          name="flat_amount"
          extra="Used for 1v1 session fees, oversight fees, and reimbursements -- leave blank for hourly entries."
        >
          <InputNumber min={0} step={0.01} style={{ width: '100%' }} addonBefore="$" />
        </Form.Item>
        <Form.Item label="Session / description" name="session_name">
          <Input />
        </Form.Item>
        <Form.Item label="Notes" name="notes">
          <Input.TextArea rows={3} />
        </Form.Item>
        <Form.Item label="Status" name="status" rules={[{ required: true }]}>
          <Select
            options={[
              { label: 'Pending', value: 'pending' },
              { label: 'Paid', value: 'paid' },
            ]}
          />
        </Form.Item>
        <Form.Item label="Paid date" name="paid_date">
          <DatePicker style={{ width: '100%' }} />
        </Form.Item>

        {status === 'paid' && paidInSheets && (
          <Alert type="info" showIcon message="Paid in Sheets -- the amount was paid in the old system, so none is recorded here." />
        )}
        {showPaidFields && (
          <>
            {computed?.missingRate && (
              <Alert
                style={{ marginBottom: 16 }}
                type="warning"
                showIcon
                message="No rate on file for this coach and program -- enter what was paid by hand."
              />
            )}
            {computed && !computed.missingRate && computed.basis === 'coaching_fallback' && (
              <Alert
                style={{ marginBottom: 16 }}
                type="warning"
                showIcon
                message="This coach has no rate for this program, so the amount uses their Coaching rate. Check it's right."
              />
            )}
            <Form.Item
              label="Paid rate"
              name="paid_rate"
              rules={[{ required: isHourly, message: 'Enter the hourly rate it was paid at' }]}
              extra={isHourly ? 'Hourly rate this entry was paid at.' : 'Not used for flat fees and 1v1 sessions.'}
            >
              <InputNumber min={0} step={0.01} style={{ width: '100%' }} addonBefore="$" addonAfter="/hr" disabled={!isHourly} />
            </Form.Item>
            <Form.Item
              label="Paid amount"
              name="paid_amount"
              rules={[{ required: true, message: 'Enter the amount it was paid' }]}
              extra={
                computed && !computed.missingRate
                  ? `Looked up: $${computed.amount.toFixed(2)} (${computed.basis ? PAID_RATE_BASIS_LABEL[computed.basis] : ''}). Change it only to override; it'll be saved as "Set by admin".`
                  : undefined
              }
            >
              <InputNumber min={0} step={0.01} style={{ width: '100%' }} addonBefore="$" />
            </Form.Item>
            {record?.paid_rate_basis && (
              <Form.Item label="Recorded basis">
                <Input readOnly value={PAID_RATE_BASIS_LABEL[record.paid_rate_basis]} />
              </Form.Item>
            )}
          </>
        )}
      </Form>
    </Edit>
  )
}

import type { Dayjs } from 'dayjs'

export type WeeklyRateFormValues = {
  coach_id: string
  program_id: string | null
  weekly_amount: number
  week_start_dow: number
  effective_from: Dayjs
  effective_to: Dayjs | null
  notes: string | null
}

export const toWeeklyRateRow = (values: WeeklyRateFormValues) => ({
  ...values,
  program_id: values.program_id ?? null,
  effective_from: values.effective_from.format('YYYY-MM-DD'),
  effective_to: values.effective_to?.format('YYYY-MM-DD') ?? null,
  notes: values.notes || null,
})

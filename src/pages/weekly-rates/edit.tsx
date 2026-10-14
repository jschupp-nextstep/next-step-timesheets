import { Edit, useForm } from '@refinedev/antd'
import type { BaseRecord, GetOneResponse } from '@refinedev/core'
import dayjs from 'dayjs'

import { WeeklyRateForm } from './form'
import { toWeeklyRateRow, type WeeklyRateFormValues } from './values'

// Module-level, not inline (an inline select resets the form every render).
const toFormValues = (data: GetOneResponse<BaseRecord>) => ({
  ...data,
  data: {
    ...data.data,
    effective_from: data.data.effective_from ? dayjs(data.data.effective_from) : undefined,
    effective_to: data.data.effective_to ? dayjs(data.data.effective_to) : null,
  },
})

export const WeeklyRateEdit = () => {
  const { formProps, saveButtonProps } = useForm({ resource: 'weekly_rates', queryOptions: { select: toFormValues } })
  return (
    <Edit saveButtonProps={saveButtonProps} title="Edit Weekly Rate">
      <WeeklyRateForm
        formProps={{
          ...formProps,
          onFinish: (values) => formProps.onFinish?.(toWeeklyRateRow(values as WeeklyRateFormValues)),
        }}
      />
    </Edit>
  )
}

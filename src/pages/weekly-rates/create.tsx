import { Create, useForm } from '@refinedev/antd'

import { WeeklyRateForm } from './form'
import { toWeeklyRateRow, type WeeklyRateFormValues } from './values'

export const WeeklyRateCreate = () => {
  const { formProps, saveButtonProps } = useForm({ resource: 'weekly_rates' })
  return (
    <Create saveButtonProps={saveButtonProps} title="Add Weekly Rate">
      <WeeklyRateForm
        formProps={{
          ...formProps,
          onFinish: (values) => formProps.onFinish?.(toWeeklyRateRow(values as WeeklyRateFormValues)),
        }}
      />
    </Create>
  )
}

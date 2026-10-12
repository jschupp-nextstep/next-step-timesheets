import { Edit, useForm } from '@refinedev/antd'
import { DatePicker, Form, Typography } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'

type SettingsFormValues = {
  cutover_date: Dayjs | null
  paid_through_date: Dayjs | null
}

// Single-row app_settings (id = 1) -- see 0015_cutover.sql.
export const Settings = () => {
  const { formProps, saveButtonProps } = useForm({
    resource: 'app_settings',
    action: 'edit',
    id: 1,
    redirect: false,
    queryOptions: {
      select: (data) => ({
        ...data,
        data: {
          ...data.data,
          cutover_date: data.data.cutover_date ? dayjs(data.data.cutover_date) : null,
          paid_through_date: data.data.paid_through_date ? dayjs(data.data.paid_through_date) : null,
        },
      }),
    },
  })

  return (
    <Edit
      title="Settings"
      saveButtonProps={saveButtonProps}
      headerButtons={() => null}
      breadcrumb={false}
      goBack={false}
    >
      <Form
        {...formProps}
        layout="vertical"
        style={{ maxWidth: 480 }}
        onFinish={(rawValues) => {
          const values = rawValues as SettingsFormValues
          formProps.onFinish?.({
            cutover_date: values.cutover_date?.format('YYYY-MM-DD') ?? null,
            paid_through_date: values.paid_through_date?.format('YYYY-MM-DD') ?? null,
            updated_at: new Date().toISOString(),
          })
        }}
      >
        <Form.Item
          label="Cutover from the old system"
          name="cutover_date"
          extra="Sessions before this date were paid in Sheets. Coaches can't log or claim them, and Payment Due and the Zoho export leave them out unless an admin entered them."
        >
          <DatePicker style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item
          label="Paid through"
          name="paid_through_date"
          extra="Payment Due opens on the day after this. It moves forward on its own once every entry in a payroll range is marked paid -- only change it to correct a mistake."
        >
          <DatePicker style={{ width: '100%' }} />
        </Form.Item>
      </Form>
      <Typography.Paragraph type="secondary">
        Changing the cutover takes effect immediately for every coach, in the app and in the database's access rules.
      </Typography.Paragraph>
    </Edit>
  )
}

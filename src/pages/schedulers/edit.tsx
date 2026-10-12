import { useState } from 'react'
import { Edit, useForm, useSelect } from '@refinedev/antd'
import { useList } from '@refinedev/core'
import { App, Button, Card, Form, Input, Popconfirm, Segmented, Select, Space, Switch, Table, Typography } from 'antd'
import { DeleteOutlined } from '@ant-design/icons'
import { useParams } from 'react-router'

import { supabaseClient } from '../../utility/supabaseClient'
import { describeScope, type ScopeLabelRow } from '../../utility/schedulerScopes'

type SchedulerFormValues = { name: string; email: string; is_active: boolean }
type ScopeRow = ScopeLabelRow & { id: string }

// Scope rules, two kinds (0017_roles.sql): a program and/or location, or a
// coach. A scheduler manages an event if ANY rule matches it.
const ScopeEditor = ({ schedulerId }: { schedulerId: string }) => {
  const { message } = App.useApp()
  const [kind, setKind] = useState<'program_location' | 'coach'>('program_location')
  const [programId, setProgramId] = useState<string | undefined>()
  const [locationId, setLocationId] = useState<string | undefined>()
  const [coachId, setCoachId] = useState<string | undefined>()
  const [adding, setAdding] = useState(false)

  const { result, query } = useList<ScopeRow>({
    resource: 'scheduler_scopes',
    meta: { select: 'id, programs(name), locations(name), coaches(name)' },
    filters: [{ field: 'scheduler_id', operator: 'eq', value: schedulerId }],
    pagination: { pageSize: 100 },
  })
  const { selectProps: programSelectProps } = useSelect({
    resource: 'programs',
    optionLabel: 'name',
    optionValue: 'id',
    sorters: [{ field: 'name', order: 'asc' }],
    pagination: { pageSize: 100 },
  })
  const { selectProps: locationSelectProps } = useSelect({
    resource: 'locations',
    optionLabel: 'name',
    optionValue: 'id',
    sorters: [{ field: 'name', order: 'asc' }],
    pagination: { pageSize: 200 },
  })
  const { selectProps: coachSelectProps } = useSelect({
    resource: 'coaches',
    optionLabel: 'name',
    optionValue: 'id',
    filters: [{ field: 'is_active', operator: 'eq', value: true }],
    sorters: [{ field: 'name', order: 'asc' }],
    pagination: { pageSize: 200 },
  })

  const canAdd = kind === 'coach' ? !!coachId : !!programId || !!locationId

  const addScope = async () => {
    setAdding(true)
    try {
      const row: Record<string, string | null | undefined> =
        kind === 'coach'
          ? { scheduler_id: schedulerId, coach_id: coachId }
          : { scheduler_id: schedulerId, program_id: programId ?? null, location_id: locationId ?? null }
      const { error } = await supabaseClient.from('scheduler_scopes').insert(row)
      if (error) {
        message.error(`Couldn't add: ${error.message}`)
        return
      }
      setProgramId(undefined)
      setLocationId(undefined)
      setCoachId(undefined)
      query.refetch()
    } finally {
      setAdding(false)
    }
  }

  const removeScope = async (id: string) => {
    const { error } = await supabaseClient.from('scheduler_scopes').delete().eq('id', id)
    if (error) message.error(`Couldn't remove: ${error.message}`)
    query.refetch()
  }

  return (
    <Card title="Manages" size="small" style={{ marginTop: 16, maxWidth: 640 }}>
      <Table<ScopeRow> dataSource={result?.data ?? []} rowKey="id" size="small" pagination={false} loading={query.isLoading}>
        <Table.Column title="Rule" render={(_, row: ScopeRow) => describeScope(row)} />
        <Table.Column
          width={60}
          render={(_, row: ScopeRow) => (
            <Popconfirm title="Remove this rule?" onConfirm={() => removeScope(row.id)}>
              <Button danger size="small" icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        />
      </Table>

      <Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>
        <strong>Program/location</strong>: events matching it (leave one blank for "any"). They can also create new
        events here. <strong>Coach</strong>: any event that coach is assigned to, anywhere -- but no event creation.
      </Typography.Paragraph>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Segmented
          value={kind}
          onChange={(v) => setKind(v as typeof kind)}
          options={[
            { label: 'Program / location', value: 'program_location' },
            { label: 'Coach', value: 'coach' },
          ]}
        />
        {kind === 'program_location' ? (
          <Space wrap>
            <Select
              options={programSelectProps.options}
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="Any program"
              style={{ width: 220 }}
              value={programId}
              onChange={setProgramId}
            />
            <Select
              options={locationSelectProps.options}
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="Any location"
              style={{ width: 220 }}
              value={locationId}
              onChange={setLocationId}
            />
          </Space>
        ) : (
          <Select
            options={coachSelectProps.options}
            showSearch
            optionFilterProp="label"
            placeholder="Coach"
            style={{ width: 220 }}
            value={coachId}
            onChange={setCoachId}
          />
        )}
        <Button type="primary" disabled={!canAdd} loading={adding} onClick={addScope}>
          Add rule
        </Button>
      </Space>
    </Card>
  )
}

export const SchedulerEdit = () => {
  const { id } = useParams()
  const { formProps, saveButtonProps } = useForm({ resource: 'schedulers' })

  return (
    <>
      <Edit saveButtonProps={saveButtonProps} title="Edit Scheduler">
        <Form
          {...formProps}
          layout="vertical"
          style={{ maxWidth: 480 }}
          onFinish={(rawValues) => {
            const values = rawValues as SchedulerFormValues
            formProps.onFinish?.({ ...values, name: values.name.trim(), email: values.email.trim().toLowerCase() })
          }}
        >
          <Form.Item label="Name" name="name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="Email" name="email" rules={[{ required: true, type: 'email' }]}>
            <Input />
          </Form.Item>
          <Form.Item label="Active" name="is_active" valuePropName="checked">
            <Switch checkedChildren="Active" unCheckedChildren="Inactive" />
          </Form.Item>
        </Form>
      </Edit>
      {id && <ScopeEditor schedulerId={id} />}
    </>
  )
}

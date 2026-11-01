import { useState } from 'react'
import { useList } from '@refinedev/core'
import { App, Button, Card, Form, Input, InputNumber, Select, Space, Typography } from 'antd'
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons'
import { Link, useNavigate } from 'react-router'

import { supabaseClient } from '../../utility/supabaseClient'
import { suggestInitials } from '../../utility/coachRateImport'

type Program = { id: string; name: string; is_active: boolean }
type Values = {
  name: string
  initials: string
  email?: string | null
  pay_type: '1099' | 'w2'
  rates?: { program_id?: string; hourly_rate?: number }[]
}

// Add a coach and their rates on one screen (Justin, 2026-11-01). The coach
// is saved first, then the rates in one insert; if the rates fail the coach
// still exists and the error says so, and their page is where to finish.
export const CoachCreate = () => {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const [form] = Form.useForm<Values>()
  const [saving, setSaving] = useState(false)
  const [initialsTouched, setInitialsTouched] = useState(false)

  const { result: programsResult } = useList<Program>({
    resource: 'programs',
    meta: { select: 'id, name, is_active' },
    filters: [{ field: 'is_active', operator: 'eq', value: true }],
    sorters: [{ field: 'name', order: 'asc' }],
    pagination: { pageSize: 200 },
  })
  const programs = programsResult?.data ?? []
  const coachingId = programs.find((p) => p.name === 'Coaching')?.id

  const save = async (values: Values) => {
    const rates = (values.rates ?? []).filter((r) => r.program_id && r.hourly_rate != null)
    const programIds = rates.map((r) => r.program_id)
    if (new Set(programIds).size !== programIds.length) {
      message.error('Each program can only have one rate.')
      return
    }
    setSaving(true)
    try {
      const { data: coach, error } = await supabaseClient
        .from('coaches')
        .insert({
          name: values.name.trim().replace(/\s+/g, ' '),
          initials: values.initials.trim(),
          email: values.email || null,
          pay_type: values.pay_type,
        })
        .select('id, name')
        .single()
      if (error) {
        message.error({ content: `Couldn't add the coach: ${error.message}`, duration: 6 })
        return
      }
      if (rates.length > 0) {
        const { error: rateError } = await supabaseClient.from('rates').insert(
          rates.map((r) => ({ coach_id: coach.id, program_id: r.program_id, hourly_rate: r.hourly_rate, is_active: true })),
        )
        if (rateError) {
          message.error({
            content: `${coach.name} was added, but the rates weren't saved: ${rateError.message}. Add them on this page.`,
            duration: 8,
          })
          navigate(`/coaches/show/${coach.id}`)
          return
        }
      }
      message.success(`Added ${coach.name}${rates.length ? ` with ${rates.length} rate(s)` : ''}`)
      navigate(`/coaches/show/${coach.id}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <Link to="/coaches">← Coaches</Link>
      <Space style={{ marginTop: 8, marginBottom: 16, width: '100%', justifyContent: 'space-between' }} wrap>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Add a coach
        </Typography.Title>
        <Link to="/coaches/import">Adding several? Import a list →</Link>
      </Space>

      <Form<Values>
        form={form}
        layout="vertical"
        onFinish={save}
        initialValues={{ pay_type: '1099', rates: [{}] }}
        onValuesChange={(changed: Partial<Values>) => {
          if (changed.name !== undefined && !initialsTouched) form.setFieldValue('initials', suggestInitials(changed.name))
        }}
      >
        <Card size="small" title="Details" style={{ marginBottom: 16 }}>
          <Form.Item label="Name" name="name" rules={[{ required: true, whitespace: true }]}>
            <Input autoFocus />
          </Form.Item>
          <Form.Item label="Initials" name="initials" rules={[{ required: true, whitespace: true }]}>
            <Input style={{ maxWidth: 120 }} onChange={() => setInitialsTouched(true)} />
          </Form.Item>
          <Form.Item
            label="Email"
            name="email"
            normalize={(value?: string) => (value ? value.trim().toLowerCase() : null)}
            rules={[{ type: 'email' }]}
            extra="Lets this coach sign in. Leave blank if you don't have it yet."
          >
            <Input />
          </Form.Item>
          <Form.Item
            label="Pay type"
            name="pay_type"
            rules={[{ required: true }]}
            extra="Determines which Zoho Books accounts this coach's pay routes to on export."
          >
            <Select
              style={{ maxWidth: 240 }}
              options={[
                { label: '1099 Contractor', value: '1099' },
                { label: 'W-2 Employee', value: 'w2' },
              ]}
            />
          </Form.Item>
        </Card>

        <Card size="small" title="Hourly rates" style={{ marginBottom: 16 }}>
          <Typography.Paragraph type="secondary">
            One per program they work. <strong>Coaching</strong> is used for any program without its own rate. You can
            add or change rates later on the coach's page.
          </Typography.Paragraph>
          <Form.List name="rates">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <Space key={field.key} align="baseline" wrap>
                    <Form.Item name={[field.name, 'program_id']} style={{ minWidth: 240 }}>
                      <Select
                        showSearch
                        optionFilterProp="label"
                        placeholder="Program"
                        options={programs.map((p) => ({ label: p.name, value: p.id }))}
                      />
                    </Form.Item>
                    <Form.Item name={[field.name, 'hourly_rate']}>
                      <InputNumber min={0} step={0.5} addonBefore="$" addonAfter="/hr" placeholder="Rate" />
                    </Form.Item>
                    <MinusCircleOutlined onClick={() => remove(field.name)} />
                  </Space>
                ))}
                <Button type="dashed" icon={<PlusOutlined />} onClick={() => add(fields.length === 0 ? { program_id: coachingId } : {})}>
                  Add a rate
                </Button>
              </>
            )}
          </Form.List>
        </Card>

        <Button type="primary" htmlType="submit" size="large" loading={saving}>
          Save coach
        </Button>
      </Form>
    </div>
  )
}

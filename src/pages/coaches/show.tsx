import { useMemo, useState } from 'react'
import { useList, useOne } from '@refinedev/core'
import {
  Alert,
  App,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Form,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { Link, useParams } from 'react-router'

import { ChangeRateModal, type ChangingRate } from '../../components/ChangeRateModal'
import { currentRate, type RateRef } from '../../utility/coachRateImport'
import { supabaseClient } from '../../utility/supabaseClient'

type Coach = { id: string; name: string; initials: string; email: string | null; pay_type: '1099' | 'w2'; is_active: boolean }
type Program = { id: string; name: string; entry_mode: string; is_active: boolean }
type OneVOne = { id: string; session_fee: number; oversight_fee: number | null; is_active: boolean; oversight: { name: string } | null }
type Weekly = {
  id: string
  weekly_amount: number
  week_start_dow: number
  effective_from: string
  effective_to: string | null
  program: { name: string } | null
}

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const money = (n: number) => `$${Number(n).toFixed(2).replace(/\.00$/, '')}`
const span = (from: string | null, to: string | null) =>
  !from && !to ? 'Always' : `${from ? dayjs(from).format('M/D/YY') : 'start'} → ${to ? dayjs(to).format('M/D/YY') : 'now'}`

type ProgramRow = { program: Program; current: RateRef | null; history: RateRef[] }

// One coach's page (Justin, 2026-11-01): their details plus every rate in
// one place -- hourly rates per program (change from a date, correct, add),
// and their 1v1 / weekly rates for reference.
export const CoachShow = () => {
  const { id } = useParams()
  const { message } = App.useApp()
  const today = dayjs().format('YYYY-MM-DD')

  const { result: coach, query: coachQuery } = useOne<Coach>({ resource: 'coaches', id })
  const { result: programsResult } = useList<Program>({
    resource: 'programs',
    meta: { select: 'id, name, entry_mode, is_active' },
    sorters: [{ field: 'name', order: 'asc' }],
    pagination: { pageSize: 200 },
  })
  const { result: ratesResult, query: ratesQuery } = useList<RateRef>({
    resource: 'rates',
    filters: [{ field: 'coach_id', operator: 'eq', value: id }],
    pagination: { pageSize: 500 },
  })
  const { result: oneVOneResult } = useList<OneVOne>({
    resource: 'one_v_one_rates',
    meta: { select: 'id, session_fee, oversight_fee, is_active, oversight:coaches!one_v_one_rates_oversight_coach_id_fkey(name)' },
    filters: [{ field: 'coach_id', operator: 'eq', value: id }],
  })
  const { result: weeklyResult } = useList<Weekly>({
    resource: 'weekly_rates',
    meta: { select: 'id, weekly_amount, week_start_dow, effective_from, effective_to, program:programs(name)' },
    filters: [{ field: 'coach_id', operator: 'eq', value: id }],
  })

  const [changing, setChanging] = useState<ChangingRate | null>(null)
  const [adding, setAdding] = useState<{ programId?: string } | null>(null)
  const [addRate, setAddRate] = useState<number | null>(null)
  const [addFrom, setAddFrom] = useState<Dayjs | null>(null)
  const [addProgram, setAddProgram] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)

  const programs = programsResult?.data ?? []
  const rates = ratesResult?.data ?? []

  // One row per program the coach has (or had) a rate for.
  const rows = useMemo<ProgramRow[]>(() => {
    const byProgram = new Map<string, RateRef[]>()
    for (const r of rates) byProgram.set(r.program_id, [...(byProgram.get(r.program_id) ?? []), r])
    return programs
      .filter((p) => byProgram.has(p.id))
      .map((program) => {
        const history = [...byProgram.get(program.id)!].sort((a, b) =>
          (b.effective_from ?? '').localeCompare(a.effective_from ?? ''),
        )
        return { program, current: currentRate(rates, id!, program.id, today), history }
      })
  }, [programs, rates, id, today])

  // Every active program can take a rate (Coaching is the fallback), except
  // ones that already have a rate today.
  const addablePrograms = programs.filter((p) => p.is_active && !rows.some((r) => r.program.id === p.id && r.current))
  const coachingProgram = programs.find((p) => p.name === 'Coaching')
  const hasCoachingRate = rows.some((r) => r.program.id === coachingProgram?.id && r.current)

  const openAdd = (programId?: string) => {
    setAdding({ programId })
    setAddProgram(programId)
    setAddRate(null)
    // After an ended rate, the new one has to start after it.
    const lastEnd = rates
      .filter((r) => r.program_id === programId && r.is_active && r.effective_to)
      .map((r) => r.effective_to!)
      .sort()
      .pop()
    setAddFrom(lastEnd ? dayjs(lastEnd).add(1, 'day') : null)
  }

  const submitAdd = async () => {
    if (!addProgram || addRate == null) return
    setBusy(true)
    try {
      const { error } = await supabaseClient.from('rates').insert({
        coach_id: id,
        program_id: addProgram,
        hourly_rate: addRate,
        is_active: true,
        effective_from: addFrom?.format('YYYY-MM-DD') ?? null,
      })
      if (error) {
        message.error({ content: error.message, duration: 6 })
        return
      }
      message.success(`Added ${money(addRate)}/hr for ${programs.find((p) => p.id === addProgram)?.name}`)
      setAdding(null)
      ratesQuery.refetch()
    } finally {
      setBusy(false)
    }
  }

  if (coachQuery.isLoading) return <Card loading />
  if (!coach) return <Alert type="warning" showIcon message="That coach wasn't found." />

  return (
    <div style={{ maxWidth: 960 }}>
      <Link to="/coaches">← Coaches</Link>
      <Space align="center" style={{ marginTop: 8, marginBottom: 16 }} wrap>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {coach.name}
        </Typography.Title>
        <Tag color={coach.is_active ? 'green' : 'default'}>{coach.is_active ? 'Active' : 'Inactive'}</Tag>
        <Link to={`/coaches/edit/${coach.id}`}>
          <Button size="small">Edit details</Button>
        </Link>
      </Space>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Descriptions size="small" column={{ xs: 1, sm: 3 }}>
          <Descriptions.Item label="Initials">{coach.initials}</Descriptions.Item>
          <Descriptions.Item label="Email">{coach.email ?? <Typography.Text type="secondary">none (can't sign in)</Typography.Text>}</Descriptions.Item>
          <Descriptions.Item label="Pay type">{coach.pay_type === 'w2' ? 'W-2' : '1099'}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card
        size="small"
        title="Hourly rates"
        extra={
          <Button type="primary" size="small" onClick={() => openAdd()} disabled={addablePrograms.length === 0}>
            + Add a rate
          </Button>
        }
        style={{ marginBottom: 16 }}
      >
        {!hasCoachingRate && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="No Coaching rate. Programs without their own rate below can't be paid for this coach (Payment Due shows them as missing a rate)."
          />
        )}
        <Table<ProgramRow>
          size="small"
          rowKey={(r) => r.program.id}
          dataSource={rows}
          pagination={false}
          locale={{ emptyText: 'No rates yet.' }}
          expandable={{
            rowExpandable: (r) => r.history.length > 1 || (!!r.history[0] && r.history[0] !== r.current),
            expandedRowRender: (r) => (
              <Table<RateRef>
                size="small"
                rowKey="id"
                dataSource={r.history}
                pagination={false}
                columns={[
                  { title: 'Rate', dataIndex: 'hourly_rate', render: (v: number) => money(v) },
                  { title: 'In effect', render: (_, h) => span(h.effective_from, h.effective_to) },
                  {
                    title: '',
                    render: (_, h) => (
                      <>
                        {h === r.current && <Tag color="green">current</Tag>}
                        {!h.is_active && <Tag>inactive</Tag>}
                        <Link to={`/rates/edit/${h.id}`}>Edit</Link>
                      </>
                    ),
                  },
                ]}
              />
            ),
          }}
          columns={[
            {
              title: 'Program',
              render: (_, r) => (
                <>
                  {r.program.name}
                  {r.program.name === 'Coaching' && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {' '}
                      (fallback for programs without their own rate)
                    </Typography.Text>
                  )}
                </>
              ),
            },
            {
              title: 'Rate now',
              render: (_, r) =>
                r.current ? <strong>{money(r.current.hourly_rate)}/hr</strong> : <Typography.Text type="secondary">none today</Typography.Text>,
            },
            { title: 'In effect', render: (_, r) => (r.current ? span(r.current.effective_from, r.current.effective_to) : '—') },
            {
              title: 'Actions',
              render: (_, r) =>
                r.current ? (
                  <Space wrap>
                    <Button
                      size="small"
                      onClick={() =>
                        setChanging({
                          id: r.current!.id,
                          hourly_rate: r.current!.hourly_rate,
                          coachName: coach.name,
                          programName: r.program.name,
                        })
                      }
                    >
                      Change from a date…
                    </Button>
                    <Link to={`/rates/edit/${r.current.id}`}>Correct</Link>
                  </Space>
                ) : (
                  <Button size="small" onClick={() => openAdd(r.program.id)}>
                    Add a rate…
                  </Button>
                ),
            },
          ]}
        />
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
          <strong>Change from a date</strong> keeps the old rate for earlier sessions. <strong>Correct</strong> edits the
          amount itself (it was always meant to be that). Paid sessions never change.
        </Typography.Paragraph>
      </Card>

      {((oneVOneResult?.data ?? []).length > 0 || (weeklyResult?.data ?? []).length > 0) && (
        <Card size="small" title="Other pay" style={{ marginBottom: 16 }}>
          {(oneVOneResult?.data ?? []).map((o) => (
            <div key={o.id} style={{ marginBottom: 8 }}>
              <strong>1v1:</strong> {money(o.session_fee)} per session
              {o.oversight && ` · oversight by ${o.oversight.name}${o.oversight_fee != null ? ` (${money(o.oversight_fee)})` : ''}`}
              {!o.is_active && <Tag style={{ marginLeft: 8 }}>inactive</Tag>} · <Link to={`/one-v-one-rates/edit/${o.id}`}>Edit</Link>
            </div>
          ))}
          {(weeklyResult?.data ?? []).map((w) => (
            <div key={w.id} style={{ marginBottom: 8 }}>
              <strong>Weekly:</strong> {money(w.weekly_amount)} per week ({w.program?.name ?? 'all work'}, weeks start{' '}
              {DOW[w.week_start_dow]}) · {span(w.effective_from, w.effective_to)} · <Link to={`/weekly-rates/edit/${w.id}`}>Edit</Link>
            </div>
          ))}
        </Card>
      )}

      <ChangeRateModal
        rate={changing}
        onClose={() => setChanging(null)}
        onDone={() => {
          setChanging(null)
          ratesQuery.refetch()
        }}
      />

      <Modal
        open={!!adding}
        title={`Add a rate for ${coach.name}`}
        okText="Add rate"
        okButtonProps={{ disabled: !addProgram || addRate == null, loading: busy }}
        onOk={submitAdd}
        onCancel={() => setAdding(null)}
        destroyOnHidden
      >
        <Form layout="vertical">
          <Form.Item label="Program" required>
            <Select
              showSearch
              optionFilterProp="label"
              value={addProgram}
              onChange={(v: string) => {
                setAddProgram(v)
                const lastEnd = rates
                  .filter((r) => r.program_id === v && r.is_active && r.effective_to)
                  .map((r) => r.effective_to!)
                  .sort()
                  .pop()
                setAddFrom(lastEnd ? dayjs(lastEnd).add(1, 'day') : null)
              }}
              options={addablePrograms.map((p) => ({ label: p.name, value: p.id }))}
              placeholder="Pick a program"
            />
          </Form.Item>
          <Form.Item label="Hourly rate" required>
            <InputNumber min={0} step={0.5} addonBefore="$" addonAfter="/hr" value={addRate} onChange={setAddRate} />
          </Form.Item>
          <Form.Item label="In effect from" extra="Leave empty for “since the beginning”.">
            <DatePicker value={addFrom} onChange={setAddFrom} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

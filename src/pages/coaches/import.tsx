import { useMemo, useState } from 'react'
import { useList } from '@refinedev/core'
import {
  Alert,
  Button,
  Card,
  Collapse,
  DatePicker,
  Input,
  Progress,
  Radio,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  Upload,
} from 'antd'
import { UploadOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { Link } from 'react-router'

import {
  buildImportPlan,
  normalizeName,
  parseCoachRates,
  type CoachRef,
  type ImportRow,
  type NameChoice,
  type PlannedRate,
  type ProgramRef,
  type RateRef,
} from '../../utility/coachRateImport'
import { applyCoachRates, type ApplyResult } from './applyCoachRates'

const SKIP = '__skip'
const NEW = '__new'

const money = (n: number) => `$${Number(n).toFixed(2).replace(/\.00$/, '')}`

// Coaches & rates in bulk (Justin, 2026-11-01): paste the rates sheet or
// upload a CSV, review what's new / changed / not on the roster, then apply.
export const CoachImport = () => {
  const [text, setText] = useState('')
  const [rows, setRows] = useState<ImportRow[] | null>(null)
  const [parseErrors, setParseErrors] = useState<string[]>([])
  const [choices, setChoices] = useState<Record<string, NameChoice>>({})
  const [changeKind, setChangeKind] = useState<'from_date' | 'correct' | null>(null)
  const [changeFrom, setChangeFrom] = useState<Dayjs | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = useState<ApplyResult | null>(null)

  const { result: coachesResult, query: coachesQuery } = useList<CoachRef>({
    resource: 'coaches',
    meta: { select: 'id, name, is_active' },
    sorters: [{ field: 'name', order: 'asc' }],
    pagination: { pageSize: 1000 },
  })
  const { result: programsResult } = useList<ProgramRef>({
    resource: 'programs',
    meta: { select: 'id, name' },
    pagination: { pageSize: 200 },
  })
  const { result: ratesResult, query: ratesQuery } = useList<RateRef>({
    resource: 'rates',
    meta: { select: 'id, coach_id, program_id, hourly_rate, is_active, effective_from, effective_to' },
    pagination: { pageSize: 5000 },
  })
  const coaches = coachesResult?.data ?? []
  const programs = programsResult?.data ?? []

  const plan = useMemo(
    () =>
      rows
        ? buildImportPlan(rows, coaches, programs, ratesResult?.data ?? [], choices, dayjs().format('YYYY-MM-DD'))
        : null,
    [rows, coaches, programs, ratesResult?.data, choices],
  )

  const check = (source: string) => {
    const parsed = parseCoachRates(source)
    setRows(parsed.rows)
    setParseErrors(parsed.errors)
    setChoices({})
    setChangeKind(null)
    setChangeFrom(null)
  }

  const reset = () => {
    setText('')
    setRows(null)
    setParseErrors([])
    setResult(null)
    setProgress(null)
  }

  const added = plan?.rates.filter((r) => r.status === 'new') ?? []
  const changed = plan?.rates.filter((r) => r.status === 'changed') ?? []
  const unchanged = plan?.rates.filter((r) => r.status === 'unchanged') ?? []
  const blocked = !!plan && (plan.unknownPrograms.length > 0 || plan.conflicts.length > 0)
  const changeReady = changed.length === 0 || changeKind === 'correct' || (changeKind === 'from_date' && !!changeFrom)
  const nothingToDo = !!plan && added.length === 0 && changed.length === 0 && plan.newCoaches.length === 0

  const confirm = async () => {
    if (!plan) return
    setProgress({ done: 0, total: 1 })
    const mode =
      changed.length === 0 || !changeKind
        ? null
        : changeKind === 'correct'
          ? ({ kind: 'correct' } as const)
          : ({ kind: 'from_date', from: changeFrom!.format('YYYY-MM-DD') } as const)
    const outcome = await applyCoachRates(plan, mode, (done, total) => setProgress({ done, total }))
    setResult(outcome)
    setProgress(null)
    coachesQuery.refetch()
    ratesQuery.refetch()
    window.scrollTo({ top: 0 })
  }

  if (result) {
    return (
      <div style={{ maxWidth: 900 }}>
        <Typography.Title level={3}>Import coaches &amp; rates</Typography.Title>
        <Card title="Import complete" extra={<Button onClick={reset}>Import another list</Button>}>
          <Space size={48} wrap>
            <Statistic title="Coaches added" value={result.coachesCreated} />
            <Statistic title="Rates added" value={result.ratesAdded} />
            <Statistic title="Rates changed" value={result.ratesChanged} />
          </Space>
          {result.failures.length > 0 && (
            <Alert
              style={{ marginTop: 16 }}
              type="error"
              showIcon
              message={`${result.failures.length} couldn't be saved`}
              description={
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  {result.failures.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              }
            />
          )}
          <Typography.Paragraph style={{ marginTop: 16, marginBottom: 0 }}>
            See them on <Link to="/coaches">Coaches</Link> (each coach's page lists their rates) or <Link to="/rates">Rates</Link>.
          </Typography.Paragraph>
        </Card>
      </div>
    )
  }

  if (progress) {
    return (
      <div style={{ maxWidth: 900 }}>
        <Typography.Title level={3}>Import coaches &amp; rates</Typography.Title>
        <Card>
          <Typography.Paragraph>
            Saving… {progress.done} of {progress.total}
          </Typography.Paragraph>
          <Progress percent={Math.round((progress.done / Math.max(progress.total, 1)) * 100)} />
        </Card>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <Typography.Title level={3}>Import coaches &amp; rates</Typography.Title>
      <Typography.Paragraph type="secondary">
        Paste rows from a spreadsheet, or upload a CSV, with columns <strong>Coach Name</strong>, <strong>Program Type</strong>,{' '}
        <strong>Hourly Rate</strong>. Optional columns for new coaches: <strong>Initials</strong>, <strong>Email</strong>,{' '}
        <strong>Pay Type</strong> (1099 or W-2). Nothing is saved until you confirm.
      </Typography.Paragraph>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Input.TextArea
          rows={8}
          placeholder={'Coach Name\tProgram Type\tHourly Rate\nKeith Thompson\tCoaching\t40'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          style={{ fontFamily: 'monospace' }}
        />
        <Space style={{ marginTop: 12 }} wrap>
          <Button type="primary" disabled={!text.trim()} onClick={() => check(text)}>
            Check
          </Button>
          <Upload
            accept=".csv,.tsv,.txt"
            showUploadList={false}
            beforeUpload={async (file) => {
              const content = await file.text()
              setText(content)
              check(content)
              return false
            }}
          >
            <Button icon={<UploadOutlined />}>Upload CSV</Button>
          </Upload>
        </Space>
      </Card>

      {parseErrors.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={`${parseErrors.length} row(s) couldn't be read and will be left out`}
          description={
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {parseErrors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          }
        />
      )}

      {plan && (
        <>
          {plan.unknownPrograms.length > 0 && (
            <Alert
              type="error"
              showIcon
              style={{ marginBottom: 16 }}
              message="Programs that don't exist"
              description={
                <>
                  {plan.unknownPrograms.map((p) => (
                    <div key={p.name}>
                      <strong>{p.name}</strong> (row {p.rows.join(', ')})
                    </div>
                  ))}
                  Fix the name in the list (it must match <Link to="/programs">Programs</Link>), then Check again.
                </>
              }
            />
          )}
          {plan.conflicts.length > 0 && (
            <Alert
              type="error"
              showIcon
              style={{ marginBottom: 16 }}
              message="Two different rates for the same coach and program"
              description={
                <>
                  {plan.conflicts.map((c) => (
                    <div key={`${c.coachName}|${c.programName}`}>
                      <strong>{c.coachName}</strong> · {c.programName}: {c.rates.map(money).join(' and ')} (rows{' '}
                      {c.rows.join(', ')})
                    </div>
                  ))}
                  Keep one row for each, then Check again.
                </>
              }
            />
          )}

          {plan.unmatchedNames.length > 0 && (
            <Card size="small" title={`Not on the roster (${plan.unmatchedNames.length})`} style={{ marginBottom: 16 }}>
              <Typography.Paragraph type="secondary">
                These names don't exactly match a coach. Pick who each one is, add them as a new coach, or leave them out
                for now (their rows are skipped).
              </Typography.Paragraph>
              <Table
                size="small"
                pagination={false}
                rowKey="name"
                dataSource={plan.unmatchedNames}
                columns={[
                  { title: 'Name in the list', dataIndex: 'name', render: (v: string) => <strong>{v}</strong> },
                  { title: 'Rows', dataIndex: 'rows', render: (r: number[]) => r.length },
                  {
                    title: 'Who is this?',
                    render: (_, u) => {
                      const key = normalizeName(u.name)
                      const choice = choices[key] ?? { kind: 'skip' }
                      const value = choice.kind === 'existing' ? choice.coachId : choice.kind === 'new' ? NEW : SKIP
                      return (
                        <Space direction="vertical" size={4} style={{ width: '100%' }}>
                          <Select
                            showSearch
                            optionFilterProp="label"
                            style={{ minWidth: 260 }}
                            value={value}
                            onChange={(v: string) =>
                              setChoices((prev) => ({
                                ...prev,
                                [key]: v === SKIP ? { kind: 'skip' } : v === NEW ? { kind: 'new' } : { kind: 'existing', coachId: v },
                              }))
                            }
                            options={[
                              { label: 'Leave out for now', value: SKIP },
                              { label: `Add "${u.name}" as a new coach`, value: NEW },
                              ...coaches.map((c) => ({ label: c.is_active ? c.name : `${c.name} (inactive)`, value: c.id })),
                            ]}
                          />
                          {u.suggestion && choice.kind === 'skip' && (
                            <Button
                              type="link"
                              size="small"
                              style={{ padding: 0 }}
                              onClick={() =>
                                setChoices((prev) => ({ ...prev, [key]: { kind: 'existing', coachId: u.suggestion!.id } }))
                              }
                            >
                              Did you mean {u.suggestion.name}?
                            </Button>
                          )}
                          {choice.kind === 'new' && (
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                              Initials {plan.newCoaches.find((n) => n.key === `new:${key}`)?.initials}, 1099 unless the
                              list says otherwise. Edit on their page afterwards.
                            </Typography.Text>
                          )}
                        </Space>
                      )
                    },
                  },
                ]}
              />
            </Card>
          )}

          <Card size="small" style={{ marginBottom: 16 }}>
            <Space size={48} wrap>
              <Statistic title="New rates" value={added.length} />
              <Statistic title="Changed rates" value={changed.length} />
              <Statistic title="Already correct" value={unchanged.length} />
              <Statistic title="New coaches" value={plan.newCoaches.length} />
              <Statistic title="Rows left out" value={plan.skippedRows} />
            </Space>
          </Card>

          {changed.length > 0 && (
            <Card size="small" title={`Rates that would change (${changed.length})`} style={{ marginBottom: 16 }}>
              <RateTable rates={changed} showCurrent />
              <Typography.Paragraph strong style={{ marginTop: 16 }}>
                How should these change?
              </Typography.Paragraph>
              <Radio.Group value={changeKind} onChange={(e) => setChangeKind(e.target.value)}>
                <Space direction="vertical">
                  <Radio value="from_date">
                    New rate from a date (sessions before it keep the current rate){' '}
                    {changeKind === 'from_date' && (
                      <DatePicker
                        size="small"
                        placeholder="Starting"
                        value={changeFrom}
                        onChange={setChangeFrom}
                        style={{ marginLeft: 8 }}
                      />
                    )}
                  </Radio>
                  <Radio value="correct">Correct the current rate (it was always meant to be the new amount)</Radio>
                </Space>
              </Radio.Group>
              <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
                Either way, sessions already paid keep the amount they were paid.
              </Typography.Paragraph>
            </Card>
          )}

          <Collapse
            style={{ marginBottom: 16 }}
            items={[
              {
                key: 'new',
                label: `New rates (${added.length})`,
                children: <RateTable rates={added} />,
              },
              {
                key: 'same',
                label: `Already correct (${unchanged.length}) — nothing to do`,
                children: <RateTable rates={unchanged} />,
              },
            ]}
          />

          <Space wrap>
            <Button
              type="primary"
              size="large"
              disabled={blocked || !changeReady || nothingToDo}
              onClick={confirm}
            >
              Save {[plan.newCoaches.length && `${plan.newCoaches.length} coach(es)`, added.length && `${added.length} new rate(s)`, changed.length && `${changed.length} change(s)`]
                .filter(Boolean)
                .join(', ') || 'nothing'}
            </Button>
            {blocked && <Typography.Text type="danger">Fix the problems above first.</Typography.Text>}
            {!blocked && !changeReady && (
              <Typography.Text type="warning">Choose how the changed rates should apply.</Typography.Text>
            )}
          </Space>
        </>
      )}
    </div>
  )
}

const RateTable = ({ rates, showCurrent }: { rates: PlannedRate[]; showCurrent?: boolean }) => (
  <Table<PlannedRate>
    size="small"
    rowKey={(r) => `${r.coachKey}|${r.programId}`}
    dataSource={rates}
    pagination={rates.length > 20 ? { pageSize: 20 } : false}
    columns={[
      {
        title: 'Coach',
        render: (_, r) => (
          <>
            {r.coachLabel} {r.coachKey.startsWith('new:') && <Tag color="blue">new coach</Tag>}
          </>
        ),
      },
      { title: 'Program', dataIndex: 'programName' },
      ...(showCurrent ? [{ title: 'Current', render: (_: unknown, r: PlannedRate) => money(r.current!.hourly_rate) }] : []),
      {
        title: showCurrent ? 'New' : 'Rate',
        render: (_, r) => (
          <>
            {money(r.rate)}
            {r.startFrom && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {' '}
                from {dayjs(r.startFrom).format('M/D/YY')}
              </Typography.Text>
            )}
          </>
        ),
      },
    ]}
  />
)

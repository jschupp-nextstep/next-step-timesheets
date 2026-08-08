import { useMemo, useState } from 'react'
import { useList } from '@refinedev/core'
import { App, Button, Card, Segmented, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'

import { supabaseClient } from '../../utility/supabaseClient'

type EntryRow = {
  id: string
  coach_id: string
  program_id: string
  hours: number | null
  flat_amount: number | null
  status: 'pending' | 'paid'
  coaches: { name: string } | null
  programs: { name: string; entry_mode: string } | null
}

type RateRow = { coach_id: string; program_id: string; hourly_rate: number }
type OneVOneRateRow = { coach_id: string; session_fee: number }
type ProgramRow = { id: string; name: string }

type Cell = { hours: number | null; amount: number; missingRate: boolean }

type CoachSummaryRow = {
  coachId: string
  coachName: string
  byProgram: Map<string, Cell>
  total: number
  hasMissingRate: boolean
  entryIds: string[]
}

// Mirrors the old system's rule exactly: exact-match rate first, then a
// fallback to the coach's "Coaching" rate only -- never any other program
// type's rate, and never a silent $0 when neither exists.
function computeAmount(
  entry: EntryRow,
  ratesByCoachProgram: Map<string, RateRow>,
  coachingProgramId: string | undefined,
  oneVOneByCoach: Map<string, OneVOneRateRow>,
): { amount: number; missingRate: boolean } {
  if (entry.flat_amount != null) return { amount: entry.flat_amount, missingRate: false }

  if (entry.programs?.entry_mode === 'direct_flat') {
    const rate = oneVOneByCoach.get(entry.coach_id)
    if (rate) return { amount: rate.session_fee, missingRate: false }
    return { amount: 0, missingRate: true }
  }

  if (entry.hours != null) {
    const exact = ratesByCoachProgram.get(`${entry.coach_id}|${entry.program_id}`)
    if (exact) return { amount: entry.hours * exact.hourly_rate, missingRate: false }
    const fallback = coachingProgramId
      ? ratesByCoachProgram.get(`${entry.coach_id}|${coachingProgramId}`)
      : undefined
    if (fallback) return { amount: entry.hours * fallback.hourly_rate, missingRate: false }
    return { amount: 0, missingRate: true }
  }

  return { amount: 0, missingRate: false }
}

export const PaymentDue = () => {
  const { message } = App.useApp()
  const [statusFilter, setStatusFilter] = useState<'pending' | 'paid'>('pending')
  const [markingCoachId, setMarkingCoachId] = useState<string | null>(null)

  const { result, query } = useList<EntryRow>({
    resource: 'timesheet_entries',
    meta: { select: '*, coaches(name), programs(name, entry_mode)' },
    filters: [{ field: 'status', operator: 'eq', value: statusFilter }],
    pagination: { pageSize: 1000 },
  })
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
  const { result: programsResult } = useList<ProgramRow>({
    resource: 'programs',
    pagination: { pageSize: 100 },
  })

  const entries = result?.data ?? []
  const ratesByCoachProgram = useMemo(
    () => new Map((ratesResult?.data ?? []).map((r) => [`${r.coach_id}|${r.program_id}`, r])),
    [ratesResult?.data],
  )
  const oneVOneByCoach = useMemo(
    () => new Map((oneVOneResult?.data ?? []).map((r) => [r.coach_id, r])),
    [oneVOneResult?.data],
  )
  const coachingProgramId = useMemo(
    () => (programsResult?.data ?? []).find((p) => p.name === 'Coaching')?.id,
    [programsResult?.data],
  )

  const programNamesById = useMemo(() => {
    const map = new Map<string, string>()
    for (const entry of entries) {
      if (entry.programs) map.set(entry.program_id, entry.programs.name)
    }
    return map
  }, [entries])

  const programColumns = useMemo(
    () =>
      Array.from(programNamesById.entries())
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [programNamesById],
  )

  const summaryRows = useMemo(() => {
    const byCoach = new Map<string, CoachSummaryRow>()
    for (const entry of entries) {
      if (!byCoach.has(entry.coach_id)) {
        byCoach.set(entry.coach_id, {
          coachId: entry.coach_id,
          coachName: entry.coaches?.name ?? 'Unknown',
          byProgram: new Map(),
          total: 0,
          hasMissingRate: false,
          entryIds: [],
        })
      }
      const row = byCoach.get(entry.coach_id)!
      const { amount, missingRate } = computeAmount(entry, ratesByCoachProgram, coachingProgramId, oneVOneByCoach)
      const existing = row.byProgram.get(entry.program_id) ?? { hours: null, amount: 0, missingRate: false }
      row.byProgram.set(entry.program_id, {
        hours: entry.hours != null ? (existing.hours ?? 0) + entry.hours : existing.hours,
        amount: existing.amount + amount,
        missingRate: existing.missingRate || missingRate,
      })
      row.total += amount
      row.hasMissingRate = row.hasMissingRate || missingRate
      row.entryIds.push(entry.id)
    }
    return Array.from(byCoach.values()).sort((a, b) => a.coachName.localeCompare(b.coachName))
  }, [entries, ratesByCoachProgram, coachingProgramId, oneVOneByCoach])

  const markPaid = async (row: CoachSummaryRow) => {
    setMarkingCoachId(row.coachId)
    try {
      const { error } = await supabaseClient
        .from('timesheet_entries')
        .update({ status: 'paid', paid_date: dayjs().format('YYYY-MM-DD') })
        .in('id', row.entryIds)
      if (error) {
        message.error(`Couldn't mark as paid: ${error.message}`)
        return
      }
      message.success(`Marked ${row.coachName} as paid`)
      query.refetch()
    } finally {
      setMarkingCoachId(null)
    }
  }

  const columns: ColumnsType<CoachSummaryRow> = useMemo(() => {
    const cols: ColumnsType<CoachSummaryRow> = [
      { title: 'Coach', dataIndex: 'coachName', fixed: 'left', width: 160 },
    ]
    for (const program of programColumns) {
      cols.push({
        title: program.name,
        children: [
          {
            title: 'Hours',
            width: 80,
            align: 'right',
            render: (_, row) => {
              const cell = row.byProgram.get(program.id)
              return cell?.hours != null ? cell.hours.toFixed(2) : '—'
            },
          },
          {
            title: '$',
            width: 100,
            align: 'right',
            render: (_, row) => {
              const cell = row.byProgram.get(program.id)
              if (!cell) return '—'
              return cell.missingRate ? <Tag color="red">No rate</Tag> : `$${cell.amount.toFixed(2)}`
            },
          },
        ],
      })
    }
    cols.push({
      title: 'Total',
      fixed: 'right',
      width: 110,
      align: 'right',
      render: (_, row) => `$${row.total.toFixed(2)}`,
    })
    if (statusFilter === 'pending') {
      cols.push({
        title: 'Actions',
        fixed: 'right',
        width: 150,
        render: (_, row) => (
          <Button
            size="small"
            type="primary"
            disabled={row.hasMissingRate}
            loading={markingCoachId === row.coachId}
            onClick={() => markPaid(row)}
          >
            Mark all paid
          </Button>
        ),
      })
    }
    return cols
  }, [programColumns, statusFilter, markingCoachId])

  return (
    <div>
      <Typography.Title level={3}>Payment Due</Typography.Title>
      <Typography.Paragraph type="secondary">
        Aggregated by coach, one Hours/$ column pair per program. A coach+program combination
        with no rate on file shows "No rate" instead of a silent $0 -- add the missing rate before
        marking that coach paid (the button disables until every cell resolves).
      </Typography.Paragraph>

      <Segmented
        style={{ marginBottom: 16 }}
        value={statusFilter}
        onChange={(value) => setStatusFilter(value as typeof statusFilter)}
        options={[
          { label: 'Pending', value: 'pending' },
          { label: 'Paid history', value: 'paid' },
        ]}
      />

      <Card size="small" loading={query.isLoading}>
        <Table<CoachSummaryRow>
          dataSource={summaryRows}
          columns={columns}
          rowKey="coachId"
          pagination={false}
          size="small"
          scroll={{ x: 'max-content' }}
          bordered
        />
      </Card>
    </div>
  )
}

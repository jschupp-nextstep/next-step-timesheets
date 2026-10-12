import { useMemo, useState } from 'react'
import { useList } from '@refinedev/core'
import { Alert, App, Button, Card, DatePicker, Segmented, Space, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'
import { Link } from 'react-router'

import { supabaseClient } from '../../utility/supabaseClient'
import { computeAmount, type OneVOneRateRow, type RateRow } from '../../utility/payroll'
import { useAppSettings } from '../../utility/appSettings'
import { formatRange, inRange, isPreCutoverExcluded, usePayrollRange } from '../../utility/payrollFilters'

type EntryRow = {
  id: string
  coach_id: string
  program_id: string
  entry_date: string
  hours: number | null
  flat_amount: number | null
  session_name: string | null
  status: 'pending' | 'paid'
  admin_entered: boolean
  coaches: { name: string } | null
  programs: { name: string; entry_mode: string } | null
}

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

export const PaymentDue = () => {
  const { message, modal } = App.useApp()
  const [statusFilter, setStatusFilter] = useState<'pending' | 'paid'>('pending')
  const [markingCoachId, setMarkingCoachId] = useState<string | null>(null)
  const [selectedPreCutoverIds, setSelectedPreCutoverIds] = useState<string[]>([])
  const [resolvingPreCutover, setResolvingPreCutover] = useState(false)

  const { cutoverDate, paidThroughDate, isLoading: settingsLoading, refetch: refetchSettings } = useAppSettings()
  const { range, setRange, queryString } = usePayrollRange(paidThroughDate, cutoverDate)

  // Pending: fetch every pending entry and partition client-side, so
  // entries outside the chosen range (or before cutover) can be counted and
  // surfaced rather than silently invisible. Paid history grows forever, so
  // that one is range-filtered server-side.
  const { result, query } = useList<EntryRow>({
    resource: 'timesheet_entries',
    meta: { select: '*, coaches(name), programs(name, entry_mode)' },
    filters:
      statusFilter === 'pending'
        ? [{ field: 'status', operator: 'eq', value: 'pending' }]
        : [
            { field: 'status', operator: 'eq', value: 'paid' },
            { field: 'entry_date', operator: 'gte', value: range[0].format('YYYY-MM-DD') },
            { field: 'entry_date', operator: 'lte', value: range[1].format('YYYY-MM-DD') },
          ],
    sorters: [{ field: 'entry_date', order: 'asc' }],
    pagination: { pageSize: 2000 },
    queryOptions: { enabled: !settingsLoading },
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

  const allEntries = result?.data ?? []

  const { entries, preCutover, beforeRange, afterRange } = useMemo(() => {
    const preCutover: EntryRow[] = []
    const beforeRange: EntryRow[] = []
    const afterRange: EntryRow[] = []
    const entries: EntryRow[] = []
    const start = range[0].format('YYYY-MM-DD')
    for (const entry of allEntries) {
      if (isPreCutoverExcluded(entry, cutoverDate)) preCutover.push(entry)
      else if (inRange(entry.entry_date, range)) entries.push(entry)
      else if (entry.entry_date < start) beforeRange.push(entry)
      else afterRange.push(entry)
    }
    return { entries, preCutover, beforeRange, afterRange }
  }, [allEntries, range, cutoverDate])

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

  // Once every payable entry in the range is paid, that range is done --
  // advance paid_through_date so next time Payment Due opens on the next
  // run. Never moves backwards, and never advances while anything in the
  // range is still unpaid (e.g. a coach held back for a missing rate),
  // since that coach's entries would otherwise fall out of the next
  // default range.
  const maybeAdvancePaidThrough = async (justPaidIds: string[]) => {
    const remaining = entries.filter((e) => !justPaidIds.includes(e.id))
    if (remaining.length > 0) return
    const end = range[1].format('YYYY-MM-DD')
    if (paidThroughDate && paidThroughDate >= end) return
    const { error } = await supabaseClient
      .from('app_settings')
      .update({ paid_through_date: end, updated_at: new Date().toISOString() })
      .eq('id', 1)
    if (error) {
      message.warning(`Paid, but couldn't update the paid-through date: ${error.message}`)
      return
    }
    message.info(`Everything through ${range[1].format('MMM D')} is paid -- that's now the paid-through date.`)
    refetchSettings()
  }

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
      await maybeAdvancePaidThrough(row.entryIds)
      query.refetch()
    } finally {
      setMarkingCoachId(null)
    }
  }

  const confirmMarkPaid = (row: CoachSummaryRow) => {
    modal.confirm({
      title: `Mark ${row.coachName} paid?`,
      content: `${row.entryIds.length} ${row.entryIds.length === 1 ? 'entry' : 'entries'} dated ${formatRange(range)}, totaling $${row.total.toFixed(2)}. Entries outside this range aren't affected.`,
      okText: 'Mark paid',
      onOk: () => markPaid(row),
    })
  }

  // One-time cutover cleanup: pending entries dated before cutover that a
  // coach (or, before 0015, anyone) logged here. Either they were already
  // paid in Sheets -- mark them paid so they can never be paid again -- or
  // they genuinely weren't, and an admin blesses them as payable here.
  const resolvePreCutover = async (action: 'paid_in_sheets' | 'pay_in_app') => {
    if (selectedPreCutoverIds.length === 0) return
    setResolvingPreCutover(true)
    try {
      const values =
        action === 'paid_in_sheets' ? { status: 'paid', paid_date: null } : { admin_entered: true }
      const { error } = await supabaseClient.from('timesheet_entries').update(values).in('id', selectedPreCutoverIds)
      if (error) {
        message.error(`Couldn't update: ${error.message}`)
        return
      }
      message.success(
        action === 'paid_in_sheets'
          ? `Marked ${selectedPreCutoverIds.length} as paid in the old system`
          : `${selectedPreCutoverIds.length} moved into Payment Due`,
      )
      setSelectedPreCutoverIds([])
      query.refetch()
    } finally {
      setResolvingPreCutover(false)
    }
  }

  const columns: ColumnsType<CoachSummaryRow> = (() => {
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
            onClick={() => confirmMarkPaid(row)}
          >
            Mark all paid
          </Button>
        ),
      })
    }
    return cols
  })()

  return (
    <div>
      <Typography.Title level={3}>Payment Due</Typography.Title>
      <Typography.Paragraph type="secondary">
        Aggregated by coach, one Hours/$ column pair per program, for the dates selected below. A
        coach+program combination with no rate on file shows "No rate" instead of a silent $0 -- add
        the missing rate before marking that coach paid (the button disables until every cell
        resolves).
      </Typography.Paragraph>

      <Space style={{ marginBottom: 16 }} wrap>
        <Segmented
          value={statusFilter}
          onChange={(value) => setStatusFilter(value as typeof statusFilter)}
          options={[
            { label: 'Pending', value: 'pending' },
            { label: 'Paid history', value: 'paid' },
          ]}
        />
        <DatePicker.RangePicker
          value={range}
          allowClear={false}
          onChange={(value) => {
            if (value?.[0] && value?.[1]) setRange([value[0], value[1]])
          }}
        />
        <Link to={`/zoho-export?${queryString}`}>Zoho export for these dates →</Link>
      </Space>

      {statusFilter === 'pending' && (
        <Typography.Paragraph type="secondary" style={{ marginTop: -8 }}>
          {paidThroughDate
            ? `Paid through ${dayjs(paidThroughDate).format('MMM D, YYYY')}.`
            : 'No payroll has been run in the app yet.'}{' '}
          {cutoverDate && `Cutover from the old system: ${dayjs(cutoverDate).format('MMM D, YYYY')}.`}
        </Typography.Paragraph>
      )}

      {statusFilter === 'pending' && beforeRange.length > 0 && (
        <Alert
          style={{ marginBottom: 16 }}
          type="warning"
          showIcon
          message={`${beforeRange.length} pending ${beforeRange.length === 1 ? 'entry is' : 'entries are'} dated before ${range[0].format('MMM D')} and not shown.`}
          description="Usually late logs or approved claims from an earlier period. They'll stay unpaid until the range includes them."
          action={
            <Button size="small" onClick={() => setRange([dayjs(beforeRange[0].entry_date), range[1]])}>
              Include them
            </Button>
          }
        />
      )}
      {statusFilter === 'pending' && afterRange.length > 0 && (
        <Alert
          style={{ marginBottom: 16 }}
          type="info"
          showIcon
          message={`${afterRange.length} pending ${afterRange.length === 1 ? 'entry is' : 'entries are'} dated after ${range[1].format('MMM D')} and not shown.`}
        />
      )}

      <Card size="small" loading={query.isLoading || settingsLoading}>
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

      {statusFilter === 'pending' && preCutover.length > 0 && (
        <Card
          size="small"
          style={{ marginTop: 16 }}
          title={`Pending entries dated before cutover (${preCutover.length})`}
          extra={
            <Space>
              <Button
                size="small"
                disabled={selectedPreCutoverIds.length === 0}
                loading={resolvingPreCutover}
                onClick={() => resolvePreCutover('paid_in_sheets')}
              >
                Paid in old system
              </Button>
              <Button
                size="small"
                disabled={selectedPreCutoverIds.length === 0}
                loading={resolvingPreCutover}
                onClick={() => resolvePreCutover('pay_in_app')}
              >
                Pay in app
              </Button>
            </Space>
          }
        >
          <Typography.Paragraph type="secondary">
            These are dated before {cutoverDate && dayjs(cutoverDate).format('MMM D, YYYY')}, when payroll still ran in
            Sheets, so they're left out of Payment Due and the Zoho export. Mark the ones Sheets already paid as{' '}
            <strong>Paid in old system</strong> (they'll never be payable here). Use <strong>Pay in app</strong> only for
            ones Sheets didn't pay.
          </Typography.Paragraph>
          <Table<EntryRow>
            dataSource={preCutover}
            rowKey="id"
            size="small"
            pagination={false}
            rowSelection={{
              selectedRowKeys: selectedPreCutoverIds,
              onChange: (keys) => setSelectedPreCutoverIds(keys as string[]),
            }}
          >
            <Table.Column dataIndex="entry_date" title="Date" width={110} />
            <Table.Column title="Coach" render={(_, row: EntryRow) => row.coaches?.name ?? '—'} />
            <Table.Column title="Program" render={(_, row: EntryRow) => row.programs?.name ?? '—'} />
            <Table.Column dataIndex="session_name" title="Session" render={(v) => v || '—'} />
            <Table.Column
              title="Hours / amount"
              render={(_, row: EntryRow) =>
                row.flat_amount != null ? `$${row.flat_amount.toFixed(2)}` : row.hours != null ? row.hours.toFixed(2) : '—'
              }
            />
          </Table>
        </Card>
      )}
    </div>
  )
}

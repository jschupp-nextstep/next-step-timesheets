import { useMemo, useState } from 'react'
import { useList } from '@refinedev/core'
import { Alert, App, Button, Card, DatePicker, Popconfirm, Segmented, Space, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'
import { Link } from 'react-router'

import { supabaseClient } from '../../utility/supabaseClient'
import { computeAmount, type OneVOneRateRow, type RateRow } from '../../utility/payroll'
import { useAppSettings } from '../../utility/appSettings'
import {
  formatRange,
  isPreCutoverExcluded,
  useHeldEventIds,
  partitionPendingEntries,
  usePayrollRange,
  type CutoverResolution,
} from '../../utility/payrollFilters'

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
  cutover_resolution: CutoverResolution | null
  event_id: string | null
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
  const [resolvingEntryId, setResolvingEntryId] = useState<string | null>(null)

  const { cutoverDate, paidThroughDate, isLoading: settingsLoading, refetch: refetchSettings } = useAppSettings()
  const { range, setRange, queryString } = usePayrollRange(paidThroughDate, cutoverDate)
  const { heldEventIds, isLoading: heldLoading, refetch: refetchHeld } = useHeldEventIds()

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

  // Paid history is already range-filtered server-side; only the pre-cutover
  // exclusion applies there.
  const { entries, held, preCutover, beforeRange, afterRange } = useMemo(() => {
    if (statusFilter === 'paid') {
      return {
        entries: allEntries.filter((e) => !isPreCutoverExcluded(e, cutoverDate)),
        held: [],
        preCutover: [],
        beforeRange: [],
        afterRange: [],
      }
    }
    const { payable, ...rest } = partitionPendingEntries(allEntries, range, cutoverDate, heldEventIds)
    return { entries: payable, ...rest }
  }, [allEntries, range, cutoverDate, statusFilter, heldEventIds])

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
    // Held entries count as unpaid in the range too -- advancing past them
    // would drop them out of the next default range.
    const remaining = entries.filter((e) => !justPaidIds.includes(e.id))
    if (remaining.length > 0 || held.length > 0) return
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
      let update = supabaseClient
        .from('timesheet_entries')
        .update({ status: 'paid', paid_date: dayjs().format('YYYY-MM-DD') })
        .in('id', row.entryIds)
        // Belt and braces: even if entryIds were somehow wrong, nothing
        // outside the selected range or already paid can be touched...
        .eq('status', 'pending')
        .gte('entry_date', range[0].format('YYYY-MM-DD'))
        .lte('entry_date', range[1].format('YYYY-MM-DD'))
      // ...nor anything on an event with a schedule change awaiting review.
      // Off-calendar entries (event_id NULL) stay eligible, hence is.null.
      if (heldEventIds.size > 0) {
        update = update.or(`event_id.is.null,event_id.not.in.(${[...heldEventIds].join(',')})`)
      }
      const { error } = await update
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

  // One-time cutover cleanup, decided entry by entry: some September
  // sessions were paid in Sheets, some never were. The trigger in 0016
  // rejects a resolution on any entry dated on/after cutover, and the
  // .lt() below means this update can't even match one.
  const resolvePreCutover = async (entry: EntryRow, resolution: CutoverResolution) => {
    if (!cutoverDate) return
    setResolvingEntryId(entry.id)
    try {
      const { data, error } = await supabaseClient
        .from('timesheet_entries')
        .update({ cutover_resolution: resolution })
        .eq('id', entry.id)
        .eq('status', 'pending')
        .lt('entry_date', cutoverDate)
        .select('id')
      if (error) {
        message.error(`Couldn't update: ${error.message}`)
        return
      }
      if (!data || data.length === 0) {
        message.warning('Nothing changed -- this entry is no longer a pending pre-cutover entry.')
      } else {
        message.success(
          resolution === 'paid_in_sheets'
            ? `${entry.coaches?.name ?? 'Entry'} ${entry.entry_date}: marked paid in Sheets`
            : `${entry.coaches?.name ?? 'Entry'} ${entry.entry_date}: still owed -- now payable here`,
        )
      }
      query.refetch()
    } finally {
      setResolvingEntryId(null)
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

      {statusFilter === 'pending' && held.length > 0 && (
        <Alert
          style={{ marginBottom: 16 }}
          type="warning"
          showIcon
          message={`${held.length} ${held.length === 1 ? 'entry is' : 'entries are'} held for schedule review and not included below.`}
          description={
            <>
              Their session had a scheduler change (a sub, removal, time change…) that hasn't been reviewed yet:{' '}
              {held
                .map((e) => `${e.coaches?.name ?? '?'} ${dayjs(e.entry_date).format('M/D')}`)
                .join(', ')}
              . Review it in <Link to="/reconciliation">Reconciliation → Schedule changes</Link>, and they'll appear here.
            </>
          }
          action={
            <Button size="small" onClick={() => refetchHeld()}>
              Refresh
            </Button>
          }
        />
      )}

      <Card size="small" loading={query.isLoading || settingsLoading || heldLoading}>
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
        <Card size="small" style={{ marginTop: 16 }} title={`Pending entries dated before cutover (${preCutover.length})`}>
          <Typography.Paragraph type="secondary">
            These are dated before {cutoverDate && dayjs(cutoverDate).format('MMM D, YYYY')}, when payroll still ran in
            Sheets, so they're left out of Payment Due and the Zoho export until you decide each one.{' '}
            <strong>Paid in Sheets</strong> records that Sheets paid it (never payable here).{' '}
            <strong>Still owed</strong> means Sheets never paid it -- it moves into Payment Due above.
          </Typography.Paragraph>
          <Table<EntryRow> dataSource={preCutover} rowKey="id" size="small" pagination={false}>
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
            <Table.Column
              title="Decision"
              width={220}
              render={(_, row: EntryRow) => (
                <Space>
                  <Popconfirm
                    title="Mark as paid in Sheets?"
                    description="It will never be payable in this app."
                    okText="Paid in Sheets"
                    onConfirm={() => resolvePreCutover(row, 'paid_in_sheets')}
                  >
                    <Button size="small" loading={resolvingEntryId === row.id}>
                      Paid in Sheets
                    </Button>
                  </Popconfirm>
                  <Popconfirm
                    title="Sheets never paid this?"
                    description="It moves into Payment Due to be paid here."
                    okText="Still owed"
                    onConfirm={() => resolvePreCutover(row, 'still_owed')}
                  >
                    <Button size="small" loading={resolvingEntryId === row.id}>
                      Still owed
                    </Button>
                  </Popconfirm>
                </Space>
              )}
            />
          </Table>
        </Card>
      )}
    </div>
  )
}

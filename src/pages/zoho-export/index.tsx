import { useMemo, useState } from 'react'
import { useList } from '@refinedev/core'
import { Alert, App, Button, Card, DatePicker, Space, Table, Typography } from 'antd'
import { Link } from 'react-router'
import dayjs, { type Dayjs } from 'dayjs'

import { computeAmount, type OneVOneRateRow, type RateRow } from '../../utility/payroll'

type EntryRow = {
  id: string
  coach_id: string
  program_id: string
  entry_date: string
  hours: number | null
  flat_amount: number | null
  notes: string | null
  status: 'pending' | 'paid'
  coaches: { name: string; pay_type: '1099' | 'w2' } | null
  programs: { name: string; entry_mode: string } | null
}
type ProgramRow = { id: string; name: string }

// Zoho account display strings, exact -- per the bookkeeping reference,
// a mismatch (including em dash vs hyphen, spacing, pluralization) either
// silently creates a new account in Zoho or fails the row, rather than
// erroring loudly. Kept as a static lookup rather than derived, so a
// renamed account in Zoho can't silently break the export. Reimbursements
// deliberately have no debit account here -- they're infrequent enough
// that categorizing them by hand in Zoho is preferable to guessing.
const ZOHO_ACCOUNTS = {
  coachLabor1099: 'Coach Labor — 1099 Contractors',
  payrollLiabilities: 'Payroll Liabilities',
}

type ZohoRow = {
  'Journal Date': string
  'Reference Number': string
  'Journal Number Prefix': string
  'Journal Number Suffix': string
  Notes: string
  'Journal Type': string
  Currency: string
  Account: string
  Description: string
  Debit: string
  Credit: string
  Status: string
}

const CSV_COLUMNS: (keyof ZohoRow)[] = [
  'Journal Date',
  'Reference Number',
  'Journal Number Prefix',
  'Journal Number Suffix',
  'Notes',
  'Journal Type',
  'Currency',
  'Account',
  'Description',
  'Debit',
  'Credit',
  'Status',
]

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function toCsv(rows: ZohoRow[]): string {
  const header = CSV_COLUMNS.join(',')
  const lines = rows.map((row) => CSV_COLUMNS.map((col) => csvEscape(row[col])).join(','))
  return [header, ...lines].join('\r\n')
}

function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export const ZohoExport = () => {
  const { message } = App.useApp()
  const [range, setRange] = useState<[Dayjs, Dayjs]>([
    dayjs().startOf('month'),
    dayjs().endOf('month'),
  ])

  const { result, query } = useList<EntryRow>({
    resource: 'timesheet_entries',
    meta: { select: '*, coaches(name, pay_type), programs(name, entry_mode)' },
    filters: [
      { field: 'status', operator: 'eq', value: 'pending' },
      { field: 'entry_date', operator: 'gte', value: range[0].format('YYYY-MM-DD') },
      { field: 'entry_date', operator: 'lte', value: range[1].format('YYYY-MM-DD') },
    ],
    pagination: { pageSize: 2000 },
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
  const { result: programsResult } = useList<ProgramRow>({ resource: 'programs', pagination: { pageSize: 100 } })

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

  const entries1099 = useMemo(
    () =>
      (result?.data ?? []).filter(
        (e) => e.coaches?.pay_type === '1099' && e.programs?.entry_mode !== 'reimbursement',
      ),
    [result?.data],
  )

  const reimbursementEntries = useMemo(
    () => (result?.data ?? []).filter((e) => e.programs?.entry_mode === 'reimbursement'),
    [result?.data],
  )
  const reimbursementTotal = useMemo(
    () => reimbursementEntries.reduce((sum, e) => sum + (e.flat_amount ?? 0), 0),
    [reimbursementEntries],
  )

  const computed = useMemo(
    () =>
      entries1099.map((entry) => ({
        entry,
        ...computeAmount(entry, ratesByCoachProgram, coachingProgramId, oneVOneByCoach),
      })),
    [entries1099, ratesByCoachProgram, coachingProgramId, oneVOneByCoach],
  )

  const included = computed.filter((c) => !c.missingRate)
  const flagged = computed.filter((c) => c.missingRate)
  const total = included.reduce((sum, c) => sum + c.amount, 0)

  // Per-coach breakdown shown on screen for review -- Zoho itself only
  // gets the pooled total (per the bookkeeping reference, individual 1099
  // coach names aren't broken out there; this app is the detail record).
  const byCoach = useMemo(() => {
    const map = new Map<string, { coachName: string; amount: number; count: number }>()
    for (const { entry, amount, missingRate } of computed) {
      if (missingRate) continue
      const key = entry.coach_id
      const existing = map.get(key) ?? { coachName: entry.coaches?.name ?? 'Unknown', amount: 0, count: 0 }
      existing.amount += amount
      existing.count += 1
      map.set(key, existing)
    }
    return Array.from(map.values()).sort((a, b) => a.coachName.localeCompare(b.coachName))
  }, [computed])

  // Both journal entries below can be generated for the same date range, so
  // each needs its own suffix -- 01 for coach labor, 02 for reimbursements
  // -- to avoid two entries landing on the same JE-PAY-<suffix> number.
  const monthCode = range[0].format('YYYYMM')
  const suffix = `${monthCode}01`
  const reimbursementSuffix = `${monthCode}02`
  const rangeLabel = `${range[0].format('MMM D, YYYY')} – ${range[1].format('MMM D, YYYY')}`

  const generate = () => {
    if (included.length === 0 && reimbursementEntries.length === 0) {
      message.warning('Nothing to export -- no eligible entries in this range.')
      return
    }
    const journalDate = range[1].format('YYYY-MM-DD')
    const rows: ZohoRow[] = []

    if (included.length > 0) {
      const shared = {
        'Journal Date': journalDate,
        'Reference Number': `1099 Coach Pay — ${range[0].format('MMM YYYY')}`,
        'Journal Number Prefix': 'JE-PAY-',
        'Journal Number Suffix': suffix,
        Notes: `Aggregate 1099 coach labor for ${rangeLabel}, generated from Next Step Timesheets.`,
        'Journal Type': 'both',
        Currency: 'USD',
        Status: 'published',
      }
      rows.push(
        {
          ...shared,
          Account: ZOHO_ACCOUNTS.coachLabor1099,
          Description: `1099 coach labor — ${rangeLabel}`,
          Debit: total.toFixed(2),
          Credit: '',
        },
        {
          ...shared,
          Account: ZOHO_ACCOUNTS.payrollLiabilities,
          Description: `Coach pay clearing — ${rangeLabel}`,
          Debit: '',
          Credit: total.toFixed(2),
        },
      )
    }

    if (reimbursementEntries.length > 0) {
      const shared = {
        'Journal Date': journalDate,
        'Reference Number': `Reimbursements — ${range[0].format('MMM YYYY')}`,
        'Journal Number Prefix': 'JE-PAY-',
        'Journal Number Suffix': reimbursementSuffix,
        Notes: `Coach/staff reimbursements for ${rangeLabel}, generated from Next Step Timesheets. Debit account intentionally left blank -- Zoho's import will flag these rows to assign by hand.`,
        'Journal Type': 'both',
        Currency: 'USD',
        Status: 'published',
      }
      rows.push(
        {
          ...shared,
          Account: '',
          Description: `Reimbursements — ${rangeLabel}`,
          Debit: reimbursementTotal.toFixed(2),
          Credit: '',
        },
        {
          ...shared,
          Account: ZOHO_ACCOUNTS.payrollLiabilities,
          Description: `Reimbursement clearing — ${rangeLabel}`,
          Debit: '',
          Credit: reimbursementTotal.toFixed(2),
        },
      )
    }

    const now = dayjs().format('YYYY-MM-DD_HHmmss')
    downloadCsv(`zoho-journal-${monthCode}-${now}.csv`, toCsv(rows))
    message.success(
      reimbursementEntries.length > 0
        ? 'CSV downloaded -- Zoho will flag the reimbursement rows for you to assign an account.'
        : 'CSV downloaded',
    )
  }

  return (
    <div>
      <Typography.Title level={3}>Zoho Books Export — 1099 Coach Pay</Typography.Title>
      <Typography.Paragraph type="secondary">
        Builds one balanced journal entry for the pooled 1099 coach labor total in the selected
        range: a debit to "{ZOHO_ACCOUNTS.coachLabor1099}" and an offsetting credit to "
        {ZOHO_ACCOUNTS.payrollLiabilities}" (a clearing liability until the real Stripe/Paychex
        entry is recorded separately from bank statements, same as today). This app only knows
        the coach-labor side -- it doesn't attempt to generate the Stripe topup or fee lines.
      </Typography.Paragraph>

      <Space style={{ marginBottom: 16 }}>
        <DatePicker.RangePicker
          value={range}
          onChange={(value) => value?.[0] && value[1] && setRange([value[0], value[1]])}
          allowClear={false}
        />
      </Space>

      {flagged.length > 0 && (
        <Alert
          style={{ marginBottom: 16 }}
          type="warning"
          showIcon
          message={`${flagged.length} entr${flagged.length === 1 ? 'y is' : 'ies are'} missing a rate and excluded from this export`}
          description={
            <Table
              dataSource={flagged}
              rowKey={(row) => row.entry.id}
              pagination={false}
              size="small"
              style={{ marginTop: 8 }}
            >
              <Table.Column dataIndex={['entry', 'entry_date']} title="Date" width={110} />
              <Table.Column title="Coach" render={(_, row: (typeof flagged)[number]) => row.entry.coaches?.name ?? '—'} />
              <Table.Column title="Program" render={(_, row: (typeof flagged)[number]) => row.entry.programs?.name ?? '—'} />
              <Table.Column
                title="Fix"
                render={(_, row: (typeof flagged)[number]) => {
                  const isFlat = row.entry.programs?.entry_mode === 'direct_flat'
                  // Opens in a new tab deliberately -- fixing a rate shouldn't
                  // lose the export's current date range/preview state.
                  const to = isFlat
                    ? `/one-v-one-rates/create?coach_id=${row.entry.coach_id}`
                    : `/rates/create?coach_id=${row.entry.coach_id}&program_id=${row.entry.program_id}`
                  return (
                    <Link to={to} target="_blank" rel="noopener noreferrer">
                      Add rate
                    </Link>
                  )
                }}
              />
            </Table>
          }
        />
      )}

      <Card title="Preview" size="small" loading={query.isLoading}>
        <Table
          dataSource={byCoach}
          rowKey="coachName"
          pagination={false}
          size="small"
          summary={() => (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0}>
                <strong>Total</strong>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={1} />
              <Table.Summary.Cell index={2} align="right">
                <strong>${total.toFixed(2)}</strong>
              </Table.Summary.Cell>
            </Table.Summary.Row>
          )}
        >
          <Table.Column dataIndex="coachName" title="Coach" />
          <Table.Column dataIndex="count" title="Entries" width={90} align="right" />
          <Table.Column
            title="Amount"
            width={110}
            align="right"
            render={(_, row: (typeof byCoach)[number]) => `$${row.amount.toFixed(2)}`}
          />
        </Table>

        <Space style={{ marginTop: 16 }}>
          <Button
            type="primary"
            disabled={included.length === 0 && reimbursementEntries.length === 0}
            onClick={generate}
          >
            Download Zoho CSV
          </Button>
        </Space>
        <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
          After confirming this imports cleanly into Zoho Books, go mark these entries paid on the
          Payment Due page -- this screen only generates the export, it doesn't change any entry's
          status itself.
        </Typography.Paragraph>
      </Card>

      {reimbursementEntries.length > 0 && (
        <Card title="Reimbursements" size="small" style={{ marginTop: 16 }} loading={query.isLoading}>
          <Typography.Paragraph type="secondary">
            Not coach labor -- included in the same CSV above as a separate journal entry with the
            debit account left blank. Zoho's import will flag those rows so you can assign an
            account to each by hand.
          </Typography.Paragraph>
          <Table
            dataSource={reimbursementEntries}
            rowKey="id"
            pagination={false}
            size="small"
            summary={() => (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0}>
                  <strong>Total</strong>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={1} />
                <Table.Summary.Cell index={2} align="right">
                  <strong>${reimbursementTotal.toFixed(2)}</strong>
                </Table.Summary.Cell>
              </Table.Summary.Row>
            )}
          >
            <Table.Column dataIndex="entry_date" title="Date" width={110} />
            <Table.Column title="Coach" render={(_, row: EntryRow) => row.coaches?.name ?? '—'} />
            <Table.Column title="What for" render={(_, row: EntryRow) => row.notes || '—'} />
            <Table.Column
              title="Amount"
              width={110}
              align="right"
              render={(_, row: EntryRow) => `$${(row.flat_amount ?? 0).toFixed(2)}`}
            />
          </Table>
        </Card>
      )}
    </div>
  )
}

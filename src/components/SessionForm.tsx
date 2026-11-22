import { useEffect, useMemo } from 'react'
import { useList } from '@refinedev/core'
import {
  Alert,
  Button,
  Checkbox,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Radio,
  Select,
  Space,
  Switch,
  TimePicker,
  Typography,
} from 'antd'
import type { DefaultOptionType } from 'antd/es/select'
import dayjs, { type Dayjs } from 'dayjs'

import { useScheduleAction } from '../utility/scheduleActions'
import { MAX_SERIES_SESSIONS, seriesDates, WEEKDAY_OPTIONS } from '../utility/sessionSeries'
import { staffPickerOptions, type StaffType } from '../utility/staffType'

// Phase 9 step 2: one form for a single session or a weekday series, used by
// admins (Create Event) and schedulers (New session). Everything is created
// by schedule_create_sessions (0036), which checks permission and logs it.

type IdName = { id: string; name: string }
type FieldRow = { id: string; name: string; location_id: string; is_active: boolean }
type TeamRow = { sprocket_team_id: string; name: string; program_id: string | null; is_default: boolean }
type DirectoryRow = IdName & { is_active: boolean; staff_type?: StaffType }

type EventType = 'practice' | 'game' | 'club' | 'other'

type Values = {
  program_id?: string
  location_id?: string
  event_type: EventType
  session_name?: string
  opponent?: string
  away_game: boolean
  first_date?: Dayjs
  repeat: 'once' | 'weekly'
  weekdays: number[]
  last_date?: Dayjs
  skip_dates?: Dayjs[]
  start?: Dayjs
  end?: Dayjs
  arrival_minutes?: number
  field_id?: string
  team_ids: string[]
  is_private: boolean
  uniform?: string
  notes?: string
  coach_ids: string[]
  reason?: string
}

const TYPE_OPTIONS = [
  { label: 'Practice', value: 'practice' },
  { label: 'Game', value: 'game' },
  { label: 'Club', value: 'club' },
  { label: 'Other', value: 'other' },
]

export const SessionForm = ({
  role,
  programs,
  locationsFor,
  onCreated,
  onCancel,
}: {
  role: 'admin' | 'scheduler'
  // Programs this person may create sessions for.
  programs: IdName[]
  // Locations they may use for a program (schedulers: their rules).
  locationsFor: (programId: string | undefined) => IdName[]
  onCreated: (count: number) => void
  onCancel?: () => void
}) => {
  const [form] = Form.useForm<Values>()
  const { run, running } = useScheduleAction()

  const { result: fieldsResult } = useList<FieldRow>({
    resource: 'fields',
    filters: [{ field: 'is_active', operator: 'eq', value: true }],
    sorters: [{ field: 'name', order: 'asc' }],
    pagination: { pageSize: 500 },
  })
  const { result: teamsResult } = useList<TeamRow>({
    resource: 'sprocket_teams',
    meta: { select: 'sprocket_team_id, name, program_id, is_default' },
    filters: [{ field: 'is_active', operator: 'eq', value: true }],
    sorters: [{ field: 'name', order: 'asc' }],
    pagination: { pageSize: 1000 },
  })
  const { result: directoryResult } = useList<DirectoryRow>({
    resource: 'coach_directory',
    filters: [{ field: 'is_active', operator: 'eq', value: true }],
    sorters: [{ field: 'name', order: 'asc' }],
    pagination: { pageSize: 500 },
  })

  const programId = Form.useWatch('program_id', form)
  const locationId = Form.useWatch('location_id', form)
  const eventType = Form.useWatch('event_type', form) ?? 'practice'
  const repeat = Form.useWatch('repeat', form) ?? 'once'
  const firstDate = Form.useWatch('first_date', form)
  const lastDate = Form.useWatch('last_date', form)
  const weekdays = Form.useWatch('weekdays', form)
  const skipDates = Form.useWatch('skip_dates', form)
  const reason = Form.useWatch('reason', form)

  const teams = useMemo(() => teamsResult?.data ?? [], [teamsResult?.data])
  const locationOptions = locationsFor(programId)
  const fieldsHere = (fieldsResult?.data ?? []).filter((f) => f.location_id === locationId)

  // A new program brings its default Sprocket teams (AP: the three groups).
  useEffect(() => {
    form.setFieldValue(
      'team_ids',
      teams.filter((t) => t.program_id === programId && t.is_default).map((t) => t.sprocket_team_id),
    )
  }, [programId, teams, form])

  // Weekly starts on the first date's weekday.
  useEffect(() => {
    if (repeat === 'weekly' && firstDate && !(form.getFieldValue('weekdays') ?? []).length) {
      form.setFieldValue('weekdays', [firstDate.day()])
    }
  }, [repeat, firstDate, form])

  const series = useMemo(
    () =>
      seriesDates({
        firstDate: firstDate?.format('YYYY-MM-DD') ?? '',
        lastDate: repeat === 'weekly' ? (lastDate?.format('YYYY-MM-DD') ?? '') || null : null,
        weekdays: weekdays ?? [],
        skipDates: (skipDates ?? []).map((d) => d.format('YYYY-MM-DD')),
      }),
    [firstDate, lastDate, repeat, weekdays, skipDates],
  )
  const weeklyIncomplete = repeat === 'weekly' && (!lastDate || !(weekdays ?? []).length)

  // Teams for this program first, then everything else.
  const teamOptions = useMemo((): DefaultOptionType[] => {
    const own = teams.filter((t) => t.program_id === programId)
    const other = teams.filter((t) => t.program_id !== programId)
    const opt = (t: TeamRow) => ({ label: t.name, value: t.sprocket_team_id })
    return own.length && other.length
      ? [
          { label: 'This program', options: own.map(opt) },
          { label: 'Other teams', options: other.map(opt) },
        ]
      : teams.map(opt)
  }, [teams, programId])

  const submit = async () => {
    const v = await form.validateFields()
    if (!series.dates.length || series.tooMany || weeklyIncomplete) return
    const isGame = v.event_type === 'game'
    const ok = await run(
      'schedule_create_sessions',
      {
        p_program_id: v.program_id,
        p_location_id: v.location_id,
        p_dates: series.dates,
        p_start: v.start?.format('HH:mm:ss') ?? null,
        p_end: v.end?.format('HH:mm:ss') ?? null,
        p_session_name: v.session_name ?? '',
        p_coach_ids: v.coach_ids ?? [],
        p_reason: v.reason ?? '',
        p_details: {
          event_type: v.event_type,
          opponent: isGame ? (v.opponent ?? null) : null,
          away_game: isGame && !!v.away_game,
          uniform: v.uniform ?? null,
          is_private: !!v.is_private,
          arrival_minutes: v.arrival_minutes ?? null,
          field_id: v.field_id ?? null,
          notes: v.notes ?? null,
          ...(v.event_type === 'club' ? {} : { team_ids: v.team_ids ?? [] }),
          ...(series.dates.length > 1
            ? {
                series: {
                  weekdays: v.weekdays,
                  first_date: v.first_date?.format('YYYY-MM-DD'),
                  last_date: v.last_date?.format('YYYY-MM-DD'),
                  skip_dates: (v.skip_dates ?? []).map((d) => d.format('YYYY-MM-DD')),
                },
              }
            : {}),
        },
      },
      series.dates.length === 1 ? 'Session created' : `${series.dates.length} sessions created`,
    )
    if (ok) {
      const count = series.dates.length
      form.resetFields()
      onCreated(count)
    }
  }

  const previewLabel = (d: string) => dayjs(d).format('ddd M/D')

  return (
    <Form
      form={form}
      layout="vertical"
      initialValues={{ event_type: 'practice', repeat: 'once', weekdays: [], away_game: false, is_private: false, coach_ids: [], team_ids: [] }}
    >
      <Form.Item label="Program" name="program_id" rules={[{ required: true, message: 'Pick a program' }]}>
        <Select
          showSearch
          optionFilterProp="label"
          placeholder="Program"
          options={programs.map((p) => ({ label: p.name, value: p.id }))}
          onChange={() => form.setFieldsValue({ location_id: undefined, field_id: undefined })}
        />
      </Form.Item>
      <Form.Item label="Location" name="location_id" rules={[{ required: true, message: 'Pick a location' }]}>
        <Select
          showSearch
          optionFilterProp="label"
          placeholder={programId ? 'Location' : 'Pick a program first'}
          disabled={!programId}
          options={locationOptions.map((l) => ({ label: l.name, value: l.id }))}
          onChange={() => form.setFieldValue('field_id', undefined)}
        />
      </Form.Item>
      {fieldsHere.length > 0 && (
        <Form.Item label="Field (optional)" name="field_id">
          <Select allowClear placeholder="Any field" options={fieldsHere.map((f) => ({ label: f.name, value: f.id }))} />
        </Form.Item>
      )}

      <Form.Item label="Type" name="event_type">
        <Radio.Group optionType="button" options={TYPE_OPTIONS} />
      </Form.Item>
      {eventType === 'game' && (
        <Space wrap align="start">
          <Form.Item label="Opponent" name="opponent">
            <Input style={{ width: 240 }} />
          </Form.Item>
          <Form.Item label="Away game" name="away_game" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item label="Uniform" name="uniform">
            <Input style={{ width: 140 }} placeholder="e.g. Blue" />
          </Form.Item>
        </Space>
      )}
      <Form.Item
        label="Session name"
        name="session_name"
        extra="What coaches see, and the Title in Sprocket (e.g. Annual Program, Futsal Session)."
      >
        <Input />
      </Form.Item>

      <Form.Item label="Date" name="first_date" rules={[{ required: true, message: 'Pick a date' }]}>
        <DatePicker format="ddd M/D/YYYY" style={{ width: 220 }} />
      </Form.Item>
      <Form.Item label="Repeat" name="repeat">
        <Radio.Group
          optionType="button"
          options={[
            { label: 'Just this date', value: 'once' },
            { label: 'Weekly', value: 'weekly' },
          ]}
        />
      </Form.Item>
      {repeat === 'weekly' && (
        <>
          <Form.Item label="On" name="weekdays" rules={[{ required: true, type: 'array', min: 1, message: 'Pick at least one day' }]}>
            <Checkbox.Group options={WEEKDAY_OPTIONS} />
          </Form.Item>
          <Form.Item label="Until (last date)" name="last_date" rules={[{ required: true, message: 'Pick the last date' }]}>
            <DatePicker
              format="ddd M/D/YYYY"
              style={{ width: 220 }}
              disabledDate={(d) => !!firstDate && d.isBefore(firstDate, 'day')}
            />
          </Form.Item>
          <Form.Item label="Skip dates (optional)" name="skip_dates" extra="Holidays, vacation weeks -- no session on these.">
            <DatePicker multiple format="M/D" style={{ width: '100%' }} />
          </Form.Item>
        </>
      )}

      <Space wrap align="start">
        <Form.Item label="Start" name="start">
          <TimePicker format="h:mm A" minuteStep={5} use12Hours />
        </Form.Item>
        <Form.Item
          label="End"
          name="end"
          dependencies={['start']}
          rules={[
            ({ getFieldValue }) => ({
              validator: (_, value?: Dayjs) => {
                const start = getFieldValue('start') as Dayjs | undefined
                if (!start && !value) return Promise.resolve()
                if (!start || !value) return Promise.reject(new Error('Set both start and end, or neither'))
                return value.isAfter(start) ? Promise.resolve() : Promise.reject(new Error('End has to be after start'))
              },
            }),
          ]}
        >
          <TimePicker format="h:mm A" minuteStep={5} use12Hours />
        </Form.Item>
        <Form.Item
          label="Arrive (min before start)"
          name="arrival_minutes"
          extra={eventType === 'game' ? 'A game is paid from arrival (warm-up).' : 'For Sprocket; not paid time.'}
        >
          <InputNumber min={1} max={240} step={5} style={{ width: 160 }} />
        </Form.Item>
      </Space>

      {eventType === 'club' ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="A Club session goes to Sprocket as one Club row (no program or team) -- like the futsal series."
        />
      ) : (
        <Form.Item
          label="Sprocket teams"
          name="team_ids"
          extra="One Sprocket row per team, with the coaches in Notes. Filled with the program's default teams."
        >
          <Select mode="multiple" showSearch optionFilterProp="label" placeholder="No teams" options={teamOptions} />
        </Form.Item>
      )}

      <Form.Item label="Coaches (optional)" name="coach_ids" extra="Assigned to every date.">
        <Select
          mode="multiple"
          showSearch
          optionFilterProp="label"
          placeholder="No one yet"
          options={staffPickerOptions(directoryResult?.data ?? [])}
        />
      </Form.Item>
      <Space wrap align="start">
        <Form.Item label="Private in Sprocket" name="is_private" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Space>
      <Form.Item label="Notes (optional)" name="notes">
        <Input.TextArea rows={2} />
      </Form.Item>
      <Form.Item
        label="Reason"
        name="reason"
        rules={role === 'scheduler' ? [{ required: true, whitespace: true, message: 'Say why -- payroll sees it on review' }] : []}
        extra={role === 'scheduler' ? 'Shown to payroll when they review it.' : 'Optional -- recorded in each session’s history.'}
      >
        <Input placeholder={role === 'admin' ? 'Scheduled' : 'e.g. Winter season schedule'} />
      </Form.Item>

      {firstDate && !weeklyIncomplete && (
        <Alert
          style={{ marginBottom: 16 }}
          type={series.tooMany || !series.dates.length ? 'error' : 'info'}
          showIcon
          message={
            series.tooMany
              ? `That's ${series.dates.length} sessions -- the most at once is ${MAX_SERIES_SESSIONS}. Shorten the range.`
              : series.dates.length === 0
                ? 'No dates match -- check the days and the range.'
                : `Creates ${series.dates.length} session${series.dates.length === 1 ? '' : 's'}`
          }
          description={
            series.dates.length > 0 && !series.tooMany ? (
              <>
                <Typography.Text>{series.dates.map(previewLabel).join(' · ')}</Typography.Text>
                {series.unusedSkips.length > 0 && (
                  <div>
                    <Typography.Text type="warning">
                      Skip date(s) {series.unusedSkips.map((d) => dayjs(d).format('M/D')).join(', ')} weren't going to be
                      a session anyway (wrong day or outside the range).
                    </Typography.Text>
                  </div>
                )}
              </>
            ) : undefined
          }
        />
      )}

      <Space>
        <Button
          type="primary"
          loading={running}
          disabled={!series.dates.length || series.tooMany || weeklyIncomplete || (role === 'scheduler' && !reason?.trim())}
          onClick={submit}
        >
          {series.dates.length > 1 ? `Create ${series.dates.length} sessions` : 'Create session'}
        </Button>
        {onCancel && <Button onClick={onCancel}>Cancel</Button>}
      </Space>
    </Form>
  )
}

import { Typography } from 'antd'
import {
  AuditOutlined,
  CalendarOutlined,
  CloudUploadOutlined,
  DollarOutlined,
  EnvironmentOutlined,
  ExportOutlined,
  FieldTimeOutlined,
  FileTextOutlined,
  ImportOutlined,
  ScheduleOutlined,
  SettingOutlined,
  TagsOutlined,
  TeamOutlined,
  UserSwitchOutlined,
  WalletOutlined,
  CarryOutOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { TileGrid, type TileSection } from '../../components/TileGrid'

// Admin landing page (Justin, 2026-10-16): one tile per screen, grouped by
// the job it's part of, instead of landing on the Coaches list.
const SECTIONS: TileSection[] = [
  {
    title: 'Payroll',
    tiles: [
      {
        to: '/payment-due',
        title: 'Payment Due',
        description: 'What each coach is owed for a date range. Mark entries paid, pay weekly coaches, add adjustments.',
        icon: <DollarOutlined />,
      },
      {
        to: '/reconciliation',
        title: 'Reconciliation',
        description: 'Review schedule changes, payment claims, swap requests, 1v1 oversight, and possible double pay.',
        icon: <AuditOutlined />,
      },
      {
        to: '/zoho-export',
        title: 'Zoho Export',
        description: 'Download the Zoho Books CSV for a payroll run.',
        icon: <ExportOutlined />,
      },
      {
        to: '/entries',
        title: 'Timesheet Entries',
        description: 'Every logged session. Edit, add one by hand, or put an entry on hold with a question.',
        icon: <FileTextOutlined />,
      },
    ],
  },
  {
    title: 'Schedule',
    tiles: [
      {
        to: '/schedule-board',
        title: 'Schedule Board',
        description: 'The week at a glance. Assign coaches, sub, change times, cancel a session or a whole day.',
        icon: <ScheduleOutlined />,
      },
      {
        to: '/events',
        title: 'Events',
        description: 'The list of every session. Create one (or a weekly series) and edit details.',
        icon: <CalendarOutlined />,
      },
      {
        to: '/sprocket-import',
        title: 'Import Calendar',
        description: "Upload a Sprocket export. New sessions are added; ones already imported update from Sprocket's changes.",
        icon: <CloudUploadOutlined />,
      },
      {
        to: '/bulk-import',
        title: 'Bulk Import Events',
        description: "Add many sessions at once from this app's own CSV format, coaches included.",
        icon: <ImportOutlined />,
      },
    ],
  },
  {
    title: 'People & rates',
    tiles: [
      {
        to: '/coaches',
        title: 'Coaches',
        description: 'The roster: names, login emails, 1099/W-2, active or not.',
        icon: <TeamOutlined />,
      },
      {
        to: '/rates',
        title: 'Rates',
        description: "Each coach's hourly rate per program, with history. Change a rate from a date forward.",
        icon: <WalletOutlined />,
      },
      {
        to: '/weekly-rates',
        title: 'Weekly Rates',
        description: 'Coaches paid a set amount per week instead of by the hour.',
        icon: <CarryOutOutlined />,
      },
      {
        to: '/one-v-one-rates',
        title: '1v1 Rates',
        description: 'Per-session fees for 1v1 training, plus oversight coach and fee.',
        icon: <UserOutlined />,
      },
      {
        to: '/schedulers',
        title: 'Schedulers',
        description: 'People who manage part of the schedule, and which programs, locations, or coaches they cover.',
        icon: <UserSwitchOutlined />,
      },
    ],
  },
  {
    title: 'Setup',
    tiles: [
      {
        to: '/programs',
        title: 'Programs',
        description: 'Program types, how coaches log them, and paid time before the start (e.g. AP +15 min).',
        icon: <TagsOutlined />,
      },
      {
        to: '/locations',
        title: 'Locations',
        description: 'Fields and sites. Camp/Nurse locations carry their fixed half/full-day hours.',
        icon: <EnvironmentOutlined />,
      },
      {
        to: '/pay-periods',
        title: 'Pay Periods',
        description: 'Two-week periods that set how far back coaches can log on their own.',
        icon: <FieldTimeOutlined />,
      },
      {
        to: '/settings',
        title: 'Settings',
        description: 'Cutover date and the date payroll is paid through.',
        icon: <SettingOutlined />,
      },
    ],
  },
]

export const Home = () => (
  <div>
    <Typography.Title level={3} style={{ marginTop: 0 }}>
      Next Step Timesheets
    </Typography.Title>
    <TileGrid sections={SECTIONS} />
  </div>
)

import { Suspense, lazy, useEffect, useState } from 'react'
import { Authenticated, Refine, useGetIdentity } from '@refinedev/core'
import { ErrorComponent, ThemedLayout, useNotificationProvider } from '@refinedev/antd'
import { dataProvider } from '@refinedev/supabase'
import routerBindings, { DocumentTitleHandler, NavigateToResource } from '@refinedev/react-router'
import { HashRouter, Navigate, Outlet, Route, Routes } from 'react-router'
import { Alert, App as AntdApp, Button, ConfigProvider, Spin } from 'antd'

import '@refinedev/antd/dist/reset.css'

import { supabaseClient } from './utility/supabaseClient'
import { authProvider, type Identity } from './providers/authProvider'
import { decodeJwtPayload } from './utility/decodeJwt'
import { useVersionCheck } from './utility/useVersionCheck'
import { ErrorBoundary } from './ErrorBoundary'
import { CoachLayout } from './components/CoachLayout'

import { Login } from './pages/auth/Login'
import { UpdatePassword } from './pages/auth/UpdatePassword'
import { ForgotPassword } from './pages/auth/ForgotPassword'

const CoachList = lazy(() => import('./pages/coaches/list').then((m) => ({ default: m.CoachList })))
const CoachCreate = lazy(() => import('./pages/coaches/create').then((m) => ({ default: m.CoachCreate })))
const CoachEdit = lazy(() => import('./pages/coaches/edit').then((m) => ({ default: m.CoachEdit })))
const ProgramList = lazy(() => import('./pages/programs/list').then((m) => ({ default: m.ProgramList })))
const ProgramCreate = lazy(() => import('./pages/programs/create').then((m) => ({ default: m.ProgramCreate })))
const ProgramEdit = lazy(() => import('./pages/programs/edit').then((m) => ({ default: m.ProgramEdit })))
const LocationList = lazy(() => import('./pages/locations/list').then((m) => ({ default: m.LocationList })))
const LocationCreate = lazy(() =>
  import('./pages/locations/create').then((m) => ({ default: m.LocationCreate })),
)
const LocationEdit = lazy(() => import('./pages/locations/edit').then((m) => ({ default: m.LocationEdit })))
const RateList = lazy(() => import('./pages/rates/list').then((m) => ({ default: m.RateList })))
const RateCreate = lazy(() => import('./pages/rates/create').then((m) => ({ default: m.RateCreate })))
const RateEdit = lazy(() => import('./pages/rates/edit').then((m) => ({ default: m.RateEdit })))
const OneVOneRateList = lazy(() =>
  import('./pages/one-v-one-rates/list').then((m) => ({ default: m.OneVOneRateList })),
)
const OneVOneRateCreate = lazy(() =>
  import('./pages/one-v-one-rates/create').then((m) => ({ default: m.OneVOneRateCreate })),
)
const OneVOneRateEdit = lazy(() =>
  import('./pages/one-v-one-rates/edit').then((m) => ({ default: m.OneVOneRateEdit })),
)
const EventList = lazy(() => import('./pages/events/list').then((m) => ({ default: m.EventList })))
const EventCreate = lazy(() => import('./pages/events/create').then((m) => ({ default: m.EventCreate })))
const EventEdit = lazy(() => import('./pages/events/edit').then((m) => ({ default: m.EventEdit })))
const EntryList = lazy(() => import('./pages/entries/list').then((m) => ({ default: m.EntryList })))
const EntryEdit = lazy(() => import('./pages/entries/edit').then((m) => ({ default: m.EntryEdit })))

const SprocketImport = lazy(() =>
  import('./pages/sprocket-import').then((m) => ({ default: m.SprocketImport })),
)
const Reconciliation = lazy(() =>
  import('./pages/reconciliation').then((m) => ({ default: m.Reconciliation })),
)
const PaymentDue = lazy(() =>
  import('./pages/payment-due').then((m) => ({ default: m.PaymentDue })),
)
const ZohoExport = lazy(() =>
  import('./pages/zoho-export').then((m) => ({ default: m.ZohoExport })),
)

const LogSession = lazy(() =>
  import('./pages/coach/log-session').then((m) => ({ default: m.LogSession })),
)
const MySessions = lazy(() =>
  import('./pages/coach/my-sessions').then((m) => ({ default: m.MySessions })),
)

const PageLoading = () => (
  <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
    <Spin size="large" />
  </div>
)

const UpdateBanner = () => {
  const updateAvailable = useVersionCheck()
  if (!updateAvailable) return null
  return (
    <Alert
      banner
      type="info"
      showIcon
      message="A new version of this app is available."
      action={
        <Button size="small" type="primary" onClick={() => window.location.reload()}>
          Reload
        </Button>
      }
      style={{ position: 'sticky', top: 0, zIndex: 1000 }}
    />
  )
}

const AdminRoutes = () => (
  <ThemedLayout>
    <Routes>
      <Route index element={<NavigateToResource resource="coaches" />} />
      <Route path="/coaches">
        <Route index element={<CoachList />} />
        <Route path="create" element={<CoachCreate />} />
        <Route path="edit/:id" element={<CoachEdit />} />
      </Route>
      <Route path="/programs">
        <Route index element={<ProgramList />} />
        <Route path="create" element={<ProgramCreate />} />
        <Route path="edit/:id" element={<ProgramEdit />} />
      </Route>
      <Route path="/locations">
        <Route index element={<LocationList />} />
        <Route path="create" element={<LocationCreate />} />
        <Route path="edit/:id" element={<LocationEdit />} />
      </Route>
      <Route path="/rates">
        <Route index element={<RateList />} />
        <Route path="create" element={<RateCreate />} />
        <Route path="edit/:id" element={<RateEdit />} />
      </Route>
      <Route path="/one-v-one-rates">
        <Route index element={<OneVOneRateList />} />
        <Route path="create" element={<OneVOneRateCreate />} />
        <Route path="edit/:id" element={<OneVOneRateEdit />} />
      </Route>
      <Route path="/events">
        <Route index element={<EventList />} />
        <Route path="create" element={<EventCreate />} />
        <Route path="edit/:id" element={<EventEdit />} />
      </Route>
      <Route path="/entries">
        <Route index element={<EntryList />} />
        <Route path="edit/:id" element={<EntryEdit />} />
      </Route>
      <Route path="/sprocket-import" element={<SprocketImport />} />
      <Route path="/reconciliation" element={<Reconciliation />} />
      <Route path="/payment-due" element={<PaymentDue />} />
      <Route path="/zoho-export" element={<ZohoExport />} />
      <Route path="*" element={<ErrorComponent />} />
    </Routes>
  </ThemedLayout>
)

const CoachRoutes = () => (
  <CoachLayout>
    <Routes>
      <Route index element={<Navigate to="/log-session" replace />} />
      <Route path="/log-session" element={<LogSession />} />
      <Route path="/log-session/edit/:id" element={<LogSession />} />
      <Route path="/my-sessions" element={<MySessions />} />
      <Route path="*" element={<ErrorComponent />} />
    </Routes>
  </CoachLayout>
)

// Supabase's JWT records how the *current* session was actually established
// (amr = authentication method reference) -- password, otp (magic link and
// recovery links both verify as otp), etc. That's a far more reliable signal
// than sniffing the landing URL: it doesn't depend on which route the
// post-login redirect chain happened to pass through, so there's nothing to
// race against Refine's own "already authenticated, leave /login" redirect.
// Anyone who got in without a password sees the set-password prompt inline,
// with "Skip for now" just dismissing it for the rest of this tab session.
const useNeedsPassword = () => {
  const [needsPassword, setNeedsPassword] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    supabaseClient.auth.getSession().then(({ data }) => {
      if (cancelled) return
      const token = data.session?.access_token
      const payload = token ? decodeJwtPayload(token) : null
      const amr = payload?.amr as Array<{ method?: string }> | undefined
      const method = amr?.[0]?.method
      setNeedsPassword(!!method && method !== 'password')
    })
    return () => {
      cancelled = true
    }
  }, [])

  return needsPassword
}

// Plain component state for "skipped" doesn't survive a page reload -- and
// since the underlying session's amr doesn't change just because someone
// skipped, a refresh would bring the prompt right back every time. Back it
// with sessionStorage instead, so skipping actually sticks until either
// they set a password (a real password-based login) or close the tab.
const SKIP_PASSWORD_PROMPT_KEY = 'skip-password-prompt'

const AuthenticatedShell = () => {
  const { data: identity, isLoading } = useGetIdentity<Identity>()
  const needsPassword = useNeedsPassword()
  const [skipped, setSkipped] = useState(() => sessionStorage.getItem(SKIP_PASSWORD_PROMPT_KEY) === 'true')

  const dismissPasswordPrompt = () => {
    sessionStorage.setItem(SKIP_PASSWORD_PROMPT_KEY, 'true')
    setSkipped(true)
  }

  if (isLoading || needsPassword === null) return <PageLoading />
  if (needsPassword && !skipped) {
    return <UpdatePassword onSkip={dismissPasswordPrompt} onSuccess={dismissPasswordPrompt} />
  }

  return identity?.role === 'coach' ? <CoachRoutes /> : <AdminRoutes />
}

function App() {
  return (
    <HashRouter>
      <ConfigProvider>
        <AntdApp>
          <UpdateBanner />
          <ErrorBoundary>
            <Refine
              dataProvider={dataProvider(supabaseClient)}
              routerProvider={routerBindings}
              authProvider={authProvider}
              notificationProvider={useNotificationProvider}
              resources={[
                {
                  name: 'coaches',
                  list: '/coaches',
                  create: '/coaches/create',
                  edit: '/coaches/edit/:id',
                  meta: { label: 'Coaches' },
                },
                {
                  name: 'programs',
                  list: '/programs',
                  create: '/programs/create',
                  edit: '/programs/edit/:id',
                  meta: { label: 'Programs' },
                },
                {
                  name: 'locations',
                  list: '/locations',
                  create: '/locations/create',
                  edit: '/locations/edit/:id',
                  meta: { label: 'Locations' },
                },
                {
                  name: 'rates',
                  list: '/rates',
                  create: '/rates/create',
                  edit: '/rates/edit/:id',
                  meta: { label: 'Rates' },
                },
                {
                  name: 'one_v_one_rates',
                  list: '/one-v-one-rates',
                  create: '/one-v-one-rates/create',
                  edit: '/one-v-one-rates/edit/:id',
                  meta: { label: '1v1 Rates' },
                },
                {
                  name: 'events',
                  list: '/events',
                  create: '/events/create',
                  edit: '/events/edit/:id',
                  meta: { label: 'Events' },
                },
                {
                  name: 'timesheet_entries',
                  list: '/entries',
                  edit: '/entries/edit/:id',
                  meta: { label: 'Timesheet Entries' },
                },
                {
                  name: 'sprocket-import',
                  list: '/sprocket-import',
                  meta: { label: 'Import Calendar' },
                },
                {
                  name: 'reconciliation',
                  list: '/reconciliation',
                  meta: { label: 'Reconciliation' },
                },
                {
                  name: 'payment-due',
                  list: '/payment-due',
                  meta: { label: 'Payment Due' },
                },
                {
                  name: 'zoho-export',
                  list: '/zoho-export',
                  meta: { label: 'Zoho Export' },
                },
              ]}
              options={{
                syncWithLocation: true,
              }}
            >
              <Suspense fallback={<PageLoading />}>
                <Routes>
                  <Route
                    path="/*"
                    element={
                      <Authenticated key="authenticated-routes" redirectOnFail="/login">
                        <AuthenticatedShell />
                      </Authenticated>
                    }
                  />
                  <Route
                    element={
                      <Authenticated key="auth-pages" fallback={<Outlet />}>
                        <Navigate to="/" />
                      </Authenticated>
                    }
                  >
                    <Route path="/login" element={<Login />} />
                    <Route path="/forgot-password" element={<ForgotPassword />} />
                  </Route>
                  <Route path="/update-password" element={<UpdatePassword />} />
                </Routes>
              </Suspense>
              <DocumentTitleHandler />
            </Refine>
          </ErrorBoundary>
        </AntdApp>
      </ConfigProvider>
    </HashRouter>
  )
}

export default App

import { Suspense, lazy } from 'react'
import { Authenticated, Refine, useGetIdentity } from '@refinedev/core'
import { ErrorComponent, ThemedLayout, useNotificationProvider } from '@refinedev/antd'
import { dataProvider } from '@refinedev/supabase'
import routerBindings, { DocumentTitleHandler, NavigateToResource } from '@refinedev/react-router'
import { HashRouter, Navigate, Outlet, Route, Routes } from 'react-router'
import { App as AntdApp, ConfigProvider, Spin } from 'antd'

import '@refinedev/antd/dist/reset.css'

import { supabaseClient } from './utility/supabaseClient'
import { authProvider, type Identity } from './providers/authProvider'
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

const SprocketImport = lazy(() =>
  import('./pages/sprocket-import').then((m) => ({ default: m.SprocketImport })),
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
      <Route path="/sprocket-import" element={<SprocketImport />} />
      <Route path="*" element={<ErrorComponent />} />
    </Routes>
  </ThemedLayout>
)

const CoachRoutes = () => (
  <CoachLayout>
    <Routes>
      <Route index element={<Navigate to="/log-session" replace />} />
      <Route path="/log-session" element={<LogSession />} />
      <Route path="/my-sessions" element={<MySessions />} />
      <Route path="*" element={<ErrorComponent />} />
    </Routes>
  </CoachLayout>
)

const AuthenticatedShell = () => {
  const { data: identity, isLoading } = useGetIdentity<Identity>()

  if (isLoading) return <PageLoading />

  return identity?.role === 'coach' ? <CoachRoutes /> : <AdminRoutes />
}

function App() {
  return (
    <HashRouter>
      <ConfigProvider>
        <AntdApp>
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
                  name: 'sprocket-import',
                  list: '/sprocket-import',
                  meta: { label: 'Import Calendar' },
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

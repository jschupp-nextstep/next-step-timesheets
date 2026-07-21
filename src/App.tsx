import { Authenticated, Refine } from '@refinedev/core'
import { AuthPage, ErrorComponent, ThemedLayout, useNotificationProvider } from '@refinedev/antd'
import { dataProvider } from '@refinedev/supabase'
import routerBindings, { DocumentTitleHandler, NavigateToResource } from '@refinedev/react-router'
import { HashRouter, Navigate, Outlet, Route, Routes } from 'react-router'
import { App as AntdApp, ConfigProvider } from 'antd'

import '@refinedev/antd/dist/reset.css'

import { supabaseClient } from './utility/supabaseClient'
import { authProvider } from './providers/authProvider'
import { ErrorBoundary } from './ErrorBoundary'

import { CoachList } from './pages/coaches/list'
import { CoachCreate } from './pages/coaches/create'
import { CoachEdit } from './pages/coaches/edit'
import { ProgramList } from './pages/programs/list'
import { ProgramCreate } from './pages/programs/create'
import { ProgramEdit } from './pages/programs/edit'
import { LocationList } from './pages/locations/list'
import { LocationCreate } from './pages/locations/create'
import { LocationEdit } from './pages/locations/edit'
import { RateList } from './pages/rates/list'
import { RateCreate } from './pages/rates/create'
import { RateEdit } from './pages/rates/edit'
import { OneVOneRateList } from './pages/one-v-one-rates/list'
import { OneVOneRateCreate } from './pages/one-v-one-rates/create'
import { OneVOneRateEdit } from './pages/one-v-one-rates/edit'
import { EventList } from './pages/events/list'
import { EventCreate } from './pages/events/create'
import { EventEdit } from './pages/events/edit'

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
              ]}
              options={{
                syncWithLocation: true,
              }}
            >
              <Routes>
                <Route
                  element={
                    <Authenticated key="authenticated-routes" redirectOnFail="/login">
                      <ThemedLayout>
                        <Outlet />
                      </ThemedLayout>
                    </Authenticated>
                  }
                >
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
                </Route>
                <Route
                  element={
                    <Authenticated key="auth-pages" fallback={<Outlet />}>
                      <Navigate to="/" />
                    </Authenticated>
                  }
                >
                  <Route
                    path="/login"
                    element={<AuthPage type="login" registerLink={false} forgotPasswordLink={false} />}
                  />
                </Route>
                <Route path="*" element={<ErrorComponent />} />
              </Routes>
              <DocumentTitleHandler />
            </Refine>
          </ErrorBoundary>
        </AntdApp>
      </ConfigProvider>
    </HashRouter>
  )
}

export default App

import { Refine, WelcomePage } from '@refinedev/core'
import { ErrorComponent, useNotificationProvider } from '@refinedev/antd'
import { dataProvider } from '@refinedev/supabase'
import routerBindings, { DocumentTitleHandler } from '@refinedev/react-router'
import { BrowserRouter, Route, Routes } from 'react-router'
import { App as AntdApp, ConfigProvider } from 'antd'

import '@refinedev/antd/dist/reset.css'

import { supabaseClient } from './utility/supabaseClient'
import { ErrorBoundary } from './ErrorBoundary'

function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <ConfigProvider>
        <AntdApp>
          <ErrorBoundary>
            <Refine
              dataProvider={dataProvider(supabaseClient)}
              routerProvider={routerBindings}
              notificationProvider={useNotificationProvider}
              resources={[]}
              options={{
                syncWithLocation: true,
              }}
            >
              <Routes>
                <Route index element={<WelcomePage />} />
                <Route path="*" element={<ErrorComponent />} />
              </Routes>
              <DocumentTitleHandler />
            </Refine>
          </ErrorBoundary>
        </AntdApp>
      </ConfigProvider>
    </BrowserRouter>
  )
}

export default App

import type { IconProp } from '@fortawesome/fontawesome-svg-core'
import { library } from '@fortawesome/fontawesome-svg-core'
import { fab } from '@fortawesome/free-brands-svg-icons'
import { far } from '@fortawesome/free-regular-svg-icons'
import { fas } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { App as AntdApp, Spin } from 'antd'
import { useEffect, useMemo } from 'react'
import { createBrowserRouter, RouterProvider } from 'react-router'

import '../index.css'
import './widgets/load'

import styles from './App.module.css'
import { onPreviewApplied } from './components/Autopilot/previewApplied'
import FiltersProvider from './components/FiltesProvider/FiltersProvider'
import { ConfigProvider, useConfigContext } from './context/ConfigContext'
import { RoutesProvider, useRoutesContext } from './context/RoutesContext'
import { useLiveRefreshFirehose } from './hooks/useLiveRefresh'

library.add(fab, fas, far)

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
      staleTime: 30 * 1000,
    },
  },
})

const AppInitializer: React.FC = () => {
  const { isLoading: isRoutesLoading, routerVersion, routes } = useRoutesContext()
  const { isLoading: isConfigLoading } = useConfigContext()

  // Pipe the SSE event firehose into the live-refresh registry, once, for the app's lifetime.
  useLiveRefreshFirehose()

  // A preview apply changes what the sandbox SERVES without changing the URL the rendered pane
  // FETCHES, so the widget cache has to be told or the pane keeps answering from it. Subscribed
  // HERE because this is inside QueryClientProvider and the apply is not — see previewApplied.
  useEffect(() => onPreviewApplied(() => {
    void queryClient.invalidateQueries({ queryKey: ['widgets'] })
  }), [])

  // Use useMemo to recreate router only when routes or routeVersion changes
  const router = useMemo(() => {
    return createBrowserRouter(routes)
  }, [routes])

  if (isRoutesLoading || isConfigLoading) {
    return (
      <div className={styles.loading}>
        <Spin indicator={<FontAwesomeIcon icon={['fas', 'spinner'] as IconProp} spin />} size='large' />
      </div>
    )
  }

  return <RouterProvider key={routerVersion} router={router} />
}

const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider>
        <RoutesProvider>
          <AntdApp className={styles.app}>
            <FiltersProvider>
              <AppInitializer />
            </FiltersProvider>
          </AntdApp>
        </RoutesProvider>
        <ReactQueryDevtools initialIsOpen={false} />
      </ConfigProvider>
    </QueryClientProvider>
  )
}

export default App

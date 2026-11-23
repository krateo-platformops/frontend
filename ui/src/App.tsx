import type { IconProp } from '@fortawesome/fontawesome-svg-core'
import { library } from '@fortawesome/fontawesome-svg-core'
import { fab } from '@fortawesome/free-brands-svg-icons'
import { far } from '@fortawesome/free-regular-svg-icons'
import { fas } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { App as AntdApp, Spin } from 'antd'
import { useEffect, useState } from 'react'
import { createBrowserRouter, RouterProvider } from 'react-router'

import '../index.css'
import './widgets/load'

import styles from './App.module.css'
import { onPreviewApplied } from './components/Agentiko/previewApplied'
import FiltersProvider from './components/FiltesProvider/FiltersProvider'
import { ConfigProvider, useConfigContext } from './context/ConfigContext'
import { useRoutesContext } from './context/RoutesContext'
import { ROUTER_ROUTES, RoutesProvider } from './context/RoutesProvider'

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

export const AppInitializer: React.FC = () => {
  const { isLoading: isRoutesLoading } = useRoutesContext()
  const { isLoading: isConfigLoading } = useConfigContext()

  // A preview apply changes what the sandbox SERVES without changing the URL the rendered pane
  // FETCHES, so the widget cache has to be told or the pane keeps answering from it. Subscribed
  // HERE because this is inside QueryClientProvider and the apply is not — see previewApplied.
  useEffect(() => onPreviewApplied(() => {
    void queryClient.invalidateQueries({ queryKey: ['widgets'] })
  }), [])

  // Built ONCE for the app's life: the routes registered later are served by the shell's descendant
  // routes (RoutesProvider.tsx), so registering one never rebuilds the router or remounts the tree.
  const [router] = useState(() => createBrowserRouter(ROUTER_ROUTES))

  if (isRoutesLoading || isConfigLoading) {
    return (
      <div className={styles.loading}>
        <Spin indicator={<FontAwesomeIcon icon={['fas', 'spinner'] as IconProp} spin />} size='large' />
      </div>
    )
  }

  return <RouterProvider router={router} />
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

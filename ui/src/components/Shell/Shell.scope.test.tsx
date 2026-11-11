// @vitest-environment jsdom
/**
 * The shell is chrome; only the routed page is page (snowplow#777). `useWidgetQuery` builds a
 * widget's extras, and so its react-query key, from the route params and the URL query only in the
 * 'page' scope. The INIT Layout used to render in that default scope, so a `?projects=` change or a
 * navigation between routes with different params re-keyed it: the whole shell dropped to its
 * loading state and remounted (header, sider, the project picker and the focus on it). The routed
 * content must keep the 'page' scope, or page widgets would lose the params and query they read.
 *
 * What each scope puts in the envelope is covered by hooks/widgetScope.extras.test.tsx; this file
 * covers which scope the shell hands to which tree. The server-driven pieces are stubbed: the
 * WidgetRenderer stand-in prints the scope it is rendered in, and the INIT one projects the shell's
 * `content` slot, as the real Layout widget does when its CR leaves `content` unset.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useWidgetScope } from '../../context/WidgetScopeContext'
import { setViewportWidth } from '../../test/viewportWidth'

import { useShellSlots } from './ShellSlots'

const INIT = '/call?resource=layouts&name=app-shell&namespace=krateo-system'

vi.mock('../../context/ConfigContext', () => ({ useConfigContext: () => ({ config: { api: { INIT } } }) }))
vi.mock('../../context/RoutesContext', () => ({ useRoutesContext: () => ({ routes: [] }) }))
vi.mock('../../otel/useDocumentLoadSpan', () => ({ useDocumentLoadSpan: vi.fn() }))
vi.mock('../../builders/clusterBuilders', () => ({ ensureBuildersLoaded: vi.fn() }))
vi.mock('../../widgets/Drawer', () => ({ default: () => null }))
vi.mock('../../widgets/Modal', () => ({ default: () => null }))
vi.mock('../SessionResume', () => ({ default: () => null }))
vi.mock('../Breadcrumb', () => ({ default: () => null }))
vi.mock('../Notifications', () => ({
  NotificationsBell: () => null,
  NotificationsDrawer: () => null,
  NotificationsProvider: ({ children }: { children: unknown }) => children,
}))
vi.mock('../Agentiko', () => ({
  AgentikoProvider: ({ children }: { children: unknown }) => children,
  AgentikoShell: ({ children }: { children: unknown }) => children,
  AgentikoToggle: () => null,
}))

const ShellLayoutStandIn = () => <>{useShellSlots().content}</>
const WidgetRendererStandIn = ({ widgetEndpoint }: { widgetEndpoint: string }) => (
  <section aria-label={widgetEndpoint}>
    <span data-testid={`scope ${widgetEndpoint}`}>{useWidgetScope()}</span>
    {widgetEndpoint === INIT ? <ShellLayoutStandIn /> : null}
  </section>
)
vi.mock('../WidgetRenderer', () => ({ default: WidgetRendererStandIn }))

const { ShellRoute } = await import('./Shell')
const { default: WidgetRenderer } = await import('../WidgetRenderer')

afterEach(cleanup)

const renderAt = (url: string) => {
  setViewportWidth(1440)
  localStorage.setItem('K_user', JSON.stringify({ user: { username: 'admin' } }))
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route element={<ShellRoute />}>
          <Route element={<WidgetRenderer widgetEndpoint='page-widget' />} path='/compositions/:namespace/:name' />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('the shell is chrome, the routed page is page', () => {
  it('the INIT Layout renders in the chrome scope, so the page\'s params and query never key it', () => {
    renderAt('/compositions/team-alpha/webapp-orders-2?projects=team-alpha')
    expect(screen.getByTestId(`scope ${INIT}`).textContent).toBe('chrome')
  })

  it('a widget in the routed content keeps the page scope, inside the chrome Layout', () => {
    renderAt('/compositions/team-alpha/webapp-orders-2?projects=team-alpha')
    expect(screen.getByRole('region', { name: INIT }).contains(screen.getByTestId('scope page-widget'))).toBe(true)
    expect(screen.getByTestId('scope page-widget').textContent).toBe('page')
  })
})

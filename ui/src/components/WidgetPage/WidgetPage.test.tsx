// @vitest-environment jsdom
/**
 * WidgetPage — post-login 404-flash guard.
 *
 * Regression cover for the race that showed a 404 flash right after login:
 * login navigates to `/` (the default when there is no `?next=`), but `/` is NOT a
 * menu route (the first menu item is `/dashboard`). Menu routes are populated
 * ASYNCHRONOUSLY by the sidebar Menu's effect, which then redirects `/` →
 * menuRoutes[0].path. There is a window where the layouts/menus queries have
 * settled (`isFetchingRoutes === 0`) but the Menu effect has not yet run
 * `updateMenuRoutes` (`menuRoutes.length === 0`) — the old guard rendered Page404
 * for `/` in that window, before the redirect fired.
 *
 * The guard must:
 *   - `/` with routes NOT yet populated → loading skeleton, never Page404.
 *   - `/` even with routes populated (pre-redirect tick) → loading skeleton.
 *   - any path with routes NOT yet populated → loading skeleton.
 *   - a genuinely-unknown path WHEN routes ARE populated → Page404 (not masked).
 *
 * Mock strategy: the routes context and the routes-in-flight counter are
 * mocked so each render is a pure function of
 * (menuRoutes, isFetchingRoutes, location). WidgetRenderer is stubbed so a
 * resolved route renders an identifiable marker instead of touching the network.
 */
import { act, fireEvent, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { failBuilders, installBuilders, markBuildersLoading, parseBuilderItems } from '../../builders/builderRegistry'
import { fixtureItems, fixtureBuilders } from '../../builders/fixtures/fixtureBuilders'
import type { AppRoute } from '../../context/RoutesContext'

import type { RouteSourceState } from './routeSource'
import WidgetPage from './WidgetPage'

// ---------------------------------------------------------------------------
// Controllable mocks
// ---------------------------------------------------------------------------

let mockMenuRoutes: AppRoute[] = []
let mockIsFetchingRoutes = 0
// The route source (the Menu's own read), as routeSource.ts would read it from the query cache.
let mockRouteSource: RouteSourceState = { retrying: false }
const mockRetryRouteSource = vi.fn(() => Promise.resolve())

vi.mock('../../context/RoutesContext', () => ({
  useRoutesContext: () => ({ menuRoutes: mockMenuRoutes }),
}))

vi.mock('@tanstack/react-query', () => ({
  useIsFetching: () => mockIsFetchingRoutes,
  useQueryClient: () => ({ getQueryCache: () => ({ subscribe: () => () => undefined }) }),
}))

vi.mock('./routeSource', () => ({
  retryRouteSource: () => mockRetryRouteSource(),
  routeSourceKey: () => JSON.stringify(mockRouteSource),
}))

vi.mock('../../pages/Page404', () => ({
  default: () => <div data-testid='page-404'>404</div>,
}))

vi.mock('../WidgetStates', () => ({
  WidgetLoading: () => <div data-testid='widget-loading'>loading</div>,
}))

vi.mock('../WidgetRenderer', () => ({
  default: ({ widgetEndpoint }: { widgetEndpoint: string }) => (
    <div data-endpoint={widgetEndpoint} data-testid='widget-content'>content</div>
  ),
}))

vi.mock('../PageSearch', () => ({
  default: () => <div data-testid='page-search'>search</div>,
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const route = (path: string): AppRoute => ({
  path,
  resourceRef: { allowed: true, id: `ref-${path}`, path: `/call?resource=x&name=${path}`, payload: {}, verb: 'GET' },
  resourceRefId: `id-${path}`,
})

const renderAt = (pathname: string) =>
  render(
    <MemoryRouter initialEntries={[pathname]}>
      <WidgetPage />
    </MemoryRouter>,
  )

beforeAll(() => {
  mockMenuRoutes = []
  mockIsFetchingRoutes = 0
})

afterEach(() => {
  mockMenuRoutes = []
  mockIsFetchingRoutes = 0
  mockRouteSource = { retrying: false }
  mockRetryRouteSource.mockClear()
  document.body.innerHTML = ''
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WidgetPage — post-login 404-flash guard', () => {
  it('shows the loading skeleton (NOT 404) for `/` when routes have settled but menuRoutes is still empty', () => {
    // The exact race: layouts/menus queries done, but the Menu effect has not yet
    // populated menuRoutes and has not yet redirected `/`.
    mockMenuRoutes = []
    mockIsFetchingRoutes = 0
    const { queryByTestId } = renderAt('/')

    expect(queryByTestId('widget-loading')).not.toBeNull()
    expect(queryByTestId('page-404')).toBeNull()
  })

  it('still shows the loading skeleton for `/` even once routes are populated (waits for the redirect, never 404s home)', () => {
    mockMenuRoutes = [route('/dashboard')]
    mockIsFetchingRoutes = 0
    const { queryByTestId } = renderAt('/')

    expect(queryByTestId('widget-loading')).not.toBeNull()
    expect(queryByTestId('page-404')).toBeNull()
  })

  it('shows the loading skeleton (NOT 404) for any unknown path while menuRoutes is still empty', () => {
    mockMenuRoutes = []
    mockIsFetchingRoutes = 0
    const { queryByTestId } = renderAt('/dashboard')

    expect(queryByTestId('widget-loading')).not.toBeNull()
    expect(queryByTestId('page-404')).toBeNull()
  })

  it('shows the loading skeleton while the routes queries are still in flight', () => {
    mockMenuRoutes = []
    mockIsFetchingRoutes = 1
    const { queryByTestId } = renderAt('/dashboard')

    expect(queryByTestId('widget-loading')).not.toBeNull()
    expect(queryByTestId('page-404')).toBeNull()
  })

  it('DOES show Page404 for a genuinely-unknown path once menuRoutes is populated (real 404 not masked)', () => {
    mockMenuRoutes = [route('/dashboard')]
    mockIsFetchingRoutes = 0
    const { queryByTestId } = renderAt('/this-page-does-not-exist')

    expect(queryByTestId('page-404')).not.toBeNull()
    expect(queryByTestId('widget-loading')).toBeNull()
  })

  it('renders the widget content when the current path resolves to a menu route', () => {
    mockMenuRoutes = [route('/dashboard')]
    mockIsFetchingRoutes = 0
    const { queryByTestId } = renderAt('/dashboard')

    expect(queryByTestId('widget-content')).not.toBeNull()
    expect(queryByTestId('page-404')).toBeNull()
    expect(queryByTestId('widget-loading')).toBeNull()
  })
})

describe('WidgetPage — a builder route not mounted yet, or never', () => {
  afterEach(() => {
    act(() => { installBuilders(fixtureBuilders()) })
  })

  it('shows the loading skeleton (NOT 404) for a path while the Builders are still being read — no 404 flash on /portal-builder/compose', () => {
    mockMenuRoutes = [route('/dashboard')]
    act(() => { markBuildersLoading() })
    const { queryByTestId } = renderAt('/portal-builder/compose')

    expect(queryByTestId('widget-loading')).not.toBeNull()
    expect(queryByTestId('page-404')).toBeNull()
  })

  it('says the Builders could not be read, with the reason, instead of a 404 when the read failed', () => {
    mockMenuRoutes = [route('/dashboard')]
    act(() => { failBuilders('you may not list Builders in krateo-system (403).') })
    const { getByText, queryByTestId } = renderAt('/portal-builder/compose')

    expect(getByText('Builders could not be read from the cluster: you may not list Builders in krateo-system (403).')).not.toBeNull()
    expect(queryByTestId('page-404')).toBeNull()
    expect(queryByTestId('widget-loading')).toBeNull()
  })

  it('turns from loading into the sentence when the read fails while the page is open', () => {
    mockMenuRoutes = [route('/dashboard')]
    act(() => { markBuildersLoading() })
    const { getByText, queryByTestId } = renderAt('/portal-builder/compose')
    expect(queryByTestId('widget-loading')).not.toBeNull()

    act(() => { failBuilders('snowplow could not be reached (Failed to fetch).') })
    expect(getByText('Builders could not be read from the cluster: snowplow could not be reached (Failed to fetch).')).not.toBeNull()
  })
})

describe('WidgetPage — the failure sentence is for builder addresses only', () => {
  afterEach(() => {
    act(() => { installBuilders(fixtureBuilders()) })
  })

  it('any other unknown address stays a plain 404 when the read failed', () => {
    mockMenuRoutes = [route('/dashboard')]
    act(() => { failBuilders('snowplow did not answer within 15 s. Reload the page to retry.') })
    const { queryByTestId, queryByText } = renderAt('/this-page-does-not-exist')

    expect(queryByTestId('page-404')).not.toBeNull()
    expect(queryByText(/Builders could not be read/)).toBeNull()
  })

  it('an address under any of the three hub prefixes gets the sentence', () => {
    mockMenuRoutes = [route('/dashboard')]
    act(() => { failBuilders('snowplow answered 503.') })
    for (const path of ['/controller-builder/compose', '/blueprint-builder']) {
      const { getAllByText, unmount } = renderAt(path)
      expect(getAllByText(/Builders could not be read from the cluster: snowplow answered 503\./).length).toBeGreaterThan(0)
      unmount()
    }
  })

  it('a route a Builder declared earlier in this tab counts as a builder address after a failure', () => {
    mockMenuRoutes = [route('/dashboard')]
    const [item] = fixtureItems() as Record<string, Record<string, unknown>>[]
    const custom = parseBuilderItems([{ ...item, metadata: { name: 'ops-builder' }, spec: { ...item.spec, route: '/ops-builder/compose' } }])
    act(() => { installBuilders(custom) })
    act(() => { failBuilders('snowplow answered 503.') })
    const { getAllByText } = renderAt('/ops-builder/compose')
    expect(getAllByText(/Builders could not be read from the cluster/).length).toBeGreaterThan(0)
  })
})

describe('WidgetPage — the menu could not load (approved "When the sidebar menu cannot load")', () => {
  const failed = (kind: 'dependency' | 'forbidden' | 'timeout' | 'error', status: number, detail?: string, retrying = false): RouteSourceState => ({
    failure: { detail, kind, object: 'krateo-system/sidebar-nav', status },
    retrying,
  })

  it('S2: a 424 says the navigation could not load, shows snowplow\u2019s words, and Check again asks again', () => {
    mockRouteSource = failed('dependency', 424, 'restactions "nav-items" not found')
    const { getByRole, getByTestId, getByText, queryByTestId } = renderAt('/dashboard')

    expect(getByTestId('navigation-unavailable-dependency')).not.toBeNull()
    expect(queryByTestId('widget-loading')).toBeNull()
    expect(getByText('The navigation could not load')).not.toBeNull()
    expect(getByText('restactions "nav-items" not found')).not.toBeNull()
    expect(getByText('menus · krateo-system/sidebar-nav · HTTP 424')).not.toBeNull()
    fireEvent.click(getByRole('button', { name: 'Check again' }))
    expect(mockRetryRouteSource).toHaveBeenCalledTimes(1)
  })

  it('S3: a 403 offers no button (asking again changes nothing) and keeps Profile and Sign out', () => {
    mockRouteSource = failed('forbidden', 403, 'forbidden')
    const { getByRole, getByTestId, queryByRole } = renderAt('/dashboard')

    expect(getByTestId('navigation-unavailable-forbidden')).not.toBeNull()
    expect(queryByRole('button')).toBeNull()
    expect(getByRole('link', { name: 'Profile' }).getAttribute('href')).toBe('/profile')
    expect(getByRole('link', { name: 'Sign out' }).getAttribute('href')).toBe('/logout')
  })

  it('S4: any other failure is an error, with the server\u2019s detail and Retry', () => {
    mockRouteSource = failed('error', 500, 'boom')
    const { getByRole, getByTestId, getByText } = renderAt('/dashboard')

    expect(getByTestId('navigation-unavailable-error')).not.toBeNull()
    expect(getByText('boom')).not.toBeNull()
    fireEvent.click(getByRole('button', { name: 'Retry' }))
    expect(mockRetryRouteSource).toHaveBeenCalledTimes(1)
  })

  it('S5: a timeout says it is still waiting, with Retry', () => {
    mockRouteSource = failed('timeout', 504)
    const { getByRole, getByText } = renderAt('/dashboard')

    expect(getByText('Still waiting for the navigation')).not.toBeNull()
    expect(getByRole('button', { name: 'Retry' })).not.toBeNull()
  })

  it('S6: while a retry runs the message stays and only the button shows progress (no fall back to the skeleton)', () => {
    mockRouteSource = failed('dependency', 424, 'missing', true)
    mockIsFetchingRoutes = 1
    const { getByRole, getByTestId, queryByTestId } = renderAt('/dashboard')

    expect(getByTestId('navigation-unavailable-dependency')).not.toBeNull()
    expect(queryByTestId('widget-loading')).toBeNull()
    expect((getByRole('button', { name: /Checking/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('home (`/`) gets the same explanation: it waits on the menu too', () => {
    mockRouteSource = failed('dependency', 424, 'missing')
    const { getByTestId } = renderAt('/')

    expect(getByTestId('navigation-unavailable-dependency')).not.toBeNull()
  })

  it('a menu that failed on a LATER refresh keeps its routes: the page renders, no explanation', () => {
    mockMenuRoutes = [route('/dashboard')]
    mockRouteSource = failed('error', 500, 'boom')
    const { queryByTestId } = renderAt('/dashboard')

    expect(queryByTestId('widget-content')).not.toBeNull()
    expect(queryByTestId('navigation-unavailable-error')).toBeNull()
  })
})

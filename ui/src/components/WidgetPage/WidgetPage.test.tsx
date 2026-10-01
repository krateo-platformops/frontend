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
 * Mock strategy: the routes context, the routes-in-flight counter and the
 * document-title hook are mocked so each render is a pure function of
 * (menuRoutes, isFetchingRoutes, location). WidgetRenderer is stubbed so a
 * resolved route renders an identifiable marker instead of touching the network.
 */
import { act, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { failBuilders, installBuilders, markBuildersLoading } from '../../builders/builderRegistry'
import { fixtureBuilders } from '../../builders/fixtures/fixtureBuilders'
import type { AppRoute } from '../../context/RoutesContext'

import WidgetPage from './WidgetPage'

// ---------------------------------------------------------------------------
// Controllable mocks
// ---------------------------------------------------------------------------

let mockMenuRoutes: AppRoute[] = []
let mockIsFetchingRoutes = 0

vi.mock('../../context/RoutesContext', () => ({
  useRoutesContext: () => ({ menuRoutes: mockMenuRoutes }),
}))

vi.mock('@tanstack/react-query', () => ({
  useIsFetching: () => mockIsFetchingRoutes,
}))

vi.mock('../../hooks/useDocumentTitle', () => ({
  useDocumentTitle: () => undefined,
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

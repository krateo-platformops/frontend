// @vitest-environment jsdom
/**
 * CommandPalette — inline-typeahead UI wiring (UX audit #22), on top of the
 * useSearchTypeahead hook (its fetch/debounce/caching contract is covered in
 * useSearchTypeahead.test.tsx). Proves at the component level:
 *  - the FALLBACK path end-to-end: a DEAD search backend leaves the palette fully
 *    functional — plain Enter still routes to /search?q=… (the pre-typeahead
 *    behavior), silently, with no inline results;
 *  - typing renders the top hits inline; ↓ then Enter navigates to the SELECTED
 *    hit's link; a click on a hit navigates too;
 *  - plain Enter (no selection) routes to /search?q=… even when hits are shown.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AppRoute } from '../../context/RoutesContext'

import CommandPalette from './CommandPalette'

const navigateMock = vi.fn()
const menuRoutesRef: { current: AppRoute[] } = { current: [] }

vi.mock('react-router', () => ({
  useNavigate: () => navigateMock,
}))

vi.mock('../../context/ConfigContext', () => ({
  useConfigContext: () => ({
    config: { api: { SNOWPLOW_API_BASE_URL: 'http://snowplow.test' } },
    isLoading: false,
  }),
}))

vi.mock('../../context/RoutesContext', () => ({
  useRoutesContext: () => ({ menuRoutes: menuRoutesRef.current }),
}))

vi.mock('../../utils/getAccessToken', () => ({
  getAccessToken: () => 'test-token',
}))

const LISTY_PATH = '/call?resource=listies&apiVersion=widgets.templates.krateo.io/v1beta1&name=search-results&namespace=test-ns'

const SEARCH_ROUTE: AppRoute = {
  endpoint: LISTY_PATH,
  path: '/search',
  resourceRef: { allowed: true, id: 'search-results', path: LISTY_PATH, payload: {}, verb: 'GET' },
  resourceRefId: 'search-results',
}

const HIT_ROW = { link: '/compositions/team-a/payments', subtitle: 'team-a', title: 'payments', type: 'composition' }

const hitsResponse = () =>
  Promise.resolve(new Response(JSON.stringify({ status: { widgetData: { dataSource: [HIT_ROW] } } }), { status: 200 }))

const renderPalette = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <CommandPalette />
    </QueryClientProvider>
  )
}

/** Render + open the palette via its header trigger and return the autofocus input. */
const openPalette = () => {
  renderPalette()
  fireEvent.click(screen.getByRole('button', { name: /Search \(/ }))
  return screen.getByPlaceholderText('Search resources, blueprints…')
}

beforeAll(() => {
  // antd + jsdom compatibility shims
  const noop = () => undefined
  Object.defineProperty(window, 'matchMedia', {
    value: (query: string) => ({
      addEventListener: noop,
      addListener: noop,
      dispatchEvent: () => false,
      matches: false,
      media: query,
      onchange: null,
      removeEventListener: noop,
      removeListener: noop,
    }),
    writable: true,
  })
  globalThis.ResizeObserver = class {
    disconnect = noop
    observe = noop
    unobserve = noop
  }
})

beforeEach(() => {
  menuRoutesRef.current = [SEARCH_ROUTE]
  navigateMock.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('CommandPalette — fallback path (typeahead failure must not break the palette)', () => {
  it('plain Enter still routes to /search?q=… when every typeahead fetch FAILS', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error('network down')))
    vi.stubGlobal('fetch', fetchMock)

    const input = openPalette()
    fireEvent.change(input, { target: { value: 'payments app' } })
    // Wait out the debounce so the (failing) typeahead request actually fires —
    // proving the failure is swallowed, not merely never triggered.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.queryByRole('listbox')).toBeNull()

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(navigateMock).toHaveBeenCalledWith('/search?q=payments%20app')
  })
})

describe('CommandPalette — inline typeahead results', () => {
  it('renders hits while typing; ↓ + Enter navigates to the SELECTED hit link', async () => {
    vi.stubGlobal('fetch', vi.fn(hitsResponse))

    const input = openPalette()
    fireEvent.change(input, { target: { value: 'pay' } })
    await screen.findByRole('option', { name: /payments/ })

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(navigateMock).toHaveBeenCalledWith('/compositions/team-a/payments')
  })

  it('clicking a hit navigates to its link', async () => {
    vi.stubGlobal('fetch', vi.fn(hitsResponse))

    const input = openPalette()
    fireEvent.change(input, { target: { value: 'pay' } })
    const option = await screen.findByRole('option', { name: /payments/ })

    fireEvent.click(option)
    expect(navigateMock).toHaveBeenCalledWith('/compositions/team-a/payments')
  })

  it('plain Enter (no selection) keeps the full-page search even when hits are visible', async () => {
    vi.stubGlobal('fetch', vi.fn(hitsResponse))

    const input = openPalette()
    fireEvent.change(input, { target: { value: 'pay' } })
    await screen.findByRole('option', { name: /payments/ })

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(navigateMock).toHaveBeenCalledWith('/search?q=pay')
  })
})

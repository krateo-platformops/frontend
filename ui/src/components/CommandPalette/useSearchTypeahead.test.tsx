// @vitest-environment jsdom
/**
 * useSearchTypeahead — the ⌘K palette's inline-results hook (UX audit #22).
 *
 * Covers, with the fetch layer mocked (no network):
 *  - DEBOUNCE wiring: no request before ~300ms of quiet; retyping resets the
 *    timer; exactly ONE request fires for the settled term, carrying
 *    `?extras={"q":…}` + the app's Bearer auth;
 *  - endpoint resolution is DATA-DRIVEN from the /search route in `menuRoutes`
 *    (structured resourceRef first — WidgetPage's own precedence); no /search
 *    route ⇒ typeahead disabled, zero requests;
 *  - the TWO-STEP container hop: a Flex answer (convention `flexes/page-search`)
 *    is followed through its resourcesRefs to the `listies` widget;
 *  - per-term react-query caching: a remount with the same term answers from
 *    cache (still one request);
 *  - the FALLBACK path: a failing fetch degrades silently to zero hits (the
 *    palette keeps its pre-typeahead Enter-only behavior) — no throw, no retry;
 *  - the pure extractors (row shape tolerance, the top-8 cap, listies-ref pick).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AppRoute } from '../../context/RoutesContext'

import { extractHits, findListyRefPath, TYPEAHEAD_MAX_RESULTS, useSearchTypeahead } from './useSearchTypeahead'

const menuRoutesRef: { current: AppRoute[] } = { current: [] }

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
const FLEX_PATH = '/call?resource=flexes&apiVersion=widgets.templates.krateo.io/v1beta1&name=page-search&namespace=test-ns'

/** The /search route as the deployed nav produces it (resourceRefId → the listies ref). */
const searchRoute = (path: string = LISTY_PATH): AppRoute => ({
  endpoint: path,
  path: '/search',
  resourceRef: { allowed: true, id: 'search-results', path, payload: {}, verb: 'GET' },
  resourceRefId: 'search-results',
})

const HIT_ROW = { link: '/compositions/team-a/payments', subtitle: 'team-a', title: 'payments', type: 'composition' }

/** A resolved widget whose widgetData carries Listy rows. */
const listyWidget = (rows: unknown[]) => ({ status: { widgetData: { dataSource: rows } } })

/** A resolved container (Flex) whose resourcesRefs points at the search-results Listy. */
const flexWidget = () => ({
  status: {
    resourcesRefs: { items: [{ allowed: true, id: 'search-results', path: LISTY_PATH, payload: {}, verb: 'GET' }] },
    widgetData: {},
  },
})

const toUrl = (input: RequestInfo | URL): string => {
  if (typeof input === 'string') { return input }
  return input instanceof URL ? input.href : input.url
}

/** fetch stub routed by /call resource; records every request URL. */
const installFetchMock = (respond: (url: string) => unknown) => {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = toUrl(input)
    const body = respond(url)
    if (body instanceof Error) { return Promise.reject(body) }
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

let queryClient: QueryClient

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
)

const renderTypeahead = (term: string) => {
  queryClient = queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(({ value }: { value: string }) => useSearchTypeahead(value), {
    initialProps: { value: term },
    wrapper,
  })
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  queryClient = undefined as unknown as QueryClient
  menuRoutesRef.current = []
})

describe('useSearchTypeahead — debounce + fetch wiring', () => {
  it('debounces: fetches NOTHING before ~300ms of quiet, then exactly one request for the settled term', () => {
    vi.useFakeTimers()
    menuRoutesRef.current = [searchRoute()]
    const fetchMock = installFetchMock(() => listyWidget([HIT_ROW]))

    const { rerender } = renderTypeahead('')
    rerender({ value: 'p' })
    act(() => { vi.advanceTimersByTime(150) })
    rerender({ value: 'pa' })
    // Retyping resets the trailing timer — 150 + 299 quiet ms, still nothing.
    act(() => { vi.advanceTimersByTime(299) })
    expect(fetchMock).not.toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(1) })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // The one request targets the route-resolved listies endpoint with the term as extras.q
    // and the app's standard Bearer auth.
    // `fetch`'s first arg is typed `URL | RequestInfo` and its second is optional, so the tuple
    // does not overlap [string, RequestInit] directly. The call site always passes a string URL and
    // an init — assert that through `unknown` rather than widening the assertions themselves.
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('resource=listies')
    expect(url).toContain('name=search-results')
    expect(new URL(url).searchParams.get('extras')).toBe(JSON.stringify({ q: 'pa' }))
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token')
  })

  it('resolves hits from the routed endpoint and caps presentation fields to the RA row shape', async () => {
    menuRoutesRef.current = [searchRoute()]
    installFetchMock(() => listyWidget([HIT_ROW, { extra: 'dropped', title: 'billing' }]))

    const { result } = renderTypeahead('pay')
    await waitFor(() => expect(result.current.hits).toHaveLength(2))
    expect(result.current.hits[0]).toEqual(HIT_ROW)
    expect(result.current.hits[1]).toEqual({ link: undefined, subtitle: undefined, title: 'billing', type: undefined })
    expect(result.current.isEmpty).toBe(false)
  })

  it('follows a container (flexes/page-search) answer through its resourcesRefs to the listies rows', async () => {
    menuRoutesRef.current = [searchRoute(FLEX_PATH)]
    const fetchMock = installFetchMock((url) => (url.includes('resource=flexes') ? flexWidget() : listyWidget([HIT_ROW])))

    const { result } = renderTypeahead('pay')
    await waitFor(() => expect(result.current.hits).toHaveLength(1))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    // The second hop forwards the SAME extras.q to the listies widget.
    const [secondUrl] = fetchMock.mock.calls[1] as [string]
    expect(secondUrl).toContain('resource=listies')
    expect(new URL(secondUrl).searchParams.get('extras')).toBe(JSON.stringify({ q: 'pay' }))
  })

  it('caches per term: a remount with the same settled term answers from react-query, still ONE request', async () => {
    menuRoutesRef.current = [searchRoute()]
    const fetchMock = installFetchMock(() => listyWidget([HIT_ROW]))

    const first = renderTypeahead('pay')
    await waitFor(() => expect(first.result.current.hits).toHaveLength(1))
    first.unmount()

    const second = renderTypeahead('pay')
    await waitFor(() => expect(second.result.current.hits).toHaveLength(1))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fires NO request when the nav has no /search route (typeahead silently disabled)', () => {
    vi.useFakeTimers()
    menuRoutesRef.current = []
    const fetchMock = installFetchMock(() => listyWidget([HIT_ROW]))

    const { result } = renderTypeahead('pay')
    act(() => { vi.advanceTimersByTime(1000) })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.hits).toEqual([])
  })
})

describe('useSearchTypeahead — the fallback path (fetch failure → Enter-only palette)', () => {
  it('degrades SILENTLY to zero hits on a non-OK response — no throw, no isEmpty claim', async () => {
    menuRoutesRef.current = [searchRoute()]
    const fetchMock = vi.fn(() => Promise.resolve(new Response('boom', { status: 500, statusText: 'Internal Server Error' })))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderTypeahead('pay')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(result.current.isFetching).toBe(false))
    expect(result.current.hits).toEqual([])
    // Not "settled empty" — the fetch FAILED, so the palette must not claim "no matches".
    expect(result.current.isEmpty).toBe(false)
  })

  it('degrades SILENTLY to zero hits on a network error', async () => {
    menuRoutesRef.current = [searchRoute()]
    const fetchMock = installFetchMock(() => new Error('network down'))

    const { result } = renderTypeahead('pay')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(result.current.isFetching).toBe(false))
    expect(result.current.hits).toEqual([])
    expect(result.current.isEmpty).toBe(false)
  })

  it('reports isEmpty ONLY for a SUCCESSFUL fetch that found nothing', async () => {
    menuRoutesRef.current = [searchRoute()]
    installFetchMock(() => listyWidget([]))

    const { result } = renderTypeahead('zzz')
    await waitFor(() => expect(result.current.isEmpty).toBe(true))
    expect(result.current.hits).toEqual([])
  })
})

describe('extractHits / findListyRefPath — tolerant pure extractors', () => {
  it('caps at TYPEAHEAD_MAX_RESULTS and skips rows without a string title', () => {
    const rows: unknown[] = [{ title: '' }, { notTitle: 'x' }, null]
    for (let index = 0; index < TYPEAHEAD_MAX_RESULTS + 3; index += 1) {
      rows.push({ title: `hit-${index}` })
    }
    const hits = extractHits(listyWidget(rows))
    expect(hits).toHaveLength(TYPEAHEAD_MAX_RESULTS)
    expect(hits[0].title).toBe('hit-0')
  })

  it('returns [] for unresolved/garbage widgets (string status, missing dataSource, junk)', () => {
    expect(extractHits(undefined)).toEqual([])
    expect(extractHits({ status: 'pending' })).toEqual([])
    expect(extractHits({ status: { widgetData: {} } })).toEqual([])
    expect(extractHits({ status: { widgetData: { dataSource: 'nope' } } })).toEqual([])
  })

  it('picks the GET-able listies ref (search-results by name first), skipping disallowed refs', () => {
    const otherListy = { allowed: true, id: 'other', path: '/call?resource=listies&name=other', payload: {}, verb: 'GET' }
    const denied = { allowed: false, id: 'search-results', path: LISTY_PATH, payload: {}, verb: 'GET' }
    const named = { allowed: true, id: 'search-results', path: LISTY_PATH, payload: {}, verb: 'GET' }
    expect(findListyRefPath({ status: { resourcesRefs: { items: [otherListy, named] }, widgetData: {} } })).toBe(LISTY_PATH)
    expect(findListyRefPath({ status: { resourcesRefs: { items: [denied, otherListy] }, widgetData: {} } })).toBe(otherListy.path)
    expect(findListyRefPath({ status: 'pending' })).toBeUndefined()
    expect(findListyRefPath({ status: { widgetData: {} } })).toBeUndefined()
  })
})

// @vitest-environment jsdom
/**
 * useGetEvents — the Notifications bell's event list + live stream.
 *
 * This file exists for installer#395. The bell was the primary site putting the
 * caller's JWT into a URL (`/notifications?access_token=…`), where it reached every
 * access log and span on the path, and it had NO test — so nothing would have caught
 * the token coming back. These two assertions are that guard:
 *
 *  - the stream is subscribed with the BARE endpoint, no credential in the url;
 *  - the `/events` list is fetched with `Authorization: Bearer`, which is the only
 *    thing sse-proxy's `/events` route accepts (it has no query fallback at all).
 *
 * The transport itself — the Bearer header on the stream, connection sharing, frame
 * parsing — is sseClient.test.ts's subject. Here the hook gets its bearer and its SSE client from
 * the signed-in session on the widget transport, which the wrapper provides with a fake client.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { type WidgetTransport, WidgetTransportProvider } from '../transport/widgetTransport'

import type { SseSubscriber } from './sseClient'
import { useGetEvents } from './useGetEvents'
import { LIVE_REFRESH_FIREHOSE_ENABLED, useLiveRefreshFirehose } from './useLiveRefresh'

type Subscriber = { onMessage?: (raw: string) => void; onOpen?: (info: { reopened: boolean }) => void }

const { sseSubscriptions } = vi.hoisted(() => ({
  sseSubscriptions: [] as ({ url: string; topic: string } & Subscriber)[],
}))

/** A signed-in transport whose session carries a synthetic bearer and a recording SSE client. */
const signedIn: WidgetTransport = {
  fetch: () => Promise.reject(new Error('not used here')),
  identity: 'signed-in',
  live: true,
  onUnauthorized: () => undefined,
  session: {
    getAccessToken: () => 'header.payload.signature',
    isResumePending: () => false,
    resume: () => Promise.resolve('resumed'),
    signInAgain: () => undefined,
    subscribeSse: (url: string, topic: string, subscriber: SseSubscriber) => {
      // Recorded loosely: the tests below open a stream with only `reopened`, no scope.
      sseSubscriptions.push({ onMessage: subscriber.onMessage, onOpen: subscriber.onOpen as Subscriber['onOpen'], topic, url })

      return () => undefined
    },
  },
  writes: true,
}

vi.mock('../context/ConfigContext', () => ({
  useConfigContext: () => ({
    config: {
      api: {
        EVENTS_API_BASE_URL: 'https://portal.krateo.dev/events',
        EVENTS_PUSH_API_BASE_URL: 'https://portal.krateo.dev/events',
      },
    },
    isLoading: false,
  }),
}))

const anonymousWrapper = ({ children }: { children: ReactNode }) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return QueryClientProvider({ children, client })
}

/** Inside the signed-in shell, as the bell always is. */
const wrapper = ({ children }: { children: ReactNode }) => createElement(WidgetTransportProvider, { value: signedIn }, anonymousWrapper({ children }))

describe('useGetEvents — installer#395: no credential in any url', () => {
  afterEach(() => {
    sseSubscriptions.length = 0
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('subscribes to the stream with the bare endpoint and no token in the url', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ json: () => Promise.resolve([]), ok: true } as unknown as Response)))

    renderHook(() => useGetEvents({ topic: 'krateo' }), { wrapper })

    await waitFor(() => { expect(sseSubscriptions).toHaveLength(1) })

    const [subscription] = sseSubscriptions
    expect(subscription?.url).toBe('https://portal.krateo.dev/events/notifications')
    expect(subscription?.topic).toBe('krateo')
    // The specific regression: the token must not reach the url in ANY form.
    expect(subscription?.url).not.toContain('access_token')
    expect(subscription?.url).not.toContain('token=')
    expect(subscription?.url).not.toContain('header.payload.signature')
    expect(subscription?.url).not.toContain('?')
  })

  it('fetches the event list with a Bearer header, which /events requires', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ json: () => Promise.resolve([]), ok: true } as unknown as Response))
    vi.stubGlobal('fetch', fetchMock)

    renderHook(() => useGetEvents({ topic: 'krateo' }), { wrapper })

    await waitFor(() => { expect(fetchMock).toHaveBeenCalled() })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://portal.krateo.dev/events/events')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer header.payload.signature')
    expect(url).not.toContain('access_token')
  })

  it('outside the signed-in shell there is no session: nothing is fetched and no stream opens', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ json: () => Promise.resolve([]), ok: true } as unknown as Response))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useGetEvents({ topic: 'krateo' }), { wrapper: anonymousWrapper })

    await new Promise<void>((resolve) => { setTimeout(resolve, 20) })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(sseSubscriptions).toHaveLength(0)
    expect(result.current.data).toBeUndefined()
  })

  it('does not subscribe when the caller opts out of the stream', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ json: () => Promise.resolve([]), ok: true } as unknown as Response)))

    renderHook(() => useGetEvents({ registerToSSE: false, topic: 'krateo' }), { wrapper })

    await waitFor(() => { expect(sseSubscriptions).toHaveLength(0) })
  })
})

/**
 * The firehose is dormant ON PURPOSE, and these pin that.
 *
 * Taking the token out of the url repairs connection sharing as a side effect: sseClient
 * keys on the url, so while the bell's carried `?access_token=` and the firehose's did not,
 * the two keyed DIFFERENT cells — the firehose opened its own credential-free connection and
 * was answered 401, silently, for as long as it has existed. Identical urls would now key one
 * shared authenticated stream, which means the firehose would START WORKING.
 *
 * That is a live behaviour change and it is not shipping on the back of a security fix, so
 * `LIVE_REFRESH_FIREHOSE_ENABLED` is false. These tests exist so that re-enabling it is a
 * deliberate act with a failing test in front of it, rather than something that happens by
 * accident in an unrelated refactor.
 */
describe('the live-refresh firehose stays dormant', () => {
  afterEach(() => { sseSubscriptions.length = 0 })

  it('is switched off', () => {
    // Flipping this to true is the whole enablement change — and it must come with its own
    // review, deploy and watch. If you are here because this failed, that is the question
    // being asked of you.
    expect(LIVE_REFRESH_FIREHOSE_ENABLED).toBe(false)
  })

  it('opens no stream of its own while disabled', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ json: () => Promise.resolve([]), ok: true } as unknown as Response)))

    renderHook(() => useLiveRefreshFirehose(), { wrapper })
    await waitFor(() => { expect(sseSubscriptions).toHaveLength(0) })
  })

  it('leaves the bell the only subscriber when both are mounted', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ json: () => Promise.resolve([]), ok: true } as unknown as Response)))

    renderHook(() => useGetEvents({ topic: 'krateo' }), { wrapper })
    renderHook(() => useLiveRefreshFirehose(), { wrapper })

    await waitFor(() => { expect(sseSubscriptions).toHaveLength(1) })
    // The one subscription is the bell's, on the bare endpoint. When the firehose is enabled
    // it will name this same url, which is precisely why they will then share one connection.
    expect(sseSubscriptions[0]?.url).toBe('https://portal.krateo.dev/events/notifications')
  })
})

/**
 * #503: a reconnect leaves a hole. sse-proxy keeps no replay and sends no ids, so events
 * published while the stream was down are gone — and the list only ever grows from the
 * stream's side, so without this the bell would carry that hole until a page reload.
 */
describe('useGetEvents — a reopened stream refetches the baseline', () => {
  afterEach(() => {
    sseSubscriptions.length = 0
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const mount = () => {
    const fetchMock = vi.fn(() => Promise.resolve({ json: () => Promise.resolve([]), ok: true, status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    renderHook(() => useGetEvents({}), { wrapper })

    return fetchMock
  }

  it('refetches /events when the stream REOPENS', async () => {
    const fetchMock = mount()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    sseSubscriptions[0]?.onOpen?.({ reopened: true })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })

  it('does NOT refetch on the first open, which it is already fetching alongside', async () => {
    // The control arm. Without it, "refetch on open" would pass while doubling the request
    // on every single mount of the bell.
    const fetchMock = mount()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    sseSubscriptions[0]?.onOpen?.({ reopened: false })
    await new Promise<void>((resolve) => { setTimeout(resolve, 20) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

/**
 * An event burst (sse-proxy replaying a stalled backlog) must neither grow the list nor copy it per
 * event. In a background tab react-query's notifications are deferred, and each pending notification
 * pins the list it carries. The /events baseline is bounded too, on first load and on every reopen.
 */
describe('useGetEvents — an event burst stays bounded', () => {
  afterEach(() => {
    sseSubscriptions.length = 0
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const eventObject = (seq: number) => ({
    involvedObject: { kind: 'Pod', name: `pod-${seq}` },
    message: `event-${seq}`,
    reason: 'Started',
    type: 'Normal',
  })
  const event = (seq: number) => JSON.stringify(eventObject(seq))
  const baseline = (size: number) => Array.from({ length: size }, (_, seq) => eventObject(seq))

  const mount = async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ json: () => Promise.resolve([]), ok: true, status: 200 })))
    const { result } = renderHook(() => useGetEvents({}), { wrapper })
    await waitFor(() => { expect(result.current.data).toEqual([]) })

    return { push: (seq: number) => { sseSubscriptions[0]?.onMessage?.(event(seq)) }, result }
  }

  it('caps an oversized /events baseline on first load', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ json: () => Promise.resolve(baseline(500)), ok: true, status: 200 })))
    const { result } = renderHook(() => useGetEvents({}), { wrapper })

    await waitFor(() => { expect(result.current.data).toHaveLength(200) })
    expect(result.current.data?.[0]?.message).toBe('event-0')
  })

  it('caps the baseline a reopened stream refetches', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ json: () => Promise.resolve(baseline(10)), ok: true, status: 200 })
      .mockResolvedValueOnce({ json: () => Promise.resolve(baseline(600)), ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useGetEvents({}), { wrapper })
    await waitFor(() => { expect(result.current.data).toHaveLength(10) })

    sseSubscriptions[0]?.onOpen?.({ reopened: true })
    await waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(2) })
    await waitFor(() => { expect(result.current.data).toHaveLength(200) })
  })

  it('never holds more than 200 events during a burst', async () => {
    const { push, result } = await mount()
    for (let seq = 0; seq < 500; seq++) { push(seq) }

    await waitFor(() => { expect(result.current.data?.[0]?.message).toBe('event-499') })
    expect(result.current.data).toHaveLength(200)
    expect(result.current.data?.[199]?.message).toBe('event-300')
  })

  it('prepends without copying the events already in the list', async () => {
    const { push, result } = await mount()
    push(0)
    push(1)
    await waitFor(() => { expect(result.current.data?.[0]?.message).toBe('event-1') })
    const [newest, older] = result.current.data ?? []

    push(2)
    await waitFor(() => { expect(result.current.data?.[0]?.message).toBe('event-2') })
    expect(result.current.data?.[1]).toBe(newest)
    expect(result.current.data?.[2]).toBe(older)
  })
})

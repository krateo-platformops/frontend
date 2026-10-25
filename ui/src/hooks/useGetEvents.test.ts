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
 * parsing — is sseClient.test.ts's subject, so sseClient is mocked at its seam here.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useGetEvents } from './useGetEvents'
import { LIVE_REFRESH_FIREHOSE_ENABLED, useLiveRefreshFirehose } from './useLiveRefresh'

const { sseSubscriptions } = vi.hoisted(() => ({
  sseSubscriptions: [] as { url: string; topic: string }[],
}))

vi.mock('./sseClient', () => ({
  subscribeSse: (url: string, topic: string) => {
    sseSubscriptions.push({ topic, url })

    return () => undefined
  },
}))

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

vi.mock('../utils/getAccessToken', () => ({ getAccessToken: () => 'header.payload.signature' }))

const wrapper = ({ children }: { children: ReactNode }) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return QueryClientProvider({ children, client })
}

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

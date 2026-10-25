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
import { useLiveRefreshFirehose } from './useLiveRefresh'

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
 * The connection-sharing consequence of taking the token out of the url.
 *
 * sseClient keys its connection map on the url. While the bell's url carried
 * `?access_token=…` and the firehose's did not, the two keys DIFFERED, so each opened
 * its own connection to the same endpoint — and the firehose's, having no credential at
 * all, was answered 401 by sse-proxy's requireSSEToken. The firehose's own docstring
 * claims it "reuses the connection Notifications already holds (no extra socket)", which
 * the token in the url had quietly made false.
 *
 * With the credential in a header, both call sites name the same endpoint, so they key
 * the same cell and genuinely share one authenticated stream. That is what this pins:
 * not that sharing works (sseClient.test.ts covers that), but that these two agree on
 * the string it keys on.
 */
describe('the bell and the live-refresh firehose share one stream', () => {
  afterEach(() => { sseSubscriptions.length = 0 })

  it('subscribe to the identical endpoint, so sseClient keys them to one connection', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ json: () => Promise.resolve([]), ok: true } as unknown as Response)))

    renderHook(() => useGetEvents({ topic: 'krateo' }), { wrapper })
    renderHook(() => useLiveRefreshFirehose(), { wrapper })

    await waitFor(() => { expect(sseSubscriptions).toHaveLength(2) })

    const [bell, firehose] = sseSubscriptions
    expect(firehose?.url).toBe(bell?.url)
    expect(bell?.url).toBe('https://portal.krateo.dev/events/notifications')
  })
})

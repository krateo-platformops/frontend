// @vitest-environment jsdom
/* eslint-disable sort-keys/sort-keys-fix */
/* Expected coordinate objects mirror the snowplow protocol doc order, not alphabetical. */

/**
 * snowplow#1324 — resubscribe with the digest each widget holds, so a missed change is caught up.
 *
 * `/refreshes` keeps no replay, and this tab re-opens its one stream on every widget mount and
 * unmount. A change published while a key was not armed reached nobody; once snowplow#1321 stops
 * the periodic identical republish, it stays lost until the next real change. The contract
 * (snowplow docs/howto-frontend-refresh-digest-catch-up.md): every armed `/call` answer carries
 * `X-Snowplow-Refresh-Digest`, the tab echoes it as `held` on each coordinate when it (re)opens,
 * and snowplow sends one ordinary `refresh` frame for every key the tab is behind on.
 *
 * The load-bearing caveat is §4: `held` must stay OUT of the equality that decides whether a
 * refetch re-arms, or every refetch that brought new bytes would re-open the stream.
 */

import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { raiseSessionExpired } from '../utils/sessionResume'

import {
  REFRESH_HEADER_CLASS,
  REFRESH_HEADER_DIGEST,
  REFRESH_HEADER_KEY,
  RefreshManager,
  __resetRefreshEntries,
  getHeldDigest,
  getRefreshEntry,
  recordRefreshHeaders,
  refreshManager,
  type SubscribedCoords,
} from './refreshSse'
import { useWidgetLiveRefresh } from './useWidgetLiveRefresh'

vi.mock('../utils/sessionResume', () => ({ raiseSessionExpired: vi.fn(() => Promise.resolve('resumed')) }))

/** The signed-in session an arming widget hands the manager (its transport's `session`). */
const CRED = { getAccessToken: () => 'test-token', resume: () => raiseSessionExpired() }

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

const DIGEST_A = 'v1.0a8f3f6d7eb6f73c0be6c50db2744fb0'
const DIGEST_B = 'v1.ffeeddccbbaa99887766554433221100'

/** An SSE response that stays open and never enqueues, so the connect counts as successful. */
const openStream = (): Response => ({
  ok: true,
  status: 200,
  body: new ReadableStream<Uint8Array>({ start() { /* held open */ } }),
}) as unknown as Response

/** An SSE response whose first bytes are `frames`, then held open — what a catch-up looks like. */
const streamWith = (frames: string): Response => ({
  ok: true,
  status: 200,
  body: new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode(frames)) },
  }),
}) as unknown as Response

/** The `/call` query params a Panel widget is fetched with. */
const params = (name: string): URLSearchParams => new URLSearchParams({
  apiVersion: 'widgets.templates.krateo.io/v1beta1',
  resource: 'panels',
  name,
  namespace: 'krateo-system',
})

/** The `/call` response headers; `digest` omitted = an older snowplow / unstamped path. */
const callHeaders = (key: string, digest?: string): Headers => {
  const headers = new Headers({ [REFRESH_HEADER_CLASS]: 'widgets', [REFRESH_HEADER_KEY]: key })
  if (digest !== undefined) { headers.set(REFRESH_HEADER_DIGEST, digest) }
  return headers
}

/** The coordinates the Nth `/refreshes` open carried in its POST body. */
const sentBody = (fetchMock: ReturnType<typeof vi.fn<FetchFn>>, call: number): SubscribedCoords[] =>
  JSON.parse(fetchMock.mock.calls[call][1]?.body as string) as SubscribedCoords[]

/** Arm `widgetId` from the entry its `/call` recorded, as useWidgetLiveRefresh does. */
const armFromEntry = (mgr: RefreshManager, widgetId: string, refetch = vi.fn()): (() => void) => {
  const entry = getRefreshEntry(widgetId)
  if (!entry) { throw new Error(`no entry recorded for ${widgetId}`) }
  return mgr.arm(widgetId, entry.coords, entry.key, refetch)
}

beforeEach(() => { vi.useFakeTimers() })

afterEach(() => {
  __resetRefreshEntries()
  refreshManager.reset()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('snowplow#1324 — recording the digest', () => {
  it('records the digest beside the entry and replaces it on EVERY refetch, even an identical-entry one', () => {
    recordRefreshHeaders('w', params('dashboard'), callHeaders('k1', DIGEST_A))
    const first = getRefreshEntry('w')
    expect(getHeldDigest('w', 'k1')).toBe(DIGEST_A)

    recordRefreshHeaders('w', params('dashboard'), callHeaders('k1', DIGEST_B))

    // The entry is the SAME object (the arm hook's effect dep), yet the digest moved.
    expect(getRefreshEntry('w')).toBe(first)
    expect(getHeldDigest('w', 'k1')).toBe(DIGEST_B)
  })

  it('forgets the digest when a later answer carries none, rather than echoing a stale one', () => {
    recordRefreshHeaders('w', params('dashboard'), callHeaders('k1', DIGEST_A))
    recordRefreshHeaders('w', params('dashboard'), callHeaders('k1'))

    expect(getRefreshEntry('w')).toBeDefined()
    expect(getHeldDigest('w', 'k1')).toBeUndefined()
  })

  it('never answers a digest for a key other than the one it was stamped with', () => {
    recordRefreshHeaders('w', params('dashboard'), callHeaders('k2', DIGEST_A))

    expect(getHeldDigest('w', 'k1')).toBeUndefined()
    expect(getHeldDigest('w', 'k2')).toBe(DIGEST_A)
  })
})

describe('snowplow#1324 — `held` on the subscription', () => {
  it('sends `held` on subscribe, and the CURRENT digest again on every re-subscribe', async () => {
    const fetchMock = vi.fn<FetchFn>(() => Promise.resolve(openStream()))
    vi.stubGlobal('fetch', fetchMock)
    const mgr = new RefreshManager()
    mgr.configure('https://portal.example/content', CRED)

    recordRefreshHeaders('w0', params('dashboard'), callHeaders('k0', DIGEST_A))
    armFromEntry(mgr, 'w0')
    await vi.advanceTimersByTimeAsync(500)

    // The doc's wire example, verbatim.
    expect(sentBody(fetchMock, 0)).toEqual([{
      class: 'widgets',
      group: 'widgets.templates.krateo.io',
      version: 'v1beta1',
      resource: 'panels',
      namespace: 'krateo-system',
      name: 'dashboard',
      held: DIGEST_A,
    }])

    // w0 refetches (new bytes → new digest, same entry), then a mount re-opens the stream.
    recordRefreshHeaders('w0', params('dashboard'), callHeaders('k0', DIGEST_B))
    recordRefreshHeaders('w1', params('sidebar'), callHeaders('k1', DIGEST_A))
    armFromEntry(mgr, 'w1')
    await vi.advanceTimersByTimeAsync(500)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const resent = sentBody(fetchMock, 1)
    expect(resent.find((coord) => coord.name === 'dashboard')?.held).toBe(DIGEST_B)
    expect(resent.find((coord) => coord.name === 'sidebar')?.held).toBe(DIGEST_A)

    mgr.reset()
  })

  it('also carries `held` on the GET ?sub= fallback to a server without the body transport', async () => {
    const fetchMock = vi.fn<FetchFn>((url) => Promise.resolve(url.includes('?sub=')
      ? openStream()
      : ({ ok: false, status: 405, body: null }) as unknown as Response))
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const mgr = new RefreshManager()
    mgr.configure('https://portal.example/content', CRED)

    recordRefreshHeaders('w0', params('dashboard'), callHeaders('k0', DIGEST_A))
    armFromEntry(mgr, 'w0')
    await vi.advanceTimersByTimeAsync(500)

    const sub = new URL(fetchMock.mock.calls[1][0]).searchParams.get('sub') ?? ''
    const decoded = JSON.parse(atob(sub.replace(/-/g, '+').replace(/_/g, '/'))) as SubscribedCoords[]
    expect(decoded[0].held).toBe(DIGEST_A)

    mgr.reset()
  })

  it('sends NO `held` field at all for a widget whose answer carried no digest', async () => {
    const fetchMock = vi.fn<FetchFn>(() => Promise.resolve(openStream()))
    vi.stubGlobal('fetch', fetchMock)
    const mgr = new RefreshManager()
    mgr.configure('https://portal.example/content', CRED)

    recordRefreshHeaders('w0', params('dashboard'), callHeaders('k0'))
    armFromEntry(mgr, 'w0')
    await vi.advanceTimersByTimeAsync(500)

    const [coord] = sentBody(fetchMock, 0)
    expect(coord.name).toBe('dashboard')
    expect('held' in coord).toBe(false)

    mgr.reset()
  })

  it('sends no `held` while the recorded digest belongs to a key the widget has not re-armed under yet', async () => {
    const fetchMock = vi.fn<FetchFn>(() => Promise.resolve(openStream()))
    vi.stubGlobal('fetch', fetchMock)
    const mgr = new RefreshManager()
    mgr.configure('https://portal.example/content', CRED)

    recordRefreshHeaders('w0', params('dashboard'), callHeaders('k0', DIGEST_A))
    armFromEntry(mgr, 'w0')
    // A refetch answered under a NEW key; the arm hook has not re-run yet, and another widget's
    // mount re-opens the stream in between.
    recordRefreshHeaders('w0', params('dashboard'), callHeaders('k0-new', DIGEST_B))
    mgr.arm('w1', { class: 'widgets', group: 'g', version: 'v1', resource: 'r', namespace: 'ns', name: 'other' }, 'k1', vi.fn())
    await vi.advanceTimersByTimeAsync(500)

    const dashboard = sentBody(fetchMock, 0).find((sent) => sent.name === 'dashboard')
    expect(dashboard).toBeDefined()
    expect(dashboard && 'held' in dashboard).toBe(false)

    mgr.reset()
  })
})

describe('snowplow#1324 — `held` stays out of the re-arm decision', () => {
  it('a refetch that only moves the digest does NOT re-arm or re-open the stream', async () => {
    const fetchMock = vi.fn<FetchFn>(() => Promise.resolve(openStream()))
    vi.stubGlobal('fetch', fetchMock)
    const armSpy = vi.spyOn(refreshManager, 'arm')
    const refetch = vi.fn()

    recordRefreshHeaders('w', params('dashboard'), callHeaders('k1', DIGEST_A))
    const { rerender, unmount } = renderHook(
      () => { useWidgetLiveRefresh('w', getRefreshEntry('w'), refetch, 'https://portal.example/content', true, CRED) },
    )
    await vi.advanceTimersByTimeAsync(500)
    expect(armSpy).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // The refetch resolves with new bytes: new digest, same key and coords. The resolved query
    // re-renders the widget, which reads the entry again.
    recordRefreshHeaders('w', params('dashboard'), callHeaders('k1', DIGEST_B))
    rerender()
    await vi.advanceTimersByTimeAsync(500)

    expect(armSpy).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    unmount()
  })
})

describe('snowplow#1324 — the catch-up frame', () => {
  it('refetches the widget it names, exactly like any other refresh frame', async () => {
    const fetchMock = vi.fn<FetchFn>(() => Promise.resolve(streamWith('event: refresh\ndata: k0\n\n')))
    vi.stubGlobal('fetch', fetchMock)
    const mgr = new RefreshManager()
    mgr.configure('https://portal.example/content', CRED)
    const behind = vi.fn()
    const current = vi.fn()

    recordRefreshHeaders('w0', params('dashboard'), callHeaders('k0', DIGEST_A))
    recordRefreshHeaders('w1', params('sidebar'), callHeaders('k1', DIGEST_A))
    armFromEntry(mgr, 'w0', behind)
    armFromEntry(mgr, 'w1', current)
    await vi.advanceTimersByTimeAsync(500)

    expect(behind).toHaveBeenCalledTimes(1)
    expect(current).not.toHaveBeenCalled()

    mgr.reset()
  })
})

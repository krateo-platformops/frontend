/* eslint-disable sort-keys/sort-keys-fix */
/* Expected coordinate objects mirror the snowplow protocol doc order, not alphabetical. */

/**
 * snowplow#560 — the subscription moves from the URL to a POST body.
 *
 * `GET /refreshes?sub=` carried the whole subscription base64'd in the query string, growing
 * ~361 B per widget. Measured on krateo-057: a 50-widget composition page produced an
 * 18,098-character URL and the ingress answered 431 before snowplow saw it — 0 stream chunks,
 * 6 immediate closes — while a 17-widget page on the same build and persona returned 200 and
 * held its stream open. Live refresh was structurally dead above roughly 22 widgets.
 *
 * snowplow accepts the body from 1.12.41. These tests pin the fallback as much as the POST:
 * against an older server the client must keep working unchanged, so the two halves can deploy
 * in either order.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  RefreshManager,
  __resetRefreshEntries,
  type RefreshCoords,
} from './refreshSse'

vi.mock('../utils/sessionResume', () => ({ raiseSessionExpired: vi.fn(() => Promise.resolve('resumed')) }))
vi.mock('../utils/getAccessToken', () => ({ getAccessToken: () => 'test-token' }))

afterEach(() => {
  __resetRefreshEntries()
  vi.unstubAllGlobals()
})

/** The shape of the global `fetch` the manager calls, so `mock.calls` is a typed tuple. */
type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

/** An SSE response that stays open, so the manager treats the connect as successful. */
const openStream = (): Response => ({
  ok: true,
  status: 200,
  body: new ReadableStream<Uint8Array>({ start() { /* held open; never enqueues */ } }),
}) as unknown as Response

/** What an older snowplow answers when it has no POST route on /refreshes. */
const methodNotAllowed = (status: number): Response => ({
  ok: false,
  status,
  body: null,
}) as unknown as Response

const coords = (name: string): RefreshCoords =>
  ({ class: 'widgets', group: 'g', version: 'v1', resource: 'r', namespace: 'ns', name })

/** Arm one widget and let the debounced connect fire. */
const connect = async (mgr: RefreshManager, count = 1): Promise<void> => {
  for (let i = 0; i < count; i += 1) {
    mgr.arm(`w${i}`, coords(`n${i}`), `key-${i}`, vi.fn())
  }
  await vi.advanceTimersByTimeAsync(500)
}

describe('snowplow#560 — POST subscription', () => {
  it('sends the coordinates as a JSON body, not in the URL', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn<FetchFn>(() => Promise.resolve(openStream()))
    vi.stubGlobal('fetch', fetchMock)

    const mgr = new RefreshManager()
    mgr.configure('https://portal.example/content')
    await connect(mgr, 3)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [[url, init]] = fetchMock.mock.calls

    expect(url).toBe('https://portal.example/content/refreshes')
    expect(url).not.toContain('?sub=')
    expect(init?.method).toBe('POST')
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json')

    // The body is the coordinate array verbatim — raw JSON, no base64 inflation.
    const sent = JSON.parse(init?.body as string) as RefreshCoords[]
    expect(sent).toHaveLength(3)
    expect(sent[0]).toMatchObject({ class: 'widgets', resource: 'r', name: 'n0' })

    mgr.reset()
    vi.useRealTimers()
  })

  it('still authorizes with the Bearer token and asks for an event stream', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn<FetchFn>(() => Promise.resolve(openStream()))
    vi.stubGlobal('fetch', fetchMock)

    const mgr = new RefreshManager()
    mgr.configure('https://portal.example/content')
    await connect(mgr)

    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer test-token')
    expect(headers.Accept).toBe('text/event-stream')

    mgr.reset()
    vi.useRealTimers()
  })
})

describe('snowplow#560 — fallback to GET against a server that predates the body transport', () => {
  it.each([404, 405])('falls back to GET ?sub= on %i and still opens the stream', async (status) => {
    vi.useFakeTimers()
    const fetchMock = vi.fn<FetchFn>()
      .mockResolvedValueOnce(methodNotAllowed(status))
      .mockImplementation(() => Promise.resolve(openStream()))
    vi.stubGlobal('fetch', fetchMock)

    const mgr = new RefreshManager()
    mgr.configure('https://portal.example/content')
    await connect(mgr, 2)

    expect(fetchMock).toHaveBeenCalledTimes(2)

    const [[, postInit], [getUrl, getInit]] = fetchMock.mock.calls
    expect(postInit?.method).toBe('POST')

    expect(getUrl).toContain('/refreshes?sub=')
    expect(getInit?.method).toBeUndefined()
    expect(getInit?.body).toBeUndefined()

    mgr.reset()
    vi.useRealTimers()
  })

  it('does not re-probe POST on later connects once the server has refused it', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn<FetchFn>()
      .mockResolvedValueOnce(methodNotAllowed(405))
      .mockImplementation(() => Promise.resolve(openStream()))
    vi.stubGlobal('fetch', fetchMock)

    const mgr = new RefreshManager()
    mgr.configure('https://portal.example/content')
    await connect(mgr)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    // A second connect: arming another widget re-opens the stream.
    fetchMock.mockClear()
    mgr.arm('w-later', coords('later'), 'key-later', vi.fn())
    await vi.advanceTimersByTimeAsync(500)

    // One call, and it is the GET — no wasted POST round trip per reconnect.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toContain('?sub=')

    mgr.reset()
    vi.useRealTimers()
  })

  it('does NOT treat a real error as "no POST route" — 500 is the caller\'s to handle', async () => {
    vi.useFakeTimers()
    const serverError = { ok: false, status: 500, body: null } as unknown as Response
    const fetchMock = vi.fn<FetchFn>(() => Promise.resolve(serverError))
    vi.stubGlobal('fetch', fetchMock)

    const mgr = new RefreshManager()
    mgr.configure('https://portal.example/content')
    await connect(mgr)

    // Exactly one attempt: a 500 is an answer, not a missing route, so there is no GET retry.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST')

    mgr.reset()
    vi.useRealTimers()
  })
})

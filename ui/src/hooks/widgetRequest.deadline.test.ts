/**
 * A widget read that never settles reaches the timeout state instead of the skeleton for good.
 * Fake timers drive the deadline; `fetch` stubs stand in for the transport.
 */
import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { isTimeoutError } from '../components/WidgetStates'

import { fetchWidgetPage, WIDGET_READ_DEADLINE_MS, type WidgetRead, WidgetReadTimeoutError, widgetQueryKey } from './widgetRequest'
import { MAX_WIDGET_FETCH_RETRIES, shouldRetryWidgetFetch, widgetFetchRetryDelay } from './widgetRetry'

vi.mock('./refreshSse', () => ({ recordRefreshHeaders: vi.fn() }))

const answer = () => new Response(JSON.stringify({ kind: 'Paragraph', metadata: { name: 'x' } }), { headers: { 'content-type': 'application/json' }, status: 200 })

type Fetch = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>
const readWith = (fetch: Fetch): WidgetRead => ({ extrasInBody: false, extrasParam: '', transport: { fetch, onUnauthorized: vi.fn() } as WidgetRead['transport'], url: 'http://sp/call?name=x' })
/** A transport whose request never settles and, like the real one, ignores nothing it need not. */
const hangs: Fetch = () => new Promise<Response>(() => { /* never */ })

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('fetchWidgetPage deadline', () => {
  it('a read that never settles fails as a timeout once the deadline passes, and not before', async () => {
    const outcome = fetchWidgetPage(readWith(hangs), {}).then(() => 'settled', (error: unknown) => error)
    await vi.advanceTimersByTimeAsync(WIDGET_READ_DEADLINE_MS - 1)
    let settled = false
    void outcome.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const error = await outcome
    expect(error).toBeInstanceOf(WidgetReadTimeoutError)
    // The state WidgetRenderer shows for it, and no status was invented.
    expect(isTimeoutError(error)).toBe(true)
    expect((error as { status?: number }).status).toBeUndefined()
  })

  it('aborts the transport request when the deadline passes', async () => {
    let seen: AbortSignal | undefined
    const fetch: Fetch = (_url, init) => {
      seen = init?.signal
      return hangs('')
    }
    void fetchWidgetPage(readWith(fetch), {}).catch(() => undefined)
    await vi.advanceTimersByTimeAsync(WIDGET_READ_DEADLINE_MS)
    expect(seen?.aborted).toBe(true)
  })

  it('a cancel before the deadline is a cancel, not a timeout, and leaves no timer behind', async () => {
    const caller = new AbortController()
    const outcome = fetchWidgetPage(readWith(hangs), {}, caller.signal).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(WIDGET_READ_DEADLINE_MS / 2)
    caller.abort()
    const error = await outcome
    expect(error).not.toBeInstanceOf(WidgetReadTimeoutError)
    expect((error as Error).name).toBe('AbortError')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a signal already aborted is a cancel at once', async () => {
    const caller = new AbortController()
    caller.abort()
    const error = await fetchWidgetPage(readWith(hangs), {}, caller.signal).catch((caught: unknown) => caught)
    expect(error).not.toBeInstanceOf(WidgetReadTimeoutError)
  })

  it('a read answering just before the deadline renders its data', async () => {
    const fetch: Fetch = () => new Promise<Response>((resolve) => {
      setTimeout(() => { resolve(answer()) }, WIDGET_READ_DEADLINE_MS - 1)
    })
    const outcome = fetchWidgetPage(readWith(fetch), {})
    await vi.advanceTimersByTimeAsync(WIDGET_READ_DEADLINE_MS - 1)
    await expect(outcome).resolves.toMatchObject({ kind: 'Paragraph' })
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('the deadline under the widget retry policy', () => {
  it('is NOT retried: a hang makes exactly one attempt and ends as the timeout state', async () => {
    const fetch = vi.fn<Fetch>(hangs)
    const queryClient = new QueryClient()
    const key = widgetQueryKey('/call?name=x', '')
    const outcome = queryClient.fetchInfiniteQuery({
      initialPageParam: {},
      queryFn: ({ pageParam, signal }) => fetchWidgetPage(readWith(fetch), pageParam, signal),
      queryKey: key,
      retry: (count: number, error: unknown) => shouldRetryWidgetFetch(count, error),
      retryDelay: widgetFetchRetryDelay,
    }).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    const error = await outcome
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(error).toBeInstanceOf(WidgetReadTimeoutError)
    expect(isTimeoutError(error)).toBe(true)
  })

  it('a snowplow 504 keeps today\'s policy: the first attempt plus MAX_WIDGET_FETCH_RETRIES', async () => {
    const fetch = vi.fn<Fetch>(() => Promise.resolve(new Response('{}', { status: 504, statusText: 'Gateway Timeout' })))
    const queryClient = new QueryClient()
    const outcome = queryClient.fetchInfiniteQuery({
      initialPageParam: {},
      queryFn: ({ pageParam, signal }) => fetchWidgetPage(readWith(fetch), pageParam, signal),
      queryKey: widgetQueryKey('/call?name=x', ''),
      retry: (count: number, error: unknown) => shouldRetryWidgetFetch(count, error),
      retryDelay: widgetFetchRetryDelay,
    }).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    const error = await outcome
    expect(fetch).toHaveBeenCalledTimes(1 + MAX_WIDGET_FETCH_RETRIES)
    expect(isTimeoutError(error)).toBe(true)
    expect(shouldRetryWidgetFetch(0, new WidgetReadTimeoutError(WIDGET_READ_DEADLINE_MS))).toBe(false)
  })

  it('a query cancelled by react-query (observer unmount) is not retried and ends as a cancel', async () => {
    const fetch = vi.fn<Fetch>(hangs)
    const queryClient = new QueryClient()
    const key = widgetQueryKey('/call?name=x', '')
    const outcome = queryClient.fetchInfiniteQuery({
      initialPageParam: {},
      queryFn: ({ pageParam, signal }) => fetchWidgetPage(readWith(fetch), pageParam, signal),
      queryKey: key,
      retry: (count: number, error: unknown) => shouldRetryWidgetFetch(count, error),
      retryDelay: widgetFetchRetryDelay,
    }).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(WIDGET_READ_DEADLINE_MS / 2)
    await queryClient.cancelQueries({ queryKey: key })
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    const error = await outcome
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(error).not.toBeInstanceOf(WidgetReadTimeoutError)
  })
})

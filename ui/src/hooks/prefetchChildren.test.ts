/**
 * prefetchChildren: on a widget's answer, the reads of the children it draws on first render start,
 * under the key each child's own query uses, and nothing else is read.
 */
import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Widget } from '../types/Widget'

import { prefetchableChildEndpoints, prefetchChildren } from './prefetchChildren'
import { recordRefreshHeaders } from './refreshSse'
import { widgetQueryKey } from './widgetRequest'
import { MAX_WIDGET_FETCH_RETRIES } from './widgetRetry'

vi.mock('./refreshSse', () => ({ recordRefreshHeaders: vi.fn() }))

const BASE = 'http://sp'
const ref = (id: string, extra: Record<string, unknown> = {}) => ({ allowed: true, id, path: `/call?resource=x&name=${id}`, payload: {}, verb: 'GET', ...extra })

const flex = (refs: unknown[], items = refs.map((item) => ({ resourceRefId: (item as { id: string }).id }))): Widget => ({
  apiVersion: 'widgets.templates.krateo.io/v1beta1',
  kind: 'Flex',
  metadata: { name: 'parent', namespace: 'krateo-system' },
  status: { resourcesRefs: { items: refs }, widgetData: { items } },
} as unknown as Widget)

const answer = (name: string) => new Response(JSON.stringify({ kind: 'Paragraph', metadata: { name } }), { headers: { 'content-type': 'application/json' }, status: 200 })

const setup = () => {
  const fetch = vi.fn((url: string) => Promise.resolve(answer(new URL(url).searchParams.get('name') ?? '')))
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })
  const context = { baseUrl: BASE, childExtrasParam: '{"q":"x"}', extrasInBody: false, isWanted: () => true, liveRefresh: false, search: new URLSearchParams(), transport: { fetch, onUnauthorized: vi.fn() } }
  return { context, fetch, queryClient }
}

afterEach(() => { vi.clearAllMocks() })

describe('prefetchChildren', () => {
  it('reads each drawn child once, under the key the child\'s own query uses, with the child\'s extras', async () => {
    const { context, fetch, queryClient } = setup()
    prefetchChildren(queryClient, flex([ref('a'), ref('b')]), context)
    await vi.waitFor(() => { expect(fetch).toHaveBeenCalledTimes(2) })
    const urls = fetch.mock.calls.map(([url]) => new URL(url))
    expect(urls.map((url) => url.searchParams.get('name')).sort()).toEqual(['a', 'b'])
    expect(urls.every((url) => url.searchParams.get('extras') === '{"q":"x"}')).toBe(true)
    await vi.waitFor(() => {
      expect(queryClient.getQueryData(widgetQueryKey('/call?resource=x&name=a', '{"q":"x"}'))).toMatchObject({ pages: [{ metadata: { name: 'a' } }] })
    })
  })

  it('a prefetched child prefetches its own children: the whole first-render tree is in flight', async () => {
    const { context, queryClient } = setup()
    const nested = flex([ref('leaf')])
    const fetch = vi.fn((url: string) => {
      const name = new URL(url).searchParams.get('name')
      const body = name === 'mid' ? nested : { kind: 'Paragraph', metadata: { name } }
      return Promise.resolve(new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' }, status: 200 }))
    })
    prefetchChildren(queryClient, flex([ref('mid')]), { ...context, transport: { fetch, onUnauthorized: vi.fn() } })
    await vi.waitFor(() => { expect(fetch.mock.calls.map(([url]) => new URL(url).searchParams.get('name'))).toEqual(['mid', 'leaf']) })
  })

  it('reads nothing for a widget no longer displayed, and stops a cascade under it', async () => {
    const { context, queryClient } = setup()
    let wanted = true
    const nested = flex([ref('leaf')])
    const fetch = vi.fn((url: string) => {
      const name = new URL(url).searchParams.get('name')
      // The page is left while `mid` is in flight.
      wanted = false
      return Promise.resolve(new Response(JSON.stringify(name === 'mid' ? nested : { kind: 'Paragraph' }), { headers: { 'content-type': 'application/json' }, status: 200 }))
    })
    prefetchChildren(queryClient, flex([ref('a')]), { ...context, isWanted: () => false })
    prefetchChildren(queryClient, flex([ref('mid')]), { ...context, isWanted: () => wanted, transport: { fetch, onUnauthorized: vi.fn() } })
    await vi.waitFor(() => { expect(queryClient.getQueryState(widgetQueryKey('/call?resource=x&name=mid', '{"q":"x"}'))?.status).toBe('success') })
    expect(fetch.mock.calls.map(([url]) => new URL(url).searchParams.get('name'))).toEqual(['mid'])
  })

  describe('a failed read follows the widget query’s own retry policy', () => {
    afterEach(() => { vi.useRealTimers() })

    const failing = (status: number, times: number) => {
      let left = times
      return vi.fn((url: string) => {
        left -= 1
        return Promise.resolve(left >= 0 ? new Response('{}', { status }) : answer(new URL(url).searchParams.get('name') ?? ''))
      })
    }
    const run = async (fetch: ReturnType<typeof failing>, isWanted = () => true) => {
      vi.useFakeTimers()
      const { context, queryClient } = setup()
      prefetchChildren(queryClient, flex([ref('a')]), { ...context, isWanted, transport: { fetch, onUnauthorized: vi.fn() } })
      await vi.advanceTimersByTimeAsync(20_000)
      return queryClient.getQueryState(widgetQueryKey('/call?resource=x&name=a', '{"q":"x"}'))
    }

    it.each([503, 404])('a %s is read again until it answers', async (status) => {
      const fetch = failing(status, 2)
      expect((await run(fetch))?.status).toBe('success')
      expect(fetch).toHaveBeenCalledTimes(3)
    })

    it('gives up after as many tries as the widget’s own query', async () => {
      const fetch = failing(503, 99)
      expect((await run(fetch))?.status).toBe('error')
      expect(fetch).toHaveBeenCalledTimes(1 + MAX_WIDGET_FETCH_RETRIES)
    })

    it('a 403 is not retried', async () => {
      const fetch = failing(403, 99)
      await run(fetch)
      expect(fetch).toHaveBeenCalledTimes(1)
    })

    it('a page that was left is not read again', async () => {
      const fetch = failing(503, 99)
      let wanted = true
      fetch.mockImplementationOnce(() => {
        wanted = false
        return Promise.resolve(new Response('{}', { status: 503 }))
      })
      await run(fetch, () => wanted)
      expect(fetch).toHaveBeenCalledTimes(1)
    })
  })

  it('skips a denied ref, a failed part, a non-GET ref and a paged child', () => {
    const widget = flex([
      ref('ok'),
      ref('denied', { allowed: false }),
      ref('failed', { allowed: false, error: { code: 424 } }),
      ref('write', { verb: 'POST' }),
      ref('paged', { path: '/call?resource=x&name=paged&page=1&perPage=50' }),
    ])
    expect(prefetchableChildEndpoints(widget, new URLSearchParams())).toEqual(['/call?resource=x&name=ok'])
  })

  it('reads nothing for a child it does not draw, or a kind that is not a container', () => {
    const notDrawn = flex([ref('a'), ref('b')], [{ resourceRefId: 'a' }])
    expect(prefetchableChildEndpoints(notDrawn, new URLSearchParams())).toEqual(['/call?resource=x&name=a'])
    const menu = { ...flex([ref('page')]), kind: 'Menu' } as Widget
    expect(prefetchableChildEndpoints(menu, new URLSearchParams())).toEqual([])
  })

  it('reads nothing already cached or in flight', async () => {
    const { context, fetch, queryClient } = setup()
    queryClient.setQueryData(widgetQueryKey('/call?resource=x&name=a', '{"q":"x"}'), { pageParams: [{}], pages: [{}] })
    prefetchChildren(queryClient, flex([ref('a'), ref('b')]), context)
    prefetchChildren(queryClient, flex([ref('a'), ref('b')]), context)
    await vi.waitFor(() => { expect(fetch).toHaveBeenCalledTimes(1) })
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get('name')).toBe('b')
  })

  it('arms live refresh under the child\'s widgetId when the parent\'s reads do', async () => {
    const { context, queryClient } = setup()
    const transport = { fetch: vi.fn(() => Promise.resolve(answer('a'))), onUnauthorized: vi.fn() }
    prefetchChildren(queryClient, flex([ref('a')]), { ...context, liveRefresh: true, transport })
    await vi.waitFor(() => { expect(recordRefreshHeaders).toHaveBeenCalledOnce() })
    expect(vi.mocked(recordRefreshHeaders).mock.calls[0][0]).toBe(JSON.stringify(widgetQueryKey('/call?resource=x&name=a', '{"q":"x"}')))
  })

  it('does not arm live refresh when the parent\'s reads do not', async () => {
    const { context, fetch, queryClient } = setup()
    prefetchChildren(queryClient, flex([ref('a')]), context)
    await vi.waitFor(() => { expect(fetch).toHaveBeenCalledOnce() })
    expect(recordRefreshHeaders).not.toHaveBeenCalled()
  })
})

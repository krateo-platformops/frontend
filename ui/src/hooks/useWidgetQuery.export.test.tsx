// @vitest-environment jsdom
/**
 * A Table export is a POST to snowplow's `/export`, never to the widget's `/call`.
 *
 * snowplow mounts `POST /export` (snowplow#970) on the same mux as `/call`, so it is a sibling of
 * `/call` under `SNOWPLOW_API_BASE_URL`. A POST to `/call` is snowplow's WRITE passthrough: it
 * tries to CREATE the widget's resource from the `{"extras": …}` body and the apiserver answers 400
 * ("Object 'Kind' is missing"). The export kept the widget's `/call` path after its extras moved
 * into the body, so every Table export failed that way.
 *
 * Pinned through the real chain a Table uses — the hook's `exportRequestFor`, the Table's own
 * export query (`buildExportRequest`), and `runExport` — down to the request that leaves the
 * browser: its path, its query (the widget's identifying params plus the export's), its method and
 * its body (the widget's extras).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildExportRequest } from '../widgets/Table/tableExport'
import { runExport } from '../widgets/Table/tableExportRun'

import { useWidgetQuery } from './useWidgetQuery'

// A base URL WITH a path: the export route sits under the snowplow base, as `/call` does.
vi.mock('../context/ConfigContext', () => ({
  useConfigContext: () => ({ config: { api: { SNOWPLOW_API_BASE_URL: 'http://sp.test/snowplow', SNOWPLOW_IDENTITY_INJECTION: 'true', WIDGET_LIVE_REFRESH_ENABLED: false } } }),
}))

// The widget's own read. It resolves, so the hook settles; the export request is what is asserted.
const readMock = vi.fn((_url: string, _init?: RequestInit) =>
  Promise.resolve(new Response(JSON.stringify({ kind: 'Table', metadata: { uid: 'u' }, status: { widgetData: {} } }), { headers: { 'Content-Type': 'application/json' }, status: 200 })))

beforeEach(() => {
  readMock.mockClear()
  vi.stubGlobal('fetch', readMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const TABLE_ENDPOINT = '/call?resource=tables&apiVersion=widgets.templates.krateo.io/v1beta1&name=pods-table&namespace=krateo-system'

const harness = (route: string) => ({ children }: { children: ReactNode }) => (
  <MemoryRouter initialEntries={[route]}>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
  </MemoryRouter>
)

/** The request `runExport` sends, captured instead of reaching a network. */
const captureExport = () => {
  const sent: { url: string; method?: string; body: string }[] = []
  const exportFetch = (url: string, init?: RequestInit) => {
    sent.push({ body: typeof init?.body === 'string' ? init.body : '', method: init?.method, url })
    return Promise.resolve(new Response('name,phase\nalpha,Running\n', { status: 200 }))
  }
  return { exportFetch, sent }
}

describe('a Table export goes to snowplow POST /export', () => {
  it('posts to /export under the snowplow base, with the widget\'s params and the export query, extras in the body', async () => {
    // `?q=nginx` on the page is what a search box leaves; it reaches the widget's extras.
    const { result } = renderHook(() => useWidgetQuery(TABLE_ENDPOINT), { wrapper: harness('/pods?q=nginx') })
    const request = buildExportRequest([{ title: 'Name', valueKey: 'name' }, { title: 'Phase', valueKey: 'phase' }], 'csv')
    expect(request).not.toBeNull()
    expect(result.current.exportRequestFor).toBeDefined()

    const { extras, url } = result.current.exportRequestFor!(request!.params)
    const { exportFetch, sent } = captureExport()
    const outcome = await runExport(url, extras, 'csv', 'pods.csv', { deliver: () => undefined, fetch: exportFetch })

    expect(outcome).toEqual({ ok: true, truncated: false })
    expect(sent).toHaveLength(1)
    const exported = new URL(sent[0].url)
    expect(exported.origin).toBe('http://sp.test')
    // The route, not the widget's /call: a POST there is snowplow's write passthrough.
    expect(exported.pathname).toBe('/snowplow/export')
    expect(sent[0].method).toBe('POST')

    // The widget's identifying params, as its own read sends them.
    expect(exported.searchParams.get('resource')).toBe('tables')
    expect(exported.searchParams.get('apiVersion')).toBe('widgets.templates.krateo.io/v1beta1')
    expect(exported.searchParams.get('name')).toBe('pods-table')
    expect(exported.searchParams.get('namespace')).toBe('krateo-system')
    // The export's own params, from the Table's columns.
    expect(exported.searchParams.get('format')).toBe('csv')
    expect(exported.searchParams.get('fields')).toBe('name,phase')
    expect(exported.searchParams.getAll('header')).toEqual(['Name', 'Phase'])
    expect(exported.searchParams.get('path')).toBe(new URLSearchParams(request!.params).get('path'))
    // `extras` rides in the body, never the query.
    expect(exported.searchParams.has('extras')).toBe(false)
    expect(JSON.parse(sent[0].body)).toEqual({ extras: { q: 'nginx' } })
  })

  it('keeps a cluster-scoped widget cluster-scoped: no namespace is invented', () => {
    const endpoint = '/call?resource=tables&apiVersion=widgets.templates.krateo.io/v1beta1&name=nodes-table'
    const { result } = renderHook(() => useWidgetQuery(endpoint), { wrapper: harness('/nodes') })
    const exported = new URL(result.current.exportRequestFor!('format=json').url)
    expect(exported.pathname).toBe('/snowplow/export')
    expect(exported.searchParams.has('namespace')).toBe(false)
    expect(exported.searchParams.get('name')).toBe('nodes-table')
    expect(exported.searchParams.get('format')).toBe('json')
  })

  it('offers no export for an endpoint that is not a /call read: there is nothing for /export to re-dispatch', () => {
    const { result } = renderHook(() => useWidgetQuery('/api-info/names?category=widgets'), { wrapper: harness('/') })
    expect(result.current.exportRequestFor).toBeUndefined()
  })
})

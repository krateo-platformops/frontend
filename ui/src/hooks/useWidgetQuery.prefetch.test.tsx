// @vitest-environment jsdom
/**
 * The hook end of "prefetch children on answer": useWidgetQuery, given a container's answer, starts
 * its first-render children's reads itself, under the key each child's own query will use.
 *
 * Deterministic where the landing e2e cannot be: only the PARENT's hook is rendered, so nothing but
 * the prefetch can read the child. Without it the child would never be fetched here at all.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useWidgetQuery } from './useWidgetQuery'

vi.mock('../context/ConfigContext', () => ({
  useConfigContext: () => ({ config: { api: { SNOWPLOW_API_BASE_URL: 'http://sp.test', SNOWPLOW_IDENTITY_INJECTION: 'true', WIDGET_LIVE_REFRESH_ENABLED: false } } }),
}))

const api = 'widgets.templates.krateo.io/v1beta1'
const endpoint = (resource: string, name: string) => `/call?resource=${resource}&apiVersion=${api}&name=${name}&namespace=krateo-system`
const PARENT = endpoint('flexes', 'page')
const CHILD = endpoint('paragraphs', 'hello')

const answers: Record<string, unknown> = {
  hello: { kind: 'Paragraph', metadata: { name: 'hello' }, status: { widgetData: { text: 'hi' } } },
  page: {
    kind: 'Flex',
    metadata: { name: 'page' },
    status: { resourcesRefs: { items: [{ allowed: true, id: 'h', path: CHILD, payload: {}, verb: 'GET' }] }, widgetData: { items: [{ resourceRefId: 'h' }] } },
  },
}

const reads: string[] = []
let release: () => void = () => undefined
let holdParent = false
const fetchMock = vi.fn(async (url: string) => {
  const name = new URL(url).searchParams.get('name') ?? ''
  reads.push(name)
  if (name === 'page' && holdParent) {
    await new Promise<void>((resolve) => { release = resolve })
  }
  return new Response(JSON.stringify(answers[name] ?? {}), { headers: { 'Content-Type': 'application/json' }, status: 200 })
})

beforeEach(() => {
  reads.length = 0
  holdParent = false
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const harness = (client: QueryClient) => ({ children }: { children: ReactNode }) => (
  <MemoryRouter initialEntries={['/dashboard']}>
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  </MemoryRouter>
)

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })

describe('useWidgetQuery prefetches a container\'s first-render children on its answer', () => {
  it('reads the child with only the parent mounted, and the child\'s own query then reads nothing', async () => {
    const queryClient = client()
    const parent = renderHook(() => useWidgetQuery(PARENT), { wrapper: harness(queryClient) })
    await waitFor(() => { expect(parent.result.current.queryResult.isSuccess).toBe(true) })
    await waitFor(() => { expect(reads).toEqual(['page', 'hello']) })

    const child = renderHook(() => useWidgetQuery(CHILD), { wrapper: harness(queryClient) })
    await waitFor(() => { expect(child.result.current.queryResult.data).toMatchObject({ metadata: { name: 'hello' } }) })
    expect(reads, 'the child found its answer in the cache: one read each').toEqual(['page', 'hello'])
  })

  it('reads nothing for a container that was unmounted before its answer arrived', async () => {
    holdParent = true
    const queryClient = client()
    const parent = renderHook(() => useWidgetQuery(PARENT), { wrapper: harness(queryClient) })
    await waitFor(() => { expect(reads).toEqual(['page']) })
    parent.unmount()
    release()
    await new Promise((resolve) => { setTimeout(resolve, 50) })
    expect(reads, 'the page was left: no read for its children').toEqual(['page'])
  })
})

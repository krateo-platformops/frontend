// @vitest-environment jsdom
/**
 * The page-context `extras` the rail sends for the URLs it already understood, pinned. RECORDED ON
 * `main`, when the collector carried only `status`, `range` and `q`, so widening it to every page
 * param is proven to send the same thing for a URL that carries only those (and nothing at all for
 * a URL with no query).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import { createElement } from 'react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { useAgentikoContext } from './useAgentikoContext'

const collectAt = (url: string) => {
  window.history.replaceState(null, '', url)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children)
  return renderHook(() => useAgentikoContext(), { wrapper }).result.current.collect()
}

afterEach(() => { window.history.replaceState(null, '', '/') })

describe('page-context extras for the params the rail always carried', () => {
  it('status, range and q ride as they are', () => {
    expect(collectAt('/incidents?status=open&range=7d&q=probe').extras).toEqual({ q: 'probe', range: '7d', status: 'open' })
  })

  it('an empty value is not carried', () => {
    expect(collectAt('/incidents?status=&q=probe').extras).toEqual({ q: 'probe' })
  })

  it('no query, no extras', () => {
    expect(collectAt('/incidents').extras).toBeUndefined()
  })
})

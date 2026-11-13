// @vitest-environment jsdom
/**
 * ASK AGENTIKO DESCRIBES THE FILTERED VIEW.
 *
 * The rail's page context carried three URL params, `status`, `range` and `q`. A root page filtered
 * by any other facet (`?kind=Alert&repo=org/x`), switched to its table (`?view=table`) or scoped to
 * projects reached Agentiko as the unfiltered page, so "summarise these" described rows the person
 * had filtered away. Every page param is now context, except the few that describe no view.
 * contextExtras.unchanged.test.ts pins that the three old params still ride exactly as before.
 *
 * Asserted through the real `collect()`, the hop a model actually receives.
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

describe('the rail carries every page param', () => {
  it('a facet filter and the table view', () => {
    expect(collectAt('/reviews?kind=Alert&view=table').extras).toEqual({ kind: 'Alert', view: 'table' })
  })

  it('multi-valued facets, the project scope and the grouping, alongside the old three', () => {
    expect(collectAt('/incidents?status=Open,Analyzing&alert=sre-probe&projects=team-a,team-b&group=age&q=probe').extras).toEqual({
      alert: 'sre-probe',
      group: 'age',
      projects: 'team-a,team-b',
      q: 'probe',
      status: 'Open,Analyzing',
    })
  })

  it('leaves out what describes no view: the seed prompt, a spotlight, an OAuth handshake', () => {
    expect(collectAt('/marketplace?ask=what+is+this&spotlight=redis&code=abc&state=xyz&category=db').extras).toEqual({ category: 'db' })
  })

  it('a param named like a prototype key is an ordinary key', () => {
    const { extras } = collectAt('/x?constructor=a&__proto__=b')
    expect(Object.keys(extras ?? {}).sort()).toEqual(['__proto__', 'constructor'])
    expect(Object.getPrototypeOf(extras)).toBe(Object.prototype)
  })

  it('is bounded: 24 params, 300 characters each', () => {
    const many = Array.from({ length: 30 }, (_, index) => `p${index}=${'v'.repeat(400)}`).join('&')
    const { extras = {} } = collectAt(`/x?${many}`)
    expect(Object.keys(extras)).toHaveLength(24)
    expect(extras.p0).toHaveLength(300)
  })
})

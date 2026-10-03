// @vitest-environment jsdom
/**
 * THE RENDER REACHES THE MODEL (frontend#442 D10).
 *
 * The follow-up turn names the problems, but every later turn reasons from the page context, so the
 * render rides there too: `previewRender` on the envelope, never collapsed by the delta budget while
 * it lists a problem, and a failed widget's own error text on its inventory entry — the RESTAction
 * resolve error a person reads on the red card, which `loadState: 'error'` alone never said.
 */
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import { createElement } from 'react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { setPreviewRender } from './previewBus'
import type { PageContextEnvelope } from './types'
import { buildContextDelta, useAutopilotContext } from './useAutopilotContext'

const ENDPOINT = '/call?resource=piecharts&apiVersion=widgets.templates.krateo.io/v1beta1&name=pods-by-phase-1a2b3c4d&namespace=krateo-preview'

afterEach(() => setPreviewRender(null))

/** A mounted widget query whose fetch failed the way useWidgetQuery's does (WidgetFetchError). */
const clientWithFailedWidget = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const queryKey = ['widgets', ENDPOINT]
  const observer = new QueryObserver(client, { queryFn: () => new Promise(() => undefined), queryKey })
  observer.subscribe(() => undefined)
  const query = client.getQueryCache().find({ queryKey })!
  const error = Object.assign(new Error('Widget fetch failed: 500 Internal Server Error'), { detail: 'unable to resolve api reference: jq: cannot iterate over null', status: 500 })
  query.setState({ ...query.state, error, errorUpdatedAt: 42, fetchStatus: 'idle', status: 'error' })
  return client
}

const hookOn = (client: QueryClient) => renderHook(() => useAutopilotContext(), {
  wrapper: ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children),
}).result.current

describe('the page context carries what the preview rendered', () => {
  it('a failed widget carries the server\'s own words, not just loadState', () => {
    const { collect } = hookOn(clientWithFailedWidget())
    const [widget] = collect().widgets
    expect(widget).toMatchObject({ endpoint: ENDPOINT, error: 'unable to resolve api reference: jq: cannot iterate over null', loadState: 'error' })
  })

  it('readRenderedWidgets hands the raw query state to the render check', () => {
    const { readRenderedWidgets } = hookOn(clientWithFailedWidget())
    expect(readRenderedWidgets()).toEqual([{
      data: undefined,
      endpoint: ENDPOINT,
      error: { message: 'unable to resolve api reference: jq: cannot iterate over null', status: 500 },
      loadState: 'error',
      updatedAt: 42,
    }])
  })

  it('previewRender rides the envelope once the check has run', () => {
    setPreviewRender({ problems: ['Table pods-table: empty — empty: 0 rows'], rendered: ['PieChart pods-by-phase: 4 slices'] })
    const { collect } = hookOn(new QueryClient())
    expect(collect().previewRender).toEqual({ problems: ['Table pods-table: empty — empty: 0 rows'], rendered: ['PieChart pods-by-phase: 4 slices'] })
  })

  it('the delta budget never collapses a render with problems, nor one that changed', () => {
    const base: PageContextEnvelope = { pageStatus: 'ready', route: '/portal-builder', widgets: [] }
    const withProblems = { ...base, previewRender: { problems: ['Table pods-table: empty — empty: 0 rows'], rendered: [] } }
    const clean = { ...base, previewRender: { problems: [], rendered: ['Table pods-table: 148 rows'] } }
    expect(buildContextDelta(withProblems, withProblems)).toContain('"previewRender"')
    expect(buildContextDelta(clean, withProblems)).toContain('148 rows')
    expect(buildContextDelta(clean, clean)).toContain('Unchanged')
  })
})

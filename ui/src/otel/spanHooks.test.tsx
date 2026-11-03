// @vitest-environment jsdom
/**
 * The two span hooks' state machines, against a real SDK provider and the real contract processor.
 *
 * WHY THESE AND NOT ONLY THE EMITTERS. `interactions.instrumentation.test.ts` proves what a span
 * CARRIES; the two things that can still be wrong are WHEN it ends and HOW MANY there are, and both
 * live here:
 *
 * - `useCompositionOpenSpan` ends the open at the first moment no widget read is in flight — but
 *   held for one macrotask, because the page's children mount in the same commit that renders the
 *   page's own resolved data and their reads start after that commit's count was taken. Ending at
 *   the first zero would end at first paint, which the contract explicitly forbids, and the span
 *   would still look perfectly healthy. So the case below drives the real sequence
 *   (0 → in flight → 0) and a second one proves the hold is what makes it wait.
 * - `useDocumentLoadSpan` must report ONCE PER DOCUMENT, and the guard has to be module-level
 *   because `RouterProvider` is keyed on `routerVersion` — registering a route set remounts the
 *   whole tree, and a ref would report a second document load for a document that never reloaded.
 *   That is asserted by remounting.
 *
 * `useIsFetching` is mocked, deliberately and narrowly: react-query's own counting is not the
 * subject (`WidgetPage.test.tsx` mocks it for the same reason), the hook's reaction to the count
 * is. Everything downstream of the hook — the emitter, the tracer, the processor — is real.
 */
import { SpanStatusCode, trace } from '@opentelemetry/api'
import { WebTracerProvider, type ReadableSpan, type SpanProcessor } from '@opentelemetry/sdk-trace-web'
import { ATTR_HTTP_ROUTE } from '@opentelemetry/semantic-conventions'
import { act, render } from '@testing-library/react'
import type { RouteObject } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ATTR_ABANDONED, ContractSpanProcessor, SPAN_NAMES } from './spanContract'
import { useCompositionOpenSpan } from './useCompositionOpenSpan'
import { useDocumentLoadSpan } from './useDocumentLoadSpan'

/** The in-flight widget-read count the hook sees, controlled per render. */
let inFlight = 0

vi.mock('@tanstack/react-query', () => ({ useIsFetching: () => inFlight }))

const DETAIL = '/compositions/:namespace/:name'
let recorded: ReadableSpan[] = []

const recorder = (): SpanProcessor => ({
  forceFlush: () => Promise.resolve(),
  onEnd: (span) => { recorded.push(span) },
  onStart: () => undefined,
  shutdown: () => Promise.resolve(),
})

/** One macrotask, which is what the open's quiescence confirmation waits for. */
const tick = async () => {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 5)
    })
  })
}

const Open = ({ route }: { route: string | null }) => {
  useCompositionOpenSpan(route)

  return null
}

beforeEach(() => {
  recorded = []
  inFlight = 0
  trace.disable()
  trace.setGlobalTracerProvider(new WebTracerProvider({
    spanProcessors: [new ContractSpanProcessor(recorder(), 'https://portal.krateo.dev/content')],
  }))
})

afterEach(() => { trace.disable() })

describe('useCompositionOpenSpan', () => {
  it('ends the open when the page\'s reads have settled, once, with the templated route', async () => {
    const page = render(<Open route={DETAIL} />)

    // The page's own read starts in a child effect, after this commit's count was taken — exactly
    // the window in which ending would mean "first paint".
    inFlight = 1
    page.rerender(<Open route={DETAIL} />)
    await tick()
    expect(recorded).toHaveLength(0)

    inFlight = 0
    page.rerender(<Open route={DETAIL} />)
    await tick()

    expect(recorded).toHaveLength(1)
    const [span] = recorded
    expect(span.name).toBe(SPAN_NAMES.compositionOpen)
    expect(span.attributes).toEqual({ [ATTR_HTTP_ROUTE]: DETAIL })
    expect(span.status.code).toBe(SpanStatusCode.UNSET)
    expect(span.attributes[ATTR_ABANDONED]).toBeUndefined()
  })

  it('waits through the gap between the page\'s read and its children\'s', async () => {
    // The sequence the hold exists for: the page's read finishes (count 0 for one commit) and the
    // children it just rendered start theirs. Ending on that zero would exclude every child.
    const page = render(<Open route={DETAIL} />)
    inFlight = 1
    page.rerender(<Open route={DETAIL} />)

    // The zero, and the children's reads, both inside one macrotask.
    inFlight = 0
    page.rerender(<Open route={DETAIL} />)
    inFlight = 2
    page.rerender(<Open route={DETAIL} />)
    await tick()
    expect(recorded).toHaveLength(0)

    inFlight = 0
    page.rerender(<Open route={DETAIL} />)
    await tick()
    expect(recorded).toHaveLength(1)
  })

  it('abandons the open when the page is left before its reads settle', async () => {
    const page = render(<Open route={DETAIL} />)
    inFlight = 1
    page.rerender(<Open route={DETAIL} />)
    await tick()

    act(() => { page.unmount() })

    expect(recorded).toHaveLength(1)
    expect(recorded[0].attributes[ATTR_ABANDONED]).toBe(true)
    expect(recorded[0].status.code).toBe(SpanStatusCode.UNSET)
  })

  it('is inert on a page that is not a composition detail — including the LIST', async () => {
    // `/compositions/:namespace` is the per-namespace list: two segments, one param, not a detail
    // page. All four mounted together, so one settle covers them.
    const others = (
      <>
        <Open route='/compositions' />
        <Open route='/compositions/:namespace' />
        <Open route='/profile' />
        <Open route={null} />
      </>
    )
    const page = render(others)
    inFlight = 1
    page.rerender(others)
    inFlight = 0
    page.rerender(others)
    await tick()
    act(() => { page.unmount() })

    expect(recorded).toHaveLength(0)
  })
})

/**
 * The route table as the app holds it: a pathless shell whose children carry absolute paths.
 * `route.test.ts` is where the matching itself is pinned, against routes built by `createRoute`.
 */
const TABLE: RouteObject[] = [{
  children: [{ element: null, path: '/dashboard' }, { element: null, path: '*' }],
  element: null,
  id: 'shell',
}]

const Document = ({ pathname }: { pathname: string }) => {
  useDocumentLoadSpan(TABLE, pathname)

  return null
}

describe('useDocumentLoadSpan', () => {
  it('reports the document load once, with the landing route', () => {
    const page = render(<Document pathname='/dashboard' />)

    expect(recorded).toHaveLength(1)
    expect(recorded[0].name).toBe(SPAN_NAMES.pageLoad)
    expect(recorded[0].attributes).toEqual({ [ATTR_HTTP_ROUTE]: '/dashboard' })
    expect(recorded[0].status.code).toBe(SpanStatusCode.UNSET)
    act(() => { page.unmount() })
  })

  it('and NOT again when the shell remounts — a route-set change is not a document load', () => {
    // This case depends on the one above having run: the guard is per document, which in a test
    // process is per module. Remounting is what `RouterProvider key={routerVersion}` does.
    const page = render(<Document pathname='/dashboard' />)

    expect(recorded).toHaveLength(0)
    act(() => { page.unmount() })
  })
})

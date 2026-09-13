// @vitest-environment jsdom
/**
 * WidgetRenderer — error-state routing tests.
 *
 * Verifies that WidgetRenderer routes to the correct calm/alarming state based on
 * the `timedOut` flag and `error` produced by useWidgetQuery:
 *
 *   - timeout (timedOut=true)  → WidgetTimeout  (calm "still loading", info status)
 *   - hard error (timedOut=false, error!=null) → WidgetError (red cross, error status)
 *   - loading (isPending=true) → skeleton (no error/timeout components)
 *
 * The distinction matters for UX trust: a slow snowplow resolve looks like a failure
 * with the old alarm-on-every-error approach. `isTimeoutError` (WidgetStates) + the
 * `timedOut` flag in useWidgetQuery together route the two cases to different UI.
 *
 * Mock strategy: vi.mock('../../hooks/useWidgetQuery') returns a fully controllable
 * state via a module-level `__setState` helper (the same pattern as
 * WidgetRenderer.formStability.test.tsx) so we can set `timedOut`, `error`, and
 * `data` independently without touching the network.
 */
import { render } from '@testing-library/react'
import { App } from 'antd'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import WidgetRenderer from './WidgetRenderer'

// ---------------------------------------------------------------------------
// Controllable useWidgetQuery mock
// ---------------------------------------------------------------------------

type MockState = {
  error: unknown
  isPending: boolean
  timedOut: boolean
}

vi.mock('../../hooks/useWidgetQuery', async () => {
  const { useSyncExternalStore } = await import('react')
  let state: MockState = { error: null, isPending: true, timedOut: false }
  const listeners = new Set<() => void>()
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }
  return {
    __setState: (partial: Partial<MockState>) => {
      state = { ...state, ...partial }
      listeners.forEach((listener) => { listener() })
    },
    useWidgetQuery: () => {
      const snap = useSyncExternalStore(subscribe, () => state)
      return {
        isFetchingResourcesRefs: false,
        queryResult: {
          data: undefined,
          dataUpdatedAt: 0,
          error: snap.error,
          fetchNextPage: () => Promise.resolve(),
          hasNextPage: false,
          isFetching: false,
          isFetchingNextPage: false,
          isLoading: snap.isPending,
          isPending: snap.isPending,
          isStale: false,
          refetch: () => Promise.resolve(),
        },
        serverPagination: undefined,
        timedOut: snap.timedOut,
        widgetId: 'test-widget-id',
      }
    },
  }
})

vi.mock('../../context/ConfigContext', () => ({
  useConfigContext: () => ({
    config: {
      api: {
        SNOWPLOW_API_BASE_URL: 'http://snowplow.test',
        WIDGET_LIVE_REFRESH_ENABLED: false,
      },
    },
    isLoading: false,
    refetch: () => Promise.resolve(),
  }),
}))

vi.mock('../FiltesProvider/FiltersProvider', () => ({
  useFilter: () => ({ isWidgetFilteredByProps: () => false }),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const setState = async (partial: Partial<MockState>) => {
  const module = await import('../../hooks/useWidgetQuery')
  ;(module as unknown as { __setState: (p: Partial<MockState>) => void }).__setState(partial)
}

const ENDPOINT =
  '/call?resource=statistics&apiVersion=widgets.templates.krateo.io%2Fv1beta1&name=test-stat&namespace=test-ns'

const renderWidget = () =>
  render(
    <MemoryRouter>
      <App>
        <WidgetRenderer widgetEndpoint={ENDPOINT} />
      </App>
    </MemoryRouter>,
  )

beforeAll(() => {
  // antd + jsdom compatibility shims
  const noop = () => undefined
  Object.defineProperty(window, 'matchMedia', {
    value: (query: string) => ({
      addEventListener: noop,
      addListener: noop,
      dispatchEvent: () => false,
      matches: false,
      media: query,
      onchange: null,
      removeEventListener: noop,
      removeListener: noop,
    }),
    writable: true,
  })
  globalThis.ResizeObserver = class {
    disconnect = noop
    observe = noop
    unobserve = noop
  }
})

beforeEach(async () => {
  await setState({ error: null, isPending: true, timedOut: false })
})

afterEach(() => {
  document.body.innerHTML = ''
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WidgetRenderer — timeout → calm state (WidgetTimeout), not the red-cross error', () => {
  /**
   * TIMEOUT path: `timedOut=true` (503/504 or deadline-exceeded message).
   * WidgetRenderer must show the CALM `WidgetTimeout` (info status, "Still waiting on
   * the server"), NOT the alarming `WidgetError` (red cross). This is the core UX-trust
   * fix: a slow snowplow resolve must not look like a failure.
   */
  it('renders WidgetTimeout (calm) for a deadline-exceeded error — NOT the red-cross WidgetError', async () => {
    await setState({
      error: new Error('context deadline exceeded'),
      isPending: false,
      timedOut: true,
    })
    const { queryByTestId } = renderWidget()

    // Calm timeout state must be present…
    expect(queryByTestId('widget-timeout')).not.toBeNull()
    // …and the hard-error red cross must NOT appear.
    expect(queryByTestId('widget-error')).toBeNull()
  })

  it('renders WidgetTimeout for a 503/504 gateway-timeout — NOT WidgetError', async () => {
    await setState({
      error: Object.assign(new Error('Widget fetch failed: 503 Service Unavailable'), { status: 503 }),
      isPending: false,
      timedOut: true,
    })
    const { queryByTestId } = renderWidget()

    expect(queryByTestId('widget-timeout')).not.toBeNull()
    expect(queryByTestId('widget-error')).toBeNull()
  })
})

describe('WidgetRenderer — hard error → WidgetError (red cross), not the calm timeout', () => {
  /**
   * HARD ERROR path: `timedOut=false` with a genuine error (403, 500, malformed data).
   * WidgetRenderer must show the `WidgetError` red cross, NOT the calm timeout state.
   */
  /**
   * 403 is NOT a hard error. This test previously asserted the red cross for it, which was the
   * behaviour being fixed: the platform scopes reads per user by design, so a denial is an
   * expected outcome and collapsing it into the same state as a 500 told the reader nothing.
   * The original intent — "must not be mistaken for the calm timeout" — is preserved, and now
   * the stronger claim holds too: it is its own state, distinct from BOTH.
   */
  it('renders WidgetForbidden for a 403 — not the red cross, not the timeout', async () => {
    await setState({
      error: Object.assign(new Error('Widget fetch failed: 403 Forbidden'), { status: 403 }),
      isPending: false,
      timedOut: false,
    })
    const { queryByTestId } = renderWidget()

    expect(queryByTestId('widget-forbidden')).not.toBeNull()
    expect(queryByTestId('widget-error')).toBeNull()
    expect(queryByTestId('widget-timeout')).toBeNull()
  })

  it('renders WidgetNotFound for a 404 — a missing object is not a malfunction', async () => {
    await setState({
      error: Object.assign(new Error('Widget fetch failed: 404 Not Found'), { status: 404 }),
      isPending: false,
      timedOut: false,
    })
    const { queryByTestId } = renderWidget()

    expect(queryByTestId('widget-notfound')).not.toBeNull()
    expect(queryByTestId('widget-error')).toBeNull()
  })

  it("surfaces the backend's own message when the failure response carried one", async () => {
    await setState({
      error: Object.assign(new Error('Widget fetch failed: 500 Internal Server Error'), {
        detail: 'restaction compositions-list: jq: error: null has no keys',
        status: 500,
      }),
      isPending: false,
      timedOut: false,
    })
    const { queryByText } = renderWidget()

    // Previously only `res.statusText` reached the UI — a generic "Internal Server Error" — and
    // the response body was discarded, so the actual cause was never visible to anyone.
    expect(queryByText(/jq: error: null has no keys/)).not.toBeNull()
  })

  it('renders WidgetError for a 500 Internal Server Error — NOT WidgetTimeout', async () => {
    await setState({
      error: Object.assign(new Error('Widget fetch failed: 500 Internal Server Error'), { status: 500 }),
      isPending: false,
      timedOut: false,
    })
    const { queryByTestId } = renderWidget()

    expect(queryByTestId('widget-error')).not.toBeNull()
    expect(queryByTestId('widget-timeout')).toBeNull()
  })
})

describe('WidgetRenderer — loading state suppresses both error components', () => {
  it('renders neither WidgetError nor WidgetTimeout while isPending (skeleton only)', async () => {
    await setState({ error: null, isPending: true, timedOut: false })
    const { queryByTestId } = renderWidget()

    // During pending, neither error/timeout component appears.
    expect(queryByTestId('widget-error')).toBeNull()
    expect(queryByTestId('widget-timeout')).toBeNull()
  })
})

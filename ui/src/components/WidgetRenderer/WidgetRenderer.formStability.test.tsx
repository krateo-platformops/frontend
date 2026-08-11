// @vitest-environment jsdom
/**
 * Reproduction + regression tests for krateo-platformops/frontend#33 (form-input-wipe half):
 * while a user fills a Form widget, the widget's periodic/event-triggered refetch
 * (live-refresh SSE / event invalidation) must NOT wipe typed values or select choices
 * back to initialValues.
 *
 * Root cause reproduced here: WidgetRenderer's freshness overlay used to wrap the
 * rendered widget in a `<div>` ONLY while stale/refreshing, so every refetch cycle
 * flipped the subtree's root element type (Suspense ↔ div) — a React identity change
 * that unmounted and remounted the whole Form, resetting every field to the (freshly
 * refetched) initialValues.
 *
 * The tests drive a REAL Form widget through WidgetRenderer with a controllable
 * useWidgetQuery mock, simulating the exact react-query state transitions a
 * live-refresh refetch produces (isFetching flip + a NEW data object identity).
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { App } from 'antd'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Widget } from '../../types/Widget'
import FormModule from '../../widgets/Form'
import { registerWidget } from '../../widgets/registry'
import type { WidgetModule } from '../../widgets/widget-module'
import { AgentDraftProvider } from '../Autopilot/agentDraft'

import WidgetRenderer from './WidgetRenderer'

const { handleActionMock } = vi.hoisted(() => ({ handleActionMock: vi.fn() }))

type MockQueryState = {
  data: Widget | undefined
  dataUpdatedAt: number
  isFetching: boolean
  isStale: boolean
}

/**
 * Controllable stand-in for useWidgetQuery: the test mutates the state via
 * `__setQueryState` and subscribed WidgetRenderers re-render through
 * useSyncExternalStore — the same notification shape react-query produces on a
 * background refetch (isFetching flip, then a NEW data object + fresh dataUpdatedAt).
 */
vi.mock('../../hooks/useWidgetQuery', async () => {
  const { useSyncExternalStore } = await import('react')
  let state: MockQueryState = { data: undefined, dataUpdatedAt: 0, isFetching: false, isStale: false }
  const listeners = new Set<() => void>()
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }
  return {
    __setQueryState: (partial: Partial<MockQueryState>) => {
      state = { ...state, ...partial }
      listeners.forEach((listener) => { listener() })
    },
    useWidgetQuery: () => {
      const snapshot = useSyncExternalStore(subscribe, () => state)
      return {
        isFetchingResourcesRefs: false,
        queryResult: {
          data: snapshot.data,
          dataUpdatedAt: snapshot.dataUpdatedAt,
          error: null,
          fetchNextPage: () => Promise.resolve(),
          hasNextPage: false,
          isFetching: snapshot.isFetching,
          isFetchingNextPage: false,
          isLoading: false,
          isPending: snapshot.data === undefined,
          isStale: snapshot.isStale,
          refetch: () => Promise.resolve(),
        },
        serverPagination: undefined,
        timedOut: false,
        widgetId: 'test-widget-id',
      }
    },
  }
})

// Live-refresh ON (the default deployment state that produced the bug).
vi.mock('../../context/ConfigContext', () => ({
  useConfigContext: () => ({
    config: { api: { SNOWPLOW_API_BASE_URL: 'http://snowplow.test', WIDGET_LIVE_REFRESH_ENABLED: true } },
    isLoading: false,
    refetch: () => Promise.resolve(),
  }),
}))

vi.mock('../FiltesProvider/FiltersProvider', () => ({
  useFilter: () => ({ isWidgetFilteredByProps: () => false }),
}))

vi.mock('../../hooks/useHandleActions', () => ({
  useHandleAction: () => ({ handleAction: handleActionMock, isActionLoading: false }),
}))

const setQueryState = async (partial: Partial<MockQueryState>) => {
  const module = await import('../../hooks/useWidgetQuery')
  const setter = (module as unknown as { __setQueryState: (partial: Partial<MockQueryState>) => void }).__setQueryState
  act(() => { setter(partial) })
}

registerWidget(FormModule as unknown as WidgetModule<unknown>)

const ENDPOINT = '/call?resource=forms&apiVersion=widgets.templates.krateo.io%2Fv1beta1&name=test-form&namespace=test-ns'

/**
 * A schema-driven Form widget: a text Input (`clusterName`) + a REQUIRED multi-select
 * array field (`clusters`, items.enum) — the two field shapes the live incident hit.
 * Every call returns FRESH object identities (as a real refetch does).
 */
const makeFormWidget = (opts: { clusterOptions?: string[]; freshness?: boolean; initialValues?: Record<string, unknown> } = {}): Widget => {
  const { clusterOptions = ['alpha', 'beta'], freshness, initialValues } = opts
  return {
    apiVersion: 'widgets.templates.krateo.io/v1beta1',
    kind: 'Form',
    metadata: {
      annotations: {},
      creationTimestamp: '2026-01-01T00:00:00Z',
      generation: 1,
      name: 'test-form',
      namespace: 'test-ns',
      resourceVersion: '1',
      uid: 'uid-form-1',
    },
    spec: (freshness === undefined ? {} : { freshness }) as never,
    status: {
      actions: {},
      resourcesRefs: { items: [] },
      widgetData: {
        actions: { rest: [{ id: 'submit-action', resourceRefId: 'ref-1', type: 'rest' }] },
        ...(initialValues ? { initialValues } : {}),
        schema: {
          properties: {
            clusterName: { type: 'string' },
            clusters: { items: { enum: clusterOptions, type: 'string' }, type: 'array' },
          },
          required: ['clusters'],
          type: 'object',
        },
        submitActionId: 'submit-action',
      },
    },
  } as unknown as Widget
}

const renderWidget = (ui?: React.ReactNode) => render(
  <MemoryRouter>
    <App>
      {ui ?? <WidgetRenderer widgetEndpoint={ENDPOINT} />}
    </App>
  </MemoryRouter>
)

const getInput = (): HTMLInputElement => {
  const input = document.getElementById('clusterName')
  expect(input).toBeTruthy()
  return input as HTMLInputElement
}

/** Open the `clusters` multi-select dropdown and click the option labelled `label`. */
const selectClusterOption = async (container: HTMLElement, label: string) => {
  // antd 6: the multi-select's search input carries the Form.Item id; the clickable
  // opener is the `.ant-select` root (no `.ant-select-selector` in v6).
  const select = container.querySelector('#clusters')?.closest('.ant-select')
  expect(select).toBeTruthy()
  fireEvent.mouseDown(select!)
  const option = await waitFor(() => {
    const found = document.querySelector(`.ant-select-item-option[title="${label}"]`)
    expect(found).toBeTruthy()
    return found!
  })
  fireEvent.click(option)
}

/**
 * Simulate one live-refresh cycle exactly as react-query surfaces it: the refetch
 * starts (isFetching=true on the EXISTING data) and completes with a brand-new
 * widget object (fresh identities for widgetData/schema/initialValues) + a fresh
 * dataUpdatedAt (data no longer stale).
 */
const simulateRefetch = async (nextWidget: Widget) => {
  await setQueryState({ isFetching: true, isStale: true })
  await setQueryState({ data: nextWidget, dataUpdatedAt: Date.now(), isFetching: false, isStale: false })
}

beforeAll(() => {
  // antd needs these browser APIs; jsdom has neither.
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
  } as unknown as typeof ResizeObserver
})

beforeEach(async () => {
  handleActionMock.mockClear()
  await setQueryState({ data: undefined, dataUpdatedAt: 0, isFetching: false, isStale: false })
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('Form widget survives a live-refresh refetch (issue #33)', () => {
  it('a typed text Input value survives a refetch cycle', async () => {
    await setQueryState({ data: makeFormWidget(), dataUpdatedAt: Date.now() })
    renderWidget()

    fireEvent.change(getInput(), { target: { value: 'my-cluster' } })
    expect(getInput().value).toBe('my-cluster')

    await simulateRefetch(makeFormWidget())

    // Pre-fix this failed: the freshness-wrapper flip remounted the Form and the
    // input came back empty.
    expect(getInput().value).toBe('my-cluster')

    // And it survives a refetch STORM (the busy-cluster case).
    await simulateRefetch(makeFormWidget())
    await simulateRefetch(makeFormWidget())
    expect(getInput().value).toBe('my-cluster')
  })

  it('a multi-select choice survives a refetch AND fresh enum options still arrive', async () => {
    await setQueryState({ data: makeFormWidget({ clusterOptions: ['alpha', 'beta'] }), dataUpdatedAt: Date.now() })
    const { container } = renderWidget()

    await selectClusterOption(container, 'alpha')

    // Refetch delivers a NEW schema whose enum gained an option (legit server change).
    await simulateRefetch(makeFormWidget({ clusterOptions: ['alpha', 'beta', 'gamma'] }))

    // The selection survives — verified against the FORM STORE via submit (this is
    // also the store/display-divergence probe: the store, not just the DOM chip).
    fireEvent.change(getInput(), { target: { value: 'named' } })
    fireEvent.submit(container.querySelector('form')!)
    await waitFor(() => { expect(handleActionMock).toHaveBeenCalledTimes(1) })
    const submitted = handleActionMock.mock.calls[0][2] as Record<string, unknown>
    expect(submitted.clusters).toEqual(['alpha'])
    expect(submitted.clusterName).toBe('named')

    // The refreshed schema's NEW option is available in the dropdown.
    await selectClusterOption(container, 'gamma')
    fireEvent.submit(container.querySelector('form')!)
    await waitFor(() => { expect(handleActionMock).toHaveBeenCalledTimes(2) })
    const resubmitted = handleActionMock.mock.calls[1][2] as Record<string, unknown>
    expect(resubmitted.clusters).toEqual(['alpha', 'gamma'])
  })

  it('a PRISTINE form re-seeds refetched initialValues (server state tracked until first touch)', async () => {
    await setQueryState({ data: makeFormWidget({ initialValues: { clusterName: 'v1' } }), dataUpdatedAt: Date.now() })
    renderWidget()
    expect(getInput().value).toBe('v1')

    // Untouched form: a refetch with NEW initialValues updates the field.
    await simulateRefetch(makeFormWidget({ initialValues: { clusterName: 'v2' } }))
    expect(getInput().value).toBe('v2')

    // Once the user touches ANY field, refetched initialValues never clobber again.
    fireEvent.change(getInput(), { target: { value: 'mine' } })
    await simulateRefetch(makeFormWidget({ initialValues: { clusterName: 'v3' } }))
    expect(getInput().value).toBe('mine')
  })

  it('the freshness wrapper <div> stays mounted across a refetch cycle regardless of the spec.freshness opt-in (remount invariant)', async () => {
    // The #33 fix: the wrapper div renders UNCONDITIONALLY — only the badge inside it
    // toggles. With the badge now opt-in (spec.freshness), the wrapper must STILL be
    // unconditional in BOTH cases, or the stale/refetch flip changes the subtree's root
    // element type and remounts the Form (wiping user input).
    const assertWrapperStable = async (freshness: boolean) => {
      document.body.innerHTML = ''
      await setQueryState({ data: makeFormWidget({ freshness }), dataUpdatedAt: Date.now(), isFetching: false, isStale: false })
      const { unmount } = renderWidget()

      fireEvent.change(getInput(), { target: { value: 'sticky' } })
      const inputBefore = getInput()

      await simulateRefetch(makeFormWidget({ freshness }))

      // Same DOM node — the widget subtree was NOT remounted by the stale/refetch flip…
      expect(getInput()).toBe(inputBefore)
      // …and the typed value survived.
      expect(getInput().value).toBe('sticky')
      unmount()
    }

    await assertWrapperStable(false)
    await assertWrapperStable(true)
  })

  it('an Autopilot draft applies once per draft — a refetch does NOT re-clobber a user edit, a NEW draft does apply', async () => {
    await setQueryState({ data: makeFormWidget(), dataUpdatedAt: Date.now() })
    const { rerender } = renderWidget(
      <AgentDraftProvider value={{ draft: { clusterName: 'drafted' }, nonce: 1 }}>
        <WidgetRenderer widgetEndpoint={ENDPOINT} />
      </AgentDraftProvider>,
    )

    // The draft lands imperatively (per-field-default override path).
    await waitFor(() => { expect(getInput().value).toBe('drafted') })

    // The user overrides the drafted value…
    fireEvent.change(getInput(), { target: { value: 'user-edit' } })

    // …and a refetch (which recomputes the schema → safeAgentDraft identity) must NOT
    // re-apply the stale draft over the user's edit.
    await simulateRefetch(makeFormWidget())
    expect(getInput().value).toBe('user-edit')

    // A genuinely NEW draft (nonce bump) still applies — the Autopilot path keeps working.
    rerender(
      <MemoryRouter>
        <App>
          <AgentDraftProvider value={{ draft: { clusterName: 'drafted-2' }, nonce: 2 }}>
            <WidgetRenderer widgetEndpoint={ENDPOINT} />
          </AgentDraftProvider>
        </App>
      </MemoryRouter>,
    )
    await waitFor(() => { expect(getInput().value).toBe('drafted-2') })
  })
})

describe('Freshness badge is OPT-IN via spec.freshness (default: no badge, ever)', () => {
  const getBadge = () => document.querySelector('[data-testid="freshness-badge"]')

  it('a STALE widget WITHOUT the opt-in renders NO badge (the default)', async () => {
    await setQueryState({ data: makeFormWidget(), dataUpdatedAt: Date.now() - 60_000, isFetching: false, isStale: true })
    renderWidget()
    // The widget itself rendered fine…
    expect(getInput()).toBeTruthy()
    // …but no badge: staleness alone is not enough without the spec opt-in.
    expect(getBadge()).toBeNull()
  })

  it('a STALE widget WITH spec.freshness=true renders the badge', async () => {
    await setQueryState({ data: makeFormWidget({ freshness: true }), dataUpdatedAt: Date.now() - 60_000, isFetching: false, isStale: true })
    renderWidget()
    expect(getBadge()).toBeTruthy()
  })

  it('an opted-in widget in the healthy/fresh state still shows NO badge (exception-only)', async () => {
    await setQueryState({ data: makeFormWidget({ freshness: true }), dataUpdatedAt: Date.now(), isFetching: false, isStale: false })
    renderWidget()
    expect(getBadge()).toBeNull()
  })
})

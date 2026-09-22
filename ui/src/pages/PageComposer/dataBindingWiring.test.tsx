// @vitest-environment jsdom
/**
 * THE MODAL OPENS ON A REAL PAGE DRAFT — the one thing 44 unit tests did not check.
 *
 * The emitters were covered thoroughly and the wiring was not, so this shipped: the Data action
 * rendered on every node, the click set state, and NO MODAL APPEARED. The guard required a non-null
 * `draftNamespace(files)`, and a page draft holds the TEMPLATED namespace
 * (`{{ include "page.tierNamespace" ... }}`) in every file — which `draftNamespace` deliberately
 * skips. So it returned null for exactly the drafts the modal exists for.
 *
 * Nothing about that is visible from a unit test of the emitters, and nothing about it errors. It
 * was found by opening the thing in a browser, which is why this test mounts the panel with the
 * output of `pageDraftFiles` rather than a hand-written fixture that happens to carry a literal
 * namespace.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from 'antd'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { pageDraftFiles } from '../../components/Autopilot/pageDraft'

import { ObjectTreePanel } from './ObjectTreePanel'

vi.mock('./placeableWidgets', () => ({
  ACTION_CATEGORY: 'actions',
  listPlaceableActions: () => Promise.resolve({ ok: true, widgets: [{ name: 'pod-sizing', resource: 'restactions' }] }),
  listPlaceableWidgets: () => Promise.resolve({ ok: true, widgets: [] }),
}))

beforeAll(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    addEventListener: vi.fn(),
    addListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
    matches: false,
    media: query,
    onchange: null,
    removeEventListener: vi.fn(),
    removeListener: vi.fn(),
  }))
  // antd's Modal needs one; jsdom ships none. The methods are intentionally inert — there is
  // nothing to observe in a test that never lays anything out.
  vi.stubGlobal('ResizeObserver', class {
    observe() { /* inert */ }
    unobserve() { /* inert */ }
    disconnect() { /* inert */ }
  })
})
afterEach(cleanup)

/** The held files a started page ACTUALLY has — templated namespace and all. */
const realDraft = () => pageDraftFiles([
  {
    apiVersion: 'widgets.templates.krateo.io/v1beta1',
    kind: 'Flex',
    metadata: { name: 'page-fleet', namespace: 'krateo-system' },
    spec: { widgetData: { items: [] } },
  },
]) ?? {}

describe('the Data action on a real page draft', () => {
  it('holds a TEMPLATED namespace — the condition that broke the guard', () => {
    // Pinned as its own fact: if pageDraftFiles ever stops templating, the reason this test exists
    // disappears with it and the next reader should be told rather than left guessing.
    const files = realDraft()
    const root = Object.entries(files).find(([path]) => path.includes('flex.'))
    expect(root?.[1]).toContain('{{ include "page.tierNamespace"')
  })

  it('OPENS the modal — it rendered nothing at all before', async () => {
    render(<App><ObjectTreePanel files={realDraft()} snowplowBaseUrl='http://snowplow.test' /></App>)

    const open = await screen.findByLabelText('Data for page-fleet')
    fireEvent.click(open)

    // The three surfaces, which is the whole point: where the data comes from, what it fills, and
    // what children it generates.
    await waitFor(() => expect(screen.getByText('Where the data comes from')).toBeTruthy())
    expect(screen.getByText('What fills the widget')).toBeTruthy()
    expect(screen.getByText('Children from data')).toBeTruthy()
  })

  it('offers BOTH routes to an apiRef — pick one, or write one', async () => {
    render(<App><ObjectTreePanel files={realDraft()} snowplowBaseUrl='http://snowplow.test' /></App>)
    fireEvent.click(await screen.findByLabelText('Data for page-fleet'))

    await waitFor(() => expect(screen.getByText('Use one that exists')).toBeTruthy())
    expect(screen.getByText('Write a new one')).toBeTruthy()
  })
})

/**
 * A NODE ADDED AFTER MOUNT MUST BE REACHABLE — the regression this suite existed to prevent,
 * arriving through a different door.
 *
 * `defaultExpandAll` is an UNCONTROLLED default: antd reads it once, at the first mount, and never
 * again. A fresh page draft holds two nodes at that moment, so everything a person subsequently
 * builds lands under a parent nothing expanded — and antd does not render a collapsed subtree into
 * the DOM at all.
 *
 * Found in a browser, not here: a Table dropped into a Row drew on the canvas, wrote its file, and
 * had no row in the tree — so no Data action, no Move, no Remove. Every existing test in this file
 * mounts a draft that already contains its nodes, which is exactly the case the bug spares.
 */
describe('a node added AFTER the first mount', () => {
  /** A draft whose root Flex holds one child — the shape a drop produces. */
  const draftWithChild = () => pageDraftFiles([
    {
      apiVersion: 'widgets.templates.krateo.io/v1beta1',
      kind: 'Flex',
      metadata: { name: 'page-fleet', namespace: 'krateo-system' },
      spec: {
        resourcesRefs: { items: [{ id: 'r1', name: 'fleet-row', namespace: 'krateo-system', resource: 'rows' }] },
        widgetData: { items: [{ resourceRefId: 'r1' }] },
      },
    },
    {
      apiVersion: 'widgets.templates.krateo.io/v1beta1',
      kind: 'Row',
      metadata: { name: 'fleet-row', namespace: 'krateo-system' },
      spec: {
        resourcesRefs: { items: [{ id: 't1', name: 'pods-table', namespace: 'krateo-system', resource: 'tables' }] },
        widgetData: { items: [{ resourceRefId: 't1' }] },
      },
    },
    {
      apiVersion: 'widgets.templates.krateo.io/v1beta1',
      kind: 'Table',
      metadata: { name: 'pods-table', namespace: 'krateo-system' },
      spec: { widgetData: { allowedResources: [], columns: [] } },
    },
  ]) ?? {}

  const mount = (files: Record<string, string>) => render(
    <App><ObjectTreePanel files={files} snowplowBaseUrl='http://snowplow.test' /></App>,
  )

  it('is rendered, with its own actions, when the draft GROWS under an existing parent', async () => {
    // Mount on the two-node draft — the state `defaultExpandAll` was evaluated against.
    const { rerender } = mount(realDraft())
    expect(screen.queryByLabelText('Data for pods-table')).toBeNull()

    // …then grow it, the way a drop does. The Table is a grandchild: its row only exists in the
    // DOM if BOTH the root and the Row were expanded in response.
    rerender(<App><ObjectTreePanel files={draftWithChild()} snowplowBaseUrl='http://snowplow.test' /></App>)

    await waitFor(() => expect(screen.getByLabelText('Data for pods-table')).toBeTruthy())
    // Not just the Data action — every per-node action lives in the same collapsed subtree.
    expect(screen.getByLabelText('Data for fleet-row')).toBeTruthy()
  })

  it('still renders a draft that already contains its nodes at mount', () => {
    // The case that always worked; asserted so the fix cannot be a swap of one gap for another.
    mount(draftWithChild())
    expect(screen.getByLabelText('Data for pods-table')).toBeTruthy()
  })
})

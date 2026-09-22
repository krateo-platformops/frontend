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

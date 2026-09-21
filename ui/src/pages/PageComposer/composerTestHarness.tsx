// @vitest-environment jsdom
/**
 * Shared scaffolding for the composer suites.
 *
 * Extracted when PageComposer.test.tsx crossed its 500-line cap. Split along a real seam rather
 * than by size — the DRAFT LIFECYCLE (open, start, publish, own, close) in one file, the TREE and
 * what it does to the draft in the other — so each file still reads as one argument.
 */
import { act, render, screen } from '@testing-library/react'
import { App as AntdApp } from 'antd'
import { vi } from 'vitest'

import { AUTOPILOT_PREVIEW_EVENT } from '../../components/Autopilot/previewBus'
import type { AutopilotPreviewPayload } from '../../components/Autopilot/previewBus'
import { emitDraftChanged } from '../../components/Autopilot/previewDraftChanged'
import { ConfigContext } from '../../context/ConfigContext'
import { ThemeModeProvider } from '../../context/ThemeModeContext'

import PageComposer from './PageComposer'

/**
 * jsdom has neither ResizeObserver nor matchMedia, and antd's Tabs, TextArea, Modal and Select all
 * construct one on mount. Without these the whole subtree fails to render and every assertion reads
 * an empty container instead of a missing element.
 */
export const installAntdShims = () => {
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
  globalThis.ResizeObserver = class {
    disconnect() { /* nothing to disconnect in jsdom */ }
    observe() { /* jsdom never resizes */ }
    unobserve() { /* nothing to stop observing */ }
  }
}

/**
 * ThemeModeProvider, and ONLY ThemeModeProvider.
 *
 * The surface reads the theme to pick a syntax-highlighter palette, and that provider is mounted
 * app-wide at index.tsx above the router — so every route already has it. Nothing here supplies an
 * AutopilotProvider, which is the whole point: that is the coupling this change removes, and its
 * absence is what these tests assert.
 */
/**
 * INSIDE antd's `<App>`, because the composer reads `App.useApp()`.
 *
 * `ObjectTreePanel` takes its `message` from that context (ObjectTreePanel.tsx:156), and outside an
 * `<App>` provider antd hands back an empty default whose `.warning` is undefined. So every refusal
 * path in the tree — remove failed, place failed, wrap failed, name clash, move refused — threw a
 * TypeError under test while the assertions around it still passed, because the throw escaped as an
 * unhandled rejection rather than failing the case that caused it. Production has always been
 * correct: App.tsx:66 wraps the router in `<AntdApp>`.
 *
 * This is therefore a harness fidelity fix, not a product fix, and it is what makes the tree's
 * refusal messages assertable at all.
 */
const inApp = (node: React.ReactNode) => <AntdApp>{node}</AntdApp>

export const mount = () => render(inApp(<ThemeModeProvider><PageComposer /></ThemeModeProvider>))

/**
 * Mount WITH config — needed only where the surface talks to snowplow (the widget picker).
 *
 * Legitimate rather than a convenience: `ConfigProvider` sits at App.tsx above the router, so this
 * route always has it in production. The bare `mount` stays, because "renders with no
 * AutopilotProvider" is a property worth keeping asserted — this adds config, not the rail.
 */
export const mountWithConfig = (snowplow = 'http://snowplow.test') => render(
  inApp(
    <ConfigContext.Provider value={{ config: { api: { SNOWPLOW_API_BASE_URL: snowplow } } } as never}>
      <ThemeModeProvider><PageComposer /></ThemeModeProvider>
    </ConfigContext.Provider>,
  ),
)

/**
 * One widget-CR fixture for every suite — there were three near-identical copies, and the namespace
 * is why that mattered: adding it to one would have left the others generating objects the cluster
 * rejects, which is the exact bug these are meant to catch.
 */
export const widgetCr = (
  kind: string,
  name: string,
  children: string[] = [],
  namespace: string | null = 'krateo-system',
) => [
  `kind: ${kind}`,
  'apiVersion: widgets.templates.krateo.io/v1beta1',
  `metadata:\n  name: ${name}${namespace ? `\n  namespace: ${namespace}` : ''}`,
  'spec:\n  widgetData:',
  '    allowedResources: []',
  children.length ? `    items:\n${children.map((ref) => `      - resourceRefId: ${ref}`).join('\n')}` : '    items: []',
  '  resourcesRefs:',
  children.length
    ? `    items:\n${children.map((ref) => `      - id: ${ref}\n        name: ${ref}\n        resource: widgets\n        namespace: krateo-system`).join('\n')}`
    : '    items: []',
].join('\n')

/**
 * Open a draft: the preview payload, and the held draft the tree edits against.
 *
 * TWO BUSES, DELIBERATELY. The payload is what the SURFACE renders; the held draft is what the TREE
 * edits. They were the same object once — the tree read `payload.files` — and that was the bug: the
 * payload is emitted once and never re-emitted, so every structural edit was computed against the
 * bytes as they were when the draft was FIRST previewed, and consecutive edits to one parent
 * silently reverted each other. In the app the provider broadcasts the held draft after each
 * accepted write; here the test plays that part.
 */
export const emit = (payload: Partial<AutopilotPreviewPayload>) => {
  act(() => {
    window.dispatchEvent(new CustomEvent(AUTOPILOT_PREVIEW_EVENT, { detail: { title: 'Draft', ...payload } }))
    emitDraftChanged({
      files: Object.fromEntries((payload.files ?? []).map((file) => [file.path, file.content])),
    })
  })
}

/** Re-broadcast the held draft alone — the provider's answer to an accepted edit. */
export const held = (files: Record<string, string>) => {
  act(() => emitDraftChanged({ files }))
}

/**
 * ONE ordered log across both draft-write buses, not one array per bus.
 *
 * Two separate arrays cannot express "the add came first" — which several suites exist to assert,
 * and which an earlier version did not check: it compared each array's LENGTH and each entry's
 * path, both of which hold just as well when the emissions are reversed.
 */
export const capture = () => {
  const log: { op: 'add' | 'edit'; path: string; content: string }[] = []
  const onAdd = (event: Event) => { log.push({ op: 'add', ...(event as CustomEvent<{ path: string; content: string }>).detail }) }
  const onEdit = (event: Event) => { log.push({ op: 'edit', ...(event as CustomEvent<{ path: string; content: string }>).detail }) }
  window.addEventListener('autopilotPreviewFileAdded', onAdd)
  window.addEventListener('autopilotPreviewFileEdited', onEdit)
  return {
    log,
    stop: () => {
      window.removeEventListener('autopilotPreviewFileAdded', onAdd)
      window.removeEventListener('autopilotPreviewFileEdited', onEdit)
    },
  }
}

/** Convenience for the many suites that just need the Objects panel scoped. */
export const objectsPanel = () => screen.getByText('Objects').closest('div')?.parentElement as HTMLElement

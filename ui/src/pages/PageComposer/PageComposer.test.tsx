// @vitest-environment jsdom
/**
 * The point of these tests is the UN-COUPLING, not the markup.
 *
 * Before this change the preview surface — live render, per-file editor, RestDefinition editor —
 * was the body of `AutopilotPreviewDrawer`, which `AutopilotProvider` renders. It was therefore
 * reachable ONLY through the Autopilot rail, as something the agent opens. What is asserted here is
 * that the same surface now renders outside the provider, from the same bus, with no rail present.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { AUTOPILOT_PREVIEW_EVENT } from '../../components/Autopilot/previewBus'
import type { AutopilotPreviewPayload } from '../../components/Autopilot/previewBus'
import { ThemeModeProvider } from '../../context/ThemeModeContext'

import PageComposer from './PageComposer'

afterEach(cleanup)

// jsdom has no ResizeObserver and antd's Tabs/TextArea construct one on mount. Same shim the
// CommandPalette and WidgetRenderer suites install; without it the whole subtree fails to render
// and every assertion below reads an empty container instead of a missing element.
beforeAll(() => {
  // antd's Modal reads matchMedia for its responsive width; jsdom has neither this nor
  // ResizeObserver. Same shims the Tabs and Table suites install.
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
})

/**
 * ThemeModeProvider, and ONLY ThemeModeProvider.
 *
 * The surface reads the theme to pick a syntax-highlighter palette, and that provider is mounted
 * app-wide at index.tsx above the router — so every route already has it. Nothing here supplies an
 * AutopilotProvider, which is the whole point: that is the coupling this change removes, and its
 * absence is what these tests assert.
 */
const mount = () => render(<ThemeModeProvider><PageComposer /></ThemeModeProvider>)

// act(): the component updates state from a DOM event listener, so without it React has not
// flushed the re-render by the time the assertion runs and every check reads the empty state.
const emit = (payload: Partial<AutopilotPreviewPayload>) => {
  act(() => {
    window.dispatchEvent(new CustomEvent(AUTOPILOT_PREVIEW_EVENT, {
      detail: { title: 'Draft', ...payload },
    }))
  })
}

describe('PageComposer — the preview surface, outside the rail', () => {
  it('renders with NO AutopilotProvider around it', () => {
    // The whole un-coupling in one assertion: this component is mounted bare. Before the split it
    // could not be — the surface lived inside the provider's subtree.
    expect(() => mount()).not.toThrow()
  })

  it('says nothing is open rather than rendering an empty canvas', () => {
    mount()

    // An empty page that looks like a failed load is the failure mode being avoided here.
    expect(screen.getByText(/No draft open/i)).toBeTruthy()
  })

  it('picks up a draft from the SAME bus Autopilot proposes on', () => {
    mount()
    emit({ summary: ['flex.page-fleet-health', 'table.fleet-failing'], title: 'Fleet health' })

    // One draft, two doors: a preview the agent proposes while this page is open lands here too.
    // A second bus would be a second source of truth about what is being authored.
    expect(screen.queryByText(/No draft open/i)).toBeNull()
    expect(screen.getByText('flex.page-fleet-health')).toBeTruthy()
  })

  it('shows the files a publish would commit, each under its repo path', () => {
    mount()
    emit({
      files: [{ content: 'kind: Flex\n', path: 'helm/portal/templates/flex.page-x.yaml' }],
      title: 'x',
    })

    expect(screen.getByText('helm/portal/templates/flex.page-x.yaml')).toBeTruthy()
  })

  it('surfaces validation problems rather than letting a bad draft look publishable', () => {
    mount()
    emit({ problems: ['spec.widgetData.actions: unknown field'], title: 'x' })

    expect(screen.getByText(/publishing this draft would be rejected/i)).toBeTruthy()
  })

  it('replaces the draft when a new preview arrives, and drops the previous verdicts', () => {
    mount()
    emit({ problems: ['first draft was broken'], title: 'first' })
    expect(screen.getByText('first draft was broken')).toBeTruthy()

    emit({ summary: ['second draft'], title: 'second' })
    // Carrying the old verdicts forward would report the PREVIOUS draft's errors against the
    // current one — the under-reporting shape that made the Autopilot review mark wrong.
    expect(screen.queryByText('first draft was broken')).toBeNull()
    expect(screen.getByText('second draft')).toBeTruthy()
  })
})

describe('PageComposer — the draft as a tree', () => {
  const cr = (kind: string, name: string, children: string[] = []) => [
    `kind: ${kind}`,
    'apiVersion: widgets.templates.krateo.io/v1beta1',
    `metadata:\n  name: ${name}`,
    'spec:\n  widgetData:',
    children.length ? `    items:\n${children.map((ref) => `      - resourceRefId: ${ref}`).join('\n')}` : '    items: []',
    '  resourcesRefs:',
    children.length ? `    items:\n${children.map((ref) => `      - id: ${ref}\n        name: ${ref}\n        resource: widgets`).join('\n')}` : '    items: []',
  ].join('\n')

  it('shows nesting — the structure the old builder could not express', () => {
    mount()
    emit({
      files: [
        { content: cr('Flex', 'page-fleet', ['row-top']), path: 'a/flex.page-fleet.yaml' },
        { content: cr('Row', 'row-top', ['stat-ready']), path: 'a/row.row-top.yaml' },
        { content: cr('Statistic', 'stat-ready'), path: 'a/statistic.stat-ready.yaml' },
      ],
      title: 'Fleet',
    })

    // Scoped to the tree: each name ALSO appears in the Files tab (in the path and the YAML), and
    // an unscoped query matches both, which is not what is being asserted here.
    const panel = screen.getByText('Objects').closest('div')?.parentElement as HTMLElement
    expect(within(panel).getByText('page-fleet')).toBeTruthy()
    expect(within(panel).getByText('row-top')).toBeTruthy()
    expect(within(panel).getByText('stat-ready')).toBeTruthy()
  })

  it('marks a placed widget that is not part of the draft', () => {
    mount()
    emit({
      files: [{ content: cr('Flex', 'page-x', ['existing-table']), path: 'a/flex.page-x.yaml' }],
      title: 'x',
    })

    // Referenced but not carried: it is not published, only pointed at. Hiding it would hide most
    // of a page composed from widgets that already exist.
    const panel = screen.getByText('Objects').closest('div')?.parentElement as HTMLElement
    expect(within(panel).getByText('existing-table')).toBeTruthy()
    expect(within(panel).getByText('placed')).toBeTruthy()
  })

  it('says so when the draft carries no objects', () => {
    mount()
    emit({ summary: ['nothing structural'], title: 'x' })

    expect(screen.getByText(/Nothing in this draft yet/i)).toBeTruthy()
  })
})

describe('PageComposer — structural edits from the tree', () => {
  const crWith = (kind: string, name: string, children: string[] = []) => [
    `kind: ${kind}`,
    'apiVersion: widgets.templates.krateo.io/v1beta1',
    `metadata:\n  name: ${name}`,
    'spec:\n  widgetData:',
    children.length ? `    items:\n${children.map((ref) => `      - resourceRefId: ${ref}`).join('\n')}` : '    items: []',
    '  resourcesRefs:',
    children.length ? `    items:\n${children.map((ref) => `      - id: ${ref}\n        name: ${ref}\n        resource: widgets`).join('\n')}` : '    items: []',
  ].join('\n')

  const openTwoChildDraft = () => {
    mount()
    emit({
      files: [{ content: crWith('Flex', 'page-x', ['first', 'second']), path: 'a/flex.page-x.yaml' }],
      title: 'x',
    })
  }

  it('emits the reordered PARENT on the same bus the Files editor uses', () => {
    const seen: { path: string; content: string }[] = []
    const listener = (event: Event) => {
      seen.push((event as CustomEvent<{ path: string; content: string }>).detail)
    }
    window.addEventListener('autopilotPreviewFileEdited', listener)
    openTwoChildDraft()

    act(() => { screen.getByLabelText('Move second up').click() })
    window.removeEventListener('autopilotPreviewFileEdited', listener)

    // One bus, one place that re-checks the cap and re-arms the gate — rather than this panel
    // growing a second way to mutate a draft.
    expect(seen).toHaveLength(1)
    expect(seen[0].path).toBe('a/flex.page-x.yaml')
    expect(seen[0].content.indexOf('second')).toBeLessThan(seen[0].content.indexOf('first'))
  })

  it('does not offer move/remove on a root, which nothing places', () => {
    openTwoChildDraft()

    expect(screen.queryByLabelText('Move page-x up')).toBeNull()
    expect(screen.getByLabelText('Move first down')).toBeTruthy()
  })

  it('removing emits a parent without that child', () => {
    const seen: { content: string }[] = []
    const listener = (event: Event) => {
      seen.push((event as CustomEvent<{ content: string }>).detail)
    }
    window.addEventListener('autopilotPreviewFileEdited', listener)
    openTwoChildDraft()

    act(() => { screen.getByLabelText('Remove first').click() })
    window.removeEventListener('autopilotPreviewFileEdited', listener)

    expect(seen[0].content).not.toContain('first')
    expect(seen[0].content).toContain('second')
  })
})

describe('PageComposer — adding a layout container', () => {
  const flex = (name: string, children: string[] = []) => [
    'kind: Flex',
    'apiVersion: widgets.templates.krateo.io/v1beta1',
    `metadata:\n  name: ${name}`,
    'spec:\n  widgetData:',
    children.length ? `    items:\n${children.map((ref) => `      - resourceRefId: ${ref}`).join('\n')}` : '    items: []',
    '  resourcesRefs:\n    items: []',
  ].join('\n')

  const capture = () => {
    const adds: { path: string; content: string }[] = []
    const edits: { path: string; content: string }[] = []
    const onAdd = (event: Event) => { adds.push((event as CustomEvent<{ path: string; content: string }>).detail) }
    const onEdit = (event: Event) => { edits.push((event as CustomEvent<{ path: string; content: string }>).detail) }
    window.addEventListener('autopilotPreviewFileAdded', onAdd)
    window.addEventListener('autopilotPreviewFileEdited', onEdit)
    return {
      adds,
      edits,
      stop: () => {
        window.removeEventListener('autopilotPreviewFileAdded', onAdd)
        window.removeEventListener('autopilotPreviewFileEdited', onEdit)
      },
    }
  }

  it('creates the container file AND places it — add before edit', () => {
    const bus = capture()
    mount()
    emit({ files: [{ content: flex('page-x'), path: 'helm/portal/templates/flex.page-x.yaml' }], title: 'x' })

    act(() => { screen.getByLabelText('Add inside page-x').click() })
    act(() => { screen.getByText('Row').click() })
    bus.stop()

    // The add MUST precede the edit: the parent's new reference resolves to a file that has to
    // exist, or the draft briefly points at nothing and the live render shows an empty slot.
    expect(bus.adds).toHaveLength(1)
    expect(bus.edits).toHaveLength(1)
    expect(bus.adds[0].path).toBe('helm/portal/templates/row.page-x-row.yaml')
    expect(bus.adds[0].content).toContain('kind: Row')
    expect(bus.edits[0].path).toBe('helm/portal/templates/flex.page-x.yaml')
    expect(bus.edits[0].content).toContain('page-x-row')
  })

  it('offers add on a container and not on a leaf', () => {
    mount()
    emit({
      files: [
        { content: flex('page-x', ['stat']), path: 'helm/portal/templates/flex.page-x.yaml' },
        {
          content: 'kind: Statistic\napiVersion: widgets.templates.krateo.io/v1beta1\nmetadata:\n  name: stat\nspec:\n  widgetData: {}\n',
          path: 'helm/portal/templates/statistic.stat.yaml',
        },
      ],
      title: 'x',
    })

    // A Statistic has no items; offering "add" there would author a CR the strict CRDs reject.
    expect(screen.getByLabelText('Add inside page-x')).toBeTruthy()
    expect(screen.queryByLabelText('Add inside stat')).toBeNull()
  })
})

describe('PageComposer — binding live data', () => {
  const flexFile = {
    content: [
      'kind: Flex',
      'apiVersion: widgets.templates.krateo.io/v1beta1',
      'metadata:\n  name: page-x',
      'spec:\n  widgetData:\n    allowedResources: []\n    items: []',
      '  resourcesRefs:\n    items: []',
    ].join('\n'),
    path: 'helm/portal/templates/flex.page-x.yaml',
  }

  it('generates the RESTAction AND the widget, then places it — three emissions', () => {
    const adds: { path: string; content: string }[] = []
    const edits: { path: string }[] = []
    const onAdd = (event: Event) => { adds.push((event as CustomEvent<{ path: string; content: string }>).detail) }
    const onEdit = (event: Event) => { edits.push((event as CustomEvent<{ path: string }>).detail) }
    window.addEventListener('autopilotPreviewFileAdded', onAdd)
    window.addEventListener('autopilotPreviewFileEdited', onEdit)

    mount()
    emit({ files: [flexFile], title: 'x' })
    act(() => { screen.getByLabelText('Bind data inside page-x').click() })

    act(() => {
      fireEvent.change(screen.getByPlaceholderText('fleet-failing'), { target: { value: 'fleet' } })
      fireEvent.change(screen.getByPlaceholderText('/apis/…'), { target: { value: '/apis/x/v1/namespaces/n/things' } })
      fireEvent.change(screen.getByPlaceholderText(/"Name"/), { target: { value: '{"Name": ".metadata.name"}' } })
    })
    act(() => { screen.getByText('Generate').click() })

    window.removeEventListener('autopilotPreviewFileAdded', onAdd)
    window.removeEventListener('autopilotPreviewFileEdited', onEdit)

    // RESTAction first: the widget's apiRef names it, so the reverse order points at nothing.
    expect(adds.map((file) => file.path)).toEqual([
      'helm/portal/templates/restaction.fleet.yaml',
      'helm/portal/templates/table.fleet.yaml',
    ])
    expect(adds[1].content).toContain('apiRef')
    expect(edits[0].path).toBe('helm/portal/templates/flex.page-x.yaml')
  })

  it('refuses a field path that is not a path, rather than generating broken jq', () => {
    mount()
    emit({ files: [flexFile], title: 'x' })
    act(() => { screen.getByLabelText('Bind data inside page-x').click() })

    act(() => {
      fireEvent.change(screen.getByPlaceholderText('fleet-failing'), { target: { value: 'fleet' } })
      fireEvent.change(screen.getByPlaceholderText('/apis/…'), { target: { value: '/apis/x' } })
      fireEvent.change(screen.getByPlaceholderText(/"Name"/), { target: { value: '{"Bad": ".a | halt"}' } })
    })
    act(() => { screen.getByText('Generate').click() })

    // Named refusal at the form beats a syntax error inside generated code the author never wrote.
    expect(screen.getByText(/not a supported field path/i)).toBeTruthy()
  })
})

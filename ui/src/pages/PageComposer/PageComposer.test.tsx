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
import { load } from 'js-yaml'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { AUTOPILOT_PREVIEW_EVENT } from '../../components/Autopilot/previewBus'
import type { AutopilotPreviewPayload } from '../../components/Autopilot/previewBus'
import { emitDraftChanged, previewSurfaceClaimed } from '../../components/Autopilot/previewDraftChanged'
import { AUTOPILOT_DRAFT_START_EVENT } from '../../components/Autopilot/previewDraftStart'
import type { DraftStartDetail } from '../../components/Autopilot/previewDraftStart'
import { AUTOPILOT_PUBLISH_REQUEST_EVENT, emitPublishResult } from '../../components/Autopilot/previewPublishRequest'
import type { PublishRequestDetail } from '../../components/Autopilot/previewPublishRequest'
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

/**
 * One widget-CR fixture for every suite below — there were three near-identical copies, and the
 * namespace is why that mattered: adding it to one copy would have left the others generating the
 * objects the cluster rejects, which is the exact bug these are meant to catch.
 *
 * `namespace` is present by default because the widget CRDs require it and default it nowhere.
 */
const widgetCr = (
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
 * Open a draft: the preview payload, and the held draft the tree reads.
 *
 * TWO BUSES, DELIBERATELY. The payload is what the SURFACE renders (the Files tab, the verdicts);
 * the held draft is what the TREE edits against. They were the same object once — the tree read
 * `payload.files` — and that was the bug: the payload is emitted once and never re-emitted, so
 * every structural edit was computed against the bytes as they were when the draft was first
 * previewed, and consecutive edits to one parent silently reverted each other. In the app the
 * provider broadcasts the held draft after each accepted write; here the test plays that part.
 *
 * act(): the component updates state from a DOM event listener, so without it React has not
 * flushed the re-render by the time the assertion runs and every check reads the empty state.
 */
const emit = (payload: Partial<AutopilotPreviewPayload>) => {
  act(() => {
    window.dispatchEvent(new CustomEvent(AUTOPILOT_PREVIEW_EVENT, {
      detail: { title: 'Draft', ...payload },
    }))
    emitDraftChanged({
      files: Object.fromEntries((payload.files ?? []).map((file) => [file.path, file.content])),
    })
  })
}

/** Re-broadcast the held draft alone — the provider's answer to an accepted edit. */
const held = (files: Record<string, string>) => {
  act(() => emitDraftChanged({ files }))
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
    // The SURFACE renders the payload, which carries repo DESTINATIONS — that is what a reviewer
    // needs to see before approving a change request. The tree, below, speaks held keys instead;
    // the two vocabularies are separate on purpose and `updateDisplayedFile` bridges them.
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

describe('PageComposer — a person starts the draft', () => {
  it('offers Start a page rather than only waiting for the agent', () => {
    mount()

    // The button shipped DISABLED, with a note saying start-a-page landed next. Until it did, the
    // surface built to let a human author a page could only ever receive Autopilot's — which
    // inverts the parity rule it was built to satisfy.
    const button = screen.getByText('Start a page').closest('button')
    expect(button).toBeTruthy()
    expect(button?.disabled).toBe(false)
  })

  it('emits the seed on the start bus, root first', () => {
    const seen: DraftStartDetail[] = []
    const listener = (event: Event) => { seen.push((event as CustomEvent<DraftStartDetail>).detail) }
    window.addEventListener(AUTOPILOT_DRAFT_START_EVENT, listener)

    mount()
    act(() => { screen.getByText('Start a page').click() })
    act(() => {
      fireEvent.change(screen.getByPlaceholderText('fleet-health'), { target: { value: 'fleet-health' } })
    })
    act(() => { screen.getByText('Start').click() })
    window.removeEventListener(AUTOPILOT_DRAFT_START_EVENT, listener)

    // Raw CRs, not YAML: the provider routes them through `recordPagePreview`, the SAME entry an
    // agent-proposed page takes, so the two are indistinguishable downstream.
    expect(seen).toHaveLength(1)
    const [root, header] = seen[0].widgets as { kind: string; metadata: { name: string } }[]
    expect(root.kind).toBe('Flex')
    expect(root.metadata.name).toBe('page-fleet-health')
    expect(header.kind).toBe('PageHeader')
  })

  it('refuses a bad slug in the form rather than seeding an unpublishable draft', () => {
    const seen: unknown[] = []
    const listener = (event: Event) => { seen.push(event) }
    window.addEventListener(AUTOPILOT_DRAFT_START_EVENT, listener)

    mount()
    act(() => { screen.getByText('Start a page').click() })
    act(() => {
      fireEvent.change(screen.getByPlaceholderText('fleet-health'), { target: { value: 'Fleet Health' } })
    })
    act(() => { screen.getByText('Start').click() })
    window.removeEventListener(AUTOPILOT_DRAFT_START_EVENT, listener)

    expect(seen).toHaveLength(0)
    // Scoped to the Alert: the field's own help text also says "lower-case", and matching that
    // would pass whether or not the form actually refused anything.
    expect(screen.getByText(/the slug must be lower-case/i)).toBeTruthy()
  })
})

describe('PageComposer — publishing without leaving the page', () => {
  const openDraft = () => {
    mount()
    emit({ files: [{ content: widgetCr('Flex', 'page-x'), path: 'flex.page-x.yaml' }], title: 'x' })
  }

  it('asks the provider to publish, rather than sending the author to the chat rail', () => {
    const seen: PublishRequestDetail[] = []
    const listener = (event: Event) => { seen.push((event as CustomEvent<PublishRequestDetail>).detail) }
    window.addEventListener(AUTOPILOT_PUBLISH_REQUEST_EVENT, listener)

    openDraft()
    act(() => { screen.getByText('Publish').click() })
    window.removeEventListener(AUTOPILOT_PUBLISH_REQUEST_EVENT, listener)

    // The provider runs the SAME runDraftPublish the agent's verb takes — one destination form,
    // one gate, one cap. Until now the only way to ship a draft authored here was to ask the agent.
    expect(seen).toHaveLength(1)
    expect(seen[0].verb).toBe('publishPage')
    expect(seen[0].id).toBeTruthy()
  })

  it('offers no Publish with no draft — there is nothing to ship', () => {
    mount()

    expect(screen.queryByText('Publish')).toBeNull()
  })

  it('shows the change request on its own page when the publish lands', () => {
    let id = ''
    const listener = (event: Event) => { id = (event as CustomEvent<PublishRequestDetail>).detail.id }
    window.addEventListener(AUTOPILOT_PUBLISH_REQUEST_EVENT, listener)
    openDraft()
    act(() => { screen.getByText('Publish').click() })
    window.removeEventListener(AUTOPILOT_PUBLISH_REQUEST_EVENT, listener)

    act(() => { emitPublishResult({ deepLink: 'https://example.invalid/compare/x', denial: null, id }) })

    expect(screen.getByText(/change request is open/i)).toBeTruthy()
    expect(screen.getByText('Open change request').closest('a')?.href).toContain('example.invalid')
  })

  it('shows a refusal as a refusal, not as success', () => {
    let id = ''
    const listener = (event: Event) => { id = (event as CustomEvent<PublishRequestDetail>).detail.id }
    window.addEventListener(AUTOPILOT_PUBLISH_REQUEST_EVENT, listener)
    openDraft()
    act(() => { screen.getByText('Publish').click() })
    window.removeEventListener(AUTOPILOT_PUBLISH_REQUEST_EVENT, listener)

    act(() => { emitPublishResult({ deepLink: null, denial: 'publish cancelled — destination not confirmed', id }) })

    expect(screen.getByText(/destination not confirmed/i)).toBeTruthy()
  })

  it('ignores another surface’s publish result', () => {
    openDraft()
    act(() => { screen.getByText('Publish').click() })

    act(() => { emitPublishResult({ deepLink: null, denial: 'not ours', id: 'someone-else' }) })

    // Two surfaces can be open on one draft; answering to a correlation id is what keeps a drawer's
    // outcome from being reported as this page's.
    expect(screen.queryByText('not ours')).toBeNull()
    expect(screen.getByText('Publishing…')).toBeTruthy()
  })
})

describe('PageComposer — the two halves are one view', () => {
  it('reveals the selected object in the Files tab', () => {
    mount()
    emit({
      files: [
        { content: 'kind: Flex\n', path: 'helm/portal/templates/flex.page-fleet.yaml' },
        { content: 'kind: Statistic\n', path: 'helm/portal/templates/statistic.stat-ready.yaml' },
      ],
      title: 'Fleet',
    })
    // The tree reads the HELD draft (bare keys); the Files tab shows routed repo destinations.
    held({
      'flex.page-fleet.yaml': widgetCr('Flex', 'page-fleet', ['stat-ready']),
      'statistic.stat-ready.yaml': widgetCr('Statistic', 'stat-ready'),
    })

    const panel = screen.getByText('Objects').closest('div')?.parentElement as HTMLElement
    act(() => { fireEvent.click(within(panel).getByText('stat-ready')) })

    // Selecting a node switches to Files and reveals that file. Without it the tree says what is
    // in the draft beside a list that will not show you the one you just clicked.
    const files = document.querySelector('.ant-tabs-tab-active')?.textContent
    expect(files).toBe('Files')
    expect(document.getElementById('preview-file-helm-portal-templates-statistic-stat-ready-yaml')).toBeTruthy()
  })

  it('claims nothing for a placed existing widget, which has no file in this draft', () => {
    mount()
    emit({ files: [{ content: 'kind: Flex\n', path: 'helm/portal/templates/flex.page-x.yaml' }], title: 'x' })
    held({ 'flex.page-x.yaml': widgetCr('Flex', 'page-x', ['already-there']) })

    const panel = screen.getByText('Objects').closest('div')?.parentElement as HTMLElement
    act(() => { fireEvent.click(within(panel).getByText('already-there')) })

    // Nothing to reveal, so nothing is scrolled to — rather than jumping somewhere arbitrary.
    expect(screen.getByText('placed')).toBeTruthy()
  })
})

describe('PageComposer — one surface owns the draft', () => {
  it('claims the preview while mounted, so the drawer does not open over it', () => {
    expect(previewSurfaceClaimed()).toBe(false)
    const view = mount()

    // Both listen on the same bus. Two surfaces on one draft is not merely redundant: the drawer's
    // close fires the sandbox teardown, which DELETEs the draft CRs this page is still rendering.
    expect(previewSurfaceClaimed()).toBe(true)
    view.unmount()
    expect(previewSurfaceClaimed()).toBe(false)
  })

  it('fires the sandbox teardown on close — the lifecycle the drawer used to own', () => {
    const onClose = vi.fn()
    mount()
    emit({ files: [{ content: widgetCr('Flex', 'page-x'), path: 'flex.page-x.yaml' }], onClose, title: 'x' })

    act(() => { screen.getByText('Close draft').click() })
    act(() => { screen.getByText('Discard').click() })

    // Without this the sandbox CRs outlive every surface that could render them.
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/No draft open/i)).toBeTruthy()
  })
})

describe('PageComposer — the draft as a tree', () => {
  it('shows nesting — the structure the old builder could not express', () => {
    mount()
    emit({
      files: [
        { content: widgetCr('Flex', 'page-fleet', ['row-top']), path: 'flex.page-fleet.yaml' },
        { content: widgetCr('Row', 'row-top', ['stat-ready']), path: 'row.row-top.yaml' },
        { content: widgetCr('Statistic', 'stat-ready'), path: 'statistic.stat-ready.yaml' },
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
      files: [{ content: widgetCr('Flex', 'page-x', ['existing-table']), path: 'flex.page-x.yaml' }],
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
  const openTwoChildDraft = () => {
    mount()
    emit({
      files: [{ content: widgetCr('Flex', 'page-x', ['first', 'second']), path: 'flex.page-x.yaml' }],
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
    expect(seen[0].path).toBe('flex.page-x.yaml')
    expect(seen[0].content.indexOf('second')).toBeLessThan(seen[0].content.indexOf('first'))
  })

  it('does not offer move/remove on a root, which nothing places', () => {
    openTwoChildDraft()

    expect(screen.queryByLabelText('Move page-x up')).toBeNull()
    expect(screen.getByLabelText('Move first down')).toBeTruthy()
  })

  it('computes the SECOND edit from the first, not from the bytes it opened with', () => {
    // THE REGRESSION. The tree used to read its file bytes from `payload.files`, which is emitted
    // once and never re-emitted — so every structural edit was derived from the draft as it was
    // when first previewed. Two moves in a row and the second silently reverted the first: both
    // started from the same original, and the tree never redrew to show it.
    //
    // Here the test plays the provider: it applies the emitted edit to the held draft and
    // re-broadcasts, exactly as `useDraftFileBuses` does after an accepted write. If the tree were
    // still reading frozen bytes, the second move would re-emit the FIRST move's result.
    const seen: { path: string; content: string }[] = []
    const listener = (event: Event) => {
      seen.push((event as CustomEvent<{ path: string; content: string }>).detail)
    }
    window.addEventListener('autopilotPreviewFileEdited', listener)

    mount()
    emit({
      files: [{ content: widgetCr('Flex', 'page-x', ['first', 'second', 'third']), path: 'flex.page-x.yaml' }],
      title: 'x',
    })

    act(() => { screen.getByLabelText('Move third up').click() })
    held({ 'flex.page-x.yaml': seen[0].content })
    act(() => { screen.getByLabelText('Move third up').click() })
    window.removeEventListener('autopilotPreviewFileEdited', listener)

    const order = (yaml: string) => (load(yaml) as {
      spec: { widgetData: { items: { resourceRefId: string }[] } }
    }).spec.widgetData.items.map((item) => item.resourceRefId)

    expect(order(seen[0].content)).toEqual(['first', 'third', 'second'])
    // Frozen bytes would repeat ['first', 'third', 'second'] here — one move's worth of progress
    // from two moves, with no error anywhere to say why.
    expect(order(seen[1].content)).toEqual(['third', 'first', 'second'])
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
  /**
   * ONE ordered log across both buses, not one array per bus.
   *
   * Two separate arrays cannot express "the add came first" — which is the property this suite
   * exists to assert, and which the previous version of it did not check: it compared each array's
   * LENGTH and each entry's path, both of which hold just as well when the emissions are reversed.
   */
  const capture = () => {
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

  it('creates the container file AND places it — add before edit', () => {
    const bus = capture()
    mount()
    emit({ files: [{ content: widgetCr('Flex', 'page-x'), path: 'flex.page-x.yaml' }], title: 'x' })

    act(() => { screen.getByLabelText('Add inside page-x').click() })
    act(() => { screen.getByText('Row').click() })
    bus.stop()

    // The add MUST precede the edit: the parent's new reference resolves to a file that has to
    // exist, or the draft briefly points at nothing and the live render shows an empty slot.
    // Asserted as ORDER, which is the claim — lengths and paths hold equally if it is reversed.
    expect(bus.log.map((entry) => entry.op)).toEqual(['add', 'edit'])
    // A bare held key. A repo path here would be prefixed a second time at publish, landing the
    // file at helm/portal/templates/helm/portal/templates/row.page-x-row.yaml.
    expect(bus.log[0].path).toBe('row.page-x-row.yaml')
    expect(bus.log[0].content).toContain('kind: Row')
    expect(bus.log[0].content).toContain('namespace: krateo-system')
    expect(bus.log[1].path).toBe('flex.page-x.yaml')
    expect(bus.log[1].content).toContain('page-x-row')
  })

  it('wraps a child in a new container — re-parenting, not a sibling insert', () => {
    const bus = capture()
    mount()
    emit({
      files: [{ content: widgetCr('Flex', 'page-x', ['stat']), path: 'flex.page-x.yaml' }],
      title: 'x',
    })

    act(() => { screen.getByLabelText('Wrap stat').click() })
    act(() => { screen.getByText('Wrap in Row').click() })
    bus.stop()

    // Container first, then the parent that references it — the same ordering rule as every add.
    expect(bus.log.map((entry) => entry.op)).toEqual(['add', 'edit'])
    expect(bus.log[0].path).toBe('row.stat-row.yaml')
    // The child is INSIDE the new container...
    expect(bus.log[0].content).toContain('resourceRefId: stat')
    // ...and the parent now references the container in its place, not the child.
    expect(bus.log[1].content).toContain('resourceRefId: stat-row')
    expect(bus.log[1].content).not.toContain('resourceRefId: stat\n')
  })

  it('does not offer wrap on a root, which no parent holds', () => {
    mount()
    emit({
      files: [{ content: widgetCr('Flex', 'page-x', ['stat']), path: 'flex.page-x.yaml' }],
      title: 'x',
    })

    expect(screen.getByLabelText('Wrap stat')).toBeTruthy()
    expect(screen.queryByLabelText('Wrap page-x')).toBeNull()
  })

  it('does not offer add inside a Layout, whose CRD has no items to add to', () => {
    mount()
    emit({
      files: [
        { content: widgetCr('Flex', 'page-x', ['shell']), path: 'flex.page-x.yaml' },
        { content: widgetCr('Layout', 'shell'), path: 'layout.shell.yaml' },
      ],
      title: 'x',
    })

    // The container list had drifted from the insertable list and carried `Layout`, which has
    // neither `widgetData.items` nor `allowedResources`. The widget CRDs are strict, so every use
    // of that affordance authored a parent the apiserver rejects outright.
    expect(screen.getByLabelText('Add inside page-x')).toBeTruthy()
    expect(screen.queryByLabelText('Add inside shell')).toBeNull()
  })

  it('offers add on a container and not on a leaf', () => {
    mount()
    emit({
      files: [
        { content: widgetCr('Flex', 'page-x', ['stat']), path: 'flex.page-x.yaml' },
        {
          content: 'kind: Statistic\napiVersion: widgets.templates.krateo.io/v1beta1\nmetadata:\n  name: stat\nspec:\n  widgetData: {}\n',
          path: 'statistic.stat.yaml',
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
  const flexFile = { content: widgetCr('Flex', 'page-x'), path: 'flex.page-x.yaml' }

  it('generates the RESTAction AND the widget, then places it — three emissions', () => {
    const adds: { path: string; content: string }[] = []
    const edits: { path: string; content: string }[] = []
    const onAdd = (event: Event) => { adds.push((event as CustomEvent<{ path: string; content: string }>).detail) }
    const onEdit = (event: Event) => { edits.push((event as CustomEvent<{ path: string; content: string }>).detail) }
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
    // Bare held keys — a repo path here is prefixed again at publish.
    expect(adds.map((file) => file.path)).toEqual(['restaction.fleet.yaml', 'table.fleet.yaml'])
    expect(adds[1].content).toContain('apiRef')
    // The namespace is read from the DRAFT's own objects. Without it the Table is rejected at
    // apply, and the placed reference resolves against the empty namespace and renders nothing.
    expect(adds[1].content).toContain('namespace: krateo-system')
    expect(edits[0].content).toContain('namespace: krateo-system')
    expect(edits[0].path).toBe('flex.page-x.yaml')
  })

  it('refuses a name the draft already holds instead of half-applying the binding', () => {
    const adds: unknown[] = []
    const edits: unknown[] = []
    const onAdd = (event: Event) => { adds.push(event) }
    const onEdit = (event: Event) => { edits.push(event) }
    window.addEventListener('autopilotPreviewFileAdded', onAdd)
    window.addEventListener('autopilotPreviewFileEdited', onEdit)

    mount()
    // The draft already holds a table called `fleet`.
    emit({
      files: [
        flexFile,
        { content: widgetCr('Table', 'fleet'), path: 'table.fleet.yaml' },
      ],
      title: 'x',
    })
    act(() => { screen.getByLabelText('Bind data inside page-x').click() })
    act(() => {
      fireEvent.change(screen.getByPlaceholderText('fleet-failing'), { target: { value: 'fleet' } })
      fireEvent.change(screen.getByPlaceholderText('/apis/…'), { target: { value: '/apis/x/v1/things' } })
      fireEvent.change(screen.getByPlaceholderText(/"Name"/), { target: { value: '{"Name": ".metadata.name"}' } })
    })
    act(() => { screen.getByText('Generate').click() })

    window.removeEventListener('autopilotPreviewFileAdded', onAdd)
    window.removeEventListener('autopilotPreviewFileEdited', onEdit)

    // `addFile` refuses an existing path, but it refuses SILENTLY from here — so this used to drop
    // both generated files on the floor while the place still went through, leaving the parent
    // referencing the OLD table twice. Nothing must be emitted at all.
    expect(adds).toHaveLength(0)
    expect(edits).toHaveLength(0)
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

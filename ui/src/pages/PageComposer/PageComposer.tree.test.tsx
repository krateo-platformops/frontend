// @vitest-environment jsdom
/**
 * The TREE, and what it does to the held draft.
 *
 * Structure is the thing the old builder could not express at all — `form.compose-page` emits one
 * level, `vertical: true, items: [...]`, and a Form widget cannot do better because SchemaFields
 * has no repeatable-row control. These assert the operations that make a page a tree: reorder,
 * remove, insert a container, RE-PARENT into one, place an existing widget, and bind live data.
 *
 * The draft lifecycle (open, start, publish, close) lives in PageComposer.test.tsx.
 */
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { load } from 'js-yaml'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { capture, emit, held, installAntdShims, mount, mountWithConfig, widgetCr } from './composerTestHarness'

afterEach(cleanup)
beforeAll(installAntdShims)
// A suite that stubs `fetch` must unstub it, and `unstubAllGlobals` takes the antd shims with it —
// leaving every LATER test in this file rendering against a jsdom with no matchMedia. Reinstalling
// after each test makes that ordering dependency impossible rather than merely avoided.
afterEach(() => {
  vi.unstubAllGlobals()
  installAntdShims()
})

describe('PageComposer — placing a widget that already exists', () => {
  it('places it into the chosen container, adding no file to the draft', async () => {
    // The widget is already on the cluster: only the PARENT changes. One emission, not two.
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      // /list returns a bare array of the objects themselves — the plural is derived from `kind`
      // through the generated table, not sent by the server.
      json: () => Promise.resolve([{ kind: 'Card', metadata: { name: 'fleet-card' } }]),
      ok: true,
      status: 200,
    })))
    const bus = capture()
    mountWithConfig()
    emit({ files: [{ content: widgetCr('Flex', 'page-x'), path: 'templates/flex.page-x.yaml' }], title: 'x' })

    act(() => { screen.getByLabelText('Place inside page-x').click() })
    // The modal mounts into a portal; wait for it before reaching into it.
    await screen.findByText(/Place a widget inside page-x/)
    // `.ant-select-content`, NOT `.ant-select-selector`: antd 6 renamed it, and a v5 selector here
    // silently matches nothing. The dropdown also opens on mouseDown rather than click, and the
    // combobox input is readonly — typing into it does not filter.
    // Wait for the fetch to land BEFORE opening: an empty options array at open time renders an
    // empty dropdown, and antd does not re-open it when the options arrive.
    await screen.findByText('Choose a widget')
    const selector = document.querySelector('.ant-select-content') as HTMLElement
    await act(async () => {
      fireEvent.mouseDown(selector)
      await Promise.resolve()
    })
    const option = await screen.findByText('fleet-card · cards')
    act(() => { fireEvent.click(option) })
    act(() => { screen.getByText('Place').click() })
    bus.stop()

    expect(bus.log.map((entry) => entry.op)).toEqual(['edit'])
    expect(bus.log[0].path).toBe('templates/flex.page-x.yaml')
    // All three places a child lives, or it does not render.
    expect(bus.log[0].content).toContain('resourceRefId: fleet-card')
    expect(bus.log[0].content).toContain('resource: cards')
    expect(bus.log[0].content).toContain('- cards')
  })

  it('offers placing only inside a container', () => {
    mount()
    emit({
      files: [
        { content: widgetCr('Flex', 'page-x', ['stat']), path: 'templates/flex.page-x.yaml' },
        { content: widgetCr('Statistic', 'stat'), path: 'templates/statistic.stat.yaml' },
      ],
      title: 'x',
    })

    expect(screen.getByLabelText('Place inside page-x')).toBeTruthy()
    expect(screen.queryByLabelText('Place inside stat')).toBeNull()
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
    // BOTH HALVES NOW READ THE HELD DRAFT. The Files tab used to render `payload.files` — built
    // once by the verb that proposed the draft and never re-emitted — so it showed the bytes as
    // they were at first preview while the tree and canvas showed the live ones. The payload above
    // is deliberately left at the old `helm/portal/…` spelling to prove the tab no longer reads it.
    held({
      'templates/flex.page-fleet.yaml': widgetCr('Flex', 'page-fleet', ['stat-ready']),
      'templates/statistic.stat-ready.yaml': widgetCr('Statistic', 'stat-ready'),
    })

    const panel = screen.getByText('Objects').closest('div')?.parentElement as HTMLElement
    act(() => { fireEvent.click(within(panel).getByText('stat-ready')) })

    // Selecting a node switches to Files and reveals that file. Without it the tree says what is
    // in the draft beside a list that will not show you the one you just clicked.
    const files = document.querySelector('.ant-tabs-tab-active')?.textContent
    expect(files).toBe('Files')
    // Anchored at the HELD key, which for a page draft is already the chart-relative path.
    expect(document.getElementById('preview-file-templates-statistic-stat-ready-yaml')).toBeTruthy()
    // …and the stale payload's routed spelling is gone from the tab entirely.
    expect(document.getElementById('preview-file-helm-portal-templates-statistic-stat-ready-yaml')).toBeNull()
  })

  it('the Files tab shows the draft AS IT IS, not as it was when first previewed', () => {
    /*
     * The defect: `payload` is built once by the verb that proposed the draft and nothing re-emits
     * it. The canvas and the tree were moved onto a live `files` state for exactly that reason; the
     * Files tab was not moved with them. So there were three views of one draft, and the one
     * LABELLED Files — the surface a person is told to review before opening a real pull request —
     * was the only one that was neither live nor authoritative.
     */
    mount()
    emit({ files: [{ content: widgetCr('Flex', 'page-fleet'), path: 'templates/flex.page-fleet.yaml' }], title: 'Fleet' })
    // …and now the draft GAINS a file, exactly as placing a container does.
    held({
      'templates/flex.page-fleet.yaml': widgetCr('Flex', 'page-fleet', ['row-a']),
      'templates/row.row-a.yaml': widgetCr('Row', 'row-a'),
    })

    // The file that did not exist when the payload was built is listed…
    expect(document.getElementById('preview-file-templates-row-row-a-yaml')).toBeTruthy()
    // …which it could not be while the tab rendered the one-shot payload.
    expect(document.getElementById('preview-file-templates-flex-page-fleet-yaml')).toBeTruthy()
  })

  it('claims nothing for a placed existing widget, which has no file in this draft', () => {
    mount()
    emit({ files: [{ content: 'kind: Flex\n', path: 'helm/portal/templates/flex.page-x.yaml' }], title: 'x' })
    held({ 'templates/flex.page-x.yaml': widgetCr('Flex', 'page-x', ['already-there']) })

    const panel = screen.getByText('Objects').closest('div')?.parentElement as HTMLElement
    act(() => { fireEvent.click(within(panel).getByText('already-there')) })

    // Nothing to reveal, so nothing is scrolled to — rather than jumping somewhere arbitrary.
    expect(screen.getByText('placed')).toBeTruthy()
  })
})

describe('PageComposer — the draft as a tree', () => {
  it('shows nesting — the structure the old builder could not express', () => {
    mount()
    emit({
      files: [
        { content: widgetCr('Flex', 'page-fleet', ['row-top']), path: 'templates/flex.page-fleet.yaml' },
        { content: widgetCr('Row', 'row-top', ['stat-ready']), path: 'templates/row.row-top.yaml' },
        { content: widgetCr('Statistic', 'stat-ready'), path: 'templates/statistic.stat-ready.yaml' },
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
      files: [{ content: widgetCr('Flex', 'page-x', ['existing-table']), path: 'templates/flex.page-x.yaml' }],
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
      files: [{ content: widgetCr('Flex', 'page-x', ['first', 'second']), path: 'templates/flex.page-x.yaml' }],
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
    expect(seen[0].path).toBe('templates/flex.page-x.yaml')
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
      files: [{ content: widgetCr('Flex', 'page-x', ['first', 'second', 'third']), path: 'templates/flex.page-x.yaml' }],
      title: 'x',
    })

    act(() => { screen.getByLabelText('Move third up').click() })
    held({ 'templates/flex.page-x.yaml': seen[0].content })
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

  /** Remove is confirmed now — it deletes a file and the composer has no undo. */
  const confirmRemove = (label: string) => {
    act(() => { screen.getByLabelText(label).click() })
    act(() => { screen.getByRole('button', { name: 'Remove' }).click() })
  }

  it('removing emits a parent without that child', () => {
    const seen: { content: string }[] = []
    const listener = (event: Event) => {
      seen.push((event as CustomEvent<{ content: string }>).detail)
    }
    window.addEventListener('autopilotPreviewFileEdited', listener)
    openTwoChildDraft()

    confirmRemove('Remove first')
    window.removeEventListener('autopilotPreviewFileEdited', listener)

    expect(seen[0].content).not.toContain('first')
    expect(seen[0].content).toContain('second')
  })

  it('REMOVES THE FILE TOO — otherwise the thing you removed comes back as a second page root', () => {
    /*
     * `removeChild` rewrites only the parent. The child's file stayed held, `buildObjectTree` drew
     * the now-unreferenced file as a ROOT, and the removed object reappeared on the canvas beside
     * the page — with no `parentPath`, so no action buttons, so no way to remove it a second time.
     * It shipped in the change request as well, since pagePublish emits one op per held key.
     */
    const removed: { path: string }[] = []
    const listener = (event: Event) => { removed.push((event as CustomEvent<{ path: string }>).detail) }
    window.addEventListener('autopilotPreviewFileRemoved', listener)
    // A draft that CARRIES the child. The two-child fixture references widgets the draft does not
    // hold — external cluster widgets — and those have no file to remove, which is why the guard
    // asks for `drafted` before emitting anything.
    mount()
    emit({
      files: [
        { content: widgetCr('Flex', 'page-x', ['row-a']), path: 'templates/flex.page-x.yaml' },
        { content: widgetCr('Row', 'row-a'), path: 'templates/row.row-a.yaml' },
      ],
      title: 'x',
    })

    confirmRemove('Remove row-a')
    window.removeEventListener('autopilotPreviewFileRemoved', listener)

    expect(removed).toHaveLength(1)
    expect(removed[0].path).toBe('templates/row.row-a.yaml')
  })

  it('leaves an EXTERNAL widget\'s file alone — there is none, and the CR is not ours to delete', () => {
    const removed: { path: string }[] = []
    const listener = (event: Event) => { removed.push((event as CustomEvent<{ path: string }>).detail) }
    window.addEventListener('autopilotPreviewFileRemoved', listener)
    openTwoChildDraft()

    confirmRemove('Remove first')
    window.removeEventListener('autopilotPreviewFileRemoved', listener)

    // The reference goes; nothing is deleted, because the widget lives on the cluster and this page
    // merely pointed at it.
    expect(removed).toHaveLength(0)
  })

  it('asks before removing — the one destructive edit in the tree, and there is no undo', () => {
    const removed: { path: string }[] = []
    const listener = (event: Event) => { removed.push((event as CustomEvent<{ path: string }>).detail) }
    window.addEventListener('autopilotPreviewFileRemoved', listener)
    openTwoChildDraft()

    // The click alone must not delete anything.
    act(() => { screen.getByLabelText('Remove first').click() })
    expect(removed).toHaveLength(0)
    expect(screen.getByText('Remove first from this page?')).toBeTruthy()
    window.removeEventListener('autopilotPreviewFileRemoved', listener)
  })
})

describe('PageComposer — adding a layout container', () => {
  it('creates the container file AND places it — add before edit', () => {
    const bus = capture()
    mount()
    emit({ files: [{ content: widgetCr('Flex', 'page-x'), path: 'templates/flex.page-x.yaml' }], title: 'x' })

    act(() => { screen.getByLabelText('Add inside page-x').click() })
    // Scoped to the open menu: the palette column offers a 'Row' of its own now, and an unscoped
    // text query matches both. Which one is clicked is the whole difference between this test and
    // the palette-drop test, so the scope is the assertion, not tidiness.
    act(() => { within(document.querySelector('.ant-dropdown') as HTMLElement).getByText('Row').click() })
    bus.stop()

    // The add MUST precede the edit: the parent's new reference resolves to a file that has to
    // exist, or the draft briefly points at nothing and the live render shows an empty slot.
    // Asserted as ORDER, which is the claim — lengths and paths hold equally if it is reversed.
    expect(bus.log.map((entry) => entry.op)).toEqual(['add', 'edit'])
    // A bare held key. A repo path here would be prefixed a second time at publish, landing the
    // file at helm/portal/templates/helm/portal/templates/row.page-x-row.yaml.
    expect(bus.log[0].path).toBe('templates/row.page-x-row.yaml')
    expect(bus.log[0].content).toContain('kind: Row')
    expect(bus.log[0].content).toContain('namespace: krateo-system')
    expect(bus.log[1].path).toBe('templates/flex.page-x.yaml')
    expect(bus.log[1].content).toContain('page-x-row')
  })

  it('wraps a child in a new container — re-parenting, not a sibling insert', () => {
    const bus = capture()
    mount()
    emit({
      files: [{ content: widgetCr('Flex', 'page-x', ['stat']), path: 'templates/flex.page-x.yaml' }],
      title: 'x',
    })

    act(() => { screen.getByLabelText('Wrap stat').click() })
    act(() => { screen.getByText('Wrap in Row').click() })
    bus.stop()

    // Container first, then the parent that references it — the same ordering rule as every add.
    expect(bus.log.map((entry) => entry.op)).toEqual(['add', 'edit'])
    expect(bus.log[0].path).toBe('templates/row.stat-row.yaml')
    // The child is INSIDE the new container...
    expect(bus.log[0].content).toContain('resourceRefId: stat')
    // ...and the parent now references the container in its place, not the child.
    expect(bus.log[1].content).toContain('resourceRefId: stat-row')
    expect(bus.log[1].content).not.toContain('resourceRefId: stat\n')
  })

  it('does not offer wrap on a root, which no parent holds', () => {
    mount()
    emit({
      files: [{ content: widgetCr('Flex', 'page-x', ['stat']), path: 'templates/flex.page-x.yaml' }],
      title: 'x',
    })

    expect(screen.getByLabelText('Wrap stat')).toBeTruthy()
    expect(screen.queryByLabelText('Wrap page-x')).toBeNull()
  })

  it('does not offer add inside a Layout, whose CRD has no items to add to', () => {
    mount()
    emit({
      files: [
        { content: widgetCr('Flex', 'page-x', ['shell']), path: 'templates/flex.page-x.yaml' },
        { content: widgetCr('Layout', 'shell'), path: 'templates/layout.shell.yaml' },
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
        { content: widgetCr('Flex', 'page-x', ['stat']), path: 'templates/flex.page-x.yaml' },
        {
          content: 'kind: Statistic\napiVersion: widgets.templates.krateo.io/v1beta1\nmetadata:\n  name: stat\nspec:\n  widgetData: {}\n',
          path: 'templates/statistic.stat.yaml',
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
  const flexFile = { content: widgetCr('Flex', 'page-x'), path: 'templates/flex.page-x.yaml' }

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
    expect(adds.map((file) => file.path)).toEqual(['templates/restaction.fleet.yaml', 'templates/table.fleet.yaml'])
    expect(adds[1].content).toContain('apiRef')
    // The namespace is read from the DRAFT's own objects. Without it the Table is rejected at
    // apply, and the placed reference resolves against the empty namespace and renders nothing.
    expect(adds[1].content).toContain('namespace: krateo-system')
    expect(edits[0].content).toContain('namespace: krateo-system')
    expect(edits[0].path).toBe('templates/flex.page-x.yaml')
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
        { content: widgetCr('Table', 'fleet'), path: 'templates/table.fleet.yaml' },
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

  it('refuses a column that would REWRITE the generated program, and says which rule it broke', () => {
    mount()
    emit({ files: [flexFile], title: 'x' })
    act(() => { screen.getByLabelText('Bind data inside page-x').click() })

    act(() => {
      fireEvent.change(screen.getByPlaceholderText('fleet-failing'), { target: { value: 'fleet' } })
      fireEvent.change(screen.getByPlaceholderText('/apis/…'), { target: { value: '/apis/x' } })
      // Unbalanced, not merely exotic. `.a | halt` used to fail here and is now ACCEPTED: it is
      // contained, so it reaches the server and comes back as a message the preview shows.
      fireEvent.change(screen.getByPlaceholderText(/"Name"/), { target: { value: '{"Bad": ".a) | .b"}' } })
    })
    act(() => { screen.getByText('Generate').click() })

    // The form still refuses what could escape the wrapper it is interpolated into — and names the
    // actual rule, which is almost always a missing bracket rather than an expression too clever.
    expect(screen.getByText(/unbalanced/i)).toBeTruthy()
  })
})

// @vitest-environment jsdom
/**
 * FE-K(edit) — the EDITABLE RestDefinition preview drawer, end to end:
 *   - a RestDefinition preview (editRestDef) renders an editable source textarea seeded with the YAML;
 *   - editing to a CRD-INVALID draft + Apply → the validation-error Alert appears and NO edit is
 *     emitted on the edit bus (the gate would not be re-armed);
 *   - editing to a CLEAN draft + Apply → the error Alert clears AND the edited draft is emitted on
 *     the edit bus (the provider re-arms the preview gate → publish commits the edited bytes);
 *   - a non-editable preview (no editRestDef) renders the read-only YAML, no textarea.
 * The held-bytes guarantee is exercised: the emitted draft is the byte-for-byte edited YAML, produced
 * by a human edit in the drawer — never a model round-trip.
 */
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// WidgetRenderer (only mounted for a liveEndpoint payload, not here) pulls the whole widget system —
// stub it so the drawer test stays focused. The two provider hooks the drawer reads are stubbed too.
vi.mock('../WidgetRenderer', () => ({ default: () => null }))
vi.mock('./AutopilotProvider', () => ({ useAutopilot: () => ({ open: false }) }))
vi.mock('../../context/ThemeModeContext', () => ({ useThemeMode: () => ({ mode: 'light' }) }))

import { buildPagePreviewPayload, buildRestDefPreviewPayload, toYamlString } from './previewBridge'
import { AUTOPILOT_PREVIEW_EVENT, openAutopilotPreview } from './previewBus'
import { claimPreviewSurface, emitDraftChanged } from './previewDraftChanged'
import { emitDraftClose } from './previewDraftClose'
import { AUTOPILOT_PREVIEW_EDIT_EVENT, type RestDefEditDetail } from './previewEditBus'
import { AUTOPILOT_PREVIEW_FILE_EDIT_EVENT, type FileEditDetail } from './previewFileEdit'
import { AutopilotPreviewDrawer } from './previewSurface'

beforeAll(() => {
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

// Each test mounts its OWN drawer; unmount between tests so a prior drawer's global
// preview-event listener does not also react to the next test's openAutopilotPreview.
afterEach(cleanup)

/** A CLEAN RestDefinition draft (URL oasPath, uppercase method) — publishable as-is. */
const cleanDraft = {
  apiVersion: 'ogen.krateo.io/v1alpha1',
  kind: 'RestDefinition',
  metadata: { name: 'gh-repo', namespace: 'krateo-system' },
  spec: {
    oasPath: 'https://example.org/openapi.yaml',
    resource: { kind: 'Repo', verbsDescription: [{ action: 'get', method: 'GET', path: '/repos' }] },
    resourceGroup: 'github.ogen.krateo.io',
  },
}

/** Capture the LAST draft emitted on the edit bus (or null). Returns the un-listen fn. */
const captureEmits = (sink: { last: Record<string, unknown> | null }): (() => void) => {
  const listener = (event: Event): void => { sink.last = (event as CustomEvent<RestDefEditDetail>).detail.draft }
  window.addEventListener(AUTOPILOT_PREVIEW_EDIT_EVENT, listener)
  return () => window.removeEventListener(AUTOPILOT_PREVIEW_EDIT_EVENT, listener)
}

describe('AutopilotPreviewDrawer — editable RestDefinition source', () => {
  it('renders the editable source textarea seeded with the draft YAML', async () => {
    const view = render(<AutopilotPreviewDrawer />)
    // A CLEAN draft so no starting validation errors clutter the assertion.
    openAutopilotPreview(buildRestDefPreviewPayload(cleanDraft))
    const area = await waitFor(() => view.getByLabelText('RestDefinition source') as HTMLTextAreaElement)
    expect(area.value).toContain('kind: RestDefinition')
    expect(area.value).toContain('resourceGroup: github.ogen.krateo.io')
  })

  it('a CLEAN edit emits the edited draft on the edit bus and clears the error Alert', async () => {
    const sink: { last: Record<string, unknown> | null } = { last: null }
    const off = captureEmits(sink)
    const view = render(<AutopilotPreviewDrawer />)
    openAutopilotPreview(buildRestDefPreviewPayload(cleanDraft))
    const area = await waitFor(() => view.getByLabelText('RestDefinition source') as HTMLTextAreaElement)

    // A human edit of the held YAML: rename the path (still a valid draft).
    const edited = { ...cleanDraft, spec: { ...cleanDraft.spec, resource: { ...cleanDraft.spec.resource, verbsDescription: [{ action: 'get', method: 'GET', path: '/repositories' }] } } }
    fireEvent.change(area, { target: { value: toYamlString(edited) } })
    fireEvent.click(view.getByRole('button', { name: 'Apply edits' }))

    // The edited draft rode the bus — byte-for-byte what the human typed (the held-bytes guarantee).
    await waitFor(() => expect(sink.last).not.toBeNull())
    const spec = sink.last?.spec as { resource?: { verbsDescription?: { path?: string }[] } }
    expect(spec?.resource?.verbsDescription?.[0]?.path).toBe('/repositories')
    expect(view.queryByText(/publishing this draft would be rejected/i)).toBeNull()
    expect(view.getByText('Valid — held for publish')).toBeTruthy()
    off()
  })

  it('a CRD-INVALID edit shows the validation Alert and does NOT emit (the gate stays un-armed)', async () => {
    const sink: { last: Record<string, unknown> | null } = { last: null }
    const off = captureEmits(sink)
    const view = render(<AutopilotPreviewDrawer />)
    openAutopilotPreview(buildRestDefPreviewPayload(cleanDraft))
    const area = await waitFor(() => view.getByLabelText('RestDefinition source') as HTMLTextAreaElement)

    // Break the draft: lowercase method — a live-CRD enum violation that would 422 at publish.
    const broken = { ...cleanDraft, spec: { ...cleanDraft.spec, resource: { ...cleanDraft.spec.resource, verbsDescription: [{ action: 'get', method: 'get', path: '/repos' }] } } }
    fireEvent.change(area, { target: { value: toYamlString(broken) } })
    fireEvent.click(view.getByRole('button', { name: 'Apply edits' }))

    await waitFor(() => expect(view.getByText(/publishing this draft would be rejected/i)).toBeTruthy())
    // NOTHING was emitted — an invalid edit never re-arms the preview gate (deny-by-default).
    expect(sink.last).toBeNull()
    off()
  })

  it('a non-editable preview renders the read-only YAML (no editable textarea)', async () => {
    const view = render(<AutopilotPreviewDrawer />)
    openAutopilotPreview({
      objects: [{ kind: 'Flex', name: 'root', yaml: 'kind: Flex\n' }],
      title: 'Page preview — 1 proposed widget',
    })
    await waitFor(() => expect(view.getByText('Page preview — 1 proposed widget')).toBeTruthy())
    expect(view.queryByLabelText('RestDefinition source')).toBeNull()
  })
})

describe('AutopilotPreviewDrawer — editable page "Files" tab', () => {
  /** A minimal page preview payload (one widget CR at the chart-relative templates/flex.page-root.yaml). */
  const pagePayload = () => buildPagePreviewPayload([{
    apiVersion: 'widgets.templates.krateo.io/v1beta1',
    kind: 'Flex',
    metadata: { name: 'page-root' },
    spec: { widgetData: {} },
  }])

  /** Capture the LAST per-file edit emitted on the bus (or null). Returns the un-listen fn. */
  const captureFileEmits = (sink: { last: FileEditDetail | null }): (() => void) => {
    const listener = (event: Event): void => { sink.last = (event as CustomEvent<FileEditDetail>).detail }
    window.addEventListener(AUTOPILOT_PREVIEW_FILE_EDIT_EVENT, listener)
    return () => window.removeEventListener(AUTOPILOT_PREVIEW_FILE_EDIT_EVENT, listener)
  }

  const openEditor = async (view: ReturnType<typeof render>): Promise<HTMLTextAreaElement> => {
    fireEvent.click(view.getByRole('button', { name: 'Edit' }))
    return waitFor(() => view.getByLabelText(/^Edit templates\/flex\.page-root\.yaml$/) as HTMLTextAreaElement)
  }

  it('a CLEAN page-file edit emits {path, content} on the file-edit bus', async () => {
    const sink: { last: FileEditDetail | null } = { last: null }
    const off = captureFileEmits(sink)
    const view = render(<AutopilotPreviewDrawer />)
    openAutopilotPreview(pagePayload())
    await waitFor(() => expect(view.getByText('templates/flex.page-root.yaml')).toBeTruthy())
    const area = await openEditor(view)

    // A human edit of the held widget CR (still a valid CR — apiVersion/kind/metadata.name intact).
    const edited = toYamlString({ apiVersion: 'widgets.templates.krateo.io/v1beta1', kind: 'Flex', metadata: { name: 'page-root' }, spec: { widgetData: { direction: 'vertical' } } })
    fireEvent.change(area, { target: { value: edited } })
    fireEvent.click(view.getByRole('button', { name: 'Apply edits' }))

    await waitFor(() => expect(sink.last).not.toBeNull())
    expect(sink.last?.path).toBe('templates/flex.page-root.yaml')
    // Says what it showed, so the provider can refuse it if a chart is what is held.
    expect(sink.last?.kind).toBe('page')
    // byte-for-byte the human's edit (held == published)
    expect(sink.last?.content).toBe(edited)
    off()
  })

  it('an INVALID page-file edit shows the inline error and does NOT emit (prior bytes kept)', async () => {
    const sink: { last: FileEditDetail | null } = { last: null }
    const off = captureFileEmits(sink)
    const view = render(<AutopilotPreviewDrawer />)
    openAutopilotPreview(pagePayload())
    await waitFor(() => expect(view.getByText('templates/flex.page-root.yaml')).toBeTruthy())
    const area = await openEditor(view)

    // Strip the CR identity — a page widget file must keep apiVersion/kind/metadata.name.
    fireEvent.change(area, { target: { value: 'spec:\n  widgetData: {}\n' } })
    fireEvent.click(view.getByRole('button', { name: 'Apply edits' }))

    await waitFor(() => expect(view.getByText('This edit was not applied')).toBeTruthy())
    // Deny-by-default: nothing rode the bus, so the held bytes are unchanged.
    expect(sink.last).toBeNull()
    off()
  })
})

describe('frontend#180 — the preview must not cover a widened rail', () => {
  it('insets by the rail LIVE width var, never a hardcoded default', async () => {
    // The inset used to be the constant 384 — the rail's DEFAULT width. The rail is drag-resizable,
    // widens further when the history split opens, and can go full width, so any of those put the
    // drawer on top of the conversation and clipped it. AutopilotRail publishes its live width as
    // `--autopilot-rail-width` for exactly this; a CSS var also tracks a drag without this component
    // re-rendering, which it does not do per frame.
    render(<AutopilotPreviewDrawer />)
    openAutopilotPreview(buildRestDefPreviewPayload({ title: 'x', yaml: 'kind: RestDefinition\n' }))
    const root = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('.ant-drawer')
      if (!el) { throw new Error('drawer root not mounted') }
      return el
    })
    const inset = root.style.insetInlineEnd
    expect(inset, 'the inset must read the live rail width').toContain('--autopilot-rail-width')
    expect(inset, 'a hardcoded rail width is the bug itself').not.toMatch(/\b384\b/)
  })
})

describe('AutopilotPreviewDrawer — which previews a mounted page composer takes', () => {
  it('defers a PAGE preview to the composer, and opens for everything the composer cannot show', async () => {
    const release = claimPreviewSurface('page')
    const view = render(<AutopilotPreviewDrawer />)
    act(() => { openAutopilotPreview({ summary: ['flex.page-x'], title: 'Page preview — x' }) })
    expect(view.queryByText('Page preview — x')).toBeNull()

    // The regression this pins: a chart proposed while /portal-builder/compose was open went to the
    // composer, which parks charts — so it was shown nowhere.
    act(() => { openAutopilotPreview({ builder: 'blueprint', summary: ['nginx-demo'], title: 'Blueprint preview — nginx-demo' }) })
    await waitFor(() => expect(view.getByText('Blueprint preview — nginx-demo')).toBeTruthy())
    release()
  })

  it('a BLUEPRINT composer takes only charts — a page preview still opens the drawer', async () => {
    // A kind-blind claim made a mounted blueprint composer swallow every page preview (it cannot show
    // one), and let its own chart previews open the drawer over it.
    const release = claimPreviewSurface('blueprint')
    const view = render(<AutopilotPreviewDrawer />)
    act(() => { openAutopilotPreview({ builder: 'blueprint', summary: ['nginx-demo'], title: 'Blueprint preview — nginx-demo' }) })
    expect(view.queryByText('Blueprint preview — nginx-demo')).toBeNull()
    act(() => { openAutopilotPreview({ summary: ['flex.page-x'], title: 'Page preview — x' }) })
    await waitFor(() => expect(view.getByText('Page preview — x')).toBeTruthy())
    release()
  })

  it('a claim made while it is OPEN on the held draft closes it — only for that kind', async () => {
    // Deferring the NEXT preview was half of it: a drawer already open on the held chart stayed
    // open over the composer, and its one-shot Files tab wrote stale bytes over the composer's edits.
    const view = render(<AutopilotPreviewDrawer />)
    act(() => { openAutopilotPreview({ builder: 'blueprint', summary: ['nginx-demo'], title: 'Blueprint preview — nginx-demo' }) })
    await waitFor(() => expect(view.getByText('Blueprint preview — nginx-demo')).toBeTruthy())
    const releasePage = claimPreviewSurface('page')
    expect(document.querySelector('.ant-drawer-open')).not.toBeNull()
    releasePage()
    let releaseBlueprint: () => void = () => undefined
    act(() => { releaseBlueprint = claimPreviewSurface('blueprint') })
    await waitFor(() => expect(document.querySelector('.ant-drawer-open')).toBeNull())
    releaseBlueprint()
  })

  it('HANDS a live page render to the claiming composer — its sandbox teardown is not fired', async () => {
    // The drawer's close of a live page preview DELETEs the sandbox draft CRs. Firing it on a claim
    // meant opening the Portal Builder tore down the render the person was looking at, while the
    // composer (which adopts only NEW previews) had none to show. The composer registers its preview
    // listener in an effect AFTER the claim's, as this does.
    const onClose = vi.fn()
    const payload = { onClose, summary: ['flex.page-x'], title: 'Page preview — x' }
    const adopted = vi.fn()
    const adopt = (event: Event): void => { adopted((event as CustomEvent<unknown>).detail) }
    const view = render(<AutopilotPreviewDrawer />)
    act(() => { openAutopilotPreview(payload) })
    await waitFor(() => expect(view.getByText('Page preview — x')).toBeTruthy())
    let release: () => void = () => undefined
    act(() => {
      release = claimPreviewSurface('page')
      window.addEventListener(AUTOPILOT_PREVIEW_EVENT, adopt)
    })
    await waitFor(() => expect(adopted).toHaveBeenCalledWith(payload))
    expect(onClose).not.toHaveBeenCalled()
    await waitFor(() => expect(document.querySelector('.ant-drawer-open')).toBeNull())
    window.removeEventListener(AUTOPILOT_PREVIEW_EVENT, adopt)
    release()
  })

  it('opens a page preview as before when no composer holds the claim', async () => {
    const view = render(<AutopilotPreviewDrawer />)
    act(() => { openAutopilotPreview({ summary: ['flex.page-x'], title: 'Page preview — x' }) })
    await waitFor(() => expect(view.getByText('Page preview — x')).toBeTruthy())
  })
})

describe('AutopilotPreviewDrawer — the held draft, discarded or dirty', () => {
  it('a discard elsewhere closes a DRAFT preview and fires its teardown', async () => {
    const onClose = vi.fn()
    const view = render(<AutopilotPreviewDrawer />)
    act(() => { openAutopilotPreview({ onClose, summary: ['flex.page-x'], title: 'Page preview — x' }) })
    await waitFor(() => expect(view.getByText('Page preview — x')).toBeTruthy())
    act(() => { emitDraftClose() })
    expect(onClose).toHaveBeenCalledTimes(1)
    // CLOSED, not merely torn down: left open it would offer edits to files that no longer exist.
    await waitFor(() => expect(document.querySelector('.ant-drawer-open')).toBeNull())
  })

  it('a discard leaves an INSPECTION open — it was never the draft', async () => {
    const onClose = vi.fn()
    const view = render(<AutopilotPreviewDrawer />)
    act(() => { openAutopilotPreview({ builder: 'inspect', onClose, summary: ['repos.github.krateo.io'], title: 'Describe — repos' }) })
    await waitFor(() => expect(view.getByText('Describe — repos')).toBeTruthy())
    act(() => { emitDraftClose() })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('says why the held draft cannot publish, on a draft preview only', async () => {
    const view = render(<AutopilotPreviewDrawer />)
    act(() => { openAutopilotPreview({ builder: 'blueprint', summary: ['nginx-demo'], title: 'Blueprint preview — nginx-demo' }) })
    await waitFor(() => expect(view.getByText('Blueprint preview — nginx-demo')).toBeTruthy())
    act(() => { emitDraftChanged({ files: { 'Chart.yaml': 'x' }, kind: 'blueprint', problems: ['values.schema.json is missing'] }) })
    expect(view.getByText('values.schema.json is missing')).toBeTruthy()

    act(() => { openAutopilotPreview({ builder: 'restdef', summary: ['gh-repo'], title: 'RestDefinition preview — gh-repo' }) })
    await waitFor(() => expect(view.getByText('RestDefinition preview — gh-repo')).toBeTruthy())
    expect(view.queryByText('values.schema.json is missing')).toBeNull()
  })
})

describe('AutopilotPreviewDrawer — only the HELD draft is editable', () => {
  const chartFiles = [{ content: 'apiVersion: v2\nname: aws-vpc\n', path: 'Chart.yaml' }]

  it('a held blueprint draft offers Edit on its chart files', async () => {
    const view = render(<AutopilotPreviewDrawer />)
    act(() => { openAutopilotPreview({ builder: 'blueprint', files: chartFiles, filesLabel: 'Chart files', title: 'Blueprint preview — aws-vpc' }) })
    await waitFor(() => expect(view.getByText('Chart.yaml')).toBeTruthy())
    expect(view.getByRole('button', { name: 'Edit' })).toBeTruthy()
  })

  it('a preview nothing holds (a draft that failed to render) shows its files READ-ONLY', async () => {
    // An edit here was written by path into whatever WAS held — a page set holds Chart.yaml too.
    const view = render(<AutopilotPreviewDrawer />)
    act(() => { openAutopilotPreview({ builder: 'inspect', error: 'function "boom" not defined', files: chartFiles, filesLabel: 'Chart files', title: 'Blueprint preview — aws-vpc' }) })
    await waitFor(() => expect(view.getByText('Chart.yaml')).toBeTruthy())
    expect(view.queryByRole('button', { name: 'Edit' })).toBeNull()
  })

  it('does not show the held draft\'s lint problems on a preview that is not the held draft', async () => {
    const view = render(<AutopilotPreviewDrawer />)
    act(() => { openAutopilotPreview({ builder: 'inspect', summary: ['aws-vpc'], title: 'Blueprint preview — aws-vpc' }) })
    await waitFor(() => expect(view.getByText('Blueprint preview — aws-vpc')).toBeTruthy())
    act(() => { emitDraftChanged({ files: { 'Chart.yaml': 'x' }, kind: 'page', problems: ['values.schema.json is missing'] }) })
    expect(view.queryByText('values.schema.json is missing')).toBeNull()
  })

  it('closes a held draft that a deferred PAGE preview replaced — its Files tab would write into the page', async () => {
    const release = claimPreviewSurface('page')
    const view = render(<AutopilotPreviewDrawer />)
    act(() => { openAutopilotPreview({ builder: 'blueprint', files: chartFiles, filesLabel: 'Chart files', title: 'Blueprint preview — aws-vpc' }) })
    await waitFor(() => expect(view.getByText('Blueprint preview — aws-vpc')).toBeTruthy())
    act(() => { openAutopilotPreview({ summary: ['flex.page-x'], title: 'Page preview — x' }) })
    await waitFor(() => expect(document.querySelector('.ant-drawer-open')).toBeNull())
    release()
  })

  it('leaves an INSPECTION open when a deferred page preview arrives — nothing replaced it', async () => {
    const release = claimPreviewSurface('page')
    const view = render(<AutopilotPreviewDrawer />)
    act(() => { openAutopilotPreview({ builder: 'inspect', summary: ['repos'], title: 'Describe — repos' }) })
    await waitFor(() => expect(view.getByText('Describe — repos')).toBeTruthy())
    act(() => { openAutopilotPreview({ summary: ['flex.page-x'], title: 'Page preview — x' }) })
    expect(document.querySelector('.ant-drawer-open')).not.toBeNull()
    release()
  })
})

describe('AutopilotPreviewDrawer — a discard re-announced in the tick a late apply opened its render', () => {
  it('drops the render it has not even drawn yet, and fires its teardown', async () => {
    // The late apply opens its payload and resolves; the loop re-announces the discard a microtask
    // later — before React has rendered the payload. A render-time ref still says "nothing shown".
    const onClose = vi.fn()
    render(<AutopilotPreviewDrawer />)
    act(() => {
      openAutopilotPreview({ onClose, summary: ['flex.page-x'], title: 'Page preview — x' })
      emitDraftClose()
    })
    expect(onClose).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(document.querySelector('.ant-drawer-open')).toBeNull())
  })
})

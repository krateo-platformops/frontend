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
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// WidgetRenderer (only mounted for a liveEndpoint payload, not here) pulls the whole widget system —
// stub it so the drawer test stays focused. The two provider hooks the drawer reads are stubbed too.
vi.mock('../WidgetRenderer', () => ({ default: () => null }))
vi.mock('./AutopilotProvider', () => ({ useAutopilot: () => ({ open: false }) }))
vi.mock('../../context/ThemeModeContext', () => ({ useThemeMode: () => ({ mode: 'light' }) }))

import { buildPagePreviewPayload, buildRestDefPreviewPayload, toYamlString } from './previewBridge'
import { openAutopilotPreview } from './previewBus'
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
  /** A minimal page preview payload (one widget CR at chart/templates/flex.root.yaml). */
  const pagePayload = () => buildPagePreviewPayload([{
    apiVersion: 'widgets.templates.krateo.io/v1beta1',
    kind: 'Flex',
    metadata: { name: 'root' },
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
    return waitFor(() => view.getByLabelText(/^Edit chart\/templates\/flex\.root\.yaml$/) as HTMLTextAreaElement)
  }

  it('a CLEAN page-file edit emits {path, content} on the file-edit bus', async () => {
    const sink: { last: FileEditDetail | null } = { last: null }
    const off = captureFileEmits(sink)
    const view = render(<AutopilotPreviewDrawer />)
    openAutopilotPreview(pagePayload())
    await waitFor(() => expect(view.getByText('chart/templates/flex.root.yaml')).toBeTruthy())
    const area = await openEditor(view)

    // A human edit of the held widget CR (still a valid CR — apiVersion/kind/metadata.name intact).
    const edited = toYamlString({ apiVersion: 'widgets.templates.krateo.io/v1beta1', kind: 'Flex', metadata: { name: 'root' }, spec: { widgetData: { direction: 'vertical' } } })
    fireEvent.change(area, { target: { value: edited } })
    fireEvent.click(view.getByRole('button', { name: 'Apply edits' }))

    await waitFor(() => expect(sink.last).not.toBeNull())
    expect(sink.last?.path).toBe('chart/templates/flex.root.yaml')
    // byte-for-byte the human's edit (held == published)
    expect(sink.last?.content).toBe(edited)
    off()
  })

  it('an INVALID page-file edit shows the inline error and does NOT emit (prior bytes kept)', async () => {
    const sink: { last: FileEditDetail | null } = { last: null }
    const off = captureFileEmits(sink)
    const view = render(<AutopilotPreviewDrawer />)
    openAutopilotPreview(pagePayload())
    await waitFor(() => expect(view.getByText('chart/templates/flex.root.yaml')).toBeTruthy())
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

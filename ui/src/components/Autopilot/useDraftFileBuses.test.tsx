// @vitest-environment jsdom
/**
 * A page STARTED BY A PERSON gets the same live render a proposed one does.
 *
 * There was no test on this hook at all, which is how the gap survived: `onDraftStart` said it took
 * "the SAME entry point a proposed page takes", and it did share `recordPagePreview` — but a
 * proposed page ALSO goes through `previewPage`, which applies the drafts to the sandbox and hands
 * the drawer a `liveEndpoint`. A hand-started one stopped at the held bytes, so the agent's page
 * rendered and the person's showed YAML.
 *
 * It became the wrong way round when drag & drop became the only way to build a page (portal#237):
 * the primary path was the one with no live preview.
 */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createBlueprintDraftStore } from './blueprintDraftStore'
import { AUTOPILOT_PREVIEW_EVENT } from './previewBus'
import { emitDraftStart } from './previewDraftStart'
import { emitFileAdd } from './previewFileAdd'
import { emitFileEdit } from './previewFileEdit'
import { useDraftFileBuses } from './useDraftFileBuses'

/** A page draft set: the `page-<slug>` root Flex is what makes it a page at all. */
const widgets = () => [
  {
    apiVersion: 'widgets.templates.krateo.io/v1beta1',
    kind: 'Flex',
    metadata: { name: 'page-service-catalog', namespace: 'krateo-system' },
    spec: { widgetData: { items: [] } },
  },
]

const Host = ({ previewLive }: { previewLive?: (w: Record<string, unknown>[], t: string) => Promise<void> }) => {
  const store = createBlueprintDraftStore()
  useDraftFileBuses(store, { recordPreview: vi.fn() }, () => null, previewLive)
  return null
}

afterEach(cleanup)

describe('a hand-started draft', () => {
  it('goes through the LIVE preview path, the same one a proposal takes', () => {
    const previewLive = vi.fn().mockResolvedValue(undefined)
    render(<Host previewLive={previewLive} />)

    act(() => { emitDraftStart({ title: 'Service catalog', widgets: widgets() }) })

    expect(previewLive).toHaveBeenCalledTimes(1)
    const [sent, sentTitle] = previewLive.mock.calls[0] as [Record<string, unknown>[], string]
    expect((sent[0].metadata as { name: string }).name).toBe('page-service-catalog')
    expect(sentTitle).toBe('Service catalog')
  })

  it('does NOT fall back to the source-only drawer when a live path exists', () => {
    // The old behaviour opened the source payload directly. Doing both would race two payloads
    // onto one bus and the source-only one could win — a live preview that flickers into YAML.
    const previewLive = vi.fn().mockResolvedValue(undefined)
    const opened: unknown[] = []
    const onPreview = (event: Event) => opened.push((event as CustomEvent).detail)
    window.addEventListener(AUTOPILOT_PREVIEW_EVENT, onPreview)
    render(<Host previewLive={previewLive} />)

    act(() => { emitDraftStart({ title: 'Service catalog', widgets: widgets() }) })

    window.removeEventListener(AUTOPILOT_PREVIEW_EVENT, onPreview)
    expect(opened).toEqual([])
  })

  it('still opens source-only with NO live path — a non-UI caller keeps working', () => {
    const opened: unknown[] = []
    const onPreview = (event: Event) => opened.push((event as CustomEvent).detail)
    window.addEventListener(AUTOPILOT_PREVIEW_EVENT, onPreview)
    render(<Host />)

    act(() => { emitDraftStart({ title: 'Service catalog', widgets: widgets() }) })

    window.removeEventListener(AUTOPILOT_PREVIEW_EVENT, onPreview)
    expect(opened).toHaveLength(1)
  })

  it('is REFUSED while a draft is already held — seeding over one discards unpublished work', () => {
    const previewLive = vi.fn().mockResolvedValue(undefined)
    render(<Host previewLive={previewLive} />)
    act(() => { emitDraftStart({ title: 'First', widgets: widgets() }) })
    act(() => { emitDraftStart({ title: 'Second', widgets: widgets() }) })
    expect(previewLive).toHaveBeenCalledTimes(1)
  })
})

/**
 * THE SANDBOX FOLLOWS THE DRAFT.
 *
 * This is the regression that made "Rendered (live)" a lie. The sandbox was applied once, on draft
 * start, and every later write updated the held store and the publish gate and told the sandbox
 * nothing. Measured on a live cluster before the fix: after dragging a Row onto the canvas and
 * binding a Table to a RESTAction, the sandbox held exactly the two objects the draft started with
 * — the Row was in the tree, in the files and in the publish set, and the RESTAction and Table
 * answered 404.
 */
describe('a draft that CHANGES after it started', () => {
  const rowFile = [
    'apiVersion: widgets.templates.krateo.io/v1beta1',
    'kind: Row',
    'metadata:',
    '  name: page-service-catalog-row',
    '  namespace: krateo-system',
    'spec:',
    '  widgetData:',
    '    items: []',
    '',
  ].join('\n')

  type LivePreview = (w: Record<string, unknown>[], t: string) => Promise<void>
  const start = (previewLive: LivePreview & { mockClear: () => void }) => {
    render(<Host previewLive={previewLive} />)
    act(() => { emitDraftStart({ title: 'Service catalog', widgets: widgets() }) })
    previewLive.mockClear()
  }

  it('RE-APPLIES to the sandbox when a file is added', async () => {
    vi.useFakeTimers()
    const previewLive = vi.fn<LivePreview>().mockResolvedValue(undefined)
    start(previewLive)

    act(() => { emitFileAdd({ content: rowFile, path: 'templates/row.page-service-catalog-row.yaml' }) })
    // debounced, not immediate
    expect(previewLive).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })

    expect(previewLive).toHaveBeenCalledTimes(1)
    const [[sent]] = previewLive.mock.calls
    const names = sent.map((cr) => (cr.metadata as { name: string }).name)
    // BOTH: the re-apply sends the whole set, not a delta — the sandbox is swept and rewritten.
    expect(names).toContain('page-service-catalog')
    expect(names).toContain('page-service-catalog-row')
    vi.useRealTimers()
  })

  it('COALESCES one gesture into one apply — a drop adds a file AND rewrites its parent', async () => {
    vi.useFakeTimers()
    const previewLive = vi.fn<LivePreview>().mockResolvedValue(undefined)
    start(previewLive)

    act(() => {
      emitFileAdd({ content: rowFile, path: 'templates/row.page-service-catalog-row.yaml' })
      emitFileEdit({ content: rowFile, path: 'templates/row.page-service-catalog-row.yaml' })
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })

    expect(previewLive).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('does nothing at all with NO live path — a non-UI caller gains no network', async () => {
    vi.useFakeTimers()
    const opened: unknown[] = []
    const onPreview = (event: Event) => opened.push((event as CustomEvent).detail)
    window.addEventListener(AUTOPILOT_PREVIEW_EVENT, onPreview)
    render(<Host />)
    act(() => { emitDraftStart({ title: 'Service catalog', widgets: widgets() }) })
    opened.length = 0

    act(() => { emitFileAdd({ content: rowFile, path: 'templates/row.page-service-catalog-row.yaml' }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })

    window.removeEventListener(AUTOPILOT_PREVIEW_EVENT, onPreview)
    expect(opened).toEqual([])
    vi.useRealTimers()
  })

  it('SURVIVES a rejected apply — the composer must not die with the preview', async () => {
    vi.useFakeTimers()
    const previewLive = vi.fn<LivePreview>().mockRejectedValue(new Error('sandbox refused'))
    start(previewLive)

    act(() => { emitFileAdd({ content: rowFile, path: 'templates/row.page-service-catalog-row.yaml' }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })

    expect(previewLive).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})

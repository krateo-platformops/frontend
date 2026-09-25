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
import { onPreviewApplied } from './previewApplied'
import { AUTOPILOT_PREVIEW_EVENT } from './previewBus'
import { type DraftChangedDetail, onDraftChanged, requestDraftReplay } from './previewDraftChanged'
import { emitDraftStart } from './previewDraftStart'
import { emitFileAdd } from './previewFileAdd'
import { emitFileEdit } from './previewFileEdit'
import { emitFileRemove } from './previewFileRemove'
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
  // AWAITED, because the start apply is now serialised with the re-applies and lands in a
  // microtask: returning before it settles leaves its own announcement to arrive mid-test and
  // makes every count off by one.
  const start = async (previewLive: LivePreview & { mockClear: () => void }) => {
    render(<Host previewLive={previewLive} />)
    act(() => { emitDraftStart({ title: 'Service catalog', widgets: widgets() }) })
    await act(async () => { await Promise.resolve() })
    previewLive.mockClear()
  }

  it('RE-APPLIES to the sandbox when a file is added', async () => {
    vi.useFakeTimers()
    const previewLive = vi.fn<LivePreview>().mockResolvedValue(undefined)
    await start(previewLive)

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
    await start(previewLive)

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

  it('ANNOUNCES the apply, so the rendered pane refetches instead of answering from cache', async () => {
    // The apply changes what the sandbox serves and not the URL the pane fetches, so without this
    // the render keeps answering from the widget cache — measured live as dataSource=23 on the
    // server beside zero rows in the pane, still zero at +30s.
    vi.useFakeTimers()
    const previewLive = vi.fn<LivePreview>().mockResolvedValue(undefined)
    await start(previewLive)
    // Subscribed AFTER the start apply, which announces too — it is an apply, and the render it
    // produced should be as re-readable as any later one.
    const heard = vi.fn()
    const stop = onPreviewApplied(heard)

    act(() => { emitFileAdd({ content: rowFile, path: 'templates/row.page-service-catalog-row.yaml' }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })

    expect(heard).toHaveBeenCalledTimes(1)
    stop()
    vi.useRealTimers()
  })

  it('does NOT announce when the apply FAILED — a refetch would just re-read the old sandbox', async () => {
    vi.useFakeTimers()
    const previewLive = vi.fn<LivePreview>().mockRejectedValue(new Error('sandbox refused'))
    await start(previewLive)
    const heard = vi.fn()
    const stop = onPreviewApplied(heard)

    act(() => { emitFileAdd({ content: rowFile, path: 'templates/row.page-service-catalog-row.yaml' }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })

    expect(heard).not.toHaveBeenCalled()
    stop()
    vi.useRealTimers()
  })

  it('NEVER runs two applies at once — the 409 that came from overlapping sweeps', async () => {
    /*
     * An apply DELETEs every name it is about to write, then POSTs them. Overlap them and B's
     * sweep can run between A's sweep and A's POSTs, so B's create hits A's object: measured live,
     * every recorded session produced exactly one
     *   Flex/page-proof-d: flexes... "page-proof-d" already exists
     * and that apply was rolled back, dropping the live render to source-only until the next one
     * happened to succeed.
     */
    vi.useFakeTimers()
    let running = 0
    let overlapped = false
    let release: (() => void) | null = null
    const previewLive = vi.fn<LivePreview>().mockImplementation(async () => {
      running += 1
      if (running > 1) {
        overlapped = true
      }
      await new Promise<void>((resolve) => {
        release = () => {
          running -= 1
          resolve()
        }
      })
    })
    render(<Host previewLive={previewLive} />)
    act(() => { emitDraftStart({ title: 'Service catalog', widgets: widgets() }) })
    await act(async () => { await Promise.resolve() })

    // A change arrives while the START apply is still in flight, then another while THAT waits.
    act(() => { emitFileAdd({ content: rowFile, path: 'templates/row.page-service-catalog-row.yaml' }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    act(() => { emitFileEdit({ content: rowFile, path: 'templates/row.page-service-catalog-row.yaml' }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })

    // the start apply, still holding the lock
    expect(previewLive).toHaveBeenCalledTimes(1)
    await act(async () => {
      release?.()
      await Promise.resolve()
    })
    await act(async () => { await Promise.resolve() })

    // …and the queued work drains as ONE apply of the final state, not one per edit.
    expect(previewLive).toHaveBeenCalledTimes(2)
    expect(overlapped).toBe(false)
    act(() => { release?.() })
    vi.useRealTimers()
  })

  it('SURVIVES a rejected apply — the composer must not die with the preview', async () => {
    vi.useFakeTimers()
    const previewLive = vi.fn<LivePreview>().mockRejectedValue(new Error('sandbox refused'))
    await start(previewLive)

    act(() => { emitFileAdd({ content: rowFile, path: 'templates/row.page-service-catalog-row.yaml' }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })

    expect(previewLive).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})

/**
 * A BLUEPRINT EDIT IS LINTED BEFORE IT RE-ARMS.
 *
 * Every accepted write re-armed the publish gate. Right for a page — its edits are ajv-verdicted
 * in the drawer — and a live hole for a blueprint: a hand edit to values.schema.json that adds a
 * populated object default (core-provider#46) had no verdict anywhere, so the gate re-armed, the
 * chart was publishable, and it wedges its CompositionDefinition at Ready=False on registration.
 * Reachable through the drawer's Files tab before any blueprint composer existed.
 */
describe('a blueprint draft edited by hand', () => {
  const chart = {
    'Chart.yaml': 'apiVersion: v2\nname: nginx-demo\nversion: 0.1.0\n',
    'templates/deployment.yaml': 'apiVersion: apps/v1\nkind: Deployment\n',
    'values.schema.json': JSON.stringify({ properties: { replicas: { default: 1, type: 'integer' } }, type: 'object' }),
  }
  const dirtySchema = JSON.stringify({ properties: { resources: { default: { limits: { cpu: '100m' } }, type: 'object' } }, type: 'object' })
  const cleanSchema = JSON.stringify({ properties: { replicas: { default: 3, type: 'integer' } }, type: 'object' })

  const BlueprintHost = ({ gate, store }: { gate: { forget: (id: string | null | undefined) => void; recordPreview: (id: string | null | undefined) => void }; store: ReturnType<typeof createBlueprintDraftStore> }) => {
    useDraftFileBuses(store, gate, (held) => (held?.kind === 'blueprint' ? 'nginx-demo' : null))
    return null
  }

  const seeded = () => {
    const store = createBlueprintDraftStore()
    store.set(chart, 'blueprint')
    const gate = { forget: vi.fn(), recordPreview: vi.fn() }
    render(<BlueprintHost gate={gate} store={store} />)
    return { gate, store }
  }

  it('FORGETS the chart when the edit makes the draft lint-dirty — and does not re-arm it', () => {
    const { gate, store } = seeded()
    act(() => { emitFileEdit({ content: dirtySchema, path: 'values.schema.json' }) })
    // The edit is accepted into the held tree — the person's bytes are kept, not discarded…
    expect(store.get()?.files['values.schema.json']).toBe(dirtySchema)
    // …but the publish is back to deny until a clean preview.
    expect(gate.forget).toHaveBeenCalledWith('nginx-demo')
    expect(gate.recordPreview).not.toHaveBeenCalled()
  })

  it('RE-ARMS as before when the edit leaves the draft clean', () => {
    const { gate } = seeded()
    act(() => { emitFileEdit({ content: cleanSchema, path: 'values.schema.json' }) })
    expect(gate.recordPreview).toHaveBeenCalledWith('nginx-demo')
    expect(gate.forget).not.toHaveBeenCalled()
  })

  it('an ADD that dirties the draft forgets too — every write path is linted, not only edit', () => {
    const { gate } = seeded()
    // Removing values.schema.json makes the chart un-installable ("error getting spec schema").
    act(() => { emitFileRemove({ path: 'values.schema.json' }) })
    expect(gate.forget).toHaveBeenCalledWith('nginx-demo')
    expect(gate.recordPreview).not.toHaveBeenCalled()
  })

  it('a PAGE draft is never linted as a chart — its re-arm is unchanged', () => {
    const store = createBlueprintDraftStore()
    const gate = { forget: vi.fn(), recordPreview: vi.fn() }
    const PageHost = () => {
      useDraftFileBuses(store, gate, () => 'page-x')
      return null
    }
    render(<PageHost />)
    act(() => { emitDraftStart({ title: 'x', widgets: widgets() }) })
    gate.recordPreview.mockClear()
    const [key] = Object.keys(store.get()?.files ?? {})
    act(() => { emitFileEdit({ content: 'kind: Flex\n', path: key }) })
    expect(gate.forget).not.toHaveBeenCalled()
  })

  it('REPLAY says who holds the draft and what the lint thinks, so a surface can park or explain it', () => {
    const { store } = seeded()
    store.updateFile('values.schema.json', dirtySchema)
    const heard: DraftChangedDetail[] = []
    const stop = onDraftChanged((detail) => heard.push(detail))
    act(() => { requestDraftReplay() })
    stop()
    expect(heard).toHaveLength(1)
    expect(heard[0].kind).toBe('blueprint')
    expect(heard[0].problems?.length).toBeGreaterThan(0)
  })
})

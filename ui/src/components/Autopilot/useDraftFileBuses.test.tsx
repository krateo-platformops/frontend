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
import { getComposeRefusals, recordComposeOutcome } from './composeRequest'
import { draftHistory } from './draftHistory'
import { onPreviewApplied } from './previewApplied'
import { AUTOPILOT_PREVIEW_EVENT, getPreviewProblems, setPreviewProblems } from './previewBus'
import { type DraftChangedDetail, onDraftChanged, requestDraftReplay } from './previewDraftChanged'
import { emitDraftClose, onDraftClose } from './previewDraftClose'
import { emitDraftStart } from './previewDraftStart'
import { emitDraftUndo } from './previewDraftUndo'
import { emitFileAdd } from './previewFileAdd'
import { emitFileEdit } from './previewFileEdit'
import { emitFileRemove } from './previewFileRemove'
import { createBroadcastingDraftStore, useDraftFileBuses } from './useDraftFileBuses'

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

  it('FORGETS on a CLEAN edit too — a chart is render-gated: only a render re-arms it (Diego, 2026-09-25)', () => {
    // The lint cannot see a template that fails helm template or a renamed chart never rendered; a
    // clean edit that re-armed made "what publishes" differ from "what was last rendered".
    const { gate } = seeded()
    act(() => { emitFileEdit({ content: cleanSchema, path: 'values.schema.json' }) })
    expect(gate.forget).toHaveBeenCalledWith('nginx-demo')
    expect(gate.recordPreview).not.toHaveBeenCalled()
  })

  it('a REMOVE that dirties the draft forgets too — every write path is linted, not only edit', () => {
    const { gate } = seeded()
    // Removing values.schema.json makes the chart un-installable ("error getting spec schema").
    act(() => { emitFileRemove({ path: 'values.schema.json' }) })
    expect(gate.forget).toHaveBeenCalledWith('nginx-demo')
    expect(gate.recordPreview).not.toHaveBeenCalled()
  })

  it('an ADD to a dirty draft does not re-arm it — adding a template fixes nothing', () => {
    const { gate, store } = seeded()
    store.updateFile('values.schema.json', dirtySchema)
    act(() => { emitFileAdd({ content: 'apiVersion: v1\nkind: Service\n', path: 'templates/service.yaml' }) })
    expect(store.get()?.files['templates/service.yaml']).toBeDefined()
    expect(gate.forget).toHaveBeenCalledWith('nginx-demo')
    expect(gate.recordPreview).not.toHaveBeenCalled()
  })

  it('an UNDO back to a dirty tree forgets — undo is a write like any other', () => {
    const { gate, store } = seeded()
    store.updateFile('values.schema.json', dirtySchema)
    act(() => { emitFileEdit({ content: cleanSchema, path: 'values.schema.json' }) })
    gate.forget.mockClear()
    act(() => { emitDraftUndo() })
    expect(store.get()?.files['values.schema.json']).toBe(dirtySchema)
    expect(gate.forget).toHaveBeenCalledWith('nginx-demo')
  })

  it('a PAGE draft is linted too — it publishes as a page-set chart; a clean edit re-arms, a broken one forgets', () => {
    const store = createBlueprintDraftStore()
    const gate = { forget: vi.fn(), recordPreview: vi.fn() }
    const PageHost = () => {
      useDraftFileBuses(store, gate, () => 'page-x')
      return null
    }
    render(<PageHost />)
    act(() => { emitDraftStart({ title: 'x', widgets: widgets() }) })
    gate.recordPreview.mockClear()
    const root = Object.keys(store.get()?.files ?? {}).find((key) => key.includes('page-service-catalog'))
    expect(root).toBeDefined()
    act(() => { emitFileEdit({ content: 'kind: Flex\n', path: root ?? '' }) })
    expect(gate.recordPreview).toHaveBeenCalledWith('page-x')
    expect(gate.forget).not.toHaveBeenCalled()
    act(() => { emitFileRemove({ path: 'values.schema.json' }) })
    expect(gate.forget).toHaveBeenCalledWith('page-x')
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

describe('undo across a switch of builder', () => {
  afterEach(() => draftHistory.clear())

  it('does NOT restore a page tree into a held chart — it drops the foreign history instead', () => {
    const store = createBlueprintDraftStore()
    store.set({ 'Chart.yaml': 'apiVersion: v2\nname: nginx-demo\nversion: 0.1.0\n', 'values.schema.json': '{"type":"object"}' }, 'blueprint')
    const before = store.get()
    const gate = { forget: vi.fn(), recordPreview: vi.fn() }
    const Hosted = () => {
      useDraftFileBuses(store, gate, () => 'nginx-demo')
      return null
    }
    render(<Hosted />)
    draftHistory.push({ files: { 'templates/flex.page-x.yaml': 'kind: Flex' }, kind: 'page' })
    act(() => { emitDraftUndo() })
    expect(store.get()).toBe(before)
    expect(draftHistory.depth()).toBe(0)
    expect(gate.recordPreview).not.toHaveBeenCalled()
  })
})

describe('discarding the held draft', () => {
  afterEach(() => draftHistory.clear())

  it('drops the files, the gate arming and the undo history — and a new page can start', () => {
    const store = createBlueprintDraftStore()
    const gate = { forget: vi.fn(), recordPreview: vi.fn() }
    const Hosted = () => {
      useDraftFileBuses(store, gate, (held) => (held ? 'page:page-service-catalog' : null))
      return null
    }
    render(<Hosted />)
    act(() => { emitDraftStart({ title: 'x', widgets: widgets() }) })
    act(() => { emitFileAdd({ content: 'kind: Row\n', path: 'templates/row.a.yaml' }) })
    expect(draftHistory.depth()).toBe(1)

    act(() => { emitDraftClose() })
    expect(store.get()).toBeNull()
    expect(gate.forget).toHaveBeenCalledWith('page:page-service-catalog')
    expect(draftHistory.depth()).toBe(0)

    // The defect this closes: after a "discard" the draft was still held, so every start was refused.
    act(() => { emitDraftStart({ title: 'y', widgets: widgets() }) })
    expect(store.get()?.kind).toBe('page')
  })

  it('forgets what the MODEL was told about the draft — its refusals and its preview verdicts', () => {
    const store = createBlueprintDraftStore()
    const Hosted = () => {
      useDraftFileBuses(store, { forget: vi.fn(), recordPreview: vi.fn() }, () => 'page:x')
      return null
    }
    render(<Hosted />)
    act(() => { emitDraftStart({ title: 'x', widgets: widgets() }) })
    recordComposeOutcome({ op: 'move', target: 'page-x', widget: 'table-a' }, { applied: false, id: '1', paths: [], reason: 'page-x cannot hold a table' })
    setPreviewProblems(['spec.widgetData.items: required'])
    act(() => { emitDraftClose() })
    // Left behind, the next turn is spent fixing a page that no longer exists.
    expect(getComposeRefusals()).toBeNull()
    expect(getPreviewProblems()).toBeNull()
  })

  it('is a no-op with nothing held', () => {
    const store = createBlueprintDraftStore()
    const gate = { forget: vi.fn(), recordPreview: vi.fn() }
    const Hosted = () => {
      useDraftFileBuses(store, gate, () => null)
      return null
    }
    render(<Hosted />)
    act(() => { emitDraftClose() })
    expect(gate.forget).not.toHaveBeenCalled()
  })
})

describe('the provider store', () => {
  it('broadcasts every change with its kind and its lint — the one emitter surfaces listen to', () => {
    const store = createBroadcastingDraftStore()
    const heard: DraftChangedDetail[] = []
    const stop = onDraftChanged((detail) => heard.push(detail))
    store.set({ 'Chart.yaml': 'apiVersion: v2\nname: nginx-demo\nversion: 0.1.0\n' }, 'blueprint')
    store.clear()
    stop()
    expect(heard).toHaveLength(2)
    expect(heard[0].kind).toBe('blueprint')
    // values.schema.json is missing — the lint says so on the broadcast itself.
    expect(heard[0].problems?.some((line) => line.includes('values.schema.json'))).toBe(true)
    expect(heard[1]).toEqual({ files: {}, kind: null, problems: [] })
  })
})

describe('a discard that lands while a re-apply is on the wire', () => {
  afterEach(() => draftHistory.clear())

  /** A live apply that does not land until the test says so. */
  const deferredLive = () => {
    const calls: Array<() => void> = []
    const live = vi.fn(() => new Promise<void>((resolve) => { calls.push(resolve) }))
    return { calls, live }
  }

  const host = (live: ReturnType<typeof deferredLive>['live'], discardLive = vi.fn(() => Promise.resolve())) => {
    const store = createBlueprintDraftStore()
    const Hosted = () => {
      useDraftFileBuses(store, { forget: vi.fn(), recordPreview: vi.fn() }, (held) => (held ? 'page:x' : null), live, discardLive)
      return null
    }
    render(<Hosted />)
    return store
  }

  it('deletes the sandbox render only AFTER the apply lands — before it, there is nothing of it to delete', async () => {
    const { calls, live } = deferredLive()
    const discardLive = vi.fn(() => Promise.resolve())
    host(live, discardLive)
    act(() => { emitDraftStart({ title: 'x', widgets: widgets() }) })
    act(() => { emitDraftClose() })
    // Queued behind the apply: a DELETE racing its POSTs on the same names is the 409 this loop exists to prevent.
    expect(discardLive).not.toHaveBeenCalled()
    await act(async () => {
      calls[0]()
      await Promise.resolve()
    })
    expect(discardLive).toHaveBeenCalledTimes(1)
  })

  it('is ANNOUNCED AGAIN when the apply lands, so every surface drops the render it put back', async () => {
    const { calls, live } = deferredLive()
    host(live)
    const closes = vi.fn()
    const applied = vi.fn()
    const stopCloses = onDraftClose(closes)
    const stopApplied = onPreviewApplied(applied)
    act(() => { emitDraftStart({ title: 'x', widgets: widgets() }) })
    expect(live).toHaveBeenCalledTimes(1)

    act(() => { emitDraftClose() })
    expect(closes).toHaveBeenCalledTimes(1)
    // The apply was already past its sweep: it lands, re-creating the sandbox objects and opening a
    // live render of the draft that was just thrown away.
    await act(async () => {
      calls[0]()
      await Promise.resolve()
    })
    stopCloses()
    stopApplied()
    expect(closes).toHaveBeenCalledTimes(2)
    // …and it is not announced as an applied preview of anything.
    expect(applied).not.toHaveBeenCalled()
  })

  it('still deletes the sandbox render when the apply it waited behind FAILS', async () => {
    // A failed apply used to end the whole loop — and with it the discard's queued teardown.
    const rejects: Array<(reason: Error) => void> = []
    const live = vi.fn(() => new Promise<void>((_resolve, reject) => { rejects.push(reject) }))
    const discardLive = vi.fn(() => Promise.resolve())
    host(live, discardLive)
    act(() => { emitDraftStart({ title: 'x', widgets: widgets() }) })
    act(() => { emitDraftClose() })
    await act(async () => {
      rejects[0](new Error('schema chunk failed to load'))
      await Promise.resolve()
    })
    expect(discardLive).toHaveBeenCalledTimes(1)
  })

  it('runs a discard that arrived WHILE the previous discard\'s teardown was on the wire', async () => {
    const { calls, live } = deferredLive()
    const teardowns: Array<() => void> = []
    const discardLive = vi.fn(() => new Promise<void>((resolve) => { teardowns.push(resolve) }))
    host(live, discardLive)
    act(() => { emitDraftStart({ title: 'a', widgets: widgets() }) })
    act(() => { emitDraftClose() })
    act(() => { emitDraftStart({ title: 'b', widgets: widgets() }) })
    // A lands; B is held, so the loop runs A's queued teardown next — and B is discarded during it.
    await act(async () => {
      calls[0]()
      await Promise.resolve()
    })
    expect(discardLive).toHaveBeenCalledTimes(1)
    act(() => { emitDraftClose() })
    await act(async () => {
      teardowns[0]()
      await Promise.resolve()
    })
    // B's discard owes a teardown of its own; the loop used to `break` on "no job" and drop it.
    expect(discardLive).toHaveBeenCalledTimes(2)
  })

  it('stays quiet when a NEW draft was started meanwhile — that one is not answerable for the last', async () => {
    const { calls, live } = deferredLive()
    const store = host(live)
    const closes = vi.fn()
    const stop = onDraftClose(closes)
    act(() => { emitDraftStart({ title: 'x', widgets: widgets() }) })
    act(() => { emitDraftClose() })
    act(() => { emitDraftStart({ title: 'y', widgets: widgets() }) })
    await act(async () => {
      calls[0]()
      await Promise.resolve()
    })
    stop()
    expect(closes).toHaveBeenCalledTimes(1)
    expect(store.get()?.kind).toBe('page')
    // The new draft is applied next, by the same serialised loop — after the discarded one's
    // objects are deleted, since the two may share names.
    expect(live).toHaveBeenCalledTimes(2)
  })
})

describe('what the loop applies, and what an edit may reach', () => {
  const chart = { 'Chart.yaml': 'apiVersion: v2\nname: nginx-demo\nversion: 0.1.0\n', 'templates/cm.yaml': 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: x\n', 'values.schema.json': '{"type":"object"}' }

  it('never re-applies a CHART as if it were a page', async () => {
    vi.useFakeTimers()
    const store = createBlueprintDraftStore()
    store.set(chart, 'blueprint')
    const live = vi.fn(() => Promise.resolve())
    const Hosted = () => {
      useDraftFileBuses(store, { forget: vi.fn(), recordPreview: vi.fn() }, () => 'nginx-demo', live)
      return null
    }
    render(<Hosted />)
    act(() => { emitFileEdit({ content: 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: y\n', kind: 'blueprint', path: 'templates/cm.yaml' }) })
    await act(async () => { await vi.runAllTimersAsync() })
    vi.useRealTimers()
    expect(store.get()?.files['templates/cm.yaml']).toContain('name: y')
    expect(live).not.toHaveBeenCalled()
  })

  it('refuses an edit made in a preview of the OTHER kind — Chart.yaml exists in both', () => {
    const store = createBlueprintDraftStore()
    const gate = { forget: vi.fn(), recordPreview: vi.fn() }
    const Hosted = () => {
      useDraftFileBuses(store, gate, () => 'page:x')
      return null
    }
    render(<Hosted />)
    act(() => { emitDraftStart({ title: 'x', widgets: widgets() }) })
    const before = store.get()?.files['Chart.yaml']
    gate.recordPreview.mockClear()
    act(() => { emitFileEdit({ content: 'apiVersion: v2\nname: aws-vpc\n', kind: 'blueprint', path: 'Chart.yaml' }) })
    expect(store.get()?.files['Chart.yaml']).toBe(before)
    expect(gate.recordPreview).not.toHaveBeenCalled()
  })
})

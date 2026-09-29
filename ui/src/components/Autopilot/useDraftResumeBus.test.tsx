// @vitest-environment jsdom
/**
 * The provider holding a resumed draft. What these pin, each a way a resume could lose work or
 * publish something unrendered:
 *   - the record's files are held with the record's KIND, and Undo starts at the restored tree;
 *   - with a draft open, a resume changes nothing and answers `held`, naming it — only
 *     `replace: true` (the prompt's "Close and resume") goes on, and it never emits a discard;
 *   - Publish is armed ONLY when renderedHash is the restored tree's hash;
 *   - a page asks for its live preview to be re-applied; replacing a page takes its render down;
 *   - the autosave is seeded with the record right before the tree is held (#391's seedFromRecord);
 *   - the thread is re-linked only through the provider's switcher, and only says so if it did;
 *   - an adoption retires the legacy objects through the sandbox writer, AFTER the tree is held
 *     and BEFORE the re-apply;
 *   - the legacy Discard deletes the whole set WITH the confirm (no sandbox skip), touches nothing
 *     held, and answers deleted / cancelled / failed.
 */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SandboxTarget } from './adoptLegacyPage'
import { CHART_YAML_PATH } from './blueprintDraft'
import { createBlueprintDraftStore, type BlueprintDraftStore } from './blueprintDraftStore'
import { createBlueprintGate, type BlueprintGate } from './blueprintGate'
import type { SandboxWriter } from './blueprintRenderSandbox'
import { draftHistory } from './draftHistory'
import { treeHash, type DraftRecordBody } from './draftRecord'
import { pageDraftFiles } from './pageDraft'
import { onDraftClose } from './previewDraftClose'
import {
  emitDraftResume,
  emitLegacyDiscard,
  onDraftReapply,
  onDraftResumeResult,
  onLegacyDiscardResult,
  type DraftReapplyDetail,
  type DraftResumeResultDetail,
  type LegacyDiscardResultDetail,
} from './previewDraftResume'
import { heldDraftIdentity } from './publishCompile'
import { useDraftResumeBus, type DraftResumeDeps } from './useDraftResumeBus'

const chart = (name: string): Record<string, string> => ({
  [CHART_YAML_PATH]: `apiVersion: v2\nname: ${name}\nversion: 0.1.0\n`,
  'values.yaml': '{}\n',
})

const record = (over: Partial<DraftRecordBody> = {}): DraftRecordBody => ({
  files: chart('payments-api'),
  kind: 'blueprint',
  name: 'payments-api',
  state: 'open',
  updatedAt: '2026-09-29T12:04:00Z',
  version: 1,
  ...over,
})

const pageFiles = (slug: string): Record<string, string> => pageDraftFiles([{
  apiVersion: 'widgets.templates.krateo.io/v1beta1',
  kind: 'Flex',
  metadata: { name: `page-${slug}`, namespace: 'krateo-system' },
  spec: { resourcesRefs: { items: [] }, widgetData: { items: [] } },
}]) as Record<string, string>

const Host = ({ deps, gate, store }: { deps: DraftResumeDeps; gate: BlueprintGate; store: BlueprintDraftStore }) => {
  useDraftResumeBus(store, gate, deps)
  return null
}

let results: DraftResumeResultDetail[]
let reapplies: DraftReapplyDetail[]
let closes: number
const stops: (() => void)[] = []

const mount = (deps: DraftResumeDeps = {}) => {
  const store = createBlueprintDraftStore()
  const gate = createBlueprintGate()
  render(<Host deps={deps} gate={gate} store={store} />)
  return { gate, store }
}

const resume = (detail: Parameters<typeof emitDraftResume>[0]) => act(() => { emitDraftResume(detail) })

beforeEach(() => {
  results = []
  reapplies = []
  closes = 0
  draftHistory.clear()
  stops.push(onDraftResumeResult((detail) => { results.push(detail) }))
  stops.push(onDraftReapply((detail) => { reapplies.push(detail) }))
  stops.push(onDraftClose(() => { closes += 1 }))
})

afterEach(() => {
  stops.splice(0).forEach((stop) => stop())
  cleanup()
})

describe('useDraftResumeBus', () => {
  it('holds the record\'s files with its kind, and Undo starts at the restored tree', () => {
    const { store } = mount()
    draftHistory.push({ files: chart('older'), kind: 'blueprint' })
    resume({ id: 'r1', record: record() })
    expect(store.get()?.kind).toBe('blueprint')
    expect(store.get()?.files).toEqual(chart('payments-api'))
    expect(draftHistory.depth()).toBe(0)
    expect(results).toEqual([{ id: 'r1', outcome: 'resumed', previewed: false, relinked: false }])
    expect(reapplies).toEqual([])
  })

  it('seeds the autosave with the record immediately BEFORE the tree is held', () => {
    const seen: (string | undefined)[] = []
    let store: BlueprintDraftStore | null = null
    const seedFromRecord = vi.fn(() => { seen.push(store?.get()?.kind) })
    store = mount({ autosave: { seedFromRecord } }).store
    const body = record({ renderedHash: 'abc', threadId: 't1' })
    resume({ id: 's1', record: body })
    expect(seedFromRecord).toHaveBeenCalledWith(body)
    expect(seen).toEqual([undefined])
    expect(store.get()?.kind).toBe('blueprint')
  })

  it('with a draft open, changes nothing and answers `held` — until the person says replace', () => {
    const { gate, store } = mount()
    store.set(chart('catalog-service'), 'blueprint')
    gate.recordPreview('catalog-service')
    resume({ id: 'r1', record: record() })
    expect(results).toEqual([{ held: { kind: 'blueprint', name: 'catalog-service', previewed: true }, id: 'r1', outcome: 'held' }])
    expect(store.get()?.files).toEqual(chart('catalog-service'))

    resume({ id: 'r2', record: record(), replace: true })
    expect(store.get()?.files).toEqual(chart('payments-api'))
    expect(results[1]).toMatchObject({ id: 'r2', outcome: 'resumed' })
    // Replacing is not discarding: the closed draft stays in Your drafts.
    expect(closes).toBe(0)
    // Its arming does not outlive it.
    expect(gate.isArmed('catalog-service')).toBe(false)
  })

  it('arms Publish only when the record\'s renderedHash is the restored tree\'s hash', () => {
    const matching = mount()
    resume({ id: 'ok', record: record({ renderedHash: treeHash(chart('payments-api')) }) })
    expect(matching.gate.isArmed('payments-api')).toBe(true)
    expect(results.at(-1)).toMatchObject({ outcome: 'resumed', previewed: true })
    cleanup()

    const edited = mount()
    resume({ id: 'stale', record: record({ renderedHash: treeHash(chart('something-else')) }) })
    expect(edited.gate.isArmed('payments-api')).toBe(false)
    expect(results.at(-1)).toMatchObject({ outcome: 'resumed', previewed: false })
  })

  it('a page asks for its live preview to be re-applied, and replacing a page takes its render down', () => {
    const { gate, store } = mount()
    const files = pageFiles('fleet')
    resume({ id: 'p1', record: record({ files, kind: 'page', name: 'fleet', renderedHash: treeHash(files) }) })
    expect(store.get()?.kind).toBe('page')
    expect(gate.isArmed(heldDraftIdentity(store.get()))).toBe(true)
    expect(reapplies).toEqual([{ discardPrevious: false }])

    resume({ id: 'b1', record: record(), replace: true })
    expect(store.get()?.kind).toBe('blueprint')
    expect(reapplies[1]).toEqual({ discardPrevious: true })
  })

  it('re-links the thread only through the switcher, and says so only when it did', () => {
    const relinkThread = vi.fn((id: string) => id === 'thread-alive')
    mount({ relinkThread })
    resume({ id: 'a', record: record({ threadId: 'thread-alive' }) })
    expect(results.at(-1)).toMatchObject({ relinked: true })
    resume({ id: 'b', record: record({ threadId: 'thread-gone' }), replace: true })
    expect(results.at(-1)).toMatchObject({ relinked: false })
    resume({ id: 'c', record: record(), replace: true })
    expect(relinkThread).toHaveBeenCalledTimes(2)
  })

  it('refuses a tree over the draft cap and leaves the open draft as it was', () => {
    const { store } = mount()
    store.set(chart('catalog-service'), 'blueprint')
    resume({ id: 'big', record: record({ files: { ...chart('huge'), 'big.txt': 'x'.repeat(600 * 1024) } }), replace: true })
    expect(results.at(-1)).toMatchObject({ id: 'big', outcome: 'refused' })
    expect(store.get()?.files).toEqual(chart('catalog-service'))
  })

  it('an adoption retires the legacy objects after holding the tree and before the re-apply', async () => {
    const order: string[] = []
    const handleActionSet = vi.fn((ops: readonly { verb: string; path: string }[]) => {
      order.push(`delete ${ops.length}`)
      return Promise.resolve(ops.map(() => ({ ok: true })))
    }) as unknown as SandboxWriter['handleActionSet']
    stops.push(onDraftReapply(() => { order.push('reapply') }))
    const { store } = mount({ sandboxWriter: { handleActionSet, sandboxNamespace: 'krateo-preview' } })
    const retire: SandboxTarget[] = Array.from({ length: 12 }, (_, index) => ({ gvr: { group: 'widgets.templates.krateo.io', resource: 'rows', version: 'v1beta1' }, name: `row-${index}` }))
    await act(async () => {
      emitDraftResume({ id: 'adopt', record: record({ files: pageFiles('fleet'), kind: 'page', name: 'fleet' }), retire })
      await Promise.resolve()
    })
    await vi.waitFor(() => expect(results.at(-1)).toMatchObject({ id: 'adopt', outcome: 'resumed' }))
    expect(store.get()?.kind).toBe('page')
    // Chunked at the dispatcher's 10-op cap, silent and confirm-free only because it is the sandbox.
    expect(order).toEqual(['delete 10', 'delete 2', 'reapply'])
    const [ops, options] = (handleActionSet as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [{ path: string; verb: string }[], unknown]
    expect(ops[0]).toEqual({ path: '/call?apiVersion=widgets.templates.krateo.io%2Fv1beta1&resource=rows&name=row-0&namespace=krateo-preview', verb: 'DELETE' })
    expect(options).toEqual({ silent: true, skipConfirmForSandbox: 'krateo-preview' })
  })

  it('an adoption whose DELETEs fail still holds the page, and says which objects are left', async () => {
    const handleActionSet = vi.fn(() => Promise.resolve(null)) as unknown as SandboxWriter['handleActionSet']
    mount({ sandboxWriter: { handleActionSet, sandboxNamespace: 'krateo-preview' } })
    await act(async () => {
      emitDraftResume({ id: 'adopt', record: record({ files: pageFiles('fleet'), kind: 'page', name: 'fleet' }), retire: [{ gvr: { group: 'widgets.templates.krateo.io', resource: 'flexes', version: 'v1beta1' }, name: 'page-fleet' }] })
      await Promise.resolve()
    })
    await vi.waitFor(() => expect(results.at(-1)).toMatchObject({ outcome: 'resumed', retireError: expect.stringContaining('flexes/page-fleet') as string }))
  })
})

describe('the legacy Discard', () => {
  const flex = { group: 'widgets.templates.krateo.io', resource: 'flexes', version: 'v1beta1' }
  const targets: SandboxTarget[] = [{ gvr: flex, name: 'page-fleet' }, { gvr: { ...flex, resource: 'rows' }, name: 'fleet-row' }]
  let answers: LegacyDiscardResultDetail[]

  beforeEach(() => {
    answers = []
    stops.push(onLegacyDiscardResult((detail) => { answers.push(detail) }))
  })

  const discard = async (handleActionSet: SandboxWriter['handleActionSet'] | null) => {
    const { store } = mount(handleActionSet ? { sandboxWriter: { handleActionSet, sandboxNamespace: 'krateo-preview' } } : {})
    store.set(chart('catalog-service'), 'blueprint')
    await act(async () => {
      emitLegacyDiscard({ id: 'd1', root: 'page-fleet', targets })
      await Promise.resolve()
    })
    await vi.waitFor(() => expect(answers).toHaveLength(1))
    // A discard of a legacy set is not a discard of the held draft.
    expect(store.get()?.files).toEqual(chart('catalog-service'))
    expect(closes).toBe(0)
    return answers[0]
  }

  it('deletes the whole set through the writer WITH the confirm', async () => {
    const handleActionSet = vi.fn((ops: readonly unknown[]) => Promise.resolve(ops.map(() => ({ ok: true })))) as unknown as SandboxWriter['handleActionSet']
    expect(await discard(handleActionSet)).toEqual({ id: 'd1', message: 'Deleted page-fleet and everything it held (2 objects).', outcome: 'deleted' })
    const [ops, options] = (handleActionSet as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [{ path: string }[], Record<string, unknown>]
    expect(ops.map(({ path }) => new URLSearchParams(path.split('?')[1]).get('name'))).toEqual(['page-fleet', 'fleet-row'])
    expect(options).toEqual({})
  })

  it('a declined confirm deletes nothing and says so', async () => {
    expect(await discard(vi.fn(() => Promise.resolve(null)) as unknown as SandboxWriter['handleActionSet']))
      .toEqual({ id: 'd1', message: 'Nothing was deleted — page-fleet is still in Unowned drafts.', outcome: 'cancelled' })
  })

  it('a failed DELETE names what is left; no writer deletes nothing', async () => {
    const partial = vi.fn(() => Promise.resolve([{ ok: true }, { ok: false }])) as unknown as SandboxWriter['handleActionSet']
    expect(await discard(partial)).toMatchObject({ message: expect.stringContaining('rows/fleet-row') as string, outcome: 'failed' })
    cleanup()
    answers.length = 0
    expect(await discard(null)).toMatchObject({ outcome: 'failed' })
  })
})

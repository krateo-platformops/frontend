// @vitest-environment jsdom
/**
 * The draft-record autosave — the held draft, stored while the person works.
 *
 * What these pin, each a way work could be lost or a record lie:
 *   - a burst of edits is ONE write, of the last tree, after the debounce — not one per keystroke;
 *   - the first save POSTs, later saves PUT; a POST answering 409 (it exists: another tab, a resume)
 *     replaces it, and a PUT answering 404 (removed under us) creates it again;
 *   - flush writes NOW and cancels the timer (the write-ahead every preview calls);
 *   - closing the held draft writes its pending save — close is not discard — and deletes nothing;
 *   - a replaced draft's pending save is written under ITS name before the new one's timer starts;
 *   - a rendered tree's hash and a landed publish ride every later save;
 *   - no sandbox → no write, no error, status `off`;
 *   - a failed save is `error` with the reason — never silent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SetDispatchOptions, WriteOpResult } from '../../hooks/runRestSet'
import type { WriteOp } from '../BlastRadius/buildBlastRadius'

import { CHART_YAML_PATH } from './blueprintDraft'
import { createBlueprintDraftStore } from './blueprintDraftStore'
import type { SandboxWriter } from './blueprintRenderSandbox'
import { LABEL_PREVIEWED, LABEL_STATE, readDraftRecord, treeHash } from './draftRecord'
import { draftSaveStatus } from './draftSaveStatus'
import { createDraftAutosave, DRAFT_AUTOSAVE_DEBOUNCE_MS } from './useDraftAutosave'
import { createBroadcastingDraftStore } from './useDraftFileBuses'

const SANDBOX = 'krateo-preview'
const NOW = new Date('2026-09-29T10:02:00Z')

const chart = (name = 'demo-chart', extra = ''): Record<string, string> => ({
  [CHART_YAML_PATH]: `apiVersion: v2\nname: ${name}\nversion: 0.1.0\n`,
  'values.yaml': `enabled: true\n${extra}`,
})

interface Call { verb: WriteOp['verb']; path: string; payload: Record<string, unknown> | undefined; options?: SetDispatchOptions }

/** A writer whose answers are scripted per call (default 201/200). */
const writerFake = (answers: number[] = []) => {
  const calls: Call[] = []
  const writer: SandboxWriter = {
    handleActionSet: vi.fn((ops: readonly WriteOp[], options?: SetDispatchOptions): Promise<WriteOpResult[] | null> => {
      const [op] = ops
      calls.push({ options, path: op.path, payload: op.payload as Record<string, unknown> | undefined, verb: op.verb })
      const status = answers.shift() ?? (op.verb === 'POST' ? 201 : 200)
      return Promise.resolve([{ index: 0, message: status < 300 ? 'OK' : `refused ${status}`, ok: status < 300, status }])
    }),
    sandboxNamespace: SANDBOX,
  }
  return { calls, writer }
}

const bodyOf = (call: Call) => readDraftRecord(call.payload)
const labelsOf = (call: Call) => (call.payload?.metadata as { labels: Record<string, string> }).labels

const setup = (answers?: number[]) => {
  const autosave = createDraftAutosave({ now: () => NOW, username: () => 'Diego.Braga' })
  const store = createBlueprintDraftStore(autosave.onHeldChange)
  const { calls, writer } = writerFake(answers)
  autosave.setWriter(writer)
  return { autosave, calls, store, writer }
}

/** Run the debounce out and let the save chain settle. */
const elapse = async (ms = DRAFT_AUTOSAVE_DEBOUNCE_MS) => {
  await vi.advanceTimersByTimeAsync(ms)
}

beforeEach(() => {
  vi.useFakeTimers()
  draftSaveStatus.reset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('debounce', () => {
  it('a burst of edits is ONE write, of the last tree, after the window', async () => {
    const { calls, store } = setup()
    store.set(chart(), 'blueprint')
    store.updateFile('values.yaml', 'enabled: false\n')
    store.updateFile('values.yaml', 'enabled: true\nreplicas: 2\n')
    await elapse(DRAFT_AUTOSAVE_DEBOUNCE_MS - 1)
    expect(calls).toHaveLength(0)
    await elapse(1)
    expect(calls).toHaveLength(1)
    expect(calls[0].verb).toBe('POST')
    expect(calls[0].path).toBe(`/call?apiVersion=v1&resource=configmaps&name=-&namespace=${SANDBOX}`)
    const body = bodyOf(calls[0])
    expect(body?.files['values.yaml']).toBe('enabled: true\nreplicas: 2\n')
    expect(body).toMatchObject({ kind: 'blueprint', name: 'demo-chart', state: 'open', updatedAt: NOW.toISOString() })
    expect((calls[0].payload?.metadata as { name: string }).name).toBe('draft-blueprint-diego-braga-demo-chart')
    // Through the audited sandbox path, silent, and refetching nothing on screen.
    expect(calls[0].options).toEqual({ silent: true, skipConfirmForSandbox: SANDBOX, skipRevalidate: true })
  })

  it('later saves REPLACE the record (PUT, by name) and an unchanged tree is not written again', async () => {
    const { autosave, calls, store } = setup()
    store.set(chart(), 'blueprint')
    await elapse()
    store.updateFile('values.yaml', 'enabled: false\n')
    await elapse()
    expect(calls.map((call) => call.verb)).toEqual(['POST', 'PUT'])
    expect(calls[1].path).toBe(`/call?apiVersion=v1&resource=configmaps&name=draft-blueprint-diego-braga-demo-chart&namespace=${SANDBOX}`)
    await autosave.flush()
    expect(calls).toHaveLength(2)
  })
})

describe('create or replace', () => {
  it('a POST answering 409 (the record exists) falls back to PUT', async () => {
    const { calls, store } = setup([409])
    store.set(chart(), 'blueprint')
    await elapse()
    expect(calls.map((call) => call.verb)).toEqual(['POST', 'PUT'])
    expect(draftSaveStatus.get()).toMatchObject({ kind: 'blueprint', phase: 'saved' })
    // …and the record now counts as created: the next save is a PUT straight away.
    store.updateFile('values.yaml', 'x: 1\n')
    await elapse()
    expect(calls.map((call) => call.verb)).toEqual(['POST', 'PUT', 'PUT'])
  })

  it('a PUT answering 404 (removed while held) creates it again', async () => {
    const { calls, store } = setup([201, 404])
    store.set(chart(), 'blueprint')
    await elapse()
    store.updateFile('values.yaml', 'x: 1\n')
    await elapse()
    expect(calls.map((call) => call.verb)).toEqual(['POST', 'PUT', 'POST'])
  })

  it('a save that fails says so, with the reason — never silent', async () => {
    const { store } = setup([403])
    store.set(chart(), 'blueprint')
    await elapse()
    expect(draftSaveStatus.get()).toEqual({ kind: 'blueprint', phase: 'error', reason: 'refused 403' })
  })

  it('is `saving` while the write is on the wire', async () => {
    const { store, writer } = setup()
    let release: (value: WriteOpResult[]) => void = () => undefined
    vi.mocked(writer.handleActionSet).mockReturnValueOnce(new Promise((resolve) => { release = resolve }))
    store.set(chart(), 'blueprint')
    await elapse()
    expect(draftSaveStatus.get()).toEqual({ kind: 'blueprint', phase: 'saving' })
    release([{ index: 0, message: 'OK', ok: true, status: 201 }])
    await elapse(0)
    expect(draftSaveStatus.get()).toEqual({ kind: 'blueprint', phase: 'saved', savedAt: NOW.toISOString() })
  })
})

describe('write-ahead and lifecycle', () => {
  it('flush writes NOW and cancels the pending timer', async () => {
    const { autosave, calls, store } = setup()
    store.set(chart(), 'blueprint')
    await autosave.flush()
    expect(calls).toHaveLength(1)
    await elapse()
    expect(calls).toHaveLength(1)
  })

  it('CLOSE IS NOT DISCARD: a close writes the pending save, and nothing is ever deleted', async () => {
    const { calls, store } = setup()
    store.set(chart(), 'blueprint')
    store.updateFile('values.yaml', 'last: edit\n')
    store.clear()
    await elapse(0)
    expect(calls).toHaveLength(1)
    expect(bodyOf(calls[0])?.files['values.yaml']).toBe('last: edit\n')
    await elapse()
    expect(calls.every((call) => call.verb !== 'DELETE')).toBe(true)
  })

  it('a REPLACED draft\'s pending save is written under its own name first', async () => {
    const { calls, store } = setup()
    store.set(chart('first'), 'blueprint')
    store.set(chart('second'), 'blueprint')
    await elapse()
    expect(calls.map((call) => bodyOf(call)?.name)).toEqual(['first', 'second'])
  })

  it('a rendered tree\'s hash rides the record, and the previewed label says whether it still matches', async () => {
    const { autosave, calls, store } = setup()
    store.set(chart(), 'blueprint')
    await autosave.markRendered(store.get())
    expect(bodyOf(calls[0])?.renderedHash).toBe(treeHash(chart()))
    expect(labelsOf(calls[0])[LABEL_PREVIEWED]).toBe('true')
    store.updateFile('values.yaml', 'edited: after-preview\n')
    await elapse()
    expect(bodyOf(calls[1])?.renderedHash).toBe(treeHash(chart()))
    expect(labelsOf(calls[1])[LABEL_PREVIEWED]).toBe('false')
  })

  it('a landed publish marks the record published, with where it went', async () => {
    const { autosave, calls, store } = setup()
    store.set(chart(), 'blueprint')
    await autosave.markPublished(store.get()!, { target: { owner: 'acme', repo: 'demo-chart' } }, 'https://github.com/acme/demo-chart/pull/1')
    expect(bodyOf(calls[0])).toMatchObject({ publish: { prUrl: 'https://github.com/acme/demo-chart/pull/1', repo: 'acme/demo-chart' }, state: 'published' })
    expect(labelsOf(calls[0])[LABEL_STATE]).toBe('published')
  })

  it('the thread a record was first saved from is kept', async () => {
    const { autosave, calls, store } = setup()
    autosave.setThreadId('thread-a')
    store.set(chart(), 'blueprint')
    await elapse()
    autosave.setThreadId('thread-b')
    store.updateFile('values.yaml', 'x: 1\n')
    await elapse()
    expect(calls.map((call) => bodyOf(call)?.threadId)).toEqual(['thread-a', 'thread-a'])
  })

  it('a page is filed under its slug', async () => {
    const { calls, store } = setup()
    store.set({ 'templates/flex.page-orders.yaml': 'kind: Flex\nmetadata:\n  name: page-orders\n' }, 'page')
    await elapse()
    expect((calls[0].payload?.metadata as { name: string }).name).toBe('draft-page-diego-braga-orders')
  })
})

describe('the seam', () => {
  it('the provider\'s broadcasting store hands every held-draft change to the autosave', () => {
    const seen: (string | null)[] = []
    const store = createBroadcastingDraftStore(undefined, (held) => { seen.push(held?.kind ?? null) })
    store.set(chart(), 'blueprint')
    store.updateFile('values.yaml', 'x: 1\n')
    store.clear()
    expect(seen).toEqual(['blueprint', 'blueprint', null])
  })
})

describe('no sandbox', () => {
  it('is off: no write, no error, and flush resolves', async () => {
    const autosave = createDraftAutosave({ now: () => NOW, username: () => 'diego' })
    const store = createBlueprintDraftStore(autosave.onHeldChange)
    autosave.setWriter(undefined)
    store.set(chart(), 'blueprint')
    await elapse()
    await expect(autosave.flush()).resolves.toBeUndefined()
    await expect(autosave.markRendered(store.get())).resolves.toBeUndefined()
    expect(draftSaveStatus.get()).toEqual({ phase: 'off' })
  })

  it('a sandbox that arrives after the draft was held saves it', async () => {
    const autosave = createDraftAutosave({ now: () => NOW, username: () => 'diego' })
    const store = createBlueprintDraftStore(autosave.onHeldChange)
    store.set(chart(), 'blueprint')
    const { calls, writer } = writerFake()
    autosave.setWriter(writer)
    await elapse()
    expect(calls).toHaveLength(1)
  })
})

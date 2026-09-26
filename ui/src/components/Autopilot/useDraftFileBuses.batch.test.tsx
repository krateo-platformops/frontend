// @vitest-environment jsdom
/**
 * The provider's answer to a files batch — one composer gesture, several files.
 *
 * What these pin:
 *   - an accepted batch is ONE step of Undo, however many files it wrote;
 *   - a batch planned against the other kind of draft, or from bytes that have moved since, writes
 *     nothing and adds no Undo step — and says which;
 *   - a blueprint batch forgets the chart's arming, like every write to a chart (render-gated), so
 *     the broadcast says previewed:false and Publish goes off until Preview renders it again;
 *   - a page batch re-arms exactly as a page edit does: clean re-arms, lint-dirty forgets.
 */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createBlueprintDraftStore, type BlueprintDraftStore } from './blueprintDraftStore'
import { createBlueprintGate } from './blueprintGate'
import { draftHistory } from './draftHistory'
import { type DraftChangedDetail, onDraftChanged } from './previewDraftChanged'
import { emitFilesBatch, type FilesBatchDetail, type FilesBatchOutcome } from './previewFilesBatch'
import { heldDraftIdentity } from './publishCompile'
import { createBroadcastingDraftStore, useDraftFileBuses } from './useDraftFileBuses'

afterEach(() => {
  cleanup()
  draftHistory.clear()
})

const chart = (): Record<string, string> => ({
  'Chart.yaml': 'apiVersion: v2\nname: orders\nversion: 0.1.0\n',
  'templates/architecture.yaml': 'kind: ConfigMap\n',
  'values.schema.json': '{"type":"object"}',
})

const page = (): Record<string, string> => ({
  'Chart.yaml': 'apiVersion: v2\nname: page-orders\nversion: 0.1.0\n',
  'values.schema.json': '{"type":"object"}',
})

type Gate = Parameters<typeof useDraftFileBuses>[1]

const host = (store: BlueprintDraftStore, gate: Gate) => {
  const Hosted = () => {
    useDraftFileBuses(store, gate, heldDraftIdentity)
    return null
  }
  render(<Hosted />)
}

const batch = (detail: FilesBatchDetail): FilesBatchOutcome | null => {
  let outcome: FilesBatchOutcome | null = null
  act(() => { outcome = emitFilesBatch(detail) })
  return outcome
}

const place: FilesBatchDetail = {
  add: { 'templates/repository.yaml': 'kind: Repository\n' },
  edit: { 'templates/architecture.yaml': 'kind: ConfigMap\ndata: {}\n' },
  expect: { 'templates/architecture.yaml': 'kind: ConfigMap\n' },
  kind: 'blueprint',
}

describe('useDraftFileBuses — a files batch', () => {
  it('writes every file and is ONE Undo step, answered with the paths it wrote', () => {
    const store = createBlueprintDraftStore()
    store.set(chart(), 'blueprint')
    host(store, { forget: vi.fn(), recordPreview: vi.fn() })
    expect(batch(place)).toEqual({ ok: true, paths: ['templates/repository.yaml', 'templates/architecture.yaml'] })
    expect(store.get()?.files['templates/repository.yaml']).toBe('kind: Repository\n')
    expect(draftHistory.depth()).toBe(1)
    // …and that one step puts BOTH files back.
    expect(draftHistory.pop()?.files).toEqual(chart())
  })

  it('the other kind of draft: refused, nothing written, no Undo step', () => {
    const store = createBlueprintDraftStore()
    store.set(page(), 'page')
    const gate = { forget: vi.fn(), recordPreview: vi.fn() }
    host(store, gate)
    expect(batch({ add: { 'templates/a.yaml': 'a' }, kind: 'blueprint' })).toEqual({ error: 'the open draft is a portal page, not the one this preview shows', ok: false })
    expect(store.get()?.files).toEqual(page())
    expect(draftHistory.depth()).toBe(0)
    expect(gate.forget).not.toHaveBeenCalled()
    expect(gate.recordPreview).not.toHaveBeenCalled()
  })

  it('a plan made from bytes that have moved: refused by path, nothing written, no Undo step', () => {
    const store = createBlueprintDraftStore()
    store.set({ ...chart(), 'templates/architecture.yaml': 'kind: ConfigMap\n# an agent wrote this meanwhile\n' }, 'blueprint')
    host(store, { forget: vi.fn(), recordPreview: vi.fn() })
    expect(batch(place)).toEqual({ error: 'templates/architecture.yaml changed since this was planned — nothing was written', ok: false, path: 'templates/architecture.yaml' })
    expect(store.get()?.files['templates/repository.yaml']).toBeUndefined()
    expect(draftHistory.depth()).toBe(0)
  })

  it('a store refusal is the answer, with its path, and no Undo step', () => {
    const store = createBlueprintDraftStore()
    store.set(chart(), 'blueprint')
    host(store, { forget: vi.fn(), recordPreview: vi.fn() })
    expect(batch({ add: { 'Chart.yaml': 'x' }, kind: 'blueprint' })).toEqual({ error: '"Chart.yaml" is already in the draft — edit it instead', ok: false, path: 'Chart.yaml' })
    expect(draftHistory.depth()).toBe(0)
  })

  it('nothing held: refused', () => {
    host(createBlueprintDraftStore(), { forget: vi.fn(), recordPreview: vi.fn() })
    expect(batch(place)).toEqual({ error: 'no draft is held', ok: false })
  })

  it('a BLUEPRINT batch forgets the arming — the broadcast says previewed:false', () => {
    const gate = createBlueprintGate()
    const store = createBroadcastingDraftStore(gate)
    host(store, gate)
    act(() => { store.set(chart(), 'blueprint') })
    act(() => { gate.recordPreview('orders') })
    const heard: DraftChangedDetail[] = []
    const stop = onDraftChanged((detail) => { heard.push(detail) })
    batch(place)
    stop()
    expect(gate.isArmed('orders')).toBe(false)
    expect(heard[heard.length - 1]?.previewed).toBe(false)
  })

  it('a PAGE batch re-arms as a page edit does — clean re-arms, lint-dirty forgets', () => {
    const store = createBlueprintDraftStore()
    store.set(page(), 'page')
    const gate = { forget: vi.fn(), recordPreview: vi.fn() }
    host(store, gate)
    batch({ add: { 'flex.page-orders.yaml': 'kind: Flex\n' }, kind: 'page' })
    expect(gate.recordPreview).toHaveBeenCalledTimes(1)
    expect(gate.forget).not.toHaveBeenCalled()
    batch({ edit: { 'values.schema.json': '{"type":"object","default":{"a":1}}' }, kind: 'page' })
    expect(gate.forget).toHaveBeenCalledTimes(1)
    expect(gate.recordPreview).toHaveBeenCalledTimes(1)
  })
})

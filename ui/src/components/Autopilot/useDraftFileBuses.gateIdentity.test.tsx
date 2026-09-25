// @vitest-environment jsdom
/**
 * The publish gate is keyed by NAME, and an arming belongs to the draft that earned it.
 *
 * What these pin:
 *   - the broadcast says whether the held draft still stands previewed, and the gate announces its
 *     own changes (a render arms a draft the store already holds);
 *   - when the held draft becomes a DIFFERENT one — renamed in Chart.yaml, replaced, discarded —
 *     the old name's arming goes with it. It used to outlive its draft, so the next chart to reuse
 *     the name started out armed without ever rendering;
 *   - under StrictMode the provider's store is built twice, and only the kept one announces.
 */
import { act, cleanup, render } from '@testing-library/react'
import { StrictMode, useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { type BlueprintDraftStore } from './blueprintDraftStore'
import { type BlueprintGate, createBlueprintGate } from './blueprintGate'
import { type DraftChangedDetail, onDraftChanged } from './previewDraftChanged'
import { emitFileEdit } from './previewFileEdit'
import { heldDraftIdentity } from './publishCompile'
import { createBroadcastingDraftStore, useDraftFileBuses } from './useDraftFileBuses'

const chart = (name: string): Record<string, string> => ({
  'Chart.yaml': `apiVersion: v2\nname: ${name}\nversion: 0.1.0\n`,
  'values.schema.json': '{"type":"object"}',
})

const Host = ({ gate, store }: { gate: BlueprintGate; store: BlueprintDraftStore }) => {
  useDraftFileBuses(store, gate, heldDraftIdentity)
  return null
}

const listen = () => {
  const heard: DraftChangedDetail[] = []
  const stop = onDraftChanged((detail) => { heard.push(detail) })
  return { heard, stop }
}

afterEach(cleanup)

describe('the broadcast says whether the held draft still stands previewed', () => {
  it('false on a fresh hold, true once the gate arms it — the gate announces too', () => {
    const gate = createBlueprintGate()
    const store = createBroadcastingDraftStore(gate)
    render(<Host gate={gate} store={store} />)
    const { heard, stop } = listen()

    act(() => { store.set(chart('nginx-demo'), 'blueprint') })
    act(() => { gate.recordPreview('nginx-demo') })
    act(() => { gate.forget('nginx-demo') })
    stop()

    expect(heard.map((detail) => detail.previewed)).toEqual([false, true, false])
  })
})

describe('an arming belongs to the draft that earned it', () => {
  it('RENAMING the chart forgets the old name — a later chart reusing it starts unarmed', () => {
    const gate = createBlueprintGate()
    const store = createBroadcastingDraftStore(gate)
    render(<Host gate={gate} store={store} />)
    store.set(chart('my-chart'), 'blueprint')
    gate.recordPreview('my-chart')

    act(() => { emitFileEdit({ content: 'apiVersion: v2\nname: orders\nversion: 0.1.0\n', kind: 'blueprint', path: 'Chart.yaml' }) })

    expect(gate.isArmed('orders')).toBe(false)
    expect(gate.isArmed('my-chart')).toBe(false)
  })

  it('REPLACING the held chart with another forgets the one it replaced', () => {
    const gate = createBlueprintGate()
    const store = createBroadcastingDraftStore(gate)
    store.set(chart('alpha'), 'blueprint')
    gate.recordPreview('alpha')

    store.set(chart('beta'), 'blueprint')

    expect(gate.isArmed('alpha')).toBe(false)
  })

  it('a replacement under the SAME name keeps nothing it did not earn — the caller arms or forgets it', () => {
    const gate = createBlueprintGate()
    const store = createBroadcastingDraftStore(gate)
    store.set(chart('alpha'), 'blueprint')
    gate.recordPreview('alpha')

    store.set({ ...chart('alpha'), 'values.yaml': 'x: 1\n' }, 'blueprint')

    // Same identity: the store cannot know whether this tree rendered — recordBlueprintPreview,
    // the only caller that replaces in place, arms or forgets right after.
    expect(gate.isArmed('alpha')).toBe(true)
  })

  it('CLEARING forgets the name that was held', () => {
    const gate = createBlueprintGate()
    const store = createBroadcastingDraftStore(gate)
    store.set(chart('alpha'), 'blueprint')
    gate.recordPreview('alpha')

    store.clear()

    expect(gate.isArmed('alpha')).toBe(false)
  })
})

describe('under StrictMode', () => {
  it('only the kept store announces — a discarded one never reports "nothing held" over the real draft', () => {
    const gate = createBlueprintGate()
    let kept: BlueprintDraftStore | null = null
    // What the provider does: the store is built in a useState initializer, which StrictMode runs twice.
    const Provider = () => {
      const [store] = useState(() => createBroadcastingDraftStore(gate))
      kept = store
      useDraftFileBuses(store, gate, heldDraftIdentity)
      return null
    }
    render(<StrictMode><Provider /></StrictMode>)
    const { heard, stop } = listen()

    act(() => { kept?.set(chart('nginx-demo'), 'blueprint') })
    heard.length = 0
    act(() => { gate.recordPreview('nginx-demo') })
    stop()

    expect(heard).toHaveLength(1)
    expect(heard[0]).toMatchObject({ kind: 'blueprint', previewed: true })
  })
})
